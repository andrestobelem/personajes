import React from 'react';
import { subscribeToHostSessionReset } from './host-session-reset.ts';
import { CircumstancePanel } from './CircumstancePanel.tsx';
import { SessionModeSchema } from '../domain/http.ts';
import { MetaIndicationPayloadSchema } from '../domain/direction-indications.ts';
import type { RunStageView } from '../domain/run-observation.ts';
import { RunIdSchema } from '../domain/values.ts';
import { createHumanInteractionClient, type SessionDocument } from './human-interaction-client.ts';
import { createRunDramaticStructureClient } from './run-dramatic-structure-client.ts';
import { createRunDirectionClient, type DirectionDocument, type DirectionIntent, type RunDirectionClient } from './run-direction-client.ts';

const sessionClient = createHumanInteractionClient();
const structureClient = createRunDramaticStructureClient();
const directionClient = createRunDirectionClient();
type ScopeChoice = 'run' | 'scene';
type Indication = DirectionDocument['page']['events'][number];
const unresolvedByRun = new Map<string, DirectionIntent>();
const circumstanceLabels = {setDoorState:'estado de puerta',setLighting:'iluminación',setDeviceAvailability:'disponibilidad de dispositivo',setEnvironment:'condición ambiental',appearObject:'aparición de objeto preparado'};

function currentModeMatches(session: SessionDocument | null, runId: string, scope: ScopeChoice, sceneId: string | null) {
  const mode = session?.view.mode;
  if (mode?.kind !== 'director' || mode.runId !== runId || mode.scope.kind !== scope) return false;
  return scope === 'run' || (sceneId !== null && mode.scope.kind === 'scene' && mode.scope.sceneId === sceneId);
}

function definitiveFailure(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}

// Keep uncertain operations across remounts, but release terminal responses so the
// operator can correct the draft and submit a fresh idempotent operation.
export async function sendDirectionIntent(intent: DirectionIntent, client: Pick<RunDirectionClient, 'mutate'> = directionClient) {
  unresolvedByRun.set(intent.runId, intent);
  try {
    const result = await client.mutate(intent);
    unresolvedByRun.delete(intent.runId);
    return result;
  } catch (error) {
    if (definitiveFailure(error)) unresolvedByRun.delete(intent.runId);
    throw error;
  }
}

export function MetaIndicationComposer({ enabled, recipients, availableRecipients, text, scope, onRecipientsChange, onTextChange, onSubmit }: {
  enabled: boolean;
  recipients: string[];
  availableRecipients: Array<{ characterId: string; label: string }>;
  text: string;
  scope: ScopeChoice;
  onRecipientsChange: (recipients: string[]) => void;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
}) {
  const invalidText = text.includes('\0') || new TextEncoder().encode(text).byteLength > 4_000;
  const canSubmit = enabled && recipients.length > 0 && text.trim().length > 0 && !invalidText;
  return <form onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(); }}>
    <h3>Indicación privada</h3>
    <fieldset disabled={!enabled}>
      <legend>Personajes destinatarios</legend>
      {availableRecipients.length === 0
        ? <p>{scope === 'scene' ? 'La escena activa no tiene personajes preparados.' : 'No hay personajes preparados.'}</p>
        : availableRecipients.map((person) => <label className="dramatic-check" key={person.characterId}>
          <input type="checkbox" checked={recipients.includes(person.characterId)} onChange={(event) => onRecipientsChange(event.currentTarget.checked
            ? [...recipients, person.characterId] : recipients.filter((id) => id !== person.characterId))} />
          {person.label}
        </label>)}
    </fieldset>
    <label>Texto para el personaje<textarea value={text} maxLength={4_000} disabled={!enabled} onChange={(event) => onTextChange(event.currentTarget.value)} placeholder="Indicá una intención de dirección, sin dictar una respuesta literal." /></label>
    {invalidText && <p role="alert">El texto no puede contener NUL ni superar 4.000 bytes UTF-8.</p>}
    <button type="submit" disabled={!canSubmit}>Registrar metaindicación</button>
  </form>;
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

  React.useEffect(()=>subscribeToHostSessionReset(()=>{
    epoch.current+=1;setSession(null);setDocument(null);setOptions(null);setRecipients([]);setBusy(false);setLoading(false);
    setMessage('La sesión del host cambió. Actualizá la sesión y activá Dirección de nuevo; el texto se conserva.');
  }),[]);

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
        const directionDocument = await directionClient.readComplete(runId);
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
      const next = await directionClient.readComplete(runId);
      if (started !== epoch.current) return;
      setDocument(next);
      setMessage('Modo Dirección confirmado por el host.');
    } catch (error) {
      if(started===epoch.current)setMessage(error instanceof Error ? error.message : 'No se pudo activar Dirección.');
    } finally {
      if(started===epoch.current)setBusy(false);
    }
  }

  async function submit(intent: DirectionIntent) {
    if (busy || !directorActive) return;
    const started=epoch.current;
    setPending(intent);
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendDirectionIntent(intent);
      if(started!==epoch.current)return;
      if (result.kind === 'stored' || result.kind === 'existing') {
        unresolvedByRun.delete(runId);
        setPending(null);
        if (intent.payload.kind === 'metaIndication') {
          setText('');
          setRecipients([]);
        }
        setMessage(result.kind === 'existing' ? 'Se recuperó la misma operación ya registrada.' : intent.payload.kind === 'metaIndication'
          ? 'Metaindicación registrada en el ledger de Dirección.' : 'Metaindicación revocada para turnos nuevos.');
        try {
          const next=await directionClient.readComplete(runId);if(started!==epoch.current)return;setDocument(next);
        } catch {
          if(started!==epoch.current)return;setDocument(null);
          setMessage('La operación quedó confirmada, pero no se pudo actualizar el historial. Actualizá sesión y ledger antes de continuar.');
        }
      } else {
        unresolvedByRun.delete(runId);
        setPending(null);
        setMessage(result.kind === 'conflict'
          ? 'El ledger cambió durante el envío. Actualizá Dirección y revisá la indicación antes de crear otra operación.'
          : 'El host no pudo confirmar la indicación para este alcance. Actualizá Dirección y revisá la escena.');
      }
    } catch (error) {
      if(started!==epoch.current)return;
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      setPending(unresolvedByRun.get(runId) ?? null);
      setMessage(error instanceof Error
        ? `${error.message}${status === undefined || status === 408 || status >= 500 ? ' Se conserva la misma operación para reintentar.' : ''}`
        : 'Resultado incierto. Se conserva la misma operación para reintentar.');
    } finally {
      if(started===epoch.current)setBusy(false);
    }
  }

  const scopeForPayload = scope === 'scene' && activeSceneId !== null
    ? { kind: 'scene' as const, sceneId: activeSceneId }
    : { kind: 'run' as const };
  const canEdit = active && lifecycle === 'running' && directorActive && pending === null && !busy && !loading && document !== null;
  const canRevoke = active && ['ready','running','paused','stopped'].includes(lifecycle) && directorActive
    && pending === null && !busy && !loading && document !== null;
  const revokedIds = new Set(document?.page.events.flatMap((event) => event.payload.kind === 'revokeMetaIndication' ? [event.payload.targetOperationId] : []) ?? []);

  return <section className="dramatic-structure-panel director-indications" aria-label="Metaindicaciones del Director">
    <header><span className="eyebrow">CANAL PRIVADO DE DIRECCIÓN</span><h2>Metaindicaciones</h2>
      <p>Se entregan al personaje como guía administrativa separada de su diálogo, memoria e historia. No reemplazan identidad, conocimiento, deseos ni capacidades; el actor conserva su punto de vista y puede resistirse.</p>
      <p>Las indicaciones vigentes se presentan juntas, sin una prioridad implícita entre ellas. Revocar una indicación impide su entrega a turnos nuevos; conserva el historial y no altera turnos ya preparados.</p>
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
      <div>
        <MetaIndicationComposer enabled={canEdit} recipients={recipients} availableRecipients={availableRecipients} text={text} scope={scope}
          onRecipientsChange={setRecipients} onTextChange={setText} onSubmit={() => {
            if (!canEdit || document === null) return;
            const payload = MetaIndicationPayloadSchema.parse({ kind: 'metaIndication', recipients, text, scope: scopeForPayload });
            void submit({ runId: RunIdSchema.parse(runId), etag: document.etag, key: crypto.randomUUID(), payload });
          }} />
        {lifecycle !== 'running' && <p>La representación debe estar en curso para registrar una indicación nueva.</p>}
        {!directorActive && <p>Activá el modo Dirección con el alcance elegido antes de escribir.</p>}
      </div>
    </div>
    {pending !== null && <div className="dramatic-pending" role="alert"><p>El resultado de esta operación sigue pendiente; se conserva la misma clave idempotente.</p>
      <button disabled={busy || !directorActive} onClick={() => void submit(pending)}>Reintentar la misma indicación</button></div>}
    <CircumstancePanel runId={runId} session={session} active={active} onCommitted={() => void reload()} />
    <section className="dramatic-event-log" aria-label="Historial de metaindicaciones">
      <h3>Historial del ledger</h3>
      {document === null ? <p>El historial está disponible al activar Dirección para esta corrida.</p> : document.page.events.length === 0
        ? <p>No hay metaindicaciones registradas.</p>
        : <ol>{document.page.events.map((event: Indication) => <li key={event.operationId}>
          <strong>{event.payload.scope.kind === 'run' ? 'Alcance: corrida' : `Alcance: escena ${event.payload.scope.sceneId}`}</strong>
          {((event.payload.scope.kind === 'scene' && event.payload.scope.sceneId !== activeSceneId)
            || (event.payload.scope.kind === 'run' && lifecycle === 'closed'))
            && <span> · alcance vencido; ya no se entrega a turnos nuevos</span>}
          {event.payload.kind === 'metaIndication' ? <>
            <p>{event.payload.text}</p>
            <p className="muted">Personajes: {event.payload.recipients.map((id) => options?.participants.find((person) => person.characterId === id)?.label ?? id).join(', ')}</p>
            {revokedIds.has(event.operationId) ? <p>Revocada: no se entrega a turnos nuevos.</p> : <button type="button"
              disabled={!canRevoke || (session?.view.mode.kind === 'director' && session.view.mode.scope.kind === 'scene'
                && (event.payload.scope.kind !== 'scene' || session.view.mode.scope.sceneId !== event.payload.scope.sceneId))}
              onClick={() => {
                if (!canRevoke || document === null) return;
                void submit({ runId: RunIdSchema.parse(runId), etag: document.etag, key: crypto.randomUUID(), payload: {
                  kind: 'revokeMetaIndication', targetOperationId: event.operationId, scope: event.payload.scope,
                } });
              }}>Revocar metaindicación</button>}
          </> : event.payload.kind === 'changeCircumstance' ? <p>Cambio de circunstancia física: {circumstanceLabels[event.payload.operation.kind]}. El registro conserva la operación; los efectos confirmados se consultan en el Escenario.</p> : <p>Revocación de la metaindicación {event.payload.targetOperationId}. No modifica turnos ya preparados ni borra el historial.</p>}
          <p className="muted">Revisión {event.directionRevision} · registrada {new Date(event.recordedAt).toISOString()}</p>
        </li>)}</ol>}
    </section>
  </section>;
}
