import React from 'react';
import type { RunModelTimeBudget } from '../domain/model-time-budget.ts';
import { createRunPreflightClient, type RunPreflightClient } from './run-preflight-client.ts';

const client = createRunPreflightClient();
type State = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'ready'; budget: RunModelTimeBudget };
function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes} min ${remainder} s`;
}

export function RunBudgetPanel({ runId, api = client }: { runId: string; api?: Pick<RunPreflightClient, 'budget'> }) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api.budget(runId, controller.signal).then(budget => {
      if (!controller.signal.aborted) setState({ kind: 'ready', budget });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'unavailable' });
    });
    return () => controller.abort();
  }, [api, runId, refresh]);

  const budget = state.kind === 'ready' ? state.budget : null;
  const progressMax = budget === null ? 1 : Math.max(1, budget.maxWallTimeMs);
  const progressValue = budget === null || budget.wallTimeMeasuredMs === null
    ? 0 : Math.min(progressMax, budget.wallTimeMeasuredMs + budget.wallTimeReservedMs);
  return <section className="run-budget-panel" aria-labelledby={`budget-${runId}`}>
    <div className="draft-actions"><h3 id={`budget-${runId}`}>Límites de llamadas al modelo</h3><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={state.kind === 'loading'}>Actualizar límites</button></div>
    <p>Se cuentan las solicitudes y su tiempo de transporte. Este control no mide tokens ni costo monetario.</p>
    {state.kind === 'loading' && <p role="status">Consultando los límites y el uso durable…</p>}
    {state.kind === 'unavailable' && <p role="alert">No se pudieron leer los límites de esta representación.</p>}
    {budget !== null && <>
      {budget.status === 'legacy-unknown' && <p role="alert">El historial contiene solicitudes anteriores sin medición. El presupuesto queda bloqueado hasta una conciliación explícita.</p>}
      {budget.status === 'uncertain' && <p role="alert">Hay solicitudes cuyo transporte no cerró. La reserva sigue activa y bloquea nuevas llamadas hasta recuperarla.</p>}
      {budget.runCallsUsed >= budget.maxPiCallsPerRun && <p role="status">Se alcanzó el máximo de llamadas para esta representación.</p>}
      {budget.wallTimeRemainingMs === 0 && <p role="status">Se agotó el tiempo acumulado; el preflight bloquea nuevas llamadas.</p>}
      {budget.status !== 'legacy-unknown' && <progress aria-label="Tiempo de inferencia medido o reservado" max={progressMax} value={progressValue} />}
      <dl className="budget-metrics">
        <div><dt>Llamadas en la representación</dt><dd>{budget.runCallsUsed} / {budget.maxPiCallsPerRun}</dd></div>
        <div><dt>Máximo de llamadas por pulso</dt><dd>{budget.maxPiCallsPerPulse}</dd></div>
        <div><dt>Tiempo medido</dt><dd>{budget.wallTimeMeasuredMs === null ? 'Desconocido' : formatDuration(budget.wallTimeMeasuredMs)}</dd></div>
        <div><dt>Tiempo reservado</dt><dd>{formatDuration(budget.wallTimeReservedMs)}</dd></div>
        <div><dt>Tiempo disponible</dt><dd>{budget.wallTimeRemainingMs === null ? 'Desconocido' : formatDuration(budget.wallTimeRemainingMs)}</dd></div>
        <div><dt>Solicitudes activas</dt><dd>{budget.activePiRequests} / {budget.maxConcurrentPiRequests}</dd></div>
        <div><dt>Timeout por solicitud</dt><dd>{formatDuration(budget.requestTimeoutMs)}</dd></div>
        <div><dt>Solicitudes inciertas</dt><dd>{budget.uncertainRequests + budget.unknownLegacyRequests}</dd></div>
      </dl>
    </>}
  </section>;
}
