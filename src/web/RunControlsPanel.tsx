import React from "react";
import { formatFictionalClock } from "./stage-format.ts";
import { z } from "zod";
import { RunStepJobViewSchema } from "../domain/run-lifecycle.ts";

import type { RunView } from "../domain/http.ts";
import type { RunLifecycleControlRequest } from "../domain/run-lifecycle.ts";
import {
  createRunControlsClient,
  captureRunControl,
  runControlRejection,
  type RunDocument,
  type RunControlIntent,
  type RunControlsClient,
} from "./run-controls-client.ts";
import {
  createRunPreflightClient,
  preflightRejection,
  type RunPreflightClient,
} from "./run-preflight-client.ts";
import { reconnectSession } from "./client.ts";
const client = createRunControlsClient();
const preflightClient = createRunPreflightClient();
const restoreLocalSession = async () => { await reconnectSession(); };
function needsSessionRecovery(error: unknown): boolean {
  const rejection = runControlRejection(error) ?? preflightRejection(error);
  return rejection?.status === 401 || rejection?.status === 403;
}
const labels = {
  draft: "Borrador",
  ready: "Lista para iniciar",
  running: "En ejecución",
  paused: "En pausa",
  stopped: "Detenida",
  closed: "Cerrada",
};
export function RunStatusView({ view }: { view: RunView }) {
  return (
    <>
      <h2>{view.config.name}</h2>
      <p role="status">Estado: {labels[view.lifecycle.kind]}</p>
      <p>Perfil configurado: {view.config.inferenceProfile === undefined ? 'Sin selección explícita registrada' : `${view.config.inferenceProfile.model} · ${view.config.inferenceProfile.provider} · esfuerzo ${view.config.inferenceProfile.reasoningEffort}`}. Sin sustitución automática de modelo. El acceso se comprueba por separado.</p>
      <dl className="budget-metrics">
        <div>
          <dt>Momento del Escenario</dt>
          <dd>{formatFictionalClock(view.clock)}</dd>
        </div>
        <div>
          <dt>Revisión del Escenario</dt>
          <dd>
            {view.worldRevision} · secuencia {view.lastWorldSeq}
          </dd>
        </div>
        <div>
          <dt>Llamadas al modelo</dt>
          <dd>
            {view.budget.modelCalls.used} usadas ·{" "}
            {view.budget.modelCalls.reserved} reservadas ·{" "}
            {view.budget.modelCalls.remaining === null ? "Sin límite de llamadas" : `${view.budget.modelCalls.remaining} disponibles`}
          </dd>
        </div>
        <div>
          <dt>Tiempo de transporte del modelo</dt>
          <dd>
            {view.budget.modelWallTimeMs.measured === null
              ? "Desconocido"
              : `${view.budget.modelWallTimeMs.measured} ms medidos`}{" "}
            · {view.budget.modelWallTimeMs.reserved} ms reservados ·{" "}
            {view.budget.status !== "unknown" && view.budget.modelWallTimeMs.limit === null
              ? "Sin límite de tiempo acumulado"
              : view.budget.modelWallTimeMs.remaining === null ? "saldo desconocido"
              : `${view.budget.modelWallTimeMs.remaining} ms disponibles`}
          </dd>
        </div>
        <div>
          <dt>Presupuesto</dt>
          <dd>
            {
              {
                available: "Disponible",
                exhausted: "Agotado",
                uncertain: "Solicitudes inciertas",
                unknown: "Historial desconocido",
              }[view.budget.status]
            }
          </dd>
        </div>
      </dl>
      {view.budget.audioBudgetStatus === "known" ? (
        <dl className="budget-metrics">
          {(
            [
              ["Diseño de voz", view.budget.voiceDesignCalls],
              ["Síntesis TTS", view.budget.ttsCalls],
              ["Efectos de sonido", view.budget.sfxCalls],
            ] satisfies Array<[string, RunView["budget"]["voiceDesignCalls"]]>
          ).map(([name, budget]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                {budget.used} usadas · {budget.reserved} reservadas ·{" "}
                {budget.remaining} disponibles de {budget.limit}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p role="status">
          Presupuesto de audio no disponible. No se confirma saldo para diseño
          de voz, TTS ni efectos.
        </p>
      )}
      <p className="muted">
        Las revisiones y el presupuesto se consultan al host. No representan
        tokens ni costo monetario.
      </p>
    </>
  );
}
export function RunCloseWarning({ view }: { view: RunView }) {
  return (
    <p>
      ¿Cerrar definitivamente «{view.config.name}» (ID {view.runId}) y conservar
      su historia?
    </p>
  );
}

export function RunControlsPanel({
  runId,
  onRead,
  disabled = false,
  api = client,
  preflight = preflightClient,
  restoreSession = restoreLocalSession,
}: {
  runId: string;
  onRead?: (document: RunDocument) => void;
  disabled?: boolean;
  api?: RunControlsClient;
  preflight?: Pick<RunPreflightClient, "history">;
  restoreSession?: () => Promise<void>;
}) {
  const [stepId, setStepId] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<z.infer<
    typeof RunStepJobViewSchema
  > | null>(null);
  const [current, setCurrent] = React.useState<RunDocument | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [readProblem, setReadProblem] = React.useState<string | null>(null);
  const [sessionRecoveryNeeded, setSessionRecoveryNeeded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [intent, setIntent] = React.useState<RunControlIntent | null>(null);
  const [closePrompt, setClosePrompt] = React.useState(false);
  const runEpoch = React.useRef(0);
  const lifetime = React.useRef<AbortController | null>(null);
  const mutation = React.useRef(false);
  const [refresh, setRefresh] = React.useState(0);
  const readEpoch = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    ++runEpoch.current;
    mutation.current = false;
    setCurrent(null);
    setMessage(null);
    setReadProblem(null);
    setSessionRecoveryNeeded(false);
    setIntent(null);
    setBusy(false);
    setClosePrompt(false);
    try {
      const remembered = z
        .string()
        .uuid()
        .safeParse(sessionStorage.getItem(`personajes:step:${runId}`));
      setStepId(remembered.success ? remembered.data : null);
    } catch {
      setStepId(null);
    }
    setStep(null);
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, [runId]);
  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const epoch = ++readEpoch.current;
      try {
        const next = await api.read(runId, controller.signal);
        if (
          !controller.signal.aborted &&
          readEpoch.current === epoch &&
          !mutation.current
        ) {
          setCurrent(next);
          setReadProblem(null);
          onRead?.(next);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          readEpoch.current === epoch &&
          !mutation.current
        ) {
          setCurrent(null);
          setReadProblem(
            "No se pudo sincronizar la representación. Los controles requieren una lectura confirmada del host.",
          );
          if (needsSessionRecovery(error)) setSessionRecoveryNeeded(true);
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, runId, refresh, onRead]);
  React.useEffect(() => {
    if (stepId === null) return;
    const id = stepId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const job = await api.stepJob(runId, id, controller.signal);
        if (controller.signal.aborted) return;
        setStep(job);
        if (
          ["succeeded", "failed", "canceled", "interrupted"].includes(job.state)
        ) {
          setRefresh((value) => value + 1);
          return;
        }
      } catch {
        if (!controller.signal.aborted)
          setMessage(
            "No se pudo consultar el pulso durable. Se volverá a leer sin iniciar otro pulso.",
          );
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, runId, stepId]);
  async function execute(captured: RunControlIntent) {
    const controller = lifetime.current;
    if (controller === null || mutation.current) return;
    const epoch = runEpoch.current;
    mutation.current = true;
    setBusy(true);
    setIntent(captured);
    setMessage(captured.command.kind === "start"
      ? "Solicitando el inicio de la representación…"
      : "Confirmando el control solicitado…");
    ++readEpoch.current;
    try {
      const result = await api.mutate(captured, controller.signal);
      if (!controller.signal.aborted) {
        ++readEpoch.current;
        if (captured.command.kind === "step" && result.job !== null) {
          setStepId(result.job.jobId);
          try {
            sessionStorage.setItem(
              `personajes:step:${runId}`,
              result.job.jobId,
            );
          } catch {
            /* Host receipt still permits recovery in this view. */
          }
          setStep(null);
        }
        setCurrent(result.document);
        onRead?.(result.document);
        setIntent(null);
        setMessage(
          result.job === null
            ? "Control confirmado. Consultando el estado actual."
            : `Trabajo ${result.job.jobId} aceptado. La aceptación no confirma su finalización.`,
        );
        setRefresh((value) => value + 1);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const rejected = runControlRejection(error);
      if (rejected) {
        if (needsSessionRecovery(error)) {
          setSessionRecoveryNeeded(true);
          // The same key may already identify a committed effect whose reply
          // was lost. An authentication rejection cannot disprove that effect.
          setMessage(`Restablecé la sesión local y recuperá el mismo control. Referencia: ${rejected.requestId}.`);
        } else {
          setIntent(null);
          setMessage(`${rejected.message} Referencia: ${rejected.requestId}.`);
        }
        setRefresh((value) => value + 1);
      } else
        setMessage(
          "El control no tiene resultado confirmado. Recuperá la misma operación con su clave antes de enviar otra.",
        );
    } finally {
      if (runEpoch.current === epoch) {
        mutation.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  async function control(kind: RunLifecycleControlRequest["kind"], retryBlockedActors = false) {
    const controller = lifetime.current;
    if (
      current === null ||
      controller === null ||
      mutation.current ||
      intent !== null
    )
      return;
    if (kind === "close" && !closePrompt) {
      setClosePrompt(true);
      return;
    }
    setClosePrompt(false);
    if (kind === "start" || kind === "resume" || kind === "step") {
      const epoch = runEpoch.current;
      mutation.current = true;
      setBusy(true);
      setMessage("Verificando requisitos de ejecución…");
      try {
        const history = await preflight.history(runId, controller.signal);
        if (controller.signal.aborted) return;
        const passed = history.items.find(
          (item) =>
            item.job.state === "completed" &&
            item.report.kind !== "stale" &&
            item.report.result?.kind === "passed" &&
            item.job.configurationRevision === current.view.configRevision &&
            item.job.worldRevision === current.view.worldRevision,
        );
        if (!passed) {
          setMessage(
            "Comprobá los requisitos de ejecución para el corte actual antes de iniciar, reanudar o avanzar.",
          );
          return;
        }
        mutation.current = false;
        await execute(
          captureRunControl({
            document: current,
            key: crypto.randomUUID(),
            command: { kind, preflightJobId: passed.job.jobId, ...(kind === "resume" && retryBlockedActors ? {retryBlockedActors:true} : {}) },
          }),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        if (needsSessionRecovery(error)) setSessionRecoveryNeeded(true);
        setMessage("No se pudo confirmar una comprobación vigente. No se envió el control.");
      } finally {
        if (runEpoch.current === epoch) {
          mutation.current = false;
          if (!controller.signal.aborted) setBusy(false);
        }
      }
      return;
    }
    await execute(
      captureRunControl({
        document: current,
        key: crypto.randomUUID(),
        command: { kind },
      }),
    );
  }
  async function restoreConnection() {
    const controller = lifetime.current;
    if (controller === null || mutation.current) return;
    const epoch = runEpoch.current;
    mutation.current = true;
    setBusy(true);
    setMessage("Restableciendo la conexión local…");
    try {
      await restoreSession();
      if (controller.signal.aborted) return;
      setCurrent(null);
      setReadProblem(null);
      setSessionRecoveryNeeded(false);
      setRefresh(value => value + 1);
      setMessage(intent === null
        ? "Conexión restablecida. Consultando el estado; no se inició ninguna acción."
        : "Conexión restablecida. Recuperá la misma operación pendiente para confirmar su resultado.");
    } catch {
      if (!controller.signal.aborted) setMessage("No se pudo restablecer la sesión local. Podés volver a intentarlo; no se envió ningún control.");
    } finally {
      if (runEpoch.current === epoch) {
        mutation.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  const lifecycle = current?.view.lifecycle.kind;
  const blocked = disabled || busy || intent !== null || current === null;
  const stepPending =
    stepId !== null &&
    (step === null ||
      !["succeeded", "failed", "canceled", "interrupted"].includes(step.state));
  return (
    <section
      className="run-controls-panel"
      aria-label="Representación y controles"
    >
      {current === null ? (
        <p role="status">Consultando representación…</p>
      ) : (
        <RunStatusView view={current.view} />
      )}
      <div className="draft-actions">
        <button
          disabled={blocked || lifecycle !== "ready"}
          onClick={() => void control("start")}
        >
          Iniciar
        </button>
        <button
          disabled={blocked || lifecycle !== "running"}
          onClick={() => void control("pause")}
        >
          Pausar
        </button>
        <button
          disabled={
            blocked || (lifecycle !== "paused" && lifecycle !== "stopped")
          }
          onClick={() => void control("resume")}
        >
          Reanudar
        </button>
        <button disabled={blocked || (lifecycle !== "paused" && lifecycle !== "stopped")} onClick={() => void control("resume", true)}>
          Reanudar y reintentar actores bloqueados
        </button>
        <button
          disabled={blocked || stepPending || lifecycle !== "paused"}
          onClick={() => void control("step")}
        >
          Avanzar un pulso
        </button>
        <button
          disabled={
            blocked || (lifecycle !== "paused" && lifecycle !== "running")
          }
          onClick={() => void control("stop")}
        >
          Detener
        </button>
        <button
          disabled={
            blocked ||
            !["running", "paused", "stopped"].includes(lifecycle ?? "")
          }
          onClick={() => void control("close")}
        >
          Cerrar representación
        </button>
        <button onClick={() => setRefresh((value) => value + 1)}>
          Actualizar estado
        </button>
      </div>
      {readProblem !== null && <p role="alert">{readProblem}</p>}
      {sessionRecoveryNeeded && <div>
        <p>La sesión local requiere actualización. Restablecerla no repite controles ni recupera permisos privados automáticamente.</p>
        <button disabled={busy} onClick={() => void restoreConnection()}>Restablecer sesión local</button>
      </div>}
      <p>
        Iniciar, reanudar y avanzar pueden llamar al modelo según la
        configuración y los límites. Pausar congela nuevas convocatorias.
        Detener conserva la historia. Cerrar es definitivo.
      </p>
      {disabled && (
        <p>
          Guardá o descartá los cambios de preparación antes de operar la
          representación.
        </p>
      )}
      {closePrompt && (
        <div role="alert">
          {current !== null && <RunCloseWarning view={current.view} />}
          <button disabled={blocked} onClick={() => void control("close")}>
            Confirmar cierre definitivo
          </button>
          <button onClick={() => setClosePrompt(false)}>
            Conservar abierta
          </button>
        </div>
      )}
      {stepId !== null && (
        <p role="status">
          Pulso {stepId}:{" "}
          {step === null
            ? "Consultando trabajo aceptado"
            : {
                queued: "En espera",
                running: "Ejecutándose",
                succeeded: "Finalizado",
                failed: "Fallido",
                canceled: "Cancelado",
                interrupted: "Interrumpido",
              }[step.state]}
          . El trabajo conserva su resultado durable.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      {intent !== null && !busy && (
        <button onClick={() => void execute(intent)}>
          Recuperar el mismo control
        </button>
      )}
    </section>
  );
}
