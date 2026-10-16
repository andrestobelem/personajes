import React from 'react';
import type { ConversationView, RunStageView, TechnicalJobView } from '../domain/run-observation.ts';
import { StageMap, type StageMapData } from './StageMap.tsx';
import { formatFictionalClock } from './stage-format.ts';

const lifecycleLabels: Record<RunStageView['lifecycle'], string> = {
  draft: 'Borrador', ready: 'Lista', running: 'En ejecución', paused: 'En pausa', stopped: 'Detenida', closed: 'Cerrada',
};
const roles: Record<TechnicalJobView['kind'], string> = {
  actor: 'Actor', continuista: 'Continuista', director: 'Director', narrator: 'Narrador', configurator: 'Configurador',
  'narration-reviewer': 'Continuista de narración', pulse: 'Pulso', step: 'Paso', preflight: 'Comprobación',
};
const gestures = { wave: 'Saluda con la mano', point: 'Señala', nod: 'Asiente', shakeHead: 'Niega con la cabeza', posture: 'Cambia de postura', bark: 'Ladra', whine: 'Gime' };
export function LivePerformance({ stage, items, jobs, map, connected, error, onExit, children, exportControl }: {
  stage: RunStageView; items: ConversationView[]; jobs: TechnicalJobView[]; map: StageMapData;
  connected: boolean; error: string | null; onExit: () => void; children?: React.ReactNode; exportControl?: React.ReactNode;
}) {
  const [follow, setFollow] = React.useState(true);
  const feed = React.useRef<HTMLOListElement>(null);
  const latest = items.at(-1)?.eventId;
  React.useEffect(() => {
    if (follow && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [latest, follow]);
  const working = jobs.filter(job => job.state === 'running' || job.state === 'cancel-requested');
  const latestJob = [...jobs].sort((a,b) => b.updatedAt - a.updatedAt)[0];
  return <section className="live-performance" aria-label="Representación en tiempo real">
    <header className="live-header">
      <div><span className={`live-indicator ${error ? 'is-stale' : ''}`}>{error ? 'Sin sincronizar' : connected ? 'En vivo' : 'Actualización automática · cada 2 s'}</span><h1>{stage.scenes.find(scene => scene.id === stage.activeSceneId)?.label ?? 'Entre escenas'}</h1><p>{lifecycleLabels[stage.lifecycle]} · {formatFictionalClock(stage.clock)}</p></div>
      <button onClick={onExit}>Volver a los controles</button>
    </header>
    {exportControl}
    {error && <p role="alert" className="stage-sync">{error} Se conserva la última lectura confirmada.</p>}
    <div className="live-body">
      <aside className="live-map">{stage.activeSceneId === null || map.places.length === 0
        ? <section aria-label="Escenografía confirmada"><h2>Escenario</h2><div role="status">{stage.activeSceneId === null ? 'Entre escenas. No hay una escena activa. Podés consultar las escenas anteriores desde los controles.' : 'No hay lugares disponibles en este corte.'}</div></section>
        : <StageMap data={map}/>}</aside>
      <section className="live-dialogue" aria-label="Diálogos en vivo">
        <header><h2>Conversación</h2><label><input type="checkbox" checked={follow} onChange={event=>setFollow(event.target.checked)}/> Seguir lo último</label></header>
        <ol ref={feed} aria-live="polite" aria-relevant="additions" aria-label="Intervenciones confirmadas">
          {items.map(item=><li key={item.eventId} className={`live-line ${item.speaker.kind === 'human' ? 'human-line' : ''}`}><strong>{item.speaker.label}</strong><blockquote>{item.content.kind === 'speech' ? item.content.text : gestures[item.content.gesture.kind]}</blockquote><small>{item.channel.label} · personajes alcanzados: {item.effectiveAudience.map(person=>person.label).join(', ') || 'ninguno'} · recepción humana: {item.speaker.kind==='human'?'no aplica: intervención dirigida al reparto':item.effectiveHumanAudience===undefined?'sin registro histórico':item.effectiveHumanAudience.map(person=>person.label).join(', ')||'ninguna'} (no confirma lectura ni memoria ICM)</small></li>)}
          {items.length===0 && <li>Aún no hay intervenciones confirmadas.</li>}
        </ol>
        <footer role="status">
          {stage.lifecycle !== 'running' ? lifecycleLabels[stage.lifecycle] : working.length > 0
            ? working.map(job=>`${roles[job.kind]}${job.actor ? ` · ${job.actor.label}` : ''}: ${job.state === 'cancel-requested' ? 'cancelación solicitada' : 'trabajando'}`).join(' · ')
            : 'Sin trabajo activo en la lectura actual. Esperando la próxima actividad.'}
          {stage.lifecycle !== 'running' && working.length > 0 && <small>Hay registros técnicos pendientes de finalizar en esta lectura; no confirman actividad actual de la representación.</small>}
          {(latestJob?.state === 'blocked' || latestJob?.state === 'failed') && <small>El último trabajo registrado {latestJob.state === 'failed' ? 'falló' : 'está bloqueado'}; su diagnóstico se conserva en los controles.</small>}
          <small>Secuencia {stage.worldSeq} · Sólo acciones y emisiones confirmadas</small>
        </footer>
      </section>
    </div>
    <details className="live-participation"><summary>Hablar con los personajes</summary>{children}</details>
  </section>;
}
