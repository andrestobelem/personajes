import { useEffect, useRef, useState } from "react";
import {
  SoundEffectRequestSchema,
  type VoiceOperation,
  type VoiceArtifact,
} from "../domain/voice.ts";
import { VoiceMedia } from "./VoiceMedia.tsx";
import {
  createVoiceAdminClient,
  captureVoiceAdminIntent,
  VoiceAdminRejection,
  type VoiceAdminIntent,
} from "./voice-admin-client.ts";
const client = createVoiceAdminClient();
type Action = {
  kind: "generate" | "listen" | "save" | "bind";
  intent: VoiceAdminIntent;
};
const unresolved = new Map<string, Action>();
export function VoiceSoundPanel({
  runId,
  onChanged,
  owners = [],
  api = client,
}: {
  runId: string;
  onChanged?: () => void;
  owners?: Array<{ id: string; label: string }>;
  api?: ReturnType<typeof createVoiceAdminClient>;
}) {
  const [prompt, setPrompt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [operation, setOperation] = useState<VoiceOperation | null>(null);
  const [artifact, setArtifact] = useState<VoiceArtifact | null>(null);
  const [pending, setPending] = useState<Action | null>(
    unresolved.get(runId) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [played, setPlayed] = useState(false);
  const [listened, setListened] = useState(false);
  const [bindingId, setBindingId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [owner, setOwner] = useState("");
  const epoch = useRef(0);
  const lock = useRef(false);
  const artifactEpoch = useRef(0);
  useEffect(() => {
    ++epoch.current; ++artifactEpoch.current;
    lock.current = false;
    setBusy(false);
    setOperation(null);
    setArtifact(null);
    setPending(unresolved.get(runId) ?? null);
    setListened(false);
    setPlayed(false);
    setBindingId("");
    setPrompt("");
    setReviewed(false);
    setSourceId("");
    setOwner("");
    setMessage("");
    return () => {
      ++epoch.current;
    };
  }, [runId]);
  const opId = operation?.operationId;
  useEffect(() => {
    if (opId === undefined) return;
    const id = opId;
    const started = epoch.current;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await api.operation(id);
        if (!live || started !== epoch.current) return;
        if (next.runId !== runId)
          throw new Error("Operación de otra representación.");
        setOperation(next);
        if (
          [
            "ready",
            "failed",
            "blocked",
            "cancelled",
            "uncertain",
            "orphaned",
          ].includes(next.state)
        )
          return;
      } catch {
        if (live && started === epoch.current)
          setMessage(
            "No se pudo leer el efecto durable. Se consultará sin volver a generarlo.",
          );
      }
      if (live) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, runId, opId]);
  async function readOperation(id: string) {
    const started = epoch.current;
    try {
      const value = await api.operation(id);
      if (started !== epoch.current) return;
      if (value.runId !== runId)
        throw new Error("Operación de otra representación.");
      setOperation(value);
    } catch (error) {
      if (started === epoch.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "No se pudo consultar la operación.",
        );
    }
  }
  async function execute(action: Action) {
    if (lock.current) return;
    const saved = {
      kind: action.kind,
      intent: captureVoiceAdminIntent(action.intent),
    };
    const started = epoch.current;
    lock.current = true;
    setBusy(true);
    setPending(saved);
    unresolved.set(runId, saved);
    setMessage("");
    try {
      switch (saved.kind) {
        case "generate": {
          const op = await api.generate(saved.intent);
          if (started !== epoch.current) return;
          if (op.runId !== runId)
            throw new Error("Operación de otra representación.");
          setOperation(op);
          setArtifact(null);
          setBindingId("");
          setListened(false);
          setPlayed(false);
          break;
        }
        case "listen":
          await api.listened(saved.intent);
          if (started !== epoch.current) return;
          setListened(true);
          break;
        case "save": {
          const binding = await api.saveSound(saved.intent);
          if (started !== epoch.current) return;
          setBindingId(binding.soundBindingId);
          break;
        }
        case "bind":
          await api.bindSound(saved.intent);
          if (started !== epoch.current) return;
          setMessage("Efecto asociado por el host.");
          break;
        default: {
          const exhaustive: never = saved.kind;
          throw new Error(String(exhaustive));
        }
      }
      if (started !== epoch.current) return;
      unresolved.delete(runId);
      setPending(null);
      onChanged?.();
    } catch (error) {
      if (started !== epoch.current) return;
      if (error instanceof VoiceAdminRejection) {
        unresolved.delete(runId);
        setPending(null);
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Resultado incierto. Recuperá la misma operación antes de otra solicitud.",
      );
    } finally {
      if (started === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function saveOrBind(kind: "save" | "bind") {
    if (lock.current || pending !== null) return;
    const started = epoch.current;
    lock.current = true;
    setBusy(true);
    try {
      const doc = await api.settings(runId);
      if (started !== epoch.current) return;
      lock.current = false;
      setBusy(false);
      if (kind === "save" && artifact)
        await execute({
          kind,
          intent: {
            path: `/api/v1/sound-effect-previews/${artifact.artifactId}/save`,
            method: "POST",
            key: crypto.randomUUID(),
            etag: doc.etag,
            body: { runId, sourceId },
          },
        });
      if (kind === "bind" && owners.some((item) => item.id === owner))
        await execute({
          kind,
          intent: {
            path: `/api/v1/runs/${runId}/sound-bindings`,
            method: "POST",
            key: crypto.randomUUID(),
            etag: doc.etag,
            body: {
              owner: { kind: "character", characterId: owner },
              assetId: bindingId,
            },
          },
        });
    } catch (error) {
      if (started === epoch.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "No se pudo leer la configuración; no se envió una nueva operación.",
        );
    } finally {
      if (started === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const blocked = busy || pending !== null;
  return (
    <section className="voice-sound-panel" aria-label="Efectos no verbales">
      <h2>Efectos originales y Fang</h2>
      <p>
        Fang usa efectos animales, nunca voz de habla. Generar contacta a
        ElevenLabs y puede consumir créditos y cuota; reproducir usa únicamente
        archivos almacenados.
      </p>
      <fieldset disabled={blocked}>
        <legend>Preparar un efecto original</legend>
        <label>
          Prompt original de efecto{" "}
          <textarea
            value={prompt}
            maxLength={1000}
            onChange={(event) => {
              setPrompt(event.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          Revisé que es original, no verbal y sin diálogo ni voz de personaje.
        </label>
        <button
          disabled={!reviewed || !prompt.trim()}
          onClick={() => {
            const request = SoundEffectRequestSchema.safeParse({
              text: prompt,
              modelId: "eleven_text_to_sound_v2",
              originalNonverbalReviewed: reviewed,
            });
            if (!request.success) {
              setMessage("Revisá el prompt original no verbal.");
              return;
            }
            void execute({
              kind: "generate",
              intent: {
                path: "/api/v1/sound-effect-previews",
                method: "POST",
                key: crypto.randomUUID(),
                body: { runId, request: request.data },
              },
            });
          }}
        >
          Generar efecto · puede consumir créditos
        </button>
      </fieldset>
      {pending && (
        <p role="alert">
          La operación {pending.kind} no tiene resultado confirmado.{" "}
          <button disabled={busy} onClick={() => void execute(pending)}>
            Recuperar la misma operación
          </button>
          {pending.kind === "generate" && (
            <button
              disabled={busy}
              onClick={() => void readOperation(pending.intent.key)}
            >
              Consultar solicitud durable sin generar
            </button>
          )}
        </p>
      )}
      {operation && (
        <>
          <p>
            Operación {operation.operationId}: {operation.state}.{" "}
            {operation.safeCode && `Diagnóstico ${operation.safeCode}`}
          </p>
          <button
            disabled={busy}
            onClick={() => void readOperation(operation.operationId)}
          >
            Actualizar operación local
          </button>
          <label>
            Artefacto elegido{" "}
            <select
              disabled={blocked}
              aria-label="Artefacto elegido" value={artifact?.artifactId ?? ""}
              onChange={(event) => {
                const id = event.target.value;
                const started = epoch.current;
                const artifactCut = ++artifactEpoch.current;
                setArtifact(null);
                setListened(false);
                setPlayed(false);
                setBindingId("");
                if (id)
                  void api
                    .artifact(id)
                    .then((value) => {
                      if (
                        started === epoch.current && artifactEpoch.current === artifactCut &&
                        value.operationId === operation.operationId &&
                        value.kind === "sound-effect"
                      )
                        setArtifact(value);
                    })
                    .catch(() => {
                      if (started === epoch.current && artifactEpoch.current === artifactCut)
                        setMessage(
                          "No se pudo consultar el artefacto del efecto.",
                        );
                    });
              }}
            >
              <option value="">Elegí un archivo confirmado</option>
              {operation.artifactIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
        </>
      )}
      {artifact && (
        <>
          <VoiceMedia artifact={artifact} onEnded={() => setPlayed(true)} />
          <button
            disabled={
              blocked || !played || listened || artifact.state !== "available"
            }
            onClick={() =>
              void execute({
                kind: "listen",
                intent: {
                  path: `/api/v1/voice-artifacts/${artifact.artifactId}/listened`,
                  method: "POST",
                  key: crypto.randomUUID(),
                  body: { kind: "listened" },
                },
              })
            }
          >
            Confirmo que escuché este efecto
          </button>
          <label>
            ID de fuente no verbal{" "}
            <input
              disabled={blocked}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            />
          </label>
          <button
            disabled={blocked || !listened || !sourceId.trim() || !!bindingId}
            onClick={() => void saveOrBind("save")}
          >
            Aprobar y guardar efecto no verbal
          </button>
        </>
      )}
      {bindingId && (
        <>
          <p>Efecto aprobado {bindingId}</p>
          <label>
            Propietario del efecto{" "}
            <select
              disabled={blocked}
              aria-label="Propietario del efecto" value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option value="">Elegí propietario configurado</option>
              {owners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {owners.length === 0 && (
            <p>
              No se pudo consultar un propietario de efectos no verbales para
              esta representación.
            </p>
          )}
          <button
            disabled={blocked || !owners.some((item) => item.id === owner)}
            onClick={() => void saveOrBind("bind")}
          >
            Asociar efecto elegido al propietario
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
