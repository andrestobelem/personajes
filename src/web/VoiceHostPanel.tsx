import { useEffect, useRef, useState } from "react";
import { AudioModeSchema } from "../domain/voice.ts";
import {
  createVoiceAdminClient,
  captureVoiceAdminIntent,
  VoiceAdminRejection,
  type VoiceSettingsDocument,
  type VoiceAdminIntent,
} from "./voice-admin-client.ts";
const client = createVoiceAdminClient();
const uncertainSettings = new Map<string, VoiceAdminIntent>();
export function parseVoiceQuota(value: string) {
  if (!/^(0|[1-9]\d{0,4})$/.test(value) || Number(value) > 10_000)
    throw new Error("La cuota debe ser un entero de 0 a 10.000.");
  return Number(value);
}
export function VoiceHostPanel({
  runId,
  onChanged,
  api = client,
}: {
  runId: string;
  onChanged?: () => void;
  api?: ReturnType<typeof createVoiceAdminClient>;
}) {
  const secret = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const lock = useRef(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [document, setDocument] = useState<VoiceSettingsDocument | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<VoiceAdminIntent | null>(
    uncertainSettings.get(runId) ?? null,
  );
  const [mode, setMode] = useState("disabled");
  const [model, setModel] = useState("");
  const [format, setFormat] = useState("mp3_44100_128");
  const [subtitles, setSubtitles] = useState(true);
  const [quotas, setQuotas] = useState({
    voiceDesignCalls: "0",
    ttsCalls: "0",
    sfxCalls: "0",
  });
  function adopt(doc: VoiceSettingsDocument) {
    setDocument(doc);
    setQuotas({
      voiceDesignCalls: String(doc.snapshot.quotaLimits.voiceDesignCalls),
      ttsCalls: String(doc.snapshot.quotaLimits.ttsCalls),
      sfxCalls: String(doc.snapshot.quotaLimits.sfxCalls),
    });
    const audio = doc.snapshot.config.audioMode;
    setMode(audio.kind === "disabled" ? "disabled" : audio.ttsMode);
    if (audio.kind === "enabled") {
      setModel(audio.ttsModelId);
      setFormat(audio.outputFormat);
      setSubtitles(audio.subtitles);
    }
  }
  async function refresh(started: number, updateDraft = true) {
    const results = await Promise.allSettled([
      api.status(),
      api.settings(runId),
    ]);
    if (epoch.current !== started) return;
    const [status, settings] = results;
    if (status?.status === "fulfilled")
      setConfigured(status.value.credentialConfigured);
    if (settings?.status === "fulfilled" && updateDraft) adopt(settings.value);
    if (results.some((value) => value.status === "rejected"))
      setMessage("No se pudo completar la consulta local.");
  }
  useEffect(() => {
    const started = ++epoch.current;
    lock.current = false;
    setBusy(false);
    setDocument(null);
    setConfigured(null);
    setPending(uncertainSettings.get(runId) ?? null);
    setMessage("");
    void refresh(started);
    return () => {
      ++epoch.current;
      if (secret.current) secret.current.value = "";
    };
  }, [runId, api]);
  async function transient(
    action: () => Promise<unknown>,
    secretTransport = false,
  ) {
    if (lock.current) return;
    const started = epoch.current;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (epoch.current !== started) return;
      await refresh(started, false);
      if (epoch.current === started) {
        onChanged?.();
        setMessage("Operación confirmada.");
      }
    } catch (error) {
      if (epoch.current === started)
        setMessage(
          secretTransport
            ? "No se confirmó el transporte de la credencial. Su valor ya se borró de la interfaz; consultá presencia antes de reemplazarla otra vez."
            : error instanceof Error
              ? error.message
              : "No se confirmó la operación.",
        );
    } finally {
      if (epoch.current === started) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function persist(intent: VoiceAdminIntent) {
    if (lock.current) return;
    const saved = captureVoiceAdminIntent(intent);
    const started = epoch.current;
    uncertainSettings.set(runId, saved);
    setPending(saved);
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.settings(runId, saved);
      if (epoch.current !== started) return;
      uncertainSettings.delete(runId);
      setPending(null);
      adopt(result);
      onChanged?.();
      setMessage("Configuración de audio confirmada.");
    } catch (error) {
      if (epoch.current !== started) return;
      if (error instanceof VoiceAdminRejection) {
        uncertainSettings.delete(runId);
        setPending(null);
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Resultado incierto. Recuperá la misma configuración antes de otra operación.",
      );
    } finally {
      if (epoch.current === started) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function credential(method: "PUT" | "DELETE") {
    const apiKey = secret.current?.value ?? "";
    if (secret.current) secret.current.value = "";
    if (method === "PUT" && !apiKey) {
      setMessage("Ingresá la clave.");
      return;
    }
    const intent = {
      path: "/api/v1/integrations/elevenlabs/credential",
      method,
      body: method === "PUT" ? { apiKey } : {},
      key: crypto.randomUUID(),
    } satisfies VoiceAdminIntent;
    void transient(() => api.credential(intent), true);
  }
  function save() {
    if (document === null) return;
    const audio = AudioModeSchema.safeParse(
      mode === "disabled"
        ? { kind: "disabled" }
        : {
            kind: "enabled",
            language: "es",
            ttsMode: mode,
            ttsModelId: model,
            outputFormat: format,
            subtitles,
          },
    );
    if (!audio.success) {
      setMessage("Revisá modo, modelo y formato.");
      return;
    }
    let limits;
    try {
      limits = {
        voiceDesignCalls: parseVoiceQuota(quotas.voiceDesignCalls),
        ttsCalls: parseVoiceQuota(quotas.ttsCalls),
        sfxCalls: parseVoiceQuota(quotas.sfxCalls),
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cuotas inválidas.");
      return;
    }
    const config = document.snapshot.config;
    void persist({
      path: `/api/v1/runs/${runId}/voice-settings`,
      method: "PUT",
      key: crypto.randomUUID(),
      etag: document.etag,
      body: {
        audioMode: audio.data,
        speakerSlots: config.speakerSlots,
        narratorSlot: config.narratorSlot,
        soundEffectSlots: config.soundEffectSlots,
        quotaLimits: limits,
      },
    });
  }
  const blocked = busy || pending !== null;
  return (
    <section className="voice-host-panel" aria-label="Administración de audio">
      <h2>ElevenLabs y audio</h2>
      <p>
        Credencial:{" "}
        {configured === null
          ? "Sin consultar"
          : configured
            ? "Configurada"
            : "Ausente"}
        . Sólo se muestra presencia; no certifica acceso real.
      </p>
      <label>
        Clave privada{" "}
        <input
          ref={secret}
          type="password"
          autoComplete="new-password"
          disabled={blocked}
        />
      </label>
      <button disabled={blocked} onClick={() => credential("PUT")}>
        Guardar o reemplazar clave
      </button>
      <button
        disabled={blocked || !configured}
        onClick={() => credential("DELETE")}
      >
        Eliminar clave
      </button>
      <button
        disabled={blocked || !configured}
        onClick={() =>
          void transient(() =>
            api.probe({
              path: "/api/v1/integrations/elevenlabs/access-check",
              method: "POST",
              key: crypto.randomUUID(),
              body: { kind: "connectionCheck" },
            }),
          )
        }
      >
        Comprobar acceso en proveedor
      </button>
      <button
        disabled={blocked}
        onClick={() => void transient(() => refresh(epoch.current))}
      >
        Consultar estado local
      </button>
      <p>
        La comprobación contacta al proveedor. La clave se borra del campo antes
        de enviar y no se almacena en el navegador.
      </p>
      <fieldset disabled={blocked || document === null}>
        <legend>Audio y cuotas de esta representación</legend>
        <label>
          Modo{" "}
          <select
            aria-label="Modo" value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="disabled">Desactivado</option>
            <option value="manual-per-publication">
              Manual por publicación
            </option>
            <option value="automatic-after-publication">
              Automático para publicaciones futuras
            </option>
          </select>
        </label>
        <p>
          El modo automático puede consumir créditos y cuotas para publicaciones
          futuras. No sintetiza la historia ni reproduce automáticamente.
        </p>
        <label>
          Modelo TTS{" "}
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label>
          Formato{" "}
          <select
            aria-label="Formato" value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            {[
              "mp3_44100_128",
              "mp3_44100_192",
              "pcm_16000",
              "pcm_22050",
              "pcm_24000",
              "pcm_44100",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={subtitles}
            onChange={(event) => setSubtitles(event.target.checked)}
          />{" "}
          Subtítulos
        </label>
        <label>
          Máximo de diseños de voz{" "}
          <input
            type="number"
            min="0"
            max="10000"
            step="1"
            value={quotas.voiceDesignCalls}
            onChange={(event) =>
              setQuotas((prior) => ({
                ...prior,
                voiceDesignCalls: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Máximo de síntesis TTS{" "}
          <input
            type="number"
            min="0"
            max="10000"
            step="1"
            value={quotas.ttsCalls}
            onChange={(event) =>
              setQuotas((prior) => ({ ...prior, ttsCalls: event.target.value }))
            }
          />
        </label>
        <label>
          Máximo de efectos de sonido{" "}
          <input
            type="number"
            min="0"
            max="10000"
            step="1"
            value={quotas.sfxCalls}
            onChange={(event) =>
              setQuotas((prior) => ({ ...prior, sfxCalls: event.target.value }))
            }
          />
        </label>
        <button disabled={document === null} onClick={save}>
          Guardar configuración de audio
        </button>
      </fieldset>
      {pending && (
        <p role="alert">
          La configuración no tiene resultado confirmado.{" "}
          <button disabled={busy} onClick={() => void persist(pending)}>
            Recuperar la misma configuración
          </button>
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
