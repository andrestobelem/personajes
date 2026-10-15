import React from 'react';
import type { RunPreflightJobDocument, RunPreflightJobView } from '../domain/http.ts';
import { capturePreflightIntent, createRunPreflightClient, preflightRejection, preflightTerminal, type PreflightDocument, type PreflightIntent, type RunPreflightClient } from './run-preflight-client.ts';
import type { RunDocument } from './run-controls-client.ts';
import type { DraftDocument } from './run-drafts-client.ts';
import { MemoryPreparationPanel } from './MemoryPreparationPanel.tsx';
import { RunBudgetPanel } from './RunBudgetPanel.tsx';

const client = createRunPreflightClient();
const checkLabels: Record<NonNullable<RunPreflightJobDocument['report']['result']>['checks'][number]['checkId'], string> = {
  configuration: 'Configuración', 'configuration-version': 'Revisión de configuración', 'world-snapshot': 'Estado del Escenario', 'prepared-contexts': 'Preparación privada del elenco', 'catalog-eligibility': 'Reparto y continuidad', 'inference-profile': 'Perfil requerido', 'pi-sdk': 'SDK de Pi', 'pi-profile': 'Modelo y esfuerzo', 'provider-authentication': 'Autenticación del proveedor', 'provider-access-check': 'Comprobación de acceso registrada', 'pi-runtime': 'Runtime de Pi', 'icm-memory': 'Memoria ICM', budget: 'Presupuestos', voice: 'Voz y audio', 'participant-availability': 'Disponibilidad del elenco',
};
const states: Record<RunPreflightJobView['state'], string> = { queued: 'En espera', running: 'Comprobando requisitos', 'cancel-requested': 'Cancelación solicitada', completed: 'Comprobación completada', failed: 'Falló la comprobación', canceled: 'Cancelado', interrupted: 'Interrumpido por el host' };
const checkStates = { passed: 'Cumplido', blocked: 'Bloqueado', deferred: 'Pendiente', unavailable: 'No disponible' };
export function RunPreflightReport({ value }: { value: RunPreflightJobDocument }) {
  const result = value.report.result;
  return <div className="preflight-report"><h3>{states[value.job.state]}</h3><p className="muted">Trabajo {value.job.jobId} · configuración {value.job.configurationRevision} · Escenario {value.job.worldRevision}</p>
    {value.job.safeCode !== null && <p role="alert">Diagnóstico: {value.job.safeCode}</p>}
    {value.report.kind === 'stale' && <p role="alert">Resultado desactualizado. Cambió el corte comprobado; no habilita ejecutar la configuración actual.</p>}
    {result !== null && <><p role="status">{result.kind === 'passed' ? 'Los requisitos comprobados se cumplieron para este corte.' : result.kind === 'blocked' ? 'Hay requisitos de ejecución bloqueados.' : 'La comprobación detectó una configuración inválida.'}</p>
      <ul>{result.checks.map((check, index) => <li key={`${check.checkId}:${index}`}><strong>{checkLabels[check.checkId]}</strong>: {checkStates[check.kind]}{check.code !== undefined && <span className="muted"> · {check.code}</span>}</li>)}</ul><p className="muted">Comprobado: <time dateTime={result.checkedAt}>{result.checkedAt}</time></p></>}
    {result === null && <p>El trabajo todavía no tiene un resultado confirmado.</p>}
  </div>;
}
/** UI guidance only: nonzero initial sequence numbers do not imply lived history.
 * The durable host also checks observations and experiences before choosing purpose. */
export function memoryPreparationReopensExisting(document: DraftDocument, currentRun?: RunDocument): boolean {
  const lifecycle = currentRun?.view.lifecycle.kind ?? document.view.state.lifecycle;
  if (lifecycle !== 'ready' || (document.view.state.editability !== undefined && document.view.state.editability !== 'editable')) return true;
  const initial = document.view.configuration.worldSnapshot;
  if (initial.kind === 'empty') return false;
  const currentRevision = currentRun?.view.worldRevision ?? document.view.state.worldRevision;
  if (initial.value.revision !== undefined && currentRevision !== null && initial.value.revision !== currentRevision) return true;
  return currentRun !== undefined && initial.value.seq !== undefined && initial.value.seq !== currentRun.view.lastWorldSeq;
}
type Selection = { kind: 'none' } | { kind: 'receipt'; job: RunPreflightJobView } | { kind: 'document'; document: PreflightDocument };
export function RunPreflightPanel({ document, currentRun, disabled = false, api = client }: { document: DraftDocument; currentRun?: RunDocument; disabled?: boolean; api?: RunPreflightClient }) {
  const runId = document.view.configuration.runId;
  const [selection, setSelection] = React.useState<Selection>({ kind: 'none' });
  const [history, setHistory] = React.useState<{ kind: 'loading' } | { kind: 'unavailable' } | { kind: 'ready'; items: RunPreflightJobDocument[]; truncated: boolean }>({ kind: 'loading' });
  const [intent, setIntent] = React.useState<PreflightIntent | null>(null);
  const [busy, setBusy] = React.useState(false); const [message, setMessage] = React.useState<string | null>(null); const [refresh, setRefresh] = React.useState(0);
  const lifetime = React.useRef<AbortController | null>(null); const activeMutation = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setSelection({ kind: 'none' }); setIntent(null); setBusy(false); setHistory({ kind: 'loading' }); setMessage(null);
    return () => { controller.abort(); lifetime.current = null; };
  }, [runId]);
  React.useEffect(() => {
    const controller = new AbortController();
    api.history(runId, controller.signal).then(page => { if (!controller.signal.aborted) setHistory({ kind: 'ready', ...page }); }).catch(() => { if (!controller.signal.aborted) setHistory({ kind: 'unavailable' }); });
    return () => controller.abort();
  }, [api, runId, refresh, (currentRun?.view.configRevision ?? document.view.state.configurationRevision), (currentRun?.view.worldRevision ?? document.view.state.worldRevision)]);
  const selectedJob = selection.kind === 'none' ? null : selection.kind === 'receipt' ? selection.job : selection.document.value.job;
  const jobId = selectedJob?.jobId;
  const needsRead = selection.kind === 'receipt' || (selectedJob !== null && !preflightTerminal(selectedJob));
  React.useEffect(() => {
    if (jobId === undefined) return;
    const id = jobId; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const current = await api.job(runId, id, controller.signal);
        if (controller.signal.aborted) return;
        setSelection({ kind: 'document', document: current });
        if (preflightTerminal(current.value.job)) { setIntent(prior => prior?.kind === 'cancel' && prior.document.value.job.jobId === id ? null : prior); if (needsRead) setRefresh(value => value + 1); return; }
      } catch { if (!controller.signal.aborted) setMessage('No se pudo consultar el trabajo. Se seguirá consultando sin repetir la evaluación.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 1500);
    }
    void poll(); return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, runId, jobId, needsRead, refresh, (currentRun?.view.configRevision ?? document.view.state.configurationRevision), (currentRun?.view.worldRevision ?? document.view.state.worldRevision)]);
  async function mutate(captured: PreflightIntent) {
    const controller = lifetime.current; if (controller === null || activeMutation.current) return;
    activeMutation.current = true; setBusy(true); setIntent(captured); setMessage(null);
    try { const job = await api.mutate(captured, controller.signal); if (!controller.signal.aborted) { setSelection({ kind: 'receipt', job }); setIntent(null); setRefresh(value => value + 1); } }
    catch (error) {
      if (controller.signal.aborted) return;
      const rejected = preflightRejection(error);
      if (rejected === undefined) setMessage('No se confirmó la operación. Recuperá su resultado con la misma clave antes de iniciar otra evaluación.');
      else {
        setIntent(null); setRefresh(value => value + 1);
        setMessage(rejected.status === 412 ? 'Cambió la revisión. Recargá la preparación antes de evaluar; para cancelar se consultará el trabajo actual.' : `Solicitud rechazada. Referencia: ${rejected.requestId}.`);
        if (captured.kind === 'cancel') { try { const current = await api.job(runId, captured.document.value.job.jobId, controller.signal); if (!controller.signal.aborted) setSelection({ kind: 'document', document: current }); } catch { /* Local history remains available for recovery. */ } }
      }
    } finally { activeMutation.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  function evaluate() { try { void mutate(currentRun === undefined ? capturePreflightIntent({ document, key: crypto.randomUUID() }) : { kind: 'evaluate', key: crypto.randomUUID(), runId, configurationRevision: currentRun.view.configRevision, worldRevision: currentRun.view.worldRevision }); } catch { setMessage('Guardá y validá la preparación antes de comprobar requisitos.'); } }
  async function recover(job: RunPreflightJobView) {
    const controller = lifetime.current; if (controller === null || busy) return;
    setBusy(true); setMessage(null);
    try { const current = await api.job(runId, job.jobId, controller.signal); if (!controller.signal.aborted) setSelection({ kind: 'document', document: current }); }
    catch { if (!controller.signal.aborted) setMessage('No se pudo recuperar el trabajo de comprobación.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const activeJobs = history.kind === 'ready' && history.items.some(value => !preflightTerminal(value.job));
  const notReady = !['ready', 'paused', 'stopped'].includes(currentRun?.view.lifecycle.kind ?? document.view.state.lifecycle) || (currentRun?.view.worldRevision ?? document.view.state.worldRevision) === null;
  return <section className="run-preflight-panel" aria-labelledby={`preflight-${runId}`}><h2 id={`preflight-${runId}`}>Requisitos de ejecución</h2><p>Comprobá la configuración guardada, el Escenario y los servicios necesarios. Esta comprobación no inicia la obra ni llama al modelo.</p>
    <MemoryPreparationPanel key={runId} runId={runId} configurationRevision={currentRun?.view.configRevision ?? document.view.state.configurationRevision} worldRevision={currentRun?.view.worldRevision ?? document.view.state.worldRevision} disabled={disabled || notReady} reopenExisting={memoryPreparationReopensExisting(document, currentRun)} />
    <div className="draft-actions"><button type="button" disabled={disabled || notReady || busy || intent !== null || activeJobs || history.kind !== 'ready' || needsRead} onClick={evaluate}>Comprobar requisitos de ejecución</button><button type="button" onClick={() => setRefresh(value => value + 1)}>Actualizar historia de comprobaciones</button></div>
    {(disabled || notReady) && <p className="muted">Guardá los cambios y completá la validación Ready para evaluar el corte persistido.</p>}
    {!notReady && <RunBudgetPanel runId={runId} api={api} />}
    {message && <p role="alert">{message}</p>}{intent !== null && !busy && <button type="button" onClick={() => void mutate(intent)}>Recuperar resultado de la operación</button>}
    {selection.kind === 'receipt' && <p role="status">Operación registrada: {states[selection.job.state]}. Consultando su resultado actual…</p>}
    {selection.kind === 'document' && <><RunPreflightReport value={{ ...selection.document.value, report: { ...selection.document.value.report, kind: selection.document.value.job.configurationRevision !== (currentRun?.view.configRevision ?? document.view.state.configurationRevision) || selection.document.value.job.worldRevision !== (currentRun?.view.worldRevision ?? document.view.state.worldRevision) ? 'stale' : selection.document.value.report.kind } }} />{!preflightTerminal(selection.document.value.job) && selection.document.value.job.state !== 'cancel-requested' && <button type="button" disabled={busy || intent !== null} onClick={() => void mutate({ kind: 'cancel', key: crypto.randomUUID(), document: selection.document })}>Solicitar cancelación de la comprobación</button>}</>}
    <h3>Comprobaciones guardadas</h3>{history.kind === 'loading' ? <p role="status">Consultando historia local…</p> : history.kind === 'unavailable' ? <p role="alert">No se pudo consultar la historia. Actualizala antes de crear otro trabajo.</p> : <><ul>{history.items.map(value => <li key={value.job.jobId}>{states[value.job.state]} · configuración {value.job.configurationRevision} · Escenario {value.job.worldRevision}{value.report.kind === 'stale' && ' · desactualizado'} <button type="button" disabled={busy || intent !== null} onClick={() => void recover(value.job)}>Consultar comprobación {value.job.jobId}</button></li>)}</ul>{history.items.length === 0 && <p>No hay comprobaciones guardadas.</p>}{history.truncated && <p className="muted">Se muestran los 1.000 trabajos más recientes.</p>}</>}
  </section>;
}
