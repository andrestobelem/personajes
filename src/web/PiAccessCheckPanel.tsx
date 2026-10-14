import React from 'react';
import { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE } from '../domain/inference-profile.ts';
import { accessFailureIsConfirmed, accessJobTerminal, createPiAccessCheckClient, type PiAccessCheckClient, type PiAccessDocument, type PiAccessIntent } from './pi-access-check-client.ts';

const client = createPiAccessCheckClient();
export function PiAccessCheckResult({ job }: { job: PiAccessDocument['job'] }) {
  const label = job.resultKind === 'passed' ? 'Acceso comprobado'
    : job.resultKind === 'failed' ? 'Comprobación fallida' : job.resultKind === 'aborted' ? 'Cancelado antes de enviar'
      : job.resultKind === 'ambiguous' || job.state === 'interrupted' ? 'Resultado incierto · no acredita acceso'
        : job.state === 'cancel-requested' ? 'Cancelación solicitada' : job.state === 'canceled' ? 'Cancelado' : 'Comprobación pendiente';
  return <div className="pi-access-job"><h3>{job.profile.model} · {job.profile.reasoningEffort}</h3><p role="status">{label}</p>
    {job.safeCode && <p>Diagnóstico: {job.safeCode}</p>}
    {job.passedResult && <><p>Perfil confirmado: {job.passedResult.effectiveProfile.model} · {job.passedResult.effectiveProfile.providerThinkingLevel ?? job.profile.reasoningEffort}</p>
      <p>Uso medido: {job.passedResult.measuredUsage.totalTokens} tokens totales; entrada {job.passedResult.measuredUsage.input}, salida {job.passedResult.measuredUsage.output}.</p></>}
    <p className="muted">{job.updatedAt}. Esta prueba no verifica la interpretación de un personaje. El preflight comprueba que su evidencia siga vigente para el mismo proveedor, credencial y perfil.</p></div>;
}
export function PiAccessCheckPanel({ api = client }: { api?: PiAccessCheckClient }) {
  const [profileChoice, setProfileChoice] = React.useState('sol');
  const [document, setDocument] = React.useState<PiAccessDocument | null>(null);
  const [items, setItems] = React.useState<PiAccessDocument['job'][] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [intent, setIntent] = React.useState<PiAccessIntent | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [refresh, setRefresh] = React.useState(0);
  const lifetime = React.useRef<AbortController | null>(null);
  const mutation = React.useRef(false);
  React.useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); lifetime.current = null; }; }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    void api.list(controller.signal).then((page) => { if (!controller.signal.aborted) { setItems(page.items); setTruncated(page.truncated || page.nextCursor !== null); } })
      .catch(() => { if (!controller.signal.aborted) { setItems(null); setMessage('No se pudo consultar el historial de comprobaciones.'); } });
    return () => controller.abort();
  }, [api, refresh]);
  const jobId = document?.job.jobId;
  const terminal = document === null || accessJobTerminal(document.job);
  React.useEffect(() => {
    if (!jobId || terminal) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await api.read(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setDocument((previous) => previous?.job.jobId === current.job.jobId && previous.job.revision > current.job.revision ? previous : current);
        if (accessJobTerminal(current.job)) { setRefresh((value) => value + 1); return; }
      } catch { if (!controller.signal.aborted) setMessage('No se pudo actualizar el trabajo. Su ejecución permanece registrada en el host.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1_000);
    };
    void poll(); return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, jobId, terminal]);
  async function execute(next: PiAccessIntent) {
    const controller = lifetime.current;
    if (!controller || mutation.current) return;
    mutation.current = true; setBusy(true); setIntent(next); setMessage('');
    try {
      const result = await api.execute(next, controller.signal);
      if (!controller.signal.aborted) { setDocument(result); setIntent(null); setRefresh((value) => value + 1); }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (accessFailureIsConfirmed(error)) { setIntent(null); setMessage('La solicitud fue rechazada. Consultá el estado actual antes de volver a intentarlo.'); setRefresh((value) => value + 1); }
        else setMessage('No se confirmó la operación. Reintentá con la misma clave para recuperar su recibo, sin iniciar otra prueba.');
      }
    } finally { mutation.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function recover(id: string) {
    const controller = lifetime.current; if (!controller || mutation.current || intent) return;
    mutation.current = true; setBusy(true);
    try { const current = await api.read(id, controller.signal); if (!controller.signal.aborted) { setDocument(current); setMessage(''); } }
    catch { if (!controller.signal.aborted) setMessage('No se pudo consultar esa comprobación.'); }
    finally { mutation.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const profile = profileChoice === 'opus' ? CLAUDE_INFERENCE_PROFILE : DEFAULT_INFERENCE_PROFILE;
  const active = items?.some((job) => !accessJobTerminal(job)) ?? true;
  return <section className="pi-access-panel" aria-labelledby="pi-check-title"><header><span className="eyebrow">Prueba explícita</span><h2 id="pi-check-title">Comprobar acceso al modelo</h2></header>
    <label>Perfil a comprobar<select disabled={busy || intent !== null} value={profileChoice} onChange={(event) => setProfileChoice(event.target.value)}><option value="sol">GPT-6.1 Sol · bajo</option><option value="opus">Claude Opus 5.5 · medio</option></select></label>
    <p>Esta acción envía una solicitud mínima al proveedor y puede consumir cuota o generar un cargo. No envía personajes, memorias ni contexto de la obra y no inicia una representación.</p>
    {profileChoice === 'opus' && <p>Requiere una credencial propia de Anthropic configurada en el host; el login de OpenAI no habilita Claude.</p>}
    <div className="draft-actions"><button type="button" disabled={busy || intent !== null || active || !terminal} onClick={() => void execute({ kind: 'start', key: crypto.randomUUID(), profile })}>Comprobar acceso · puede consumir cuota</button>
      <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Consultar historial local</button>
      {document && !terminal && <button type="button" disabled={busy || intent !== null} onClick={() => void execute({ kind: 'cancel', key: crypto.randomUUID(), document })}>Cancelar comprobación</button>}</div>
    {message && <p role="alert">{message}</p>}
    {intent && !busy && <button type="button" onClick={() => void execute(intent)}>Recuperar la misma operación</button>}
    {document && <PiAccessCheckResult job={document.job} />}
    <h3>Comprobaciones guardadas</h3>{items === null ? <p>Historial local todavía no disponible.</p> : items.length === 0 ? <p>No hay comprobaciones guardadas.</p> : <ul>{items.map((job) => <li key={job.jobId}><button type="button" disabled={busy || intent !== null} onClick={() => void recover(job.jobId)}>{job.profile.model} · {job.resultKind ?? job.state} · {job.updatedAt}</button></li>)}</ul>}
    {truncated && <p>Se muestra una ventana de las comprobaciones recientes.</p>}
  </section>;
}
