import React from "react";
import { RunRefreshSchema } from "../domain/run-refresh.ts";
import type { z } from "zod";
import type {
  RunStageView,
  ConversationView,
  ConfirmedEventPageSchema,
  TechnicalJobView,
} from "../domain/run-observation.ts";
import {
  StageMap,
  type StageMapData,
  type StageMapEntity,
} from "./StageMap.tsx";
import { StageConversation, StageJobs } from "./StageConversation.tsx";
import { InspectorPanel } from "./InspectorPanel.tsx";
import { HumanInteractionPanel } from "./HumanInteractionPanel.tsx";
import {
  createRunObservationClient,
  type RunObservationClient,
} from "./run-observation-client.ts";
import { formatFictionalClock } from "./stage-format.ts";
const client = createRunObservationClient();
type ConfirmedEvent = z.infer<typeof ConfirmedEventPageSchema>["items"][number];
type Observation = {
  stage: RunStageView;
  conversations: ConversationView[];
  events: ConfirmedEvent[];
  jobs: TechnicalJobView[];
  moreConversations: boolean;
  moreEvents: boolean;
  moreJobs: boolean;
};
export function stageMapData(stage: RunStageView): StageMapData {
  const entities = stage.entities.map((entity) => {
    const base = {
      id: entity.entityId,
      label: entity.label,
      kind: entity.kind,
    };
    switch (entity.kind) {
      case "character":
        return {
          ...base,
          location: { placeId: entity.placeId, position: entity.position },
          status:
            entity.availability === "available"
              ? "Disponible"
              : "No disponible",
          details: { human: "Persona", animal: "Animal", robot: "Robot" }[
            entity.species
          ],
        };
      case "device":
        return {
          ...base,
          location: { placeId: entity.placeId, position: entity.position },
          status: `${entity.availability === "available" ? "Disponible" : "No disponible"} · ${entity.power === "on" ? "Encendido" : "Apagado"}`,
          details: "Estado operativo confirmado",
        };
      case "object":
        return {
          ...base,
          location:
            entity.placeId === null || entity.position === null
              ? null
              : { placeId: entity.placeId, position: entity.position },
          status:
            entity.condition === undefined
              ? "Estado no registrado"
              : {
                  usable: "Utilizable",
                  damaged: "Dañado",
                  unknown: "Estado desconocido",
                }[entity.condition],
          details: `${entity.holderEntityId === null ? "En el lugar confirmado" : `En inventario de ${stage.entities.find((holder) => holder.entityId === entity.holderEntityId)?.label ?? entity.holderEntityId}`}${entity.quantity === undefined ? "" : ` · cantidad ${entity.quantity}`}`,
        };
      default: {
        const exhaustive: never = entity;
        return exhaustive;
      }
    }
  });
  return {
    places: stage.places,
    doors: stage.doors,
    connections: stage.connections,
    entities: [
      ...entities,
      ...stage.humanParticipants.map<StageMapEntity>((person) => ({
        id: person.participantId,
        label: person.label,
        kind: "human" satisfies "human",
        location:
          person.placeId === null || person.position === null
            ? null
            : { placeId: person.placeId, position: person.position },
        status:
          person.presence === "remote"
            ? "Participación remota preparada"
            : "Participación en escena preparada",
        details:
          "Identidad humana configurada. Su presencia no afirma que haya enviado una intervención.",
      })),
    ],
  };
}
export function effectiveInterventionLifecycle(
  stageLifecycle: RunStageView["lifecycle"],
  knownLifecycle?: RunStageView["lifecycle"],
) {
  return knownLifecycle !== undefined && knownLifecycle !== "running"
    ? knownLifecycle
    : stageLifecycle;
}
export function RunStageWorkspace({
  runId,
  active = true,
  knownLifecycle,
  api = client,
}: {
  runId: string;
  active?: boolean;
  knownLifecycle?: RunStageView["lifecycle"];
  api?: RunObservationClient;
}) {
  const [streamState, setStreamState] = React.useState<
    "connecting" | "active" | "polling"
  >("polling");
  const [observation, setObservation] = React.useState<Observation | null>(
    null,
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [cut, setCut] = React.useState<number | undefined>();
  const [fromSeq, setFromSeq] = React.useState<number | undefined>();
  const [pageCount, setPageCount] = React.useState(1);
  const [olderFrom, setOlderFrom] = React.useState("0");
  const epoch = React.useRef(0);
  const confirmed = React.useRef<RunStageView | null>(null);
  const lifetime = React.useRef<AbortController | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    ++epoch.current;
    confirmed.current = null;
    setObservation(null);
    setMessage(null);
    setCut(undefined);
    setFromSeq(undefined);
    setPageCount(1);
    setOlderFrom("0");
  }, [runId]);
  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const thisEpoch = ++epoch.current;
    async function poll() {
      try {
        const stage = await api.stage(runId, controller.signal, cut);
        const from = Math.min(
          fromSeq ?? Math.max(0, stage.worldSeq - 100),
          stage.worldSeq,
        );
        async function readConversations() {
          let cursor: string | undefined;
          const items = new Map<string, ConversationView>();
          let nextCursor: string | null = null;
          for (let index = 0; index < pageCount; index++) {
            const page = await api.conversations({
              runId,
              fromWorldSeq: from,
              toWorldSeq: stage.worldSeq,
              ...(cursor === undefined ? {} : { cursor }),
              signal: controller.signal,
            });
            for (const item of page.items) items.set(item.eventId, item);
            nextCursor = page.nextCursor;
            if (nextCursor === null) break;
            if (nextCursor === cursor)
              throw new Error("La página de conversación no avanzó.");
            cursor = nextCursor;
          }
          return { items: [...items.values()], nextCursor };
        }
        async function readEvents() {
          let cursor: string | undefined;
          const items = new Map<string, ConfirmedEvent>();
          let nextCursor: string | null = null;
          for (let index = 0; index < pageCount; index++) {
            const page = await api.events({
              runId,
              fromWorldSeq: from,
              toWorldSeq: stage.worldSeq,
              ...(cursor === undefined ? {} : { cursor }),
              signal: controller.signal,
            });
            for (const item of page.items) items.set(item.eventId, item);
            nextCursor = page.nextCursor;
            if (nextCursor === null) break;
            if (nextCursor === cursor)
              throw new Error("La página de historia no avanzó.");
            cursor = nextCursor;
          }
          return { items: [...items.values()], nextCursor };
        }
        async function readJobs() {
          let cursor: string | undefined;
          const items = new Map<string, TechnicalJobView>();
          let nextCursor: string | null = null;
          for (let index = 0; index < pageCount; index++) {
            const page = await api.jobs(runId, controller.signal, cursor);
            for (const item of page.items) items.set(item.jobId, item);
            nextCursor = page.nextCursor;
            if (nextCursor === null) break;
            if (nextCursor === cursor)
              throw new Error("La página de trabajos no avanzó.");
            cursor = nextCursor;
          }
          return { items: [...items.values()], nextCursor };
        }
        const results = await Promise.allSettled([
          readConversations(),
          readEvents(),
          readJobs(),
        ]);
        const conversations = results[0];
        const events = results[1];
        const jobs = results[2];
        if (
          conversations === undefined ||
          events === undefined ||
          jobs === undefined ||
          conversations.status !== "fulfilled" ||
          events.status !== "fulfilled" ||
          jobs.status !== "fulfilled"
        ) {
          throw new Error(
            "No se pudo confirmar una lectura completa del Escenario, conversación y diagnósticos. Se conserva el último corte confirmado.",
          );
        }
        if (controller.signal.aborted || epoch.current !== thisEpoch) return;
        const prior = confirmed.current;
        if (
          cut === undefined &&
          prior?.runId === runId &&
          (stage.worldRevision < prior.worldRevision ||
            stage.worldSeq < prior.worldSeq)
        )
          throw new Error(
            "Llegó un corte anterior. Se conserva la vista confirmada y se volverá a sincronizar.",
          );
        confirmed.current = stage;
        setObservation({
          stage,
          conversations: conversations.value.items,
          events: events.value.items,
          jobs: jobs.value.items,
          moreConversations: conversations.value.nextCursor !== null,
          moreEvents: events.value.nextCursor !== null,
          moreJobs: jobs.value.nextCursor !== null,
        });
        setMessage(null);
      } catch (error) {
        if (!controller.signal.aborted && epoch.current === thisEpoch)
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudo sincronizar esta representación.",
          );
      }
      if (!controller.signal.aborted && cut === undefined)
        timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      if (lifetime.current === controller) lifetime.current = null;
    };
  }, [api, runId, active, cut, fromSeq, refresh, pageCount]);
  React.useEffect(() => {
    if (!active || cut !== undefined || typeof EventSource === "undefined")
      return;
    setStreamState("connecting");
    const source = new EventSource(`/api/v1/runs/${runId}/events/stream`);
    let fence: string | null = null;
    source.onopen = () => setStreamState("active");
    source.onerror = () => setStreamState("polling");
    function invalidate(event: Event) {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string")
        return;
      try {
        const value: unknown = JSON.parse(event.data);
        const result = RunRefreshSchema.safeParse(value);
        if (!result.success || result.data.runId !== runId) return;
        const refreshFence = `${result.data.configRevision}:${result.data.worldRevision}:${result.data.lifecycleRevision}:${result.data.lastWorldSeq}`;
        if (fence !== null && refreshFence !== fence)
          setRefresh((value) => value + 1);
        fence = refreshFence;
      } catch {
        /* Malformed invalidation never changes the confirmed projection. */
      }
    }
    source.addEventListener("run.refresh", invalidate);
    return () => {
      source.removeEventListener("run.refresh", invalidate);
      source.close();
    };
  }, [runId, active, cut]);
  function viewCut(seq: number) {
    setCut(seq);
    setObservation(null);
    setMessage(null);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function present() {
    setCut(undefined);
    setObservation(null);
    setMessage(null);
    setRefresh((value) => value + 1);
  }
  return (
    <div className="stage-workspace">
      <header>
        <p className="muted">
          Sincronización:{" "}
          {cut !== undefined
            ? "lectura histórica"
            : streamState === "active"
              ? "notificaciones del host y consulta periódica"
              : "consulta periódica de respaldo"}
          . Las notificaciones sólo piden una nueva lectura; no publican
          eventos.
        </p>
        <h1 tabIndex={-1} ref={heading}>
          {cut === undefined
            ? "Representación · Presente"
            : `Historia · Corte confirmado ${cut}`}
        </h1>
        <p>
          {cut === undefined
            ? "Lectura del estado confirmado del host. Las actualizaciones no convocan actores ni proveedores."
            : "Lectura histórica. No llama modelos, herramientas ni síntesis de audio; el compositor queda deshabilitado."}
        </p>
        <div className="stage-toolbar">
          <button onClick={() => setRefresh((value) => value + 1)}>
            Actualizar lectura
          </button>
          {cut !== undefined && (
            <button onClick={present}>Volver al presente</button>
          )}
        </div>
      </header>
      {message && (
        <p role="alert" className="stage-sync">
          {message}
        </p>
      )}
      {observation === null ? (
        <p role="status">
          Consultando estado, emisiones y trabajos confirmados…
        </p>
      ) : (
        <>
          <p className="stage-caption">
            Representación {runId} · configuración{" "}
            {observation.stage.configRevision} · Escenario{" "}
            {observation.stage.worldRevision} · secuencia{" "}
            {observation.stage.worldSeq} ·{" "}
            {formatFictionalClock(observation.stage.clock)}
          </p>
          <p>
            Escena:{" "}
            {observation.stage.scenes.find(
              (scene) => scene.id === observation.stage.activeSceneId,
            )?.label ?? "Sin etiqueta disponible"}
            .
          </p>
          <div className="stage-layout">
            <StageMap data={stageMapData(observation.stage)} />
            <StageConversation
              items={observation.conversations}
              stage={observation.stage}
              onSelectEvent={viewCut}
            />
          </div>
          <InspectorPanel
            runId={runId}
            atWorldSeq={observation.stage.worldSeq}
            worldRevision={observation.stage.worldRevision}
          />
          {cut === undefined && (
            <HumanInteractionPanel
              runId={runId}
              participants={observation.stage.humanParticipants}
              lifecycle={effectiveInterventionLifecycle(
                observation.stage.lifecycle,
                knownLifecycle,
              )}
            />
          )}
          <section
            className="stage-history"
            aria-label="Historia de eventos confirmados"
          >
            <h2>Historia</h2>
            <p>
              Rango consultado:{" "}
              {Math.min(
                fromSeq ?? Math.max(0, observation.stage.worldSeq - 100),
                observation.stage.worldSeq,
              )}
              –{observation.stage.worldSeq}. Cada entrada procede de un evento
              confirmado; no contiene propuestas privadas.
            </p>
            <div className="stage-toolbar">
              <div>
                <label htmlFor={`history-from-${runId}`}>Desde secuencia</label>
                <input
                  id={`history-from-${runId}`}
                  type="number"
                  min="0"
                  max={observation.stage.worldSeq}
                  value={olderFrom}
                  onChange={(event) => setOlderFrom(event.target.value)}
                />
              </div>
              <button
                onClick={() => {
                  const value = Number(olderFrom);
                  if (
                    Number.isSafeInteger(value) &&
                    value >= 0 &&
                    value <= observation.stage.worldSeq
                  ) {
                    setFromSeq(value);
                    setPageCount(1);
                  } else
                    setMessage(
                      "Elegí una secuencia entera dentro del rango confirmado.",
                    );
                }}
              >
                Consultar rango
              </button>
            </div>
            {observation.events.length === 0 ? (
              <p>No hay eventos confirmados en este rango.</p>
            ) : (
              <ol>
                {observation.events.map((event) => (
                  <li key={event.eventId}>
                    <strong>Secuencia {event.worldSeq}</strong> ·{" "}
                    {formatFictionalClock({
                      ...observation.stage.clock,
                      instant: event.fictionalAt,
                    })}
                    <p>{event.summary}</p>
                    <button onClick={() => viewCut(event.worldSeq)}>
                      Ver corte {event.worldSeq}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {(observation.moreEvents ||
              observation.moreConversations ||
              observation.moreJobs) && (
              <p role="status">
                Hay más eventos, emisiones o trabajos en estas consultas.
              </p>
            )}
            {(observation.moreEvents ||
              observation.moreConversations ||
              observation.moreJobs) && (
              <button onClick={() => setPageCount((value) => value + 1)}>
                Cargar más historia, emisiones y trabajos
              </button>
            )}
          </section>
          <StageJobs items={observation.jobs} more={observation.moreJobs} />
        </>
      )}
    </div>
  );
}
