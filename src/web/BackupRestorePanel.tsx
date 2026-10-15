import React from 'react';
import type {z} from 'zod';
import type {HostRecoveryOwnershipSchema} from '../domain/host-recovery.ts';
import { RunIdSchema } from '../domain/values.ts';
import { BackupIdSchema } from '../domain/backup.ts';
import type { HostRecoveryJob } from '../domain/host-recovery.ts';
import type { ForkJobView } from '../domain/fork-http.ts';
import { createForkClient, newerForkJob, type ForkClient } from './fork-client.ts';
import { ForkJobStatus } from './ForkPanel.tsx';
import { backupRejection, captureBackupIntent, createBackupClient, newerHostRecovery, readStoredBackupIntent, selectRestoreRetry, writeStoredBackupIntent, type BackupClient, type BackupIntent, type BackupJob, type BackupPreview, type BackupSources } from './backup-client.ts';
const client = createBackupClient();
const forks = createForkClient();
export function RestoreDiff({ preview }: { preview: BackupPreview }) {
  return <div><h3>Diferencias de la restauración</h3><p>{preview.mode === 'fork' ? 'Se creará una representación independiente desde el backup; el origen se conserva. No inicia actores ni genera audio.' : 'Se recuperará el host completo desde el backup. Se pausarán las operaciones mientras se conservan los datos originales, se instala el conjunto y se verifica la recuperación.'}</p>
    <p>Operación: <code>{preview.operationId}</code>. Revisión válida hasta {new Date(preview.expiresAt).toLocaleString('es')}.</p>
    <ul>{preview.differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul>
    {preview.blockers.length > 0 && <div role="alert"><p>Esta restauración todavía no se puede aplicar:</p><ul>{preview.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div>}
  </div>;
}
export function HostRecoveryStatus({job,onResume,busy=false,hasPreviousLock=false}:{job:HostRecoveryJob;onResume?:()=>void;busy?:boolean;hasPreviousLock?:boolean}) {
  const phases = {queued:'Solicitud guardada',staging:'Verificando el conjunto guardado',closing:'Cerrando operaciones del host', 'original-preserved':'Datos originales conservados',installed:'Conjunto instalado',reopening:'Restableciendo el host',verified:'Verificación final completada','original-retained':'Host original conservado y disponible'};
  const verified = job.state === 'succeeded' && job.phase === 'verified';
  return <div role="status"><h3>{verified ? 'Host recuperado y verificado' : job.state==='aborted' ? 'Recuperación cancelada; se conservó el host original' : job.state === 'failed' || job.state === 'interrupted' ? 'La recuperación requiere revisión' : 'Recuperación del host en curso'}</h3><p>{phases[job.phase]} · revisión {job.revision}.</p><p>Operación: <code>{job.operationId}</code> · backup <code>{job.backupId}</code>.</p>{job.safeCode !== null && <p role="alert">{job.safeCode}</p>}{!verified && <p>La consulta conserva esta operación y no vuelve a ejecutar la restauración.</p>}{onResume!==undefined&&job.state!=='succeeded'&&job.state!=='aborted'&&<button type="button" disabled={busy} onClick={onResume}>{hasPreviousLock?'Reanudar y revisar bloqueo anterior':job.state==='queued'||job.state==='running'?'Reanudar si se interrumpió':'Reanudar recuperación'}</button>}</div>;
}
export function BackupRestorePanel({ onOpenRun, onHostRecovered, onOriginalRetained, onBackupAvailable, recoveryOnly = false, api = client, forkApi = forks }: { onOpenRun?: (runId: string) => void; onHostRecovered?:()=>void; onOriginalRetained?:()=>void; onBackupAvailable?:(backupId:string)=>void; recoveryOnly?:boolean; api?: BackupClient; forkApi?: ForkClient }) {
  const [restored] = React.useState(() => { if (typeof window === 'undefined') return null; try { return readStoredBackupIntent(window.sessionStorage); } catch { return null; } });
  const [backupId, setBackupId] = React.useState(restored?.backupId ?? '');
  const [backup, setBackup] = React.useState<BackupJob | null>(null);
  React.useEffect(()=>{if(backup?.state==='succeeded')onBackupAvailable?.(backup.backupId);},[backup,onBackupAvailable]);
  const [sources, setSources] = React.useState<BackupSources | null>(null);
  const [mode, setMode] = React.useState<'fork'|'recover'>(restored?.kind === 'recover' ? 'recover' : 'fork');
  const [recovery, setRecovery] = React.useState<HostRecoveryJob|null>(null);
  const [ownership,setOwnership] = React.useState<z.infer<typeof HostRecoveryOwnershipSchema>|null>(null);
  const recoveryAnnounced = React.useRef<string|null>(null);
  const originalAnnounced = React.useRef<string|null>(null);
  const [sourceRunId, setSourceRunId] = React.useState('');
  const [name, setName] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [intent, setIntent] = React.useState<BackupIntent | null>(restored);
  const [preview, setPreview] = React.useState<BackupPreview | null>(restored?.kind === 'apply' || restored?.kind === 'recover' ? restored.preview : null);
  const [job, setJob] = React.useState<ForkJobView | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [repreview, setRepreview] = React.useState(false);
  const lock = React.useRef(false);
  const lifetime = React.useRef<AbortController | null>(null);
  const retry = React.useRef<{ job: ForkJobView; key: string } | null>(restored?.kind === 'apply' ? restored.retry ?? null : null);
  React.useEffect(() => () => lifetime.current?.abort(), []);
  function preserve(value: BackupIntent) {
    const valid = captureBackupIntent(value);
    if (typeof window === 'undefined' || !writeStoredBackupIntent(window.sessionStorage, valid)) throw new Error('No se pudo conservar el intento. Habilitá el almacenamiento de sesión antes de enviarlo.');
    setIntent(valid); return valid;
  }
  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const controller = new AbortController(); lifetime.current = controller;
    try { await operation(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) { const rejection = backupRejection(failure); setError(rejection ? `${rejection.message} (${rejection.code})` : `${failure instanceof Error ? failure.message : 'No llegó confirmación.'} Si el envío quedó incierto, conservamos el mismo intento para consultarlo o repetirlo.`); setRepreview(rejection !== undefined && ['RESTORE_PREVIEW_EXPIRED','RESTORE_LEGACY_PREVIEW_RECREATE','RESTORE_PREVIEW_NOT_FOUND'].includes(rejection.code)); } }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function load(id: string, signal: AbortSignal) {
    const result = await api.read(id, signal); if (signal.aborted) return;
    setBackup(result); setBackupId(id);
    if (result.state === 'succeeded') { const choices = await api.sources(id, signal); if (!signal.aborted) setSources(choices); }
  }
  async function execute(value: BackupIntent, signal: AbortSignal) {
    const saved = preserve(value);
    if (saved.kind !== 'apply' || saved.preview.operationId !== retry.current?.job.operationId) retry.current = null;
    switch (saved.kind) {
      case 'create': { const result = await api.create(saved, signal); if (signal.aborted) return; setBackup(result); setBackupId(result.backupId); if (result.state === 'succeeded') { const choices = await api.sources(result.backupId, signal); if (!signal.aborted) setSources(choices); } break; }
      case 'preview': { const result = await api.preview(saved, signal); if (!signal.aborted) { setPreview(result); setConfirmed(false); } break; }
      case 'recover': {const result = await api.recover(saved,signal); if (!signal.aborted) setRecovery(current=>newerHostRecovery(current,result)); break;}
      case 'apply': { const result = await api.apply(saved, signal); if (!signal.aborted) setJob(current => newerForkJob(current, result)); break; }
      default: { const exhaustive: never = saved; return exhaustive; }
    }
  }
  React.useEffect(() => {
    if (restored === null || restored.kind === 'recover') return;
    const controller = new AbortController();
    void load(restored.backupId, controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el backup conservado.'); });
    if (restored.kind === 'apply') void forkApi.read(restored.preview.operationId, controller.signal).then(result => { if (!controller.signal.aborted) setJob(current => newerForkJob(current, result)); }).catch(() => { if (!controller.signal.aborted) setError('No se confirmó la restauración conservada. Consultá su estado o repetí el mismo envío confirmado.'); });
    return () => controller.abort();
  }, [restored, api, forkApi]);
  React.useEffect(() => {
    if (job?.state !== 'staging') return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (job === null) return;
      try { const result = await forkApi.read(job.operationId, controller.signal); if (!controller.signal.aborted) setJob(current => newerForkJob(current, result)); }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la restauración.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [job?.state, job?.operationId, forkApi]);
  React.useEffect(() => {
    if (job?.state !== 'ready') return;
    retry.current = null;
    if (intent?.kind !== 'apply' || intent.preview.operationId !== job.operationId || intent.retry === undefined) return;
    const {retry: _retry, ...settled} = intent;
    try {
      if (typeof window !== 'undefined' && writeStoredBackupIntent(window.sessionStorage, settled)) setIntent(settled);
      else setError('La restauración está publicada, pero no se pudo actualizar el intento conservado en el navegador.');
    } catch { setError('La restauración está publicada, pero no se pudo actualizar el intento conservado en el navegador.'); }
  }, [job?.state, job?.operationId, intent]);
  React.useEffect(() => {
    if (intent?.kind !== 'recover' || (recovery !== null && recovery.state !== 'queued' && recovery.state !== 'running')) return;
    const controller = new AbortController(); let timer:ReturnType<typeof setTimeout>|undefined;
    const identity = {operationId:intent.preview.operationId,backupId:intent.backupId};
    async function poll() {
      try {const next = await api.readRecovery(identity,controller.signal); if (!controller.signal.aborted) {setRecovery(current=>newerHostRecovery(current,next)); setError('');}}
      catch (failure) {if (!controller.signal.aborted) setError(`${failure instanceof Error ? failure.message : 'Esperando la reconexión del host.'} Conservamos la operación; sólo consultamos su estado.`);}
      if (!controller.signal.aborted) timer=setTimeout(()=>void poll(),2000);
    }
    timer=setTimeout(()=>void poll(),500);
    return ()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[intent,api,recovery?.state]);
  React.useEffect(()=>{
    if(recovery===null||recovery.state==='succeeded'||recovery.state==='aborted')return;
    const controller=new AbortController();
    void api.readRecoveryOwnership(recovery.operationId,controller.signal).then(value=>{if(!controller.signal.aborted)setOwnership(value);}).catch(()=>{/* The explicit action rechecks ownership before reserving a resume. */});
    return ()=>controller.abort();
  },[recovery?.operationId,recovery?.revision,api]);
  React.useEffect(()=>{
    if(intent?.kind!=='recover'||intent.resume===undefined||recovery===null||recovery.operationId!==intent.preview.operationId||recovery.revision<=intent.resume.job.revision)return;
    const {resume:_resume,...settled}=intent;
    try {if(typeof window!=='undefined'&&writeStoredBackupIntent(window.sessionStorage,settled))setIntent(settled);else setError('Se confirmó el avance, pero no se pudo actualizar la solicitud conservada.');}
    catch {setError('Se confirmó el avance, pero no se pudo actualizar la solicitud conservada.');}
  },[intent,recovery]);
  React.useEffect(()=>{
    if (recovery?.state !== 'succeeded' || recovery.phase !== 'verified' || recoveryAnnounced.current === recovery.operationId) return;
    recoveryAnnounced.current=recovery.operationId; onHostRecovered?.();
  },[recovery,onHostRecovered]);
  React.useEffect(()=>{
    if(recovery?.state!=='aborted'||recovery.phase!=='original-retained'||originalAnnounced.current===recovery.operationId)return;
    originalAnnounced.current=recovery.operationId;onOriginalRetained?.();
  },[recovery,onOriginalRetained]);
  const pinned = intent !== null && (intent.kind !== 'create' || backup?.state !== 'succeeded');
  const apply = intent?.kind === 'apply' ? intent : null;
  const admitted = intent?.kind === 'apply' || intent?.kind === 'recover' ? intent : null;
  return <section className="dramatic-structure-panel" aria-label="Backups y restauración"><h2>Backups y restauración</h2>
    <p>Guardá un corte coherente de todas las representaciones. Podés crear una bifurcación independiente o recuperar el host completo con cierre y reapertura administrados.</p>
    {!recoveryOnly && <fieldset disabled={busy || pinned}><legend>Backup local del host</legend><button type="button" onClick={() => void perform(signal => execute({ kind: 'create', backupId: BackupIdSchema.parse(crypto.randomUUID()), key: crypto.randomUUID() }, signal))}>Crear backup de todas las representaciones</button>
      <label>Identificador de backup guardado<input value={backupId} onChange={event => setBackupId(event.target.value)} placeholder="UUID del backup" /></label><button type="button" disabled={!BackupIdSchema.safeParse(backupId).success} onClick={() => void perform(signal => load(backupId, signal))}>Consultar backup guardado</button></fieldset>}
    {backup && <p role="status">Backup <code>{backup.backupId}</code>: {backup.state === 'succeeded' ? 'verificado y disponible' : backup.state === 'running' ? 'en preparación' : `no disponible (${backup.safeCode ?? backup.state})`}.</p>}
    {backup?.state === 'running' && <button type="button" disabled={busy} onClick={() => void perform(signal => load(backup.backupId, signal))}>Actualizar estado del backup</button>}
    {!recoveryOnly && backup?.state === 'succeeded' && preview === null && <form onSubmit={event => { event.preventDefault(); const selection = mode === 'recover' ? {mode:'recover' as const} : {mode:'fork' as const,sourceRunId:RunIdSchema.parse(sourceRunId),name,reason}; void perform(signal => execute({ kind: 'preview', backupId: backup.backupId, key: crypto.randomUUID(), selection }, signal)); }}><fieldset disabled={busy || (intent !== null && intent.kind !== 'create')}><legend>Elegir qué restaurar</legend>
      <label><input type="radio" name="restore-mode" checked={mode==='fork'} onChange={()=>setMode('fork')} />Crear una bifurcación independiente</label><label><input type="radio" name="restore-mode" checked={mode==='recover'} onChange={()=>setMode('recover')} />Recuperar el host completo</label>
      {mode==='fork' ? <><label>Origen dentro del backup<select required value={sourceRunId} onChange={event => setSourceRunId(event.target.value)}><option value="">Elegí un origen</option>{sources?.sources.map(source => <option key={source.runId} value={source.runId}>{source.runId} · commit {source.commitIndex} · Escenario {source.worldRevision} · secuencia {source.worldSeq}</option>)}</select></label>
      <label>Nombre de la nueva representación<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Motivo<textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label></> : <p>La recuperación conserva los originales y detiene temporalmente las operaciones del host. Revisá las diferencias antes de confirmar.</p>}
      <button disabled={mode==='fork' && (!sourceRunId || !name.trim() || !reason.trim())}>Revisar restauración desde el backup</button></fieldset></form>}
    {preview !== null && job === null && recovery === null && <><RestoreDiff preview={preview} />{admitted === null && <><label><input type="checkbox" checked={confirmed} disabled={busy || preview.blockers.length > 0} onChange={event => setConfirmed(event.target.checked)} />{preview.mode==='fork' ? 'Revisé las diferencias y quiero crear esta representación independiente.' : 'Revisé las diferencias y quiero recuperar el host completo, con la pausa y reapertura indicadas.'}</label>
      <button type="button" disabled={busy || !confirmed || preview.blockers.length > 0 || backup === null} onClick={() => { if (backup !== null) void perform(signal => execute(preview.mode==='fork' ? { kind: 'apply', backupId: preview.backupId, key: crypto.randomUUID(), backupRevision: backup.revision, preview } : {kind:'recover',backupId:preview.backupId,key:crypto.randomUUID(),backupRevision:backup.revision,preview}, signal)); }}>{preview.mode==='fork' ? 'Confirmar restauración como bifurcación' : 'Confirmar recuperación del host'}</button></>}
    </>}
    {intent?.kind === 'preview' && intent.selection.mode==='fork' && <p>Origen conservado: <code>{intent.selection.sourceRunId}</code>. Destino: {intent.selection.name}. Motivo: {intent.selection.reason}.</p>}
    {(intent?.kind === 'preview' || repreview) && <button type="button" disabled={busy} onClick={() => { if (typeof window !== 'undefined' && !writeStoredBackupIntent(window.sessionStorage, null)) { setError('No se pudo liberar la revisión conservada.'); return; } retry.current = null; setIntent(null); setPreview(null); setConfirmed(false); setRepreview(false); }}>Descartar revisión y elegir otro origen</button>}
    {intent !== null && job === null && recovery === null && <button type="button" disabled={busy} onClick={() => void perform(signal => execute(intent, signal))}>{intent.kind === 'apply' || intent.kind === 'recover' ? 'Repetir mismo envío confirmado' : 'Repetir la misma solicitud'}</button>}
    {apply !== null && <><p>Operación conservada: <code>{apply.preview.operationId}</code></p><button type="button" disabled={busy} onClick={() => void perform(async signal => { const result = await forkApi.read(apply.preview.operationId, signal); if (!signal.aborted) setJob(current => newerForkJob(current, result)); })}>Consultar estado de la restauración</button></>}
    {intent?.kind==='recover' && <button type="button" disabled={busy} onClick={()=>void perform(async signal=>{const result=await api.readRecovery({operationId:intent.preview.operationId,backupId:intent.backupId},signal);if(!signal.aborted)setRecovery(current=>newerHostRecovery(current,result));})}>Consultar recuperación del host</button>}
    {recovery !== null && <HostRecoveryStatus job={recovery} busy={busy} hasPreviousLock={ownership?.operationId===recovery.operationId&&ownership.directoryOperation.kind==='present'} {...(intent?.kind!=='recover'?{}:{onResume:()=>void perform(async signal=>{
      let pending=intent.resume;
      if(pending===undefined){const observed=await api.readRecoveryOwnership(recovery.operationId,signal);if(signal.aborted)return;setOwnership(observed);pending={job:recovery,key:crypto.randomUUID(),...(observed.directoryOperation.kind==='present'?{expectedDirectoryOperationNonce:observed.directoryOperation.nonce}:{})};}
      const saved=preserve({...intent,resume:pending});
      if(saved.kind!=='recover')return;
      const result=await api.resumeRecovery(saved,signal);if(!signal.aborted)setRecovery(current=>newerHostRecovery(current,result));
    })})}/>}
    {job !== null && <ForkJobStatus job={job} {...(onOpenRun === undefined ? {} : { onOpenRun })} />}
    {job?.state === 'failed' && <button type="button" disabled={busy} onClick={() => void perform(async signal => { if (apply === null) return; const value = selectRestoreRetry({job, pending:retry.current, key:crypto.randomUUID()}); preserve({ ...apply, retry: value }); retry.current = value; const result = await forkApi.retry(value, signal); if (!signal.aborted) { setJob(current => newerForkJob(current, result)); retry.current = null; const {retry: _retry, ...settled} = apply; preserve(settled); } })}>Reintentar restauración en el mismo destino</button>}
    {(job?.state === 'ready' || (recovery?.state==='succeeded' && recovery.phase==='verified') || recovery?.state==='aborted' || (preview?.blockers.length ?? 0) > 0) && <button type="button" disabled={busy} onClick={() => { try { if (typeof window !== 'undefined' && !writeStoredBackupIntent(window.sessionStorage, null)) { setError('No se pudo liberar el intento conservado.'); return; } } catch { setError('No se pudo liberar el intento conservado.'); return; } retry.current = null; setIntent(null); setPreview(null); setJob(null); setRecovery(null); setOwnership(null); recoveryAnnounced.current=null; originalAnnounced.current=null; setConfirmed(false); setRepreview(false); setSources(null); setBackup(null); }}>Preparar otra restauración</button>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Esperando confirmación del host…</p>}
  </section>;
}
