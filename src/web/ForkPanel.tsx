import React from 'react';
import type { ForkJobView } from '../domain/fork-http.ts';
import { captureForkIntent, createForkClient, newerForkJob, readStoredForkIntent, writeStoredForkIntent, type ForkClient, type ForkIntent, type ForkSourceSelection } from './fork-client.ts';
const client = createForkClient();
type Attempt = { intent: ForkIntent; job: ForkJobView | null };
export function ForkJobStatus({ job, onOpenRun }: { job: ForkJobView; onOpenRun?: (runId: string) => void }) {
  return <div role="status"><p>{job.state === 'ready' ? 'Bifurcación preparada y publicada' : job.state === 'failed' ? `La bifurcación terminó con error: ${job.code}` : 'Preparando memoria aislada y publicación…'}</p>
    <p>Destino reservado: <code>{job.targetRunId}</code> · revisión {job.revision}</p>
    <p>{job.audioDerivation.bindingState === 'unbound' ? 'Audio: voces heredadas sin vincular; revisá su preparación antes de iniciar.' : 'Audio: no requiere vínculos de voz.'} Se toma la configuración inicial Ready; no se reconstruye el historial efectivo de audio.</p>
    {job.state === 'ready' && onOpenRun !== undefined && <button type="button" onClick={() => onOpenRun(job.targetRunId)}>Abrir representación bifurcada</button>}
  </div>;
}
export function ForkPanel({ source, runId, active = true, onOpenRun, api = client }: { source: ForkSourceSelection | null; runId?: string; active?: boolean; onOpenRun?: (runId: string) => void; api?: ForkClient }) {
  const [selected, setSelected] = React.useState<ForkSourceSelection | null>(null);
  const [name, setName] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [restored] = React.useState(() => {
    if (typeof window === 'undefined' || runId === undefined) return null;
    try { return readStoredForkIntent(window.sessionStorage, runId); } catch { return null; }
  });
  const [attempt, setAttempt] = React.useState<Attempt | null>(() => restored === null ? null : { intent: restored, job: null });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const retry = React.useRef<{ job: ForkJobView; key: string } | null>(null);
  const lifetime = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => lifetime.current?.abort(), []);
  React.useEffect(() => {
    if (runId === undefined || typeof window === 'undefined') return;
    try { if (!writeStoredForkIntent(window.sessionStorage, runId, attempt?.intent ?? null)) setMessage('El navegador no pudo conservar el intento tras una recarga. Guardá el identificador de operación.'); } catch { setMessage('El navegador no pudo conservar el intento tras una recarga.'); }
  }, [runId, attempt?.intent]);
  React.useEffect(() => {
    if (restored === null || !active) return;
    const controller = new AbortController();
    void api.read(restored.body.operationId, controller.signal).then((job) => {
      if (!controller.signal.aborted) setAttempt((current) => current?.intent.body.operationId === restored.body.operationId ? { ...current, job: newerForkJob(current.job, job) } : current);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setMessage(`${error instanceof Error ? error.message : 'No llegó confirmación.'} Se conservó el intento original; podés consultar de nuevo o repetir el mismo envío.`); });
    return () => controller.abort();
  }, [api, active, restored]);
  React.useEffect(() => {
    if (!active || attempt?.job?.state !== 'staging') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operationId = attempt.intent.body.operationId;
    async function poll() {
      try {
        const job = await api.read(operationId, controller.signal);
        if (!controller.signal.aborted) setAttempt((current) => current?.intent.body.operationId === operationId ? { ...current, job: newerForkJob(current.job, job) } : current);
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'No se pudo actualizar la bifurcación.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, active, attempt?.intent.body.operationId, attempt?.job?.state]);
  async function perform(operation: (signal: AbortSignal) => Promise<ForkJobView>, intent: ForkIntent) {
    setBusy(true); setMessage(null);
    const controller = new AbortController(); lifetime.current = controller;
    try { const job = await operation(controller.signal); if (!controller.signal.aborted) { setAttempt((current) => ({ intent, job: newerForkJob(current?.intent.body.operationId === intent.body.operationId ? current.job : null, job) })); retry.current = null; } }
    catch (error) { if (!controller.signal.aborted) setMessage(`${error instanceof Error ? error.message : 'No llegó confirmación.'} El intento conserva su operación y su corte; consultá su estado o repetí el mismo envío.`); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function begin() {
    if (selected === null) return;
    const intent = captureForkIntent({ source: selected, body: { commitIndex: selected.commitIndex, worldRevision: selected.worldRevision, worldSeq: selected.worldSeq, operationId: crypto.randomUUID(), name: name.trim(), reason: reason.trim() }, key: crypto.randomUUID() });
    setAttempt({ intent, job: null });
    void perform((signal) => api.begin(intent, signal), intent);
  }
  const pinned = attempt?.intent.source ?? selected;
  return <section className="dramatic-structure-panel" aria-label="Bifurcar representación"><h2>Continuar desde este corte</h2>
    <p>Creá otra representación con historia y memorias independientes desde el momento confirmado que elegís. Esta acción no inicia actores ni genera audio.</p>
    {pinned === null ? <button type="button" disabled={!active || source === null} onClick={() => { if (source !== null) setSelected({ ...source }); }}>Elegir corte para bifurcar</button> : <>
      <p>Corte elegido: <code>{pinned.runId}</code> · commit {pinned.commitIndex} · Escenario {pinned.worldRevision} · secuencia {pinned.worldSeq}. Este corte permanece fijo aunque avance la vista.</p>
      {attempt === null && <form onSubmit={(event) => { event.preventDefault(); begin(); }}><label>Nombre de la nueva representación<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Motivo de la bifurcación<textarea required maxLength={4000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={!active || busy || name.trim() === '' || reason.trim() === ''}>Crear bifurcación</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Volver a elegir corte</button></form>}
      {attempt !== null && <><p>Operación: <code>{attempt.intent.body.operationId}</code></p>
        {attempt.job !== null && <ForkJobStatus job={attempt.job} {...(onOpenRun === undefined ? {} : { onOpenRun })} />}
        <button type="button" disabled={busy || !active} onClick={() => void perform((signal) => api.read(attempt.intent.body.operationId, signal), attempt.intent)}>Consultar estado de la operación</button>
        {attempt.job === null && <button type="button" disabled={busy || !active} onClick={() => void perform((signal) => api.begin(attempt.intent, signal), attempt.intent)}>Repetir mismo envío</button>}
        {attempt.job?.state === 'failed' && <button type="button" disabled={busy || !active} onClick={() => { const job = attempt.job; if (job === null) return; const intent = retry.current ?? { job, key: crypto.randomUUID() }; retry.current = intent; void perform((signal) => api.retry(intent, signal), attempt.intent); }}>Reintentar mismo destino</button>}
        {attempt.job?.state === 'ready' && <button type="button" disabled={busy} onClick={() => { setAttempt(null); setSelected(null); setName(''); setReason(''); }}>Preparar otra bifurcación</button>}
      </>}
    </>}
    {message !== null && <p role="alert">{message}</p>}
  </section>;
}
