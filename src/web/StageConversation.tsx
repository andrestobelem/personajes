import React from "react";
import type {
  ConversationView,
  RunStageView,
  TechnicalJobView,
} from "../domain/run-observation.ts";
import { formatFictionalClock, fictionalDateKey } from "./stage-format.ts";
const gestureLabels = {
  wave: "Saluda con la mano",
  point: "Señala",
  nod: "Asiente",
  shakeHead: "Niega con la cabeza",
  posture: "Cambia de postura",
  bark: "Ladra",
  whine: "Gime",
};
function communicationText(item: ConversationView) {
  switch (item.content.kind) {
    case "speech":
      return item.content.text;
    case "gesture":
      return gestureLabels[item.content.gesture.kind];
    default: {
      const exhaustive: never = item.content;
      return exhaustive;
    }
  }
}
function labelList(items: Array<{ label: string }>) {
  return items.length === 0
    ? "Ninguno"
    : items.map((item) => item.label).join(", ");
}
export function ConversationMessage({
  item,
  clock,
  onSelectEvent,
}: {
  item: ConversationView;
  clock: RunStageView["clock"];
  onSelectEvent: (commitIndex: number) => void;
}) {
  return (
    <li className="stage-message">
      <header>
        <strong>{item.speaker.label}</strong> ·{" "}
        {item.speaker.kind === "human" ? "Participante humano" : "Personaje"}
        <br />
        <time dateTime={new Date(item.fictionalAt).toISOString()}>
          {formatFictionalClock({ ...clock, instant: item.fictionalAt })}
        </time>
      </header>
      <blockquote>{communicationText(item)}</blockquote>
      <dl>
        <dt>Emisión</dt>
        <dd>Confirmada · canal {item.channel.label}</dd>
        <dt>Destinatarios solicitados</dt>
        <dd>
          {labelList(item.requestedRecipients)} · {item.requestedRecipientCount}{" "}
          solicitados
        </dd>
        <dt>Recepción efectiva en el Escenario</dt>
        <dd>
          {labelList(item.effectiveAudience)} · {item.effectiveAudienceCount}{" "}
          alcanzados
        </dd>
      </dl>
      {item.effectiveAudienceCount === 0 && (
        <p>Nadie recibió esta emisión en el Escenario.</p>
      )}
      {item.effectiveAudienceCount < item.requestedRecipientCount && (
        <p>
          Recepción parcial. La emisión no alcanzó a todos los destinatarios
          solicitados.
        </p>
      )}
      <details>
        <summary>Entrega a la memoria y procedencia</summary>
        <p>
          La recepción en el Escenario y la entrega a memoria son estados
          diferentes.
        </p>
        {item.deliveries.length === 0 ? (
          <p>No hay entregas a memoria registradas para esta emisión.</p>
        ) : (
          <ul>
            {item.deliveries.map((delivery) => (
              <li key={delivery.recipient.entityId}>
                {delivery.recipient.label}:{" "}
                {
                  {
                    planned: "Entrega planificada",
                    delivering: "Entregando",
                    delivered: "Entregada",
                    failed: "Entrega fallida",
                  }[delivery.state]
                }{" "}
                ·{" "}
                {
                  {
                    pending: "Proyección de memoria pendiente",
                    projected: "Proyección de memoria confirmada",
                    notDelivered: "Sin entregar a memoria",
                  }[delivery.memoryProjection]
                }
              </li>
            ))}
          </ul>
        )}
        <p>
          Evento {item.eventId} · secuencia {item.worldSeq} · escena{" "}
          {item.sceneId} · canal {item.channel.id}
        </p>
      </details>
      <button onClick={() => onSelectEvent(item.commitIndex)}>
        Ver commit {item.commitIndex} del evento {item.worldSeq}
      </button>
    </li>
  );
}
export function StageConversation({
  items,
  stage,
  onSelectEvent,
}: {
  items: ConversationView[];
  stage: RunStageView;
  onSelectEvent: (commitIndex: number) => void;
}) {
  const [speaker, setSpeaker] = React.useState("");
  const [channel, setChannel] = React.useState("");
  const [recipient, setRecipient] = React.useState("");
  const [date, setDate] = React.useState("");
  const [scene, setScene] = React.useState("");
  const filtersId = React.useId();
  const speakers = [...new Set(items.map((item) => item.speaker.label))];
  const channels = [...new Set(items.map((item) => item.channel.label))];
  const recipients = [
    ...new Set(
      items.flatMap((item) =>
        item.effectiveAudience.map((person) => person.label),
      ),
    ),
  ];
  const scenes = [...new Set(items.map((item) => item.sceneId))];
  const filtered = items.filter(
    (item) =>
      (!speaker || item.speaker.label === speaker) &&
      (!channel || item.channel.label === channel) &&
      (!recipient ||
        item.effectiveAudience.some((person) => person.label === recipient)) &&
      (!scene || item.sceneId === scene) &&
      (!date ||
        fictionalDateKey({ ...stage.clock, instant: item.fictionalAt }) ===
          date),
  );
  return (
    <section className="stage-conversation" aria-label="Conversación pública">
      <h2>Conversación</h2>
      <p>
        Sólo emisiones confirmadas. Los estados técnicos y las propuestas sin
        emitir se muestran por separado.
      </p>
      <div className="stage-filters">
        <div>
          <label htmlFor={`${filtersId}-speaker`}>Hablante</label>
          <select
            id={`${filtersId}-speaker`}
            value={speaker}
            onChange={(event) => setSpeaker(event.target.value)}
          >
            <option value="">Todos</option>
            {speakers.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${filtersId}-channel`}>Canal</label>
          <select
            id={`${filtersId}-channel`}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="">Todos</option>
            {channels.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${filtersId}-recipient`}>Receptor efectivo</label>
          <select
            id={`${filtersId}-recipient`}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          >
            <option value="">Todos</option>
            {recipients.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${filtersId}-scene`}>Escena</label>
          <select
            id={`${filtersId}-scene`}
            value={scene}
            onChange={(event) => setScene(event.target.value)}
          >
            <option value="">Todas</option>
            {scenes.map((value) => (
              <option key={value} value={value}>
                {stage.scenes.find((item) => item.id === value)?.label ?? value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${filtersId}-date`}>
            Fecha ficticia (AAAA-MM-DD)
          </label>
          <input
            id={`${filtersId}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <button
          onClick={() => {
            setSpeaker("");
            setChannel("");
            setRecipient("");
            setDate("");
            setScene("");
          }}
        >
          Limpiar filtros
        </button>
      </div>
      {items.length === 0 ? (
        <p>
          No hay emisiones confirmadas en este rango. Esto no representa una
          decisión de silencio de los personajes.
        </p>
      ) : filtered.length === 0 ? (
        <p>Los filtros no encontraron emisiones. Podés limpiar los filtros.</p>
      ) : (
        <ol>
          {filtered.map((item) => (
            <ConversationMessage
              key={item.eventId}
              item={item}
              clock={stage.clock}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
const jobLabels = {
  queued: "En espera",
  running: "Ejecutándose",
  accepted: "Aceptado",
  blocked: "Bloqueado",
  completed: "Completado",
  succeeded: "Finalizado",
  failed: "Fallido",
  canceled: "Cancelado",
  interrupted: "Interrumpido",
  "cancel-requested": "Cancelación solicitada",
};
const roleLabels = {
  director: "Director", narrator: "Narrador", configurator: "Configurador", "narration-reviewer": "Continuista de narración",
  actor: "Actor",
  continuista: "Continuista",
  pulse: "Pulso",
  step: "Paso acotado",
  preflight: "Comprobación de requisitos",
};
const diagnosticLabels: Record<
  NonNullable<TechnicalJobView["safeCode"]>,
  string
> = {
  "budget-exhausted": "Se agotó el presupuesto del trabajo",
  "memory-unavailable": "La memoria requerida no está disponible",
  "observation-missing": "Falta una observación confirmada para este trabajo",
  "terminal-incomplete": "El trabajo terminó sin un resultado completo",
  "job-inactive": "El trabajo ya no está activo",
  "execution-failed": "Falló la ejecución del trabajo",
  cancelled: "Trabajo cancelado",
  "pi-incomplete": "El modelo no entregó una respuesta completa",
  "proposal-missing": "No se registró una propuesta confirmada",
  "review-incomplete": "La revisión quedó incompleta",
  "review-rejected": "La revisión rechazó la propuesta",
  "reformulations-exhausted": "Se agotó el límite de reformulaciones",
  "recovery-required": "Se requiere recuperación explícita del trabajo",
  "preflight-blocked": "La comprobación de requisitos bloqueó la operación",
  "runtime-unavailable": "El runtime de la representación no está disponible",
};
export function StageJobs({
  items,
  more,
}: {
  items: TechnicalJobView[];
  more: boolean;
}) {
  return (
    <section className="stage-jobs" aria-label="Trabajos y diagnósticos">
      <h2>Trabajos y diagnósticos actuales del host</h2>
      <p>
        Estos estados no son diálogo, silencio ni una acción de personaje. Se
        conserva el ID para recuperar su resultado.
      </p>
      {items.length === 0 ? (
        <p>No hay trabajos registrados.</p>
      ) : (
        <ul>
          {items.map((job) => (
            <li key={job.jobId}>
              <strong>
                {roleLabels[job.kind]}
                {job.actor && ` · ${job.actor.label}`}: {jobLabels[job.state]}
              </strong>
              <p>
                Trabajo {job.jobId} · generación {job.generation} ·{" "}
                {job.elapsedMs} ms de trabajo · {job.modelCalls} llamadas ·{" "}
                {job.modelWallTimeMs} ms medidos y {job.reservedWallTimeMs} ms
                reservados.
              </p>
              {job.safeCode && (
                <p role="alert">
                  Diagnóstico: {diagnosticLabels[job.safeCode]}. No se presenta
                  como respuesta del personaje.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {more && (
        <p>
          Esta consulta tiene más páginas de trabajos. Hay más trabajos en el
          host.
        </p>
      )}
    </section>
  );
}
