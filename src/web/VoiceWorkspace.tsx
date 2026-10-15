import React from "react";
import type { z } from "zod";
import {
  VoiceDesignRequestSchema,
  VoiceTestRequestSchema,
  voiceOwnerKey,
  VoicePreviewSchema,
  SavedVoiceSchema,
  VoiceProviderModelSchema,
  VoiceProviderVoicesPageSchema,
  type VoiceOperation,
  type VoiceArtifact,
  type SpeechBindingDraft,
} from "../domain/voice.ts";
import {
  createVoiceClient,
  captureVoiceIntent,
  VoiceHttpRejection,
  VoiceOwnersSchema,
  type VoiceIntent,
  type VoiceClient,
  type VoiceSettingsDocument,
} from "./voice-client.ts";
import { VoiceSettingsPanel } from "./VoiceSettingsPanel.tsx";
import { VoiceHostPanel } from "./VoiceHostPanel.tsx";
import { VoiceSoundPanel } from "./VoiceSoundPanel.tsx";
import { VoiceMedia } from "./VoiceMedia.tsx";
import { DocumentBody } from "./DocumentBody.tsx";
import { readDossier } from "./client.ts";
const client = createVoiceClient();
const pendingByRun = new Map<string, VoiceIntent>();
const labels = {
  queued: "En espera",
  validating: "Validando",
  submitted: "Solicitud enviada",
  "response-received": "Respuesta recibida",
  "artifact-persisting": "Guardando archivo",
  ready: "Resultado disponible",
  blocked: "Bloqueada",
  failed: "Fallida",
  cancelled: "Cancelada",
  uncertain: "Resultado incierto",
  orphaned: "Archivo huérfano",
};
function terminal(op: VoiceOperation) {
  return [
    "ready",
    "blocked",
    "failed",
    "cancelled",
    "uncertain",
    "orphaned",
  ].includes(op.state);
}
export function VoiceOperationStatus({
  operation,
}: {
  operation: VoiceOperation;
}) {
  return (
    <section>
      <h3>{labels[operation.state]}</h3>
      <p>
        Operación {operation.operationId} · modelo {operation.modelId} ·
        revisión de voz {operation.configRevision} · costo informado
        desconocido.
      </p>
      {operation.safeCode && (
        <p role="alert">
          Diagnóstico seguro: {operation.safeCode}. No confirma voz guardada,
          binding ni publicación.
        </p>
      )}
      {operation.state === "uncertain" && (
        <p>
          No se confirma el resultado del proveedor; no se repite
          automáticamente. Consultá o conciliá archivos locales antes de otra
          generación.
        </p>
      )}
    </section>
  );
}
export function VoiceWorkspace({
  runId,
  active = true,
  api = client,
}: {
  runId: string;
  active?: boolean;
  api?: VoiceClient;
}) {
  const [settings, setSettings] = React.useState<VoiceSettingsDocument | null>(
    null,
  );
  const [baseStale, setBaseStale] = React.useState(false);
  const [owners, setOwners] = React.useState<
    z.infer<typeof VoiceOwnersSchema>["owners"]
  >([]);
  const [soundOwners, setSoundOwners] = React.useState<
    Array<{ id: string; label: string }>
  >([]);
  const [credential, setCredential] = React.useState(false);
  const [selectedOwner, setSelectedOwner] = React.useState("");
  const [saved, setSaved] = React.useState<z.infer<typeof SavedVoiceSchema>[]>(
    [],
  );
  const [history, setHistory] = React.useState<VoiceOperation[]>([]);
  const [candidates, setCandidates] = React.useState<SpeechBindingDraft[]>([]);
  const [models, setModels] = React.useState<
    z.infer<typeof VoiceProviderModelSchema>[]
  >([]);
  const [catalog, setCatalog] = React.useState<z.infer<
    typeof VoiceProviderVoicesPageSchema
  > | null>(null);
  const [variety, setVariety] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [sample, setSample] = React.useState("");
  const [designModel, setDesignModel] = React.useState("");
  const [original, setOriginal] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saveDescription, setSaveDescription] = React.useState("");
  const [source, setSource] = React.useState("");
  const [ttsModel, setTtsModel] = React.useState("");
  const [draft, setDraft] = React.useState<SpeechBindingDraft | null>(null);
  const [testSample, setTestSample] = React.useState("");
  const [testOriginal, setTestOriginal] = React.useState(false);
  const [publication, setPublication] = React.useState("");
  const [recipe, setRecipe] = React.useState<string | null>(null);
  const [operation, setOperation] = React.useState<VoiceOperation | null>(null);
  const [previews, setPreviews] = React.useState<
    z.infer<typeof VoicePreviewSchema>[]
  >([]);
  const [artifacts, setArtifacts] = React.useState<VoiceArtifact[]>([]);
  const [played, setPlayed] = React.useState<Set<string>>(new Set());
  const [listened, setListened] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<VoiceIntent | null>(
    pendingByRun.get(runId) ?? null,
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [operationRefresh, setOperationRefresh] = React.useState(0);
  const [metadataValid,setMetadataValid] = React.useState(false);
  const [metadataLoading,setMetadataLoading] = React.useState(true);
  const lifetime = React.useRef<AbortController | null>(null);
  const epoch = React.useRef(0);
  const recipeEpoch = React.useRef(0);
  const lock = React.useRef(false);
  const changed = React.useCallback(() => setRefresh((value) => value + 1), []);
  React.useEffect(() => {
    const controller = new AbortController();
    const current = ++epoch.current;
    lifetime.current = controller;
    lock.current = false;
    setBusy(false);
    setSettings(null);
    setBaseStale(false);
    setOwners([]);
    setSoundOwners([]);
    setCredential(false);
    setOperation(null);
    setDraft(null);
    setPending(pendingByRun.get(runId) ?? null);
    return () => {
      controller.abort();
      if (epoch.current === current) {
        ++epoch.current;
        lifetime.current = null;
      }
    };
  }, [runId]);
  React.useEffect(() => {
    if (!active) return;
    setMetadataLoading(true);
    setMetadataValid(false);
    const controller = new AbortController();
    void Promise.allSettled([
      api.settings(runId, controller.signal).then((document) => ({document, baseStale:false})).catch(async (error: unknown) => {
        if (error instanceof VoiceHttpRejection && error.safeCode === "VOICE_BASE_CONFIGURATION_STALE") return api.reconciliationContext(runId, controller.signal);
        throw error;
      }),
      api.owners(runId, controller.signal),
      api.library(controller.signal),
      api.history(runId, controller.signal),
      api.drafts(runId, controller.signal),
      api.status(controller.signal),
      api.soundOwners(runId, controller.signal),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      setMetadataLoading(false);
      setMetadataValid(results.every((result) => result.status === "fulfilled"));
      const [config, people, library, operations, bindings, status, sound] =
        results;
      if (config?.status === "fulfilled") {
        setBaseStale(config.value.baseStale);
        setSettings((prior) =>
          prior &&
          prior.value.config.revision > config.value.document.value.config.revision
            ? prior
            : config.value.document,
        );
      }
      if (people?.status === "fulfilled") {
        setOwners(people.value.owners);
        setSelectedOwner((prior) =>
          people.value.owners.some(
            (item) => voiceOwnerKey(item.owner) === prior,
          )
            ? prior
            : people.value.owners[0] === undefined
              ? ""
              : voiceOwnerKey(people.value.owners[0].owner),
        );
      }
      if (library?.status === "fulfilled") setSaved(library.value.voices);
      if (operations?.status === "fulfilled")
        setHistory(operations.value.operations);
      if (bindings?.status === "fulfilled")
        setCandidates(bindings.value.drafts);
      setCredential(
        status?.status === "fulfilled" && status.value.credentialConfigured,
      );
      if (sound?.status === "fulfilled") setSoundOwners(sound.value.owners);
      if (results.some((result) => result.status === "rejected"))
        setMessage(
          "No se completó la consulta local de voces. Actualizá antes de otra operación.",
        );
    });
    return () => controller.abort();
  }, [api, runId, active, refresh]);
  const operationId = operation?.operationId;
  React.useEffect(() => {
    if (!active || operationId === undefined) return;
    const id = operationId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const op = await api.operation(id, controller.signal);
        if (controller.signal.aborted) return;
        if (op.runId !== runId)
          throw new Error("La operación pertenece a otra representación.");
        setOperation(op);
        if (op.kind === "design-preview" && op.state === "ready") {
          const value = await api.design(id, controller.signal);
          if (!controller.signal.aborted) setPreviews(value.previews);
        }
        const results = await Promise.allSettled(
          op.artifactIds.map((id) => api.artifact(id, controller.signal)),
        );
        if (controller.signal.aborted) return;
        setArtifacts(
          results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        );
        if (results.some((result) => result.status === "rejected"))
          setMessage(
            "Hay artefactos no consultables; no se inventa audio ausente.",
          );
        if (terminal(op)) {
          changed();
          return;
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudo consultar la operación.",
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
  }, [api, runId, active, operationId, operationRefresh, changed]);
  const chosen = owners.find(
    (item) => voiceOwnerKey(item.owner) === selectedOwner,
  );
  const owner = chosen?.owner;
  React.useEffect(() => {
    ++recipeEpoch.current;
    setRecipe(chosen?.recipe ?? null);
    setSample("");
    setDescription("");
    setOriginal(false);
    setReviewed(false);
    setDraft(null);
    setTestSample("");
    setTestOriginal(false);
  }, [selectedOwner]);
  async function act(value: unknown) {
    const controller = lifetime.current;
    if (controller === null || lock.current) return;
    let intent: VoiceIntent;
    try {
      intent = captureVoiceIntent(value);
    } catch {
      setMessage(
        "Revisá campos y confirmaciones. No se envió ninguna solicitud.",
      );
      return;
    }
    const started = epoch.current;
    lock.current = true;
    setBusy(true);
    setPending(intent);
    pendingByRun.set(runId, intent);
    setMessage(null);
    try {
      const result = await api.mutate(intent, controller.signal);
      if (controller.signal.aborted || epoch.current !== started) return;
      pendingByRun.delete(runId);
      setPending(null);
      switch (result.kind) {
        case "operation":
          setOperation(result.operation);
          setPreviews([]);
          setArtifacts([]);
          setOperationRefresh((value) => value + 1);
          setMessage(
            "Operación registrada. Consultando sin repetir la solicitud.",
          );
          break;
        case "settings":
          setSettings((prior) =>
            prior &&
            prior.value.config.revision > result.document.value.config.revision
              ? prior
              : result.document,
          );
          setBaseStale(false);
          setMessage(intent.kind === "reconcileSettings"
            ? "Fuente de preparación conciliada. Se conservó el modo de audio anterior; revisá y guardá explícitamente los ajustes deseados."
            : intent.kind === "settings" ? "Configuración de audio guardada, sin generar audio." : "Variedad registrada por el host.");
          break;
        case "draft":
          setDraft(result.draft);
          setTestSample("");
          setTestOriginal(false);
          setMessage(
            "Candidato sin validar. Falta probar, escuchar y aceptar.",
          );
          break;
        case "listened":
          setListened((prior) => new Set([...prior, result.artifactId]));
          setMessage(
            "Escucha registrada; selección y aceptación son acciones separadas.",
          );
          break;
        case "accepted":
          setSettings({
            value: result.value.settings,
            etag: `"voice-config:${runId}:r${result.value.settings.config.revision}"`,
          });
          setDraft(null);
          setMessage("Prueba aceptada y binding confirmado por el host.");
          break;
        case "rejected":
          setDraft(null);
          setMessage("Prueba rechazada; no habilita una voz.");
          break;
        default: {
          const exhaustive: never = result;
          throw new Error(String(exhaustive));
        }
      }
      changed();
    } catch (error) {
      if (controller.signal.aborted || epoch.current !== started) return;
      if (error instanceof VoiceHttpRejection) {
        pendingByRun.delete(runId);
        setPending(null);
        changed();
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Resultado incierto: recuperá la misma operación.",
      );
    } finally {
      if (epoch.current === started) {
        lock.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  async function consult(
    purpose: "voiceDesign" | "speech" | "voices",
    cursor?: string,
  ) {
    const controller = lifetime.current;
    if (controller === null || lock.current) return;
    const started = epoch.current;
    setBusy(true);
    try {
      if (purpose === "voices") {
        const page = await api.voices(controller.signal, cursor);
        if (epoch.current === started)
          setCatalog((prior) =>
            cursor === undefined
              ? page
              : { ...page, voices: [...(prior?.voices ?? []), ...page.voices] },
          );
      } else {
        const values = await api.models(purpose, controller.signal);
        if (epoch.current === started)
          setModels((prior) => [
            ...prior.filter((item) => item.kind !== purpose),
            ...values,
          ]);
      }
    } catch (error) {
      if (epoch.current === started)
        setMessage(
          error instanceof Error
            ? error.message
            : "No se pudo consultar el catálogo.",
        );
    } finally {
      if (epoch.current === started) setBusy(false);
    }
  }
  const settingsBlocked = busy || metadataLoading || !metadataValid || pending !== null || settings === null;
  const blocked = settingsBlocked || baseStale;
  const paidBlocked = blocked || !credential;
  const confirmed = settings?.value.config.spanishVariety.kind === "confirmed";
  const configArgs =
    settings === null
      ? null
      : { runId, configRevision: settings.value.config.revision };
  const opArgs =
    operation === null
      ? null
      : {
          operationId: operation.operationId,
          operationRevision: operation.revision,
        };
  const key = () => crypto.randomUUID();
  const validDesign =
    owner !== undefined &&
    VoiceDesignRequestSchema.safeParse({
      owner,
      sampleText: sample,
      sampleOrigin: { kind: "operator-entered" },
      voiceDescription: description,
      modelId: designModel,
      language: "es",
      originalSampleConfirmed: original,
      descriptionReviewed: reviewed,
    }).success;
  const testArtifacts = artifacts.filter(
    (item) =>
      item.kind === "binding-test" && item.sourceId === draft?.bindingDraftId,
  );
  const slot =
    owner === undefined
      ? undefined
      : owner.kind === "narrator"
        ? settings?.value.config.narratorSlot
        : settings?.value.config.speakerSlots[owner.id];
  return (
    <div className="voice-workspace">
      <header>
        <h1>Voces y sonido</h1>
        <p>
          Representación {runId}. Receta, preview temporal, voz guardada y
          binding validado son estados distintos.
        </p>
        <button onClick={changed}>Actualizar metadata local</button>
      </header>
      <VoiceHostPanel runId={runId} onChanged={changed} />
      {message && <p role="alert">{message}</p>}
      {pending && (
        <p role="alert">
          La operación {pending.kind} no tiene resultado confirmado.{" "}
          <button disabled={busy} onClick={() => void act(pending)}>
            Recuperar la misma operación
          </button>
        </p>
      )}
      <VoiceSettingsPanel key={runId} runId={runId} document={settings} owners={owners} soundOwners={soundOwners} models={models} blocked={settingsBlocked} stale={baseStale} onIntent={(intent) => void act(intent)} onConsultModels={() => void consult("speech")} />
      {settings && (
        <section className="voice-panel">
          <h2>Convención de español</h2>
          <p>
            {confirmed
              ? "Variedad confirmada"
              : "Propuesta editorial sin confirmar"}
            : {settings.value.config.spanishVariety.label}
          </p>
          <label>
            Variedad elegida{" "}
            <input
              value={variety}
              maxLength={300}
              onChange={(event) => setVariety(event.target.value)}
            />
          </label>
          <button
            disabled={blocked || !variety.trim()}
            onClick={() =>
              void act({
                kind: "proposeVariety",
                ...configArgs,
                key: key(),
                label: variety,
              })
            }
          >
            Guardar propuesta de variedad
          </button>
          <button
            disabled={blocked || !variety.trim()}
            onClick={() =>
              void act({
                kind: "confirmVariety",
                ...configArgs,
                key: key(),
                label: variety,
              })
            }
          >
            Confirmar esta variedad para voz
          </button>
          <p>
            La propuesta permite actuación textual; preview y TTS requieren una
            variedad confirmada.
          </p>
          <p>
            Cuotas configuradas: {settings.value.quotaLimits.voiceDesignCalls}{" "}
            diseño · {settings.value.quotaLimits.ttsCalls} TTS ·{" "}
            {settings.value.quotaLimits.sfxCalls} efectos. Costo monetario
            desconocido.
          </p>
        </section>
      )}
      <section className="voice-panel">
        <h2>Identidad y receta</h2>
        <label>
          Identidad que tendrá voz{" "}
          <select
            disabled={blocked}
            aria-label="Identidad que tendrá voz" value={selectedOwner}
            onChange={(event) => setSelectedOwner(event.target.value)}
          >
            {owners.map((item) => (
              <option
                key={voiceOwnerKey(item.owner)}
                value={voiceOwnerKey(item.owner)}
              >
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {slot && (
          <p>
            Slot confirmado:{" "}
            {slot.kind === "enabled-bound"
              ? `Binding validado ${slot.speechBindingId}`
              : slot.kind === "enabled-unbound"
                ? "Habilitado sin binding validado"
                : "Audio de esta identidad desactivado"}
            .
          </p>
        )}
        {owners.length === 0 && (
          <p>
            No hay identidades hablantes consultables. Fang usa efectos no
            verbales; los gemelos no reciben voz humana.
          </p>
        )}
        {owner?.kind === "character" && (
          <button
            disabled={busy}
            onClick={() => {
              const id = owner.id;
              const started = epoch.current;
              const sourceEpoch = recipeEpoch.current;
              void readDossier({ id })
                .then((value) => {
                  if (
                    epoch.current === started &&
                    recipeEpoch.current === sourceEpoch
                  )
                    setRecipe(value.markdown);
                })
                .catch(() => {
                  if (epoch.current === started)
                    setMessage("No se pudo abrir la fuente de la receta.");
                });
            }}
          >
            Abrir expediente y receta fuente
          </button>
        )}
        <p>
          Lectura administrativa: no se entrega al personaje ni rellena una
          muestra. Cambiar identidad deja vacías muestra y descripción.
        </p>
        {recipe && (
          <details>
            <summary>Receta y procedencia editorial</summary>
            <DocumentBody text={recipe} />
          </details>
        )}
      </section>
      <section className="voice-panel">
        <h2>Diseñar opciones temporales</h2>
        <p>
          La muestra debe ser original y autorizada. Solicitud explícita a
          ElevenLabs, con posible consumo de créditos; no se precarga diálogo ni
          historia de la obra.
        </p>
        {!credential && (
          <p>
            La credencial está ausente o no se pudo comprobar. Configurala antes
            de generar audio.
          </p>
        )}
        <button disabled={busy} onClick={() => void consult("voiceDesign")}>
          Consultar modelos de diseño admitidos
        </button>
        <label>
          Modelo de diseño{" "}
          <select
            aria-label="Modelo de diseño" value={designModel}
            onChange={(event) => setDesignModel(event.target.value)}
          >
            <option value="">Elegí un modelo consultado</option>
            {models
              .filter((item) => item.kind === "voiceDesign")
              .map((item) => (
                <option key={item.modelId}>{item.modelId}</option>
              ))}
          </select>
        </label>
        <label>
          Descripción de voz (20–1000 caracteres; incluye la variedad
          confirmada){" "}
          <textarea
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Texto original de muestra en español (100–1000 caracteres){" "}
          <textarea
            value={sample}
            maxLength={1000}
            onChange={(event) => setSample(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={original}
            onChange={(event) => setOriginal(event.target.checked)}
          />{" "}
          Confirmo muestra original y autorizada.
        </label>
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          Revisé descripción y variedad, sin imitar intérpretes.
        </label>
        <button
          disabled={paidBlocked || !confirmed || !validDesign}
          onClick={() =>
            void act({
              kind: "design",
              ...configArgs,
              key: key(),
              request: {
                owner,
                sampleText: sample,
                sampleOrigin: { kind: "operator-entered" },
                voiceDescription: description,
                modelId: designModel,
                language: "es",
                originalSampleConfirmed: true,
                descriptionReviewed: true,
              },
            })
          }
        >
          Solicitar previews a ElevenLabs · puede consumir créditos
        </button>
        {!confirmed && <p>Confirmá la variedad antes de diseño o TTS.</p>}
      </section>
      {operation && (
        <section className="voice-panel">
          <VoiceOperationStatus operation={operation} />
          {!terminal(operation) && (
            <button
              disabled={blocked}
              onClick={() =>
                void act({ kind: "cancel", ...opArgs, key: key() })
              }
            >
              Solicitar cancelación
            </button>
          )}
          {["uncertain", "orphaned", "artifact-persisting"].includes(
            operation.state,
          ) && (
            <button
              disabled={blocked}
              onClick={() =>
                void act({
                  kind: "reconcile",
                  operationId: operation.operationId,
                  key: key(),
                })
              }
            >
              Conciliar archivos locales · sin llamar al proveedor
            </button>
          )}
          {previews.map((preview, index) => (
            <section key={preview.previewId}>
              <h3>
                Opción {index + 1}
                {operation.selectedPreviewId === preview.previewId
                  ? " · seleccionada"
                  : ""}
              </h3>
              <p>
                {preview.description} · {preview.varietyLabel}
              </p>
              <audio
                controls
                preload="none"
                src={`/api/v1/voice-previews/${preview.previewId}/media`}
                onEnded={() =>
                  setPlayed((prior) => new Set([...prior, preview.artifactId]))
                }
              >
                Audio temporal
              </audio>
              <p className="voice-sample-text">{preview.sampleText}</p>
              <button
                disabled={
                  blocked ||
                  !played.has(preview.artifactId) ||
                  listened.has(preview.artifactId)
                }
                onClick={() =>
                  void act({
                    kind: "listen",
                    artifactId: preview.artifactId,
                    key: key(),
                  })
                }
              >
                Confirmar que escuché esta preview
              </button>
              <button
                disabled={
                  blocked ||
                  !listened.has(preview.artifactId) ||
                  operation.state !== "ready"
                }
                onClick={() =>
                  void act({
                    kind: "select",
                    ...opArgs,
                    key: key(),
                    previewId: preview.previewId,
                  })
                }
              >
                Seleccionar esta preview
              </button>
            </section>
          ))}
          {previews.length > 0 && (
            <>
              <label>
                Nombre de la nueva voz{" "}
                <input
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Descripción para guardar voz{" "}
                <textarea
                  value={saveDescription}
                  maxLength={1000}
                  onChange={(event) => setSaveDescription(event.target.value)}
                />
              </label>
              <button
                disabled={
                  paidBlocked ||
                  operation.selectedPreviewId === null ||
                  !name.trim() ||
                  saveDescription.length < 20
                }
                onClick={() =>
                  void act({
                    kind: "saveVoice",
                    ...opArgs,
                    key: key(),
                    previewId: operation.selectedPreviewId,
                    voiceName: name,
                    voiceDescription: saveDescription,
                  })
                }
              >
                Guardar la preview seleccionada como voz · puede consumir
                créditos
              </button>
              <p>Guardar una voz no crea un binding ni habilita TTS.</p>
            </>
          )}
          {artifacts
            .filter((item) => item.kind !== "preview")
            .map((artifact) => (
              <div key={artifact.artifactId}>
                <VoiceMedia
                  artifact={artifact}
                  onEnded={() =>
                    setPlayed(
                      (prior) => new Set([...prior, artifact.artifactId]),
                    )
                  }
                />
                {artifact.kind === "binding-test" && (
                  <button
                    disabled={
                      blocked ||
                      !played.has(artifact.artifactId) ||
                      listened.has(artifact.artifactId)
                    }
                    onClick={() =>
                      void act({
                        kind: "listen",
                        artifactId: artifact.artifactId,
                        key: key(),
                      })
                    }
                  >
                    Confirmar que escuché esta prueba
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
      <section className="voice-panel">
        <h2>Asociar una voz y validar el binding</h2>
        <p>
          Elegir una voz guarda un candidato sin validar; sólo aceptar una
          prueba escuchada habilita el slot.
        </p>
        <button disabled={busy} onClick={() => void consult("voices")}>
          Consultar catálogo de voces del proveedor
        </button>
        <button disabled={busy} onClick={() => void consult("speech")}>
          Consultar modelos TTS y compatibilidad
        </button>
        <label>
          Voz elegida{" "}
          <select
            disabled={blocked}
            aria-label="Voz elegida" value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Elegí una voz</option>
            <optgroup label="Voces guardadas en esta aplicación">
              {saved.map((item) => (
                <option
                  key={item.savedVoiceId}
                  value={`saved:${item.savedVoiceId}`}
                >
                  {item.voiceName}
                </option>
              ))}
            </optgroup>
            <optgroup label="Catálogo de proveedor consultado">
              {catalog?.voices
                .filter((item) => item.languages.includes("es"))
                .map((item) => (
                  <option key={item.voiceId} value={`provider:${item.voiceId}`}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        {catalog?.hasMore && catalog.nextCursor !== null && (
          <button
            disabled={busy}
            onClick={() =>
              void consult("voices", catalog.nextCursor ?? undefined)
            }
          >
            Más voces del proveedor
          </button>
        )}
        <label>
          Modelo TTS compatible con español{" "}
          <select
            aria-label="Modelo TTS compatible con español" value={ttsModel}
            onChange={(event) => setTtsModel(event.target.value)}
          >
            <option value="">Elegí un modelo consultado</option>
            {models
              .filter(
                (item) =>
                  item.kind === "speech" &&
                  item.canDoTextToSpeech &&
                  item.languages.includes("es"),
              )
              .map((item) => (
                <option key={item.modelId} value={item.modelId}>
                  {item.kind === "speech" ? item.name : item.modelId}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={
            paidBlocked ||
            !confirmed ||
            owner === undefined ||
            !source ||
            !ttsModel
          }
          onClick={() => {
            const index = source.indexOf(":");
            const prefix = source.slice(0, index);
            const id = source.slice(index + 1);
            void act({
              kind: "draft",
              ...configArgs,
              key: key(),
              owner,
              source:
                prefix === "saved"
                  ? { kind: "savedVoice", savedVoiceId: id }
                  : { kind: "providerVoice", providerVoiceId: id },
              ttsModelId: ttsModel,
            });
          }}
        >
          Crear candidato de binding · comprobar catálogo remoto
        </button>
        {candidates.length > 0 && (
          <details>
            <summary>Candidatos guardados de la identidad seleccionada</summary>
            <ul>
              {candidates
                .filter((item) => voiceOwnerKey(item.owner) === selectedOwner)
                .map((item) => (
                  <li key={item.bindingDraftId}>
                    {item.voiceSnapshot.name} · {item.bindingDraftId}{" "}
                    <button disabled={blocked} onClick={() => setDraft(item)}>
                      Consultar candidato y sus pruebas
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        )}
        {draft && (
          <>
            <p>
              Candidato {draft.bindingDraftId} · {draft.voiceSnapshot.name} ·{" "}
              {draft.varietyLabel} · sin validar.
            </p>
            <label>
              Texto original para probar esta voz{" "}
              <textarea
                value={testSample}
                onChange={(event) => setTestSample(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={testOriginal}
                onChange={(event) => setTestOriginal(event.target.checked)}
              />{" "}
              Esta prueba usa muestra original y autorizada.
            </label>
            <button
              disabled={
                paidBlocked ||
                !confirmed ||
                !testOriginal ||
                !VoiceTestRequestSchema.safeParse({
                  sampleText: testSample,
                  sampleOrigin: { kind: "operator-entered" },
                }).success
              }
              onClick={() =>
                void act({
                  kind: "test",
                  ...configArgs,
                  key: key(),
                  bindingDraftId: draft.bindingDraftId,
                  request: {
                    sampleText: testSample,
                    sampleOrigin: { kind: "operator-entered" },
                  },
                })
              }
            >
              Solicitar prueba TTS · puede consumir créditos
            </button>
            {testArtifacts.map((artifact) => (
              <div key={artifact.artifactId}>
                <p>
                  Prueba {artifact.artifactId} del candidato{" "}
                  {draft.bindingDraftId}
                </p>
                <button
                  disabled={
                    blocked ||
                    !listened.has(artifact.artifactId) ||
                    artifact.configRevision !== settings?.value.config.revision
                  }
                  onClick={() =>
                    void act({
                      kind: "accept",
                      ...configArgs,
                      key: key(),
                      bindingDraftId: draft.bindingDraftId,
                      artifactId: artifact.artifactId,
                      verdict: "accept",
                    })
                  }
                >
                  Aceptar prueba escuchada y habilitar binding
                </button>
                <button
                  disabled={
                    blocked ||
                    !listened.has(artifact.artifactId) ||
                    artifact.configRevision !== settings?.value.config.revision
                  }
                  onClick={() =>
                    void act({
                      kind: "accept",
                      ...configArgs,
                      key: key(),
                      bindingDraftId: draft.bindingDraftId,
                      artifactId: artifact.artifactId,
                      verdict: "reject",
                    })
                  }
                >
                  Rechazar esta prueba
                </button>
              </div>
            ))}
          </>
        )}
      </section>
      <section className="voice-panel">
        <h2>Audio de una publicación confirmada</h2>
        <p>
          Texto confirmado canónico. La síntesis de una publicación existente no
          reejecuta actores ni duplica diálogo. Replay reproduce sólo audio
          almacenado.
        </p>
        <label>
          ID de publicación que querés sintetizar{" "}
          <input
            value={publication}
            onChange={(event) => setPublication(event.target.value)}
          />
        </label>
        <button
          disabled={
            paidBlocked ||
            !confirmed ||
            settings?.value.config.audioMode.kind !== "enabled" ||
            settings.value.config.audioMode.ttsMode !==
              "manual-per-publication" ||
            !publication.trim()
          }
          onClick={() => {
            const mode = settings?.value.config.audioMode;
            if (mode?.kind === "enabled")
              void act({
                kind: "tts",
                ...configArgs,
                key: key(),
                publicationId: publication,
                format: mode.outputFormat,
              });
          }}
        >
          Solicitar audio de esta publicación · puede consumir créditos
        </button>
      </section>
      <section className="voice-panel">
        <h2>Historia administrativa de voz</h2>
        {history.length === 0 ? (
          <p>No hay operaciones de voz registradas.</p>
        ) : (
          <ul>
            {history.map((op) => (
              <li key={op.operationId}>
                {op.kind} · {labels[op.state]} · {op.operationId}{" "}
                <button
                  disabled={busy}
                  onClick={() => {
                    setOperation(op);
                    setPreviews([]);
                    setArtifacts([]);
                    setOperationRefresh((value) => value + 1);
                  }}
                >
                  Consultar esta operación guardada
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <VoiceSoundPanel runId={runId} owners={soundOwners} onChanged={changed} />
    </div>
  );
}
