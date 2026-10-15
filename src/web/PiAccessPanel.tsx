import React from 'react';
import type { PiIntegrationStatus, PiOAuthInteractionView, PiOAuthJobView, PiOAuthProvider } from '../domain/http.ts';
import { createPiAccessClient, piJobIsTerminal, reconcilePiOAuthRejection, type PiAccessClient, type PiJobDocument, type PiOAuthIntent } from './pi-access-client.ts';

const client = createPiAccessClient();
type StatusState = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'ready'; value: PiIntegrationStatus };
const stateLabels: Record<PiOAuthJobView['state'], string> = {
  queued: 'En espera', running: 'Conectando', 'cancel-requested': 'Cancelación solicitada',
  succeeded: 'Completado', failed: 'Falló', canceled: 'Cancelado', interrupted: 'Interrumpido por el host',
};
/** Rendering accepts only already parsed public DTOs, never SDK callbacks or credential values. */
export function PiAccessStatus({ status, provider = 'openai-codex' }: { status: StatusState; provider?: PiOAuthProvider }) {
  const selected = status.kind === 'ready' ? status.value.provider : provider;
  const model = selected === 'anthropic' ? 'claude-opus-5-5' : 'gpt-6.1-sol';
  const modelLabel = selected === 'anthropic' ? 'Claude' : 'Sol';
  return <><dl className="pi-access-profile"><dt>Proveedor del login</dt><dd>{selected} · OAuth</dd><dt>Modelo requerido</dt><dd>{model}</dd><dt>Esfuerzo</dt><dd>{selected === 'anthropic' ? 'medium' : 'low'}</dd></dl>
    {status.kind === 'loading' ? <p role="status">Consultando estado local…</p> : status.kind === 'unavailable' ? <p role="alert">No se pudo consultar el estado local de Pi.</p> : <>
      <p>{status.value.authState === 'present' ? 'Credencial OAuth presente en el host.' : status.value.authState === 'missing' ? 'Sin credencial OAuth en el host.' : 'No se pudo leer la configuración OAuth del host.'}</p>
      <p className="muted">{status.value.accessCheck === 'passed' ? `Hay una comprobación vigente de acceso a ${modelLabel} para la credencial y el perfil actuales.`
        : status.value.accessCheck === 'failed' ? `La comprobación vigente de acceso a ${modelLabel} falló.`
          : status.value.accessCheck === 'stale' ? 'La comprobación anterior ya no acredita acceso para la credencial y el perfil actuales.'
            : `Acceso a la cuenta y perfil efectivo: sin comprobar. La credencial guardada no demuestra acceso a ${modelLabel}.`}</p>
      <p className="muted">Última consulta local: <time dateTime={status.value.checkedAt}>{status.value.checkedAt}</time></p>
    </>}
    <p className="muted">Este panel consulta metadatos locales. No inicia una representación ni ejecuta inferencias. El acceso del proveedor y la sesión local de la aplicación son independientes.</p></>;
}
export function PiOAuthJobStatus({ document, interaction, onAuthorize, busy = false }: { document: PiJobDocument; interaction: PiOAuthInteractionView | null; onAuthorize?: (response: string) => void; busy?: boolean }) {
  const { job } = document;
  const [authorizationCode, setAuthorizationCode] = React.useState('');
  React.useEffect(() => setAuthorizationCode(''), [job.jobId, interaction?.kind === 'authorization-code' ? interaction.challengeId : null]);
  return <div className="pi-access-job"><h3>{job.operation === 'login' ? 'Conexión OAuth' : 'Desconexión OAuth'}</h3><p>{job.provider} · OAuth</p><p role="status">{stateLabels[job.state]}</p><p className="muted">Trabajo: {job.jobId}</p>
    {job.safeCode !== null && <p role="alert">Código de diagnóstico: {job.safeCode}</p>}
    {!piJobIsTerminal(job) && interaction?.kind === 'device-code' && <div className="pi-access-device"><p>Abrí la página oficial de OpenAI y escribí este código público de usuario.</p>
      <a href={interaction.verificationUri} target="_blank" rel="noopener noreferrer">Autorizar en OpenAI ↗</a><p><strong aria-label="Código público de usuario">{interaction.userCode}</strong></p>
      <p>Válido hasta <time dateTime={interaction.expiresAt}>{interaction.expiresAt}</time>.</p><p className="muted">La autorización se completa en OpenAI. No pegues tokens ni códigos de autorización en la aplicación.</p></div>}
    {!piJobIsTerminal(job) && job.provider === 'anthropic' && interaction?.kind === 'authorization-code' && <form onSubmit={event => { event.preventDefault(); const response = authorizationCode.trim(); setAuthorizationCode(''); if (response) onAuthorize?.(response); }}><a href={interaction.authorizationUrl} target="_blank" rel="noopener noreferrer">Autorizar en Claude ↗</a><label>Código de autorización de Claude<input type="password" value={authorizationCode} onChange={event => setAuthorizationCode(event.target.value)} autoComplete="off" spellCheck={false} /></label><button type="submit" disabled={busy || !authorizationCode.trim() || onAuthorize === undefined}>Enviar código una vez</button><p className="muted">El código sólo se envía al trabajo de esta sesión y no se guarda en el navegador. No pegues claves API ni tokens.</p></form>}
    {!piJobIsTerminal(job) && interaction === null && <p className="muted">La guía de autorización pertenece a la sesión local que inició la conexión. Si volviste a abrir la aplicación, el código anterior no se revela: podés consultar el estado y solicitar cancelación del trabajo existente.</p>}
    {job.state === 'interrupted' && <p>El host no puede asegurar el resultado externo. Consultá el estado local antes de iniciar otra conexión.</p>}
  </div>;
}
export function PiAccessPanel({ api = client }: { api?: PiAccessClient }) {
  const [provider, setProvider] = React.useState<PiOAuthProvider>('openai-codex');
  const [status, setStatus] = React.useState<StatusState>({ kind: 'loading' });
  const [document, setDocument] = React.useState<PiJobDocument | null>(null);
  const [interaction, setInteraction] = React.useState<PiOAuthInteractionView | null>(null);
  const [uncertain, setUncertain] = React.useState<PiOAuthIntent | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [recoveryId, setRecoveryId] = React.useState('');
  const [jobs, setJobs] = React.useState<{ kind: 'loading' } | { kind: 'unavailable' } | { kind: 'ready'; items: PiOAuthJobView[]; truncated: boolean }>({ kind: 'loading' });
  const lifetime = React.useRef<AbortController | null>(null);
  const mutationActive = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); lifetime.current = null; };
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    api.status(controller.signal, provider).then(value => { if (!controller.signal.aborted) setStatus({ kind: 'ready', value }); })
      .catch(() => { if (!controller.signal.aborted) setStatus({ kind: 'unavailable' }); });
    api.jobs(controller.signal).then(page => { if (!controller.signal.aborted) setJobs({ kind: 'ready', items: page.items, truncated: page.truncated }); })
      .catch(() => { if (!controller.signal.aborted) setJobs({ kind: 'unavailable' }); });
    return () => { controller.abort(); };
  }, [api, refresh, provider]);
  const jobId = document?.job.jobId;
  const terminal = document === null || piJobIsTerminal(document.job);
  React.useEffect(() => {
    if (jobId === undefined || terminal) { setInteraction(null); return; }
    const currentJobId = jobId;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let cursor = 0;
    async function poll() {
      try {
        const current = await api.job(currentJobId, controller.signal);
        if (controller.signal.aborted) return;
        setDocument(current);
        if (piJobIsTerminal(current.job)) {
          setInteraction(null);
          setUncertain(prior => prior?.kind === 'cancel' && prior.document.job.jobId === current.job.jobId ? null : prior);
          setRefresh(value => value + 1); return;
        }
        const next = await api.interaction(current.job.jobId, cursor, controller.signal);
        if (controller.signal.aborted) return;
        cursor = next.cursor;
        if (next.kind === 'device-code' || next.kind === 'authorization-code') setInteraction(Date.parse(next.expiresAt) > Date.now() ? next : null);
        else setInteraction(prior => prior !== null && prior.kind !== 'waiting' && Date.parse(prior.expiresAt) <= Date.now() ? null : prior);
        setMessage(null);
      } catch { if (!controller.signal.aborted) setMessage('No se pudo actualizar el trabajo. La consulta continuará sin repetir la conexión.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 1500);
    }
    void poll();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, jobId, terminal]);
  React.useEffect(() => {
    if (interaction === null || interaction.kind === 'waiting') return;
    const delay = Math.max(0, Date.parse(interaction.expiresAt) - Date.now());
    const timer = setTimeout(() => setInteraction(null), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [interaction]);
  async function mutate(intent: PiOAuthIntent) {
    const controller = lifetime.current;
    if (controller === null || mutationActive.current) return;
    mutationActive.current = true; setBusy(true); setMessage(null); setUncertain(intent);
    try {
      const result = await api.mutate(intent, controller.signal);
      if (!controller.signal.aborted) { setDocument(result); setUncertain(null); setInteraction(null); setRefresh(value => value + 1); }
    } catch (error) {
      const recovery = await reconcilePiOAuthRejection({ error, intent, readJob: api.job, signal: controller.signal });
      if (!controller.signal.aborted) {
        if (recovery.kind === 'rejected') {
          setUncertain(null);
          if (recovery.document !== null) setDocument(recovery.document);
          setRefresh(value => value + 1);
          setMessage(recovery.rejection.status === 412 ? 'El trabajo cambió de revisión. Se consultó el estado actual; podés solicitar cancelación de nuevo si sigue activo.' : `Solicitud rechazada. Referencia: ${recovery.rejection.requestId}.`);
        } else setMessage('No se confirmó la operación. Recuperá el resultado con la misma clave antes de iniciar otra.');
      }
    }
    finally { mutationActive.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function authorize(response: string) {
    const controller = lifetime.current;
    if (controller === null || mutationActive.current || document === null || interaction?.kind !== 'authorization-code') return;
    mutationActive.current = true; setBusy(true); setMessage(null);
    const challengeId = interaction.challengeId;
    setInteraction(null);
    try { await api.respondInteraction({ jobId: document.job.jobId, challengeId, response }, controller.signal); }
    catch { if (!controller.signal.aborted) setMessage('No se confirmó el envío. Consultá el trabajo; el código no se reenvía automáticamente.'); }
    finally { mutationActive.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function recoverJob(id = recoveryId.trim()) {
    const controller = lifetime.current;
    if (controller === null || mutationActive.current) return;
    mutationActive.current = true; setBusy(true); setMessage(null);
    try { const result = await api.job(id, controller.signal); if (!controller.signal.aborted) { setDocument(result); setInteraction(null); } }
    catch { if (!controller.signal.aborted) setMessage('No se pudo recuperar ese trabajo de acceso. Revisá su identificador.'); }
    finally { mutationActive.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const activeJobs = jobs.kind === 'ready' && jobs.items.some(job => !piJobIsTerminal(job));
  const disabled = busy || uncertain !== null || !terminal || activeJobs || jobs.kind !== 'ready' || status.kind !== 'ready' || status.value.authState === 'error';
  return <section className="pi-access-panel" aria-labelledby="pi-access-title"><header><span className="eyebrow">Acceso del host</span><h2 id="pi-access-title">Conexión Pi</h2><p>Administrá el acceso técnico compartido sin mezclar las memorias ni los historiales de los personajes.</p></header>
    <label>Proveedor del login<select value={provider} onChange={event => { setProvider(event.target.value === 'anthropic' ? 'anthropic' : 'openai-codex'); setStatus({ kind: 'loading' }); }}><option value="openai-codex">OpenAI Codex · login OAuth</option><option value="anthropic">Anthropic Claude · login OAuth</option></select></label>
    <PiAccessStatus status={status} provider={provider} />
    <div className="draft-actions"><button type="button" disabled={disabled} onClick={() => void mutate({ kind: 'login', key: crypto.randomUUID(), provider })}>Conectar con {provider === 'anthropic' ? 'Claude' : 'OpenAI'}</button>
      <button type="button" disabled={disabled || status.kind !== 'ready' || status.value.authState !== 'present'} onClick={() => void mutate({ kind: 'logout', key: crypto.randomUUID(), provider })}>Desconectar OAuth</button>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Consultar estado local</button></div>
    <p className="muted">Conectar abre una autorización con el proveedor seleccionado y puede contactar al proveedor. Desconectar elimina la credencial local; la historia de la obra se conserva.</p>
    {message && <p role="alert">{message}</p>}
    {uncertain && !busy && <button type="button" onClick={() => void mutate(uncertain)}>Recuperar resultado de la operación</button>}
    {document && <><PiOAuthJobStatus document={document} interaction={interaction} onAuthorize={response => void authorize(response)} busy={busy} />{!terminal && document.job.state !== 'cancel-requested' && <button type="button" disabled={busy || uncertain !== null} onClick={() => void mutate({ kind: 'cancel', key: crypto.randomUUID(), document })}>Solicitar cancelación</button>}</>}
    <div className="pi-access-history"><h3>Trabajos de acceso guardados</h3><p className="muted">Esta lista se lee del host al abrir el panel. Recuperar un trabajo no inicia otra autorización.</p>
      {jobs.kind === 'loading' ? <p role="status">Consultando trabajos locales…</p> : jobs.kind === 'unavailable' ? <p role="alert">No se pudo consultar la historia de acceso. Actualizá el estado local antes de iniciar otra conexión.</p> : <><PiOAuthJobsList items={jobs.items} disabled={busy || uncertain !== null || !terminal} onSelect={id => void recoverJob(id)} />{jobs.truncated && <p className="muted">La lista abarca los 1.000 trabajos más recientes. Para uno anterior, usá su identificador.</p>}</>}
    </div>
    <details><summary>Recuperar un trabajo por su identificador</summary><p>Consulta el trabajo existente. No inicia otra autorización.</p><label>Identificador del trabajo<input value={recoveryId} onChange={event => setRecoveryId(event.target.value)} autoComplete="off" spellCheck={false} /></label><button type="button" disabled={busy || uncertain !== null || !terminal || !recoveryId.trim()} onClick={() => void recoverJob()}>Consultar trabajo</button></details>
    <p className="muted">La comprobación de acceso se hace con el sondeo separado. Este panel sólo administra OAuth.</p>
  </section>;
}

/** Recent metadata is authoritative across remount/reload, even when the creation response was lost. */
export function PiOAuthJobsList({ items, disabled, onSelect }: { items: PiOAuthJobView[]; disabled: boolean; onSelect: (jobId: string) => void }) {
  if (items.length === 0) return <p>No hay trabajos de acceso guardados.</p>;
  return <ul>{items.map(job => <li key={job.jobId}><strong>{job.operation === 'login' ? 'Conexión' : 'Desconexión'} · {job.provider} · {stateLabels[job.state]}</strong><p className="muted">{job.jobId} · <time dateTime={job.updatedAt}>{job.updatedAt}</time></p><button type="button" disabled={disabled} onClick={() => onSelect(job.jobId)}>Recuperar este trabajo</button></li>)}</ul>;
}
