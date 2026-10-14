import { useEffect, useRef, useState } from "react";
import { SessionModeSchema } from "../domain/http.ts";
import type { RunStageView } from "../domain/run-observation.ts";
import { HumanInterventionRequestSchema } from "../domain/interaction-schema.ts";
import {
  captureHumanIntent,
  createHumanInteractionClient,
  HumanRejection,
  type ContextDocument,
  type HumanIntent,
  type HumanInteractionClient,
  type SessionDocument,
} from "./human-interaction-client.ts";

const drafts = new Map<string, string>();
// An unresolved operation survives changing representations and remounting this panel.
let unresolved: HumanIntent | null = null;
const defaultApi = createHumanInteractionClient();
export function HumanInteractionPanel({
  runId,
  participants,
  lifecycle,
  api = defaultApi,
}: {
  runId: string;
  participants: RunStageView["humanParticipants"];
  lifecycle: RunStageView["lifecycle"];
  api?: HumanInteractionClient;
}) {
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [context, setContext] = useState<ContextDocument | null>(null);
  const [participantId, setParticipantId] = useState(
    participants[0]?.participantId ?? "",
  );
  const [text, setText] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [pending, setPending] = useState<HumanIntent | null>(unresolved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current += 1;
    return () => {
      epoch.current += 1;
    };
  }, [runId, participantId]);
  const draftKey = `${runId}:${participantId}`;
  useEffect(() => {
    setParticipantId(participants[0]?.participantId ?? "");
    setContext(null);
    setRecipients([]);
    setBusy(false);
    setPending(unresolved);
  }, [runId]);
  useEffect(() => {
    setText(drafts.get(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    let live = true;
    void api
      .session()
      .then((value) => {
        if (live) setSession(value);
      })
      .catch((error) => {
        if (live)
          setMessage(
            error instanceof Error ? error.message : "Sesión no disponible",
          );
      });
    return () => {
      live = false;
    };
  }, [api, runId]);
  const active =
    session?.view.mode.kind === "interlocutor" &&
    session.view.mode.runId === runId &&
    session.view.mode.participantId === participantId;
  async function refresh() {
    const started = epoch.current;
    setBusy(true);
    setContext(null);
    try {
      const value = await api.session();
      if (started !== epoch.current) return;
      setSession(value);
      if (
        value.view.mode.kind === "interlocutor" &&
        value.view.mode.runId === runId &&
        value.view.mode.participantId === participantId
      ) {
        const next = await api.context(runId);
        if (started !== epoch.current) return;
        setContext(next);
        setRecipients([]);
      }
    } catch (error) {
      if (started !== epoch.current) return;
      setMessage(
        error instanceof Error ? error.message : "No se pudo actualizar",
      );
    } finally {
      if (started === epoch.current) setBusy(false);
    }
  }
  async function send(intent: HumanIntent) {
    const started = epoch.current;
    let saved: HumanIntent;
    try {
      saved = captureHumanIntent(intent);
    } catch {
      setMessage(
        "La intervención no tiene un formato válido. El borrador se conserva y no se envió ninguna operación.",
      );
      return;
    }
    unresolved = saved;
    setPending(saved);
    setBusy(true);
    setMessage("");
    try {
      const result = await api.mutate(saved);
      if (started !== epoch.current) return;
      unresolved = null;
      setPending(null);
      setContext(null);
      if (result.kind === "mode") {
        setSession(result.document);
        setMessage(
          "Modo confirmado por el host. Actualizá el contexto para hablar.",
        );
      } else {
        setMessage(
          `Intervención confirmada ${result.receipt.interventionId}. Audiencia efectiva: ${result.receipt.effectiveAudience.length}. Entrega: ${result.receipt.deliveryState}. Esto no confirma recepción por Pi ni una respuesta del personaje.`,
        );
      }
    } catch (error) {
      if (started !== epoch.current) return;
      if (error instanceof HumanRejection) {
        unresolved = null;
        setPending(null);
        if (error.status === 412) {
          setContext(null);
          setSession(null);
        }
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Resultado incierto. Reintentá la misma operación antes de otra acción.",
      );
    } finally {
      if (started === epoch.current) setBusy(false);
    }
  }
  const blocked = busy || pending !== null;
  const canSend = lifecycle === "running";
  const invalidText =
    text.includes("\0") || new TextEncoder().encode(text).byteLength > 16_384;
  return (
    <section
      className="human-interaction-panel"
      aria-label="Interlocución humana"
    >
      <h3>Interlocución humana</h3>
      <p>
        Modo confirmado:{" "}
        {session === null
          ? "Sin consultar"
          : {
              observer: "Observar",
              interlocutor: "Interlocución",
              director: "Dirección",
            }[session.view.mode.kind]}
        . El texto no concede autoridad ni cambia el modo.
      </p>
      <label>
        Identidad ficticia{" "}
        <select
          value={participantId}
          disabled={blocked}
          onChange={(event) => {
            setParticipantId(event.target.value);
            setContext(null);
            setRecipients([]);
          }}
        >
          {participants.map((profile) => (
            <option key={profile.participantId} value={profile.participantId}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>
      {participants.length === 0 && (
        <p>No hay identidades humanas configuradas en esta representación.</p>
      )}
      <button
        disabled={blocked || session === null}
        onClick={() => {
          if (session)
            void send({
              kind: "mode",
              mode: { kind: "observer" },
              etag: session.etag,
              key: crypto.randomUUID(),
            });
        }}
      >
        Observar
      </button>
      <button
        disabled={blocked || session === null || !participantId}
        onClick={() => {
          if (session)
            void send({
              kind: "mode",
              mode: SessionModeSchema.parse({
                kind: "interlocutor",
                runId: runId,
                participantId,
              }),
              etag: session.etag,
              key: crypto.randomUUID(),
            });
        }}
      >
        Activar Interlocución
      </button>
      <button disabled={blocked} onClick={() => void refresh()}>
        Actualizar sesión y contexto
      </button>
      {context && active && (
        <>
          <p>
            Escena: {context.view.scene.label}. Lugar:{" "}
            {context.view.place.label}. Canal fijado por el host:{" "}
            {context.view.channel.label} ({context.view.channel.scope}).
            Revisión {context.view.worldRevision}, secuencia{" "}
            {context.view.worldSeq}.
          </p>
          <fieldset disabled={blocked}>
            <legend>Destinatarios actualmente alcanzables</legend>
            {context.view.recipients.map((recipient) => (
              <label key={recipient.characterId}>
                <input
                  type="checkbox"
                  checked={recipients.includes(recipient.characterId)}
                  onChange={(event) =>
                    setRecipients((values) =>
                      event.target.checked
                        ? [...values, recipient.characterId]
                        : values.filter((id) => id !== recipient.characterId),
                    )
                  }
                />
                {recipient.displayName}
              </label>
            ))}
          </fieldset>
          <p>
            {context.view.channel.scope === "broadcast"
              ? "Sin selección, se emite al canal de difusión."
              : "El canal dirigido requiere al menos un destinatario."}
          </p>
        </>
      )}
      <label>
        Texto de tu intervención{" "}
        <textarea
          value={text}
          disabled={busy}
          onChange={(event) => {
            drafts.set(draftKey, event.target.value);
            setText(event.target.value);
          }}
        />
      </label>
      <p>
        El borrador se conserva en esta sesión de la interfaz por representación
        e identidad.
      </p>
      {invalidText && (
        <p role="alert">
          El texto no puede contener NUL ni superar 16.384 bytes UTF-8.
        </p>
      )}
      {!canSend && (
        <p role="status">
          La representación debe estar en ejecución para enviar una intervención
          nueva. El borrador se conserva; podés consultar el modo, actualizar el
          contexto o recuperar la misma operación pendiente.
        </p>
      )}
      <button
        disabled={
          !canSend ||
          blocked ||
          !active ||
          context === null ||
          !text.trim() ||
          invalidText ||
          (context.view.channel.scope === "addressed" &&
            recipients.length === 0)
        }
        onClick={() => {
          if (context && canSend)
            void send({
              kind: "speech",
              runId: runId,
              participantId,
              etag: context.etag,
              key: crypto.randomUUID(),
              request: HumanInterventionRequestSchema.parse({
                kind: "speech",
                channelId: context.view.channel.id,
                recipientCharacterIds: recipients,
                content: { kind: "speech", text },
              }),
            });
        }}
      >
        Enviar intervención a{" "}
        {recipients.length
          ? context?.view.recipients
              .filter((item) => recipients.includes(item.characterId))
              .map((item) => item.displayName)
              .join(", ")
          : "audiencia del canal"}{" "}
        por {context?.view.channel.label ?? "canal pendiente"}
      </button>
      {pending && (
        <p role="alert">
          Hay una operación sin confirmar ({pending.kind})
          {pending.kind === "speech"
            ? ` de la representación ${pending.runId}`
            : ""}
          .{" "}
          <button disabled={busy} onClick={() => void send(pending)}>
            Reintentar la misma operación
          </button>
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
