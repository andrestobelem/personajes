import React from 'react';
import { IcmContextInspectionRequestSchema, type IcmContextInspectionPage } from '../domain/icm-context-inspection.ts';
import { IcmWorkspaceRoleSchema } from '../domain/icm-workspace-schema.ts';
import { createIcmContextInspectionClient, IcmInspectionRejection, type IcmContextInspectionClient } from './icm-context-inspection-client.ts';
import { subscribeToHostSessionReset } from './host-session-reset.ts';

const client = createIcmContextInspectionClient();
const roles = { actor: 'Actor', continuista: 'Continuista', director: 'Director', configurator: 'Configurador', narrator: 'Narrador', 'narration-reviewer': 'Revisor de narración' };
export function IcmContextInspectionPanel({ runId, api = client, onPermissionLost }: { runId: string; api?: IcmContextInspectionClient; onPermissionLost?: () => void }) {
  const [role, setRole] = React.useState(''); const [actorId, setActorId] = React.useState(''); const [jobId, setJobId] = React.useState('');
  const [page, setPage] = React.useState<IcmContextInspectionPage | null>(null);
  const [available, setAvailable] = React.useState(true);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const epoch = React.useRef(0); const controller = React.useRef<AbortController | null>(null); const active = React.useRef(false);
  const permissionLost = React.useRef(onPermissionLost); permissionLost.current = onPermissionLost;
  function reset() { ++epoch.current; controller.current?.abort(); controller.current = null; setPage(null); setBusy(false); setError(''); }
  React.useEffect(() => {
    active.current = true; setAvailable(true); reset(); setRole(''); setActorId(''); setJobId('');
    const unsubscribe = subscribeToHostSessionReset(() => { active.current = false; setAvailable(false); reset(); });
    return () => { active.current = false; ++epoch.current; controller.current?.abort(); unsubscribe(); };
  }, [runId, api]);
  async function read(offset = 0) {
    if (!active.current || busy) return;
    const request = IcmContextInspectionRequestSchema.safeParse({ runId, offset, limit: 25, filters: { ...(role === '' ? {} : { role }), ...(role === 'actor' && actorId.trim() !== '' ? { actorId: actorId.trim() } : {}), ...(jobId.trim() === '' ? {} : { jobId: jobId.trim() }) } });
    reset();
    if (!request.success) { setError('Revisá el identificador de personaje o de trabajo y sus filtros.'); return; }
    const current = ++epoch.current; const pending = new AbortController(); controller.current = pending; setBusy(true);
    try {
      const result = await api.read(request.data, pending.signal);
      if (!pending.signal.aborted && current === epoch.current && active.current) setPage(result);
    } catch (failure) {
      if (!pending.signal.aborted && current === epoch.current && active.current) {
        setError('No se pudo verificar el archivo privado ICM. No se sustituyó por fuentes actuales.');
        if (failure instanceof IcmInspectionRejection && [401, 403].includes(failure.status)) { active.current = false; setAvailable(false); permissionLost.current?.(); }
      }
    } finally { if (!pending.signal.aborted && current === epoch.current) setBusy(false); }
  }
  return <section aria-label="Paquetes privados ICM" style={{ overflowWrap: 'anywhere' }}><h3>Paquetes ICM por rol y trabajo</h3>
    <p>Archivo completo de la representación. Incluye trabajos posteriores al corte mental seleccionado arriba. Cada paquete se verifica contra su propia configuración y commit históricos; no modifica la obra ni llama al modelo.</p>
    <p>Se muestran hashes y procedencia, sin prompts, instrucciones, Markdown ni contexto diegético. Esta inspección no certifica la ejecución del proveedor.</p>
    <label>Rol del paquete<select value={role} onChange={event => { reset(); setRole(event.target.value); setActorId(''); }}><option value="">Todos los roles</option>{IcmWorkspaceRoleSchema.options.map(value => <option key={value} value={value}>{roles[value]}</option>)}</select></label>
    {role === 'actor' && <label>Identificador del actor<input value={actorId} onChange={event => { reset(); setActorId(event.target.value); }} /></label>}
    <label>Identificador del trabajo (opcional)<input value={jobId} onChange={event => { reset(); setJobId(event.target.value); }} /></label>
    <button disabled={busy || !available} onClick={() => void read()}>Consultar paquetes ICM</button>
    {busy && <p role="status">Verificando paquetes y fuentes históricas…</p>}{error && <p role="alert">{error}</p>}
    {page !== null && page.runId === runId && <>
      <p>{page.configuration.kind === 'legacy-without-icm' ? 'La configuración vigente verificada no tiene ICM Markdown: conserva el comportamiento histórico.' : page.configuration.kind === 'configured' ? `Configuración vigente verificada ${page.configuration.configurationRevision} · snapshot ICM ${page.configuration.workspaceSnapshotHash}` : 'No se pudo verificar la configuración vigente. No se interpreta la ausencia de filas como configuración histórica sin ICM.'}</p>
      {page.configuration.kind !== 'unavailable' && <p>Configuración vigente SHA-256 {page.configuration.configurationHash} · commit {page.configuration.commitIndex}</p>}
      <p>{page.total} paquetes para estos filtros. {page.items.length === 0 ? 'No hay paquetes en esta página; esto no demuestra que se haya ejecutado un trabajo.' : `Se muestran ${page.offset + 1}–${page.offset + page.items.length}.`}</p>
      <ol start={page.offset + 1}>{page.items.map(item => <li key={item.position}>
        <h4>{item.identity === undefined ? 'Identidad de fila no verificable' : `${roles[item.identity.audience.role]}${item.identity.audience.role === 'actor' ? ` · ${item.identity.audience.actorId}` : ''} · trabajo ${item.identity.jobId} · generación ${item.identity.generation}`}</h4>
        {item.kind === 'corrupt' ? <p role="alert">Paquete o fuente histórica corruptos o ausentes. No se reconstruyó desde archivos actuales.</p> : <>
          <p>Paquete verificado contra su configuración y corte históricos. Configuración {item.scope.configurationRevision} · {item.scope.cut.kind === 'world-cut' ? `commit ${item.scope.cut.commitIndex} · revisión ${item.scope.cut.worldRevision} · secuencia ${item.scope.cut.worldSeq}` : `borrador ${item.scope.cut.draftRevision}`}</p>
          <p>Compilador {item.compilerVersion} · paquete SHA-256 {item.packetHash} · snapshot ICM SHA-256 {item.workspaceSnapshotHash}</p>
          {item.preparedContextHash !== undefined && <p>Contexto preparado SHA-256 {item.preparedContextHash} (distinto del hash del paquete)</p>}
          <details><summary>Procedencia de {item.sources.length} fuentes</summary><ul>{item.sources.map(source => <li key={source.sourceId}>{source.sourceId} · revisión {source.revision} · SHA-256 {source.sourceHash}<ul>{source.sections.map(section => <li key={section.sectionId}>{section.sectionId} · SHA-256 {section.sectionHash}</li>)}</ul></li>)}</ul></details>
        </>}
      </li>)}</ol>
      <nav aria-label="Páginas de paquetes ICM"><button disabled={busy || page.offset === 0} onClick={() => void read(Math.max(0, page.offset - page.limit))}>Paquetes anteriores</button><button disabled={busy || !page.hasMore} onClick={() => void read(page.offset + page.limit)}>Paquetes siguientes</button></nav>
    </>}
  </section>;
}
