import React from 'react';
import type { MemoryPreparationJob } from '../domain/memory-preparation.ts';
import { captureMemoryPreparationIntent, createMemoryPreparationClient, memoryPreparationRejection, type MemoryPreparationClient, type MemoryPreparationDocument, type MemoryPreparationIntent } from './memory-preparation-client.ts';
const defaultClient = createMemoryPreparationClient();
const states: Record<MemoryPreparationJob['state'], string> = { queued: 'En espera', running: 'Preparando memorias', completed: 'Memorias preparadas', failed: 'Preparación fallida', interrupted: 'Preparación interrumpida' };
const actorStates: Record<MemoryPreparationJob['actors'][number]['state'], string> = { pending: 'Pendiente', initialized: 'Memoria privada inicializada', existing: 'Memoria existente conservada', failed: 'No se pudo preparar' };
export function memoryPreparationTerminal(job: MemoryPreparationJob) { return job.state === 'completed' || job.state === 'failed' || job.state === 'interrupted'; }
export function MemoryPreparationStatus({ job }: { job: MemoryPreparationJob }) {
  return <div><h3>{states[job.state]}</h3><p>{job.purpose === 'reopen-existing' ? 'Reapertura de memorias existentes verificadas' : 'Inicialización de memorias privadas vacías'}</p><p className="muted">Trabajo {job.jobId} · configuración {job.expectedConfigurationRevision} · Escenario {job.expectedWorldRevision}</p><ul>{job.actors.map(actor => <li key={actor.actorId}>{actor.actorId}: {actorStates[actor.state]}</li>)}</ul>{job.failureCode !== null && <p role="alert">La preparación no pudo completarse. Diagnóstico: {job.failureCode}.</p>}</div>;
}
export function MemoryPreparationPanel({ runId, configurationRevision, worldRevision, disabled = false, reopenExisting = false, api = defaultClient }: { runId: string; configurationRevision: number; worldRevision: number | null; disabled?: boolean; reopenExisting?: boolean; api?: MemoryPreparationClient }) {
  const [document, setDocument] = React.useState<MemoryPreparationDocument | null>(null);
  const [intent, setIntent] = React.useState<MemoryPreparationIntent | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<{ kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; jobs: MemoryPreparationJob[]; truncated: boolean }>({ kind: 'loading' });
  const [refresh, setRefresh] = React.useState(0);
  const lifetime = React.useRef<AbortController | null>(null);
  const active = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setDocument(null); setIntent(null); setBusy(false); setMessage(null); setHistory({ kind: 'loading' }); active.current = false;
    return () => { controller.abort(); if (lifetime.current === controller) lifetime.current = null; };
  }, [runId]);
  React.useEffect(() => {
    const controller = new AbortController();
    api.history(runId, controller.signal).then(page => { if (!controller.signal.aborted) setHistory({ kind: 'ready', ...page }); }).catch(() => { if (!controller.signal.aborted) setHistory({ kind: 'failed' }); });
    return () => controller.abort();
  }, [api, runId, refresh]);
  const jobId = document?.job.jobId;
  const terminal = document === null || memoryPreparationTerminal(document.job);
  React.useEffect(() => {
    if (jobId === undefined || terminal) return;
    const selected = jobId; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const current = await api.job({ runId, jobId: selected }, controller.signal);
        if (controller.signal.aborted) return;
        setDocument(current);
        if (memoryPreparationTerminal(current.job)) { setRefresh(value => value + 1); return; }
      } catch { if (!controller.signal.aborted) setMessage('No se pudo consultar el trabajo. La consulta continuará sin repetir la preparación.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 1500);
    }
    void poll();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, runId, jobId, terminal]);
  async function start(captured: MemoryPreparationIntent) {
    const controller = lifetime.current; if (controller === null || active.current) return;
    active.current = true; setBusy(true); setIntent(captured); setMessage(null);
    try {
      const result = await api.start(captured, controller.signal);
      if (!controller.signal.aborted) { setDocument(result); setIntent(null); setRefresh(value => value + 1); }
    } catch (error) {
      if (controller.signal.aborted) return;
      const rejected = memoryPreparationRejection(error);
      if (rejected === undefined) setMessage('No se confirmó la preparación. Recuperá el resultado con la misma clave y el mismo corte antes de iniciar otra.');
      else { setIntent(null); setRefresh(value => value + 1); setMessage(rejected.status === 412 ? 'Cambió el corte guardado. Recargá la preparación antes de continuar.' : `La preparación fue rechazada. Referencia: ${rejected.requestId}.`); }
    } finally { if (lifetime.current === controller) active.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function recover(job: MemoryPreparationJob) {
    const controller = lifetime.current; if (controller === null || active.current) return;
    active.current = true; setBusy(true); setMessage(null);
    try { const current = await api.job({ runId, jobId: job.jobId }, controller.signal); if (!controller.signal.aborted) setDocument(current); }
    catch { if (!controller.signal.aborted) setMessage('No se pudo recuperar el trabajo de memorias.'); }
    finally { if (lifetime.current === controller) active.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const activeHistory = history.kind === 'ready' && history.jobs.some(job => !memoryPreparationTerminal(job));
  const blocked = disabled || worldRevision === null || busy || intent !== null || !terminal || activeHistory || history.kind !== 'ready';
  function prepare() {
    if (worldRevision === null || blocked) return;
    try { void start(captureMemoryPreparationIntent({ runId, key: crypto.randomUUID(), expectedConfigurationRevision: configurationRevision, expectedWorldRevision: worldRevision })); }
    catch { setMessage('Guardá y validá un corte Ready inicial antes de preparar memorias.'); }
  }
  return <section aria-labelledby={`memory-preparation-${runId}`} className="memory-preparation-panel"><h3 id={`memory-preparation-${runId}`}>Memorias privadas del elenco</h3><p>{reopenExisting ? 'Reabre exclusivamente las bases privadas ICM SQLite existentes y verificadas. Una memoria ausente o inválida bloquea la operación; no se reemplaza por una base vacía.' : 'Prepara una base ICM SQLite independiente por actor. El host sólo crea bases vacías en una puesta Ready inicial; si ya hay historia, reabre exclusivamente memorias existentes verificadas y bloquea cualquier base ausente o inválida.'} No inicia actores ni llama al modelo.</p><div className="draft-actions"><button type="button" disabled={blocked} onClick={prepare}>{reopenExisting ? 'Reabrir memorias privadas existentes' : 'Preparar memorias privadas'}</button><button type="button" onClick={() => setRefresh(value => value + 1)}>Actualizar trabajos de memorias</button></div>{disabled && <p className="muted">Guardá los cambios y completá la validación Ready, o pausá la representación antes de administrar sus memorias.</p>}{message && <p role="alert">{message}</p>}{intent !== null && !busy && <button type="button" onClick={() => void start(intent)}>Recuperar resultado de preparación de memorias</button>}{document !== null && <MemoryPreparationStatus job={document.job} />}<details><summary>Trabajos de memorias guardados</summary>{history.kind === 'loading' ? <p role="status">Consultando trabajos de memorias…</p> : history.kind === 'failed' ? <p role="alert">No se pudo consultar la historia de memorias. Actualizala antes de preparar.</p> : <><ul>{history.jobs.map(job => <li key={job.jobId}>{states[job.state]} · configuración {job.expectedConfigurationRevision} · Escenario {job.expectedWorldRevision} <button type="button" disabled={busy || intent !== null || !terminal} onClick={() => void recover(job)}>Consultar trabajo {job.jobId}</button></li>)}</ul>{history.jobs.length === 0 && <p>No hay trabajos de memorias guardados.</p>}{history.truncated && <p>Se muestran los primeros 1.000 trabajos. La historia restante se conserva en el host.</p>}</>}</details></section>;
}
