import React from 'react';
import { z } from 'zod';
import type { RunStageView } from '../domain/run-observation.ts';
import type { DramaticEpisodeViewSchema, DramaticStructureEventSchema } from '../domain/dramatic-structure.ts';
import { createRunDramaticStructureClient, type DramaticStructureDocument, type RunDramaticStructureClient, type StructureMutation, type StructureMutationIntent } from './run-dramatic-structure-client.ts';

const defaultClient = createRunDramaticStructureClient();
type StructureEvent = z.infer<typeof DramaticStructureEventSchema>;
type ConfirmedEvent = { eventId: string; summary: string };
type SceneOptions = Awaited<ReturnType<typeof defaultClient.sceneOptions>>;
type HistoricalCut = { worldRevision: number; worldSeq: number };
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; document: DramaticStructureDocument; events: StructureEvent[]; options: SceneOptions | null };
type Pending = StructureMutationIntent & { bodyLabel: string };

function sceneName(event: StructureEvent): { id: string; label: string } | undefined {
  const payload = event.payload;
  if (event.kind !== 'sceneOpened') return undefined;
  const scene = z.object({ id: z.string().uuid(), label: z.string().min(1).max(200) }).safeParse(payload['scene']);
  return scene.success ? scene.data : undefined;
}
type SceneCuts = { openingCommitIndex?: number; closingCommitIndex?: number };
function sceneCutsById(events: readonly StructureEvent[]): Map<string, SceneCuts> {
  const cuts = new Map<string, SceneCuts>();
  function record(sceneId: string, cut: 'openingCommitIndex' | 'closingCommitIndex', commitIndex: number) {
    const current = cuts.get(sceneId) ?? {};
    if (current[cut] === undefined) current[cut] = commitIndex;
    cuts.set(sceneId, current);
  }
  for (const event of events) {
    if (event.kind === 'episodeOpened') {
      const initialSceneId = z.string().uuid().safeParse(event.payload['associatedInitialSceneId']);
      if (initialSceneId.success) record(initialSceneId.data, 'openingCommitIndex', event.commitIndex);
    } else if (event.kind === 'sceneOpened') {
      const scene = sceneName(event);
      if (scene !== undefined) record(scene.id, 'openingCommitIndex', event.commitIndex);
    } else if (event.kind === 'sceneClosed') {
      const sceneId = z.string().uuid().safeParse(event.payload['sceneId']);
      if (sceneId.success) record(sceneId.data, 'closingCommitIndex', event.commitIndex);
    }
  }
  return cuts;
}
const eventNames: Record<StructureEvent['kind'], string> = {
  episodeOpened: 'Se abrió un episodio', episodeClosed: 'Se cerró un episodio',
  sceneOpened: 'Se abrió una escena', sceneClosed: 'Se cerró una escena', actsSet: 'Se actualizaron los actos',
};

export function structureLifecycleAllowsEdit(lifecycle: RunStageView['lifecycle'], derivedPreparation: boolean) {
  return lifecycle === 'running' || lifecycle === 'paused' || lifecycle === 'stopped' || (lifecycle === 'ready' && derivedPreparation);
}

export function EpisodeForkOrigins({ episode }: { episode: z.infer<typeof DramaticEpisodeViewSchema> }) {
  const origins = episode.forkOrigins ?? [];
  if (origins.length === 0) return null;
  return <details><summary>Base dramática heredada ({origins.length} orígenes)</summary><p>Este episodio y sus actos se conservaron desde otra representación. Los cortes locales de base no son nuevas aperturas ni cierres de la ficción.</p><ul>{origins.map((origin, index) => <li key={`${origin.source.runId}:${origin.episodeId}:${index}`}>
    Origen <code>{origin.source.runId}</code> · episodio <code>{origin.episodeId}</code> · corte fuente commit {origin.source.commitIndex} · secuencia {origin.source.worldSeq}.
    <p>Apertura en origen: commit {origin.openingCut.commitIndex} · secuencia {origin.openingCut.worldSeq}{origin.closingCut === null ? ' · sin cierre heredado' : ` · cierre en origen: commit ${origin.closingCut.commitIndex} · secuencia ${origin.closingCut.worldSeq}`}.</p>
    {origin.consequenceEventIds.length > 0 && <p>Consecuencias del origen: {origin.consequenceEventIds.map((id) => <code key={id}>{id} </code>)}</p>}
    {origin.openLines.map((line) => <p key={line.lineId}>Línea heredada: {line.lineId} · evidencia en origen: {line.evidenceEventIds.join(', ')}</p>)}
  </li>)}</ul></details>;
}

export function DramaticStructurePanel({
  runId, lifecycle, active, refreshToken, confirmedEvents, historicalCut, onSelectCommit, derivedPreparation = false, sceneLabels = [], structureClient = defaultClient,
}: {
  runId: string;
  lifecycle: RunStageView['lifecycle'];
  derivedPreparation?: boolean;
  active: boolean;
  refreshToken: string;
  confirmedEvents: ConfirmedEvent[];
  sceneLabels?: readonly { id: string; label: string }[];
  historicalCut?: HistoricalCut;
  onSelectCommit?: (commitIndex: number) => void;
  structureClient?: RunDramaticStructureClient;
}) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [episodeTitle, setEpisodeTitle] = React.useState('');
  const [sceneLabel, setSceneLabel] = React.useState('');
  const [participants, setParticipants] = React.useState<string[]>([]);
  const [scenePlaces, setScenePlaces] = React.useState<string[]>([]);
  const [sceneReason, setSceneReason] = React.useState('Cierre de escena');
  const [consequences, setConsequences] = React.useState<string[]>([]);
  const [lineId, setLineId] = React.useState('');
  const [lineEvidence, setLineEvidence] = React.useState<string[]>([]);
  const [actTitle, setActTitle] = React.useState('');
  const [actSceneIds, setActSceneIds] = React.useState<string[]>([]);
  const [actDraft, setActDraft] = React.useState<Array<{ title: string; sceneIds: string[] }>>([]);
  const [saving, setSaving] = React.useState(false);
  const [structureRefresh, setStructureRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const load = historicalCut === undefined
      ? Promise.all([structureClient.read(runId, controller.signal), structureClient.allEvents(runId, controller.signal), structureClient.sceneOptions(runId, controller.signal)])
        .then(([document, history, options]) => ({ document, events: history.events, options }))
      : structureClient.read(runId, controller.signal, historicalCut).then(async (document) => {
        if (document.value.commitIndex === undefined) throw new Error('El corte histórico no informó commitIndex.');
        const history = await structureClient.allEvents(runId, controller.signal, document.value.commitIndex);
        return { document, events: history.events, options: null };
      });
    void load.then(({ document, events, options }) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', document, events, options });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', message: error instanceof Error ? error.message : 'No se pudo leer la estructura de la obra.' });
      });
    return () => controller.abort();
  }, [runId, active, refreshToken, structureRefresh, structureClient, historicalCut?.worldRevision, historicalCut?.worldSeq]);

  const structure = state.kind === 'ready' ? state.document.value : undefined;
  const currentEpisode = structure?.episodes.find((episode) => episode.episodeId === structure.activeEpisodeId);
  const activeSceneId = structure?.activeSceneId ?? null;
  const participantPlaceMissing = state.kind === 'ready' && participants.some((participantId) => {
    const participant = state.options?.participants.find((item) => item.characterId === participantId);
    return participant !== undefined && !scenePlaces.includes(participant.placeId);
  });
  const historical = historicalCut !== undefined;
  const canEdit = !historical && active && structureLifecycleAllowsEdit(lifecycle, derivedPreparation) && state.kind === 'ready' && !saving;
  const labels = new Map(sceneLabels.map((scene) => [scene.id, scene.label]));
  if (state.kind === 'ready') for (const event of state.events) {
    const value = sceneName(event);
    if (value !== undefined) labels.set(value.id, value.label);
  }
  for (const scene of structure?.unassignedLegacyScenes ?? []) labels.set(scene.id, scene.label);
  const allScenes = currentEpisode?.sceneIds ?? [];
  const sceneCuts = state.kind === 'ready' ? sceneCutsById(state.events) : new Map<string, SceneCuts>();

  async function submit(mutation: StructureMutation, bodyLabel: string, reuse?: Pending) {
    if (state.kind !== 'ready') return;
    const intent: Pending = reuse ?? { runId, etag: state.document.etag, key: crypto.randomUUID(), mutation, bodyLabel };
    setPending(intent);
    setSaving(true);
    setMessage(null);
    const controller = new AbortController();
    try {
      const result = await structureClient.mutate(intent, controller.signal);
      if (result.kind === 'stored' || result.kind === 'existing') {
        setPending(null);
        setMessage(result.kind === 'existing' ? `La operación «${bodyLabel}» ya estaba confirmada; se recuperó el mismo recibo.` : `La operación «${bodyLabel}» quedó confirmada en la historia estructural.`);
        setEpisodeTitle('');
        setSceneLabel('');
        setConsequences([]);
        setLineId('');
        setLineEvidence([]);
        setActDraft([]);
        setStructureRefresh((value) => value + 1);
      } else {
        setMessage(result.kind === 'conflict' ? 'La estructura avanzó durante el envío. Recargá y revisá el corte antes de volver a intentarlo.' : result.kind === 'invalidState' ? `El Escenario rechazó la transición (${result.code}); actualizá la estructura antes de continuar.` : 'La representación ya no está disponible.');
      }
      if (result.kind !== 'stored' && result.kind !== 'existing') setStructureRefresh((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} La misma operación queda disponible para reintentar.` : 'No se confirmó la operación. La misma clave queda disponible para reintentar.');
    } finally {
      setSaving(false);
    }
  }

  function selectedOptions(event: React.ChangeEvent<HTMLSelectElement>, setValue: (value: string[]) => void) {
    setValue(Array.from(event.currentTarget.selectedOptions, (option) => option.value));
  }
  function closeEpisode() {
    if (currentEpisode === undefined) return;
    const openLines = lineId.trim() === '' ? [] : [{ lineId: lineId.trim(), evidenceEventIds: lineEvidence }];
    void submit({ kind: 'closeEpisode', episodeId: currentEpisode.episodeId, consequenceEventIds: consequences, openLines }, 'El episodio');
  }

  return <section className="dramatic-structure-panel" aria-label="Estructura dramática">
    <header><span className="eyebrow">LA OBRA EN CURSO</span><h2>Episodios y escenas</h2>
      <p>El Director observa el progreso dramático; estas acciones registran decisiones estructurales del operador. Abrir o cerrar una unidad no inventa hechos ni adelanta el reloj.</p>
      {historical && <p className="muted">Corte histórico inmutable: revisión de mundo {historicalCut.worldRevision} · secuencia {historicalCut.worldSeq} · commit {state.kind === 'ready' ? state.document.value.commitIndex : '…'}.</p>}
      {state.kind === 'ready' && <p className="muted">Revisión estructural {structure?.structureRevision} · Escenario {structure?.activeEpisodeId === null ? 'sin episodio activo' : 'con episodio activo'} · {structure?.activeSceneId === null ? 'entre escenas' : 'escena abierta'}</p>}
    </header>
    {state.kind === 'loading' && <p role="status">Leyendo episodios, escenas y cambios confirmados…</p>}
    {state.kind === 'error' && <p role="alert">{state.message}</p>}
    {message && <p role="status">{message}</p>}
    {state.kind === 'ready' && structure !== undefined && <>
      {structure.episodes.length === 0 && <p>No hay episodios estructurados todavía. Las escenas heredadas aparecen aparte; la migración no les inventa episodio ni cierre.</p>}
      <ol className="dramatic-episodes">{structure.episodes.map((episode) => <li key={episode.episodeId}>
        <strong>{episode.ordinal}. {episode.title ?? `Episodio ${episode.ordinal}`}</strong> · {episode.lifecycle === 'open' ? 'abierto' : 'cerrado'}
        <EpisodeForkOrigins episode={episode} />
        <p className="muted">{(episode.forkOrigins?.length ?? 0) > 0 ? 'Base local heredada: commit ' : 'Apertura: commit '}{episode.openingCut.commitIndex} · secuencia {episode.openingCut.worldSeq}
          {episode.closingCut === null ? ' · sin corte de cierre' : ` · ${(episode.forkOrigins?.length ?? 0) > 0 && episode.closingCut.commitIndex === 0 ? 'cierre de base heredada' : 'cierre'}: commit ${episode.closingCut.commitIndex} · secuencia ${episode.closingCut.worldSeq}`}</p>
        {episode.sceneIds.length === 0 ? <p>Sin escenas registradas.</p> : <ul>{episode.sceneIds.map((id) => {
          const label = labels.get(id) ?? `Escena ${id}`;
          const cuts = sceneCuts.get(id);
          return <li key={id}><strong>{label}</strong>{id === structure.activeSceneId ? ' · abierta' : ''}
            <ul aria-label={`Cortes de ${label}`}>
              <li>{cuts?.openingCommitIndex === undefined
                ? 'Apertura: sin evento local verificable'
                : onSelectCommit === undefined
                  ? `Apertura: commit ${cuts.openingCommitIndex}`
                  : <button type="button" aria-label={`Ver apertura de ${label} (commit ${cuts.openingCommitIndex})`} onClick={() => onSelectCommit(cuts.openingCommitIndex!)}>Ver apertura · commit {cuts.openingCommitIndex}</button>}</li>
              <li>{cuts?.closingCommitIndex !== undefined
                ? onSelectCommit === undefined
                  ? `Cierre: commit ${cuts.closingCommitIndex}`
                  : <button type="button" aria-label={`Ver cierre de ${label} (commit ${cuts.closingCommitIndex})`} onClick={() => onSelectCommit(cuts.closingCommitIndex!)}>Ver cierre · commit {cuts.closingCommitIndex}</button>
                : id === structure.activeSceneId ? 'Cierre: escena abierta' : 'Cierre: sin evento local verificable'}</li>
            </ul>
          </li>;
        })}</ul>}
        {episode.acts.length > 0 && <p>Actos editoriales: {episode.acts.map((act) => act.title).join(' · ')}</p>}
        {episode.consequenceEventIds.length > 0 && <details><summary>Consecuencias vinculadas ({episode.consequenceEventIds.length})</summary><ul>{episode.consequenceEventIds.map((eventId) => <li key={eventId}><code>{eventId}</code></li>)}</ul></details>}
        {episode.openLines.map((line) => <details key={line.lineId}><summary>Línea abierta: {line.lineId}</summary><ul>{line.evidenceEventIds.map((eventId) => <li key={eventId}><code>{eventId}</code></li>)}</ul></details>)}
      </li>)}</ol>
      {structure.unassignedLegacyScenes.length > 0 && <details><summary>Escenas históricas sin episodio asignado ({structure.unassignedLegacyScenes.length})</summary><ul>{structure.unassignedLegacyScenes.map((scene) => <li key={scene.id}>{scene.label} · {scene.lifecycle.kind === 'open' ? 'abierta' : 'cerrada'} · sin episodio local ni cortes estructurales</li>)}</ul></details>}
      {!historical && <div className="dramatic-structure-actions">
        {structure.activeEpisodeId === null && structure.activeSceneId === null && <form onSubmit={(event) => { event.preventDefault(); void submit({ kind: 'openEpisode', ...(episodeTitle.trim() === '' ? {} : { title: episodeTitle.trim() }) }, 'El episodio'); }}>
          <h3>Abrir episodio</h3><label>Título opcional<input value={episodeTitle} maxLength={200} onChange={(event) => setEpisodeTitle(event.target.value)} /></label>
          <button type="submit" disabled={!canEdit}>Abrir episodio</button>
        </form>}
        {structure.activeEpisodeId !== null && structure.activeSceneId === null && <form onSubmit={(event) => { event.preventDefault(); void submit({ kind: 'openScene', label: sceneLabel.trim(), participantIds: participants, placeIds: scenePlaces }, 'La escena'); }}>
          <h3>Abrir escena</h3><label>Nombre de escena<input required value={sceneLabel} maxLength={200} onChange={(event) => setSceneLabel(event.target.value)} /></label>
          <label>Personajes<select multiple required value={participants} onChange={(event) => selectedOptions(event, setParticipants)}>{(state.options?.participants ?? []).map((actor) => <option key={actor.characterId} value={actor.characterId}>{actor.label} · {actor.placeId}</option>)}</select></label>
          <label>Lugares incluidos<select multiple required value={scenePlaces} onChange={(event) => selectedOptions(event, setScenePlaces)}>{(state.options?.places ?? []).map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
          <p className="muted">Elegí los lugares actuales de cada personaje, además de cualquier otro lugar que la escena incluya.</p>
          {participantPlaceMissing && <p role="alert">Incluí en la escena el lugar actual de cada personaje seleccionado.</p>}
          <button type="submit" disabled={!canEdit || participants.length === 0 || scenePlaces.length === 0 || participantPlaceMissing}>Abrir escena</button>
        </form>}
        {activeSceneId !== null && <form onSubmit={(event) => { event.preventDefault(); void submit({ kind: 'closeScene', sceneId: activeSceneId, reason: sceneReason.trim() }, 'La escena'); }}>
          <h3>Cerrar escena</h3><label>Motivo del corte<input required value={sceneReason} maxLength={500} onChange={(event) => setSceneReason(event.target.value)} /></label>
          <button type="submit" disabled={!canEdit}>Cerrar escena</button><p className="muted">El Escenario espera a que terminen los trabajos actorales activos.</p>
        </form>}
        {currentEpisode !== undefined && structure.activeSceneId === null && currentEpisode.sceneIds.length > 0 && <form onSubmit={(event) => { event.preventDefault(); closeEpisode(); }}>
          <h3>Cerrar episodio</h3><p>Elegí eventos confirmados que expliquen consecuencias. Las líneas dramáticas abiertas pueden guardar una evidencia de estos mismos hechos.</p>
          <fieldset><legend>Consecuencias registradas</legend>{confirmedEvents.length === 0 ? <p>No hay eventos confirmados en el corte visible.</p> : confirmedEvents.map((item) => <label className="dramatic-check" key={item.eventId}><input type="checkbox" checked={consequences.includes(item.eventId)} onChange={(event) => setConsequences((values) => event.target.checked ? [...values, item.eventId] : values.filter((id) => id !== item.eventId))} />{item.summary} <code>{item.eventId}</code></label>)}</fieldset>
          <label>Línea dramática que queda abierta (opcional)<input value={lineId} maxLength={120} onChange={(event) => setLineId(event.target.value)} placeholder="p. ej. descubrir quién envió el mensaje" /></label>
          {lineId.trim() !== '' && <fieldset><legend>Evidencia de la línea</legend>{confirmedEvents.map((item) => <label className="dramatic-check" key={item.eventId}><input type="checkbox" checked={lineEvidence.includes(item.eventId)} onChange={(event) => setLineEvidence((values) => event.target.checked ? [...values, item.eventId] : values.filter((id) => id !== item.eventId))} />{item.summary}</label>)}</fieldset>}
          <button type="submit" disabled={!canEdit || (lineId.trim() !== '' && lineEvidence.length === 0)}>Cerrar episodio</button>
        </form>}
      </div>}
      {!historical && currentEpisode !== undefined && <section className="dramatic-acts"><h3>Actos opcionales</h3><p>Los actos son agrupaciones editoriales. La progresión dramática puede tener planteamiento, desarrollo, clímax y desenlace sin imponer tres actos.</p>
        {currentEpisode.acts.length === 0 ? <p>Este episodio no tiene actos asignados.</p> : <ol>{currentEpisode.acts.map((act) => <li key={act.actId}>{act.title}: {act.sceneIds.map((id) => labels.get(id) ?? id).join(', ')}</li>)}</ol>}
        <label>Nombre del acto<input value={actTitle} maxLength={200} onChange={(event) => setActTitle(event.target.value)} /></label>
        <label>Escenas del acto<select multiple value={actSceneIds} onChange={(event) => selectedOptions(event, setActSceneIds)}>{allScenes.map((id) => <option key={id} value={id}>{labels.get(id) ?? id}</option>)}</select></label>
        <button type="button" disabled={!canEdit || actTitle.trim() === '' || actSceneIds.length === 0} onClick={() => { setActDraft((items) => [...items, { title: actTitle.trim(), sceneIds: actSceneIds }]); setActTitle(''); setActSceneIds([]); }}>Añadir acto a la propuesta</button>
        {actDraft.length > 0 && <><ol>{actDraft.map((act, index) => <li key={`${index}:${act.title}`}>{act.title}: {act.sceneIds.map((id) => labels.get(id) ?? id).join(', ')} <button type="button" onClick={() => setActDraft((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></li>)}</ol>
          <button type="button" disabled={!canEdit} onClick={() => void submit({ kind: 'setEpisodeActs', episodeId: currentEpisode.episodeId, acts: actDraft }, 'La organización de actos')}>Guardar actos opcionales</button></>}
      </section>}
      {!historical && pending !== null && <div className="dramatic-pending"><p>{pending.bodyLabel} no tiene confirmación visible. El reintento usa la misma clave y contenido.</p><button type="button" disabled={saving} onClick={() => void submit(pending.mutation, pending.bodyLabel, pending)}>Reintentar misma operación</button><button type="button" disabled={saving} onClick={() => { setPending(null); setMessage('Operación local descartada; se vuelve a leer el estado durable.'); setStructureRefresh((value) => value + 1); }}>Descartar y recargar</button></div>}
      <details className="dramatic-event-log"><summary>Registro de cambios estructurales ({state.events.length})</summary><ol>{state.events.map((event) => <li key={event.operationId}><strong>Rev. {event.structureRevision}</strong> · {eventNames[event.kind]} · commit {event.commitIndex} · {new Date(event.recordedAt).toLocaleString()}{onSelectCommit !== undefined && <button type="button" onClick={() => onSelectCommit(event.commitIndex)}>Ver este corte</button>}</li>)}</ol></details>
      {!historical && !canEdit && <p className="muted">La estructura se puede editar en curso, en pausa, detenida o durante la preparación de una bifurcación, sin trabajos actorales activos.</p>}
    </>}
  </section>;
}
