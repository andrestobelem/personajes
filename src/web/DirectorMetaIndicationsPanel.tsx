import React from 'react';
import { SessionModeSchema } from '../domain/http.ts';
import { MetaIndicationPayloadSchema } from '../domain/direction-indications.ts';
import type { RunStageView } from '../domain/run-observation.ts';
import { RunIdSchema } from '../domain/values.ts';
import { createHumanInteractionClient, type SessionDocument } from './human-interaction-client.ts';
import { createRunDramaticStructureClient } from './run-dramatic-structure-client.ts';
import { createRunDirectionClient, type DirectionDocument, type DirectionIntent } from './run-direction-client.ts';

const sessionClient = createHumanInteractionClient();
const structureClient = createRunDramaticStructureClient();
const directionClient = createRunDirectionClient();
type ScopeChoice = 'run' | 'scene';
type Indication = DirectionDocument['page']['events'][number];
const unresolvedByRun = new Map<string, DirectionIntent>();

function currentModeMatches(session: SessionDocument | null, runId: string, scope: ScopeChoice, sceneId: string | null) {
  const mode = session?.view.mode;
  if (mode?.kind !== 'director' || mode.runId !== runId || mode.scope.kind !== scope) return false;
  return scope === 'run' || (sceneId !== null && mode.scope.kind === 'scene' && mode.scope.sceneId === sceneId);
}

export function DirectorMetaIndicationsPanel({
  runId, lifecycle, activeSceneId, activeSceneLabel, sceneParticipantIds,
  active = true,
}: {
  runId: string;
  lifecycle: RunStageView['lifecycle'];
  activeSceneId: string | null;
  activeSceneLabel: string | null;
  sceneParticipantIds: string[];
  active?: boolean;
}) {
  const [session, setSession] = React.useState<SessionDocument | null>(null);
  const [options, setOptions] = React.useState<Awaited<ReturnType<typeof structureClient.sceneOptions>> | null>(null);
  const [document, setDocument] = React.useState<DirectionDocument | null>(null);
  const [scope, setScope] = React.useState<ScopeChoice>('run');
  const [recipients, setRecipients] = React.useState<string[]>([]);
  const [text, setText] = React.useState('');
  const [pending, setPending] = React.useState<DirectionIntent | null>(() => unresolvedByRun.get(runId) ?? null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const epoch = React.useRef(0);

  const directorActive = currentModeMatches(session, runId, scope, activeSceneId);
  const availableRecipients = React.useMemo(() => {
    const all = options?.participants ?? [];
    return scope === 'scene'
      ? all.filter((person) => sceneParticipantIds.includes(person.characterId))
      : all;
  }, [options, scope, sceneParticipantIds]);

  const reload = React.useCallback(async () => {
    const started = ++epoch.current;
    setLoading(true);
    try {
      const [sessionDocument, sceneOptions] = await Promise.all([
        sessionClient.session(), structureClient.sceneOptions(runId, new AbortController().signal),
      ]);
      if (started !== epoch.current) return;
      setSession(sessionDocument);
      setOptions(sceneOptions);
      if (sessionDocument.view.mode.kind === 'director' && sessionDocument.view.mode.runId === runId) {
        setScope(sessionDocument.view.mode.scope.kind);
        const directionDocument = await directionClient.read(runId);
        if (started !== epoch.current) return;
        setDocument(directionDocument);
      } else {
        setDocument(null);
      }
      setMessage(null);
    } catch (error) {
      if (started === epoch.current) setMessage(error instanceof Error ? error.message : 'No se pudo actualizar Dirección.');
    } finally {
      if (started === epoch.current) setLoading(false);
    }
  }, [runId]);

  React.useEffect(() => {
    if (!active) return;
    void reload();
    return () => { epoch.current += 1; };
  }, [active, reload]);

  React.useEffect(() => {
    setRecipients([]);
  }, [scope, activeSceneId, runId]);

  React.useEffect(() => {
    setPending(unresolvedByRun.get(runId) ?? null);
  }, [runId]);

  async function activateDirector() {
    if (session === null || busy) return;
    const started = epoch.current;
    setBusy(true);
    setMessage(null);
    try {
      const candidate = SessionModeSchema.parse({
        kind: 'director', runId,
        scope: scope === 'scene' && activeSceneId !== null ? { kind: 'scene', sceneId: activeSceneId } : { kind: 'run' },
      });
      const result = await sessionClient.mutate({ kind: 'mode', mode: candidate, etag: session.etag, key: crypto.randomUUID() });
      if (started !== epoch.current) return;
      if (result.kind !== 'mode') throw new Error('El host no confirmó el modo Dirección.');
      setSession(result.document);
      const next = await directionClient.read(runId);
      if (started !== epoch.current) return;
      setDocument(next);
      setMessage('Modo Dirección confirmado por el host.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo activar Dirección.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(intent: DirectionIntent) {
    if (busy || !directorActive) return;
    unresolvedByRun.set(runId, intent);
    setPending(intent);
    setBusy(true);
    setMessage(null);
    try {
      const result = await directionClient.mutate(intent);
      if (result.kind === 'stored' || result.kind === 'existing') {
        unresolvedByRun.delete(runId);
        setPending(null);
        setText('');
        setRecipients([]);
        setMessage(result.kind === 'existing' ? 'Se recuperó la misma indicación ya registrada.' : 'Metaindicación registrada en el ledger de Dirección.');
        setDocument(await directionClient.read(runId));
      } else {
        unresolvedByRun.delete(runId);
        setPending(null);
        setMessage(result.kind === 'conflict'
          ? 'El ledger cambió durante el envío. Actualizá Dirección y revisá la indicación antes de crear otra operación.'
          : 'El host no pudo confirmar la indicación para este alcance. Actualizá Dirección y revisá la escena.');
      }
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      if (status !== undefined && status >= 400 && status < 500 && status !== 408) setPending(null);
      setMessage(error instanceof Error
        ? `${error.message}${status === undefined || status === 408 || status >= 500 ? ' Se conserva la misma operación para reintentar.' : ''}`
        : 'Resultado incierto. Se conserva la misma operación para reintentar.');
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (document === null || busy) return;
    const last = document.page.events.at(-1)?.directionRevision ?? 0;
    if (!document.page.hasMore || last === 0) return;
    setBusy(true);
    try {
      const next = await directionClient.read(runId, last);
      setDocument({ page: { ...next.page, events: [...document.page.events, ...next.page.events] }, etag: next.etag });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo ampliar el historial de Dirección.');
    } finally {
      setBusy(false);
    }
  }

  const scopeForPayload = scope === 'scene' && activeSceneId !== null
    ? { kind: 'scene' as const, sceneId: activeSceneId }
    : { kind: 'run' as const };
  const invalidText = text.includes('\0') || new TextEncoder().encode(text).byteLength > 4_000;
  const canWrite = active && lifecycle === 'running' && directorActive && pending === null && !busy
    && document !== null && recipients.length > 0 && text.trim().length > 0 && !invalidText;

  return <section className="dramatic-structure-panel director-indications" aria-label="Metaindicaciones del Director">
    <header><span className="eyebrow">CANAL PRIVADO DE DIRECCIÓN</span><h2>Metaindicaciones</h2>
      <p>Se entregan al personaje como guía administrativa separada de su diálogo, memoria e historia. No reemplazan identidad, conocimiento, deseos ni capacidades; el actor conserva su punto de vista y puede resistirse.</p>
    </header>
    {loading && <p role="status">Consultando sesión y ledger de Dirección…</p>}
    {message !== null && <p role="status">{message}</p>}
    {session !== null && <p className="muted">Modo actual: {session.view.mode.kind === 'director' && session.view.mode.runId === runId
      ? `Dirección · ${session.view.mode.scope.kind === 'run' ? 'corrida' : `escena ${session.view.mode.scope.sceneId}`}`
      : session.view.mode.kind === 'interlocutor' ? 'Interlocución' : 'Observar'}.</p>}
    <div className="dramatic-structure-actions">
      <form onSubmit={(event) => { event.preventDefault(); void activateDirector(); }}>
        <h3>Autoridad de la sesión</h3>
        <label>Alcance
          <select value={scope} disabled={busy} onChange={(event) => setScope(event.currentTarget.value === 'scene' ? 'scene' : 'run')}>
            <option value="run">Corrida</option>
            <option value="scene" disabled={activeSceneId === null}>{activeSceneLabel === null ? 'Escena activa' : `Escena activa · ${activeSceneLabel}`}</option>
          </select>
        </label>
        {!directorActive && <button type="submit" disabled={session === null || busy || (scope === 'scene' && activeSceneId === null)}>
          {scope === 'scene' ? 'Activar Dirección en esta escena' : 'Activar Dirección en la corrida'}
        </button>}
        {directorActive && <p>La sesión tiene autoridad de Dirección para el alcance seleccionado.</p>}
        <button type="button" disabled={busy} onClick={() => void reload()}>Actualizar sesión y ledger</button>
      </form>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!canWrite || document === null) return;
        const payload = MetaIndicationPayloadSchema.parse({ kind: 'metaIndication', recipients, text, scope: scopeForPayload });
        void submit({ runId: RunIdSchema.parse(runId), etag: document.etag, key: crypto.randomUUID(), payload });
      }}>
        <h3>Indicación privada</h3>
        <fieldset disabled={!canWrite}>
          <legend>Personajes destinatarios</legend>
          {availableRecipients.length === 0
            ? <p>{scope === 'scene' ? 'La escena activa no tiene personajes preparados.' : 'No hay personajes preparados.'}</p>
            : availableRecipients.map((person) => <label className="dramatic-check" key={person.characterId}>
              <input type="checkbox" checked={recipients.includes(person.characterId)} onChange={(event) => setRecipients((current) => event.currentTarget.checked
                ? [...current, person.characterId] : current.filter((id) => id !== person.characterId))} />
              {person.label}
            </label>)}
        </fieldset>
        <label>Texto para el personaje<textarea value={text} maxLength={4_000} disabled={!canWrite} onChange={(event) => setText(event.currentTarget.value)} placeholder="Indicá una intención de dirección, sin dictar una respuesta literal." /></label>
        {invalidText && <p role="alert">El texto no puede contener NUL ni superar 4.000 bytes UTF-8.</p>}
        {lifecycle !== 'running' && <p>La representación debe estar en curso para registrar una indicación nueva.</p>}
        {!directorActive && <p>Activá el modo Dirección con el alcance elegido antes de escribir.</p>}
        <button type="submit" disabled={!canWrite}>Registrar metaindicación</button>
      </form>
    </div>
    {pending !== null && <div className="dramatic-pending" role="alert"><p>El resultado de esta operación sigue pendiente; se conserva la misma clave idempotente.</p>
      <button disabled={busy || !directorActive} onClick={() => void submit(pending)}>Reintentar la misma indicación</button></div>}
    <section className="dramatic-event-log" aria-label="Historial de metaindicaciones">
      <h3>Historial del ledger</h3>
      {document === null ? <p>El historial está disponible al activar Dirección para esta corrida.</p> : document.page.events.length === 0
        ? <p>No hay metaindicaciones registradas.</p>
        : <ol>{document.page.events.map((event: Indication) => <li key={event.operationId}>
          <strong>{event.payload.scope.kind === 'run' ? 'Alcance: corrida' : `Alcance: escena ${event.payload.scope.sceneId}`}</strong>
          {((event.payload.scope.kind === 'scene' && event.payload.scope.sceneId !== activeSceneId)
            || (event.payload.scope.kind === 'run' && lifecycle === 'closed'))
            && <span> · alcance vencido; ya no se entrega a turnos nuevos</span>}
          <p>{event.payload.text}</p>
          <p className="muted">Personajes: {event.payload.recipients.map((id) => options?.participants.find((person) => person.characterId === id)?.label ?? id).join(', ')} · revisión {event.directionRevision} · registrada {new Date(event.recordedAt).toISOString()}</p>
        </li>)}</ol>}
      {document?.page.hasMore && <button type="button" disabled={busy} onClick={() => void loadMore()}>Cargar indicaciones anteriores</button>}
    </section>
  </section>;
}
