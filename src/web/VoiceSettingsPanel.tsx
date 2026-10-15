import React from "react";
import type { z } from "zod";
import { VoiceProviderModelSchema, voiceOwnerKey } from "../domain/voice.ts";
import { VoiceSettingsInputSchema, type VoiceIntent, type VoiceSettingsDocument, type VoiceOwnersSchema } from "./voice-client.ts";

type Settings = z.infer<typeof VoiceSettingsInputSchema>;
type Owners = z.infer<typeof VoiceOwnersSchema>["owners"];
export function editableVoiceSettings(document: VoiceSettingsDocument): Settings {
  const { audioMode, speakerSlots, narratorSlot, soundEffectSlots } = document.value.config;
  return VoiceSettingsInputSchema.parse({ audioMode, speakerSlots, narratorSlot, soundEffectSlots, quotaLimits: document.value.quotaLimits });
}
export function changeVoiceSlot(input: { settings: Settings; section: "speaker" | "narrator" | "effect"; id: string; selection: string; saved: Settings }): Settings {
  const { settings, section, id, selection, saved } = input;
  if (section === "narrator") return VoiceSettingsInputSchema.parse({ ...settings, narratorSlot: selection === "preserve" ? saved.narratorSlot : { kind: selection } });
  const property = section === "speaker" ? "speakerSlots" : "soundEffectSlots";
  const prior = saved[property][id];
  if (selection === "preserve" && prior?.kind !== "enabled-bound") throw new Error("No existe un binding confirmado para conservar.");
  return VoiceSettingsInputSchema.parse({ ...settings, [property]: { ...settings[property], [id]: selection === "preserve" ? prior : { kind: selection } } });
}
export function VoiceSettingsPanel({ runId, document, owners, soundOwners, models, blocked, stale, onIntent, onConsultModels }: {
  runId: string; document: VoiceSettingsDocument | null; owners: Owners;
  soundOwners: Array<{id:string;label:string}>;
  models: z.infer<typeof VoiceProviderModelSchema>[];
  blocked: boolean; stale: boolean;
  onIntent: (intent: VoiceIntent) => void; onConsultModels: () => void;
}) {
  const [edit, setEdit] = React.useState<Settings | null>(() => document && editableVoiceSettings(document));
  const [baseRevision, setBaseRevision] = React.useState(document?.value.config.revision ?? null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (edit === null && document !== null) {
      setEdit(editableVoiceSettings(document));
      setBaseRevision(document.value.config.revision);
    }
  }, [document, edit]);
  const audioMode = edit?.audioMode;
  const saved = document && editableVoiceSettings(document);
  const changedRevision = document !== null && baseRevision !== document.value.config.revision;
  const disabled = blocked || stale || changedRevision || edit === null;
  function update(next: Settings) { setEdit(next); setInvalid(null); }
  function slot(section: "speaker" | "narrator" | "effect", id: string, label: string, eligible = true) {
    if (!edit || !saved) return null;
    const selected = section === "narrator" ? edit.narratorSlot : section === "speaker" ? edit.speakerSlots[id] : edit.soundEffectSlots[id];
    const prior = section === "narrator" ? saved.narratorSlot : section === "speaker" ? saved.speakerSlots[id] : saved.soundEffectSlots[id];
    const off = section === "narrator" ? "absent" : "disabled";
    return <label key={`${section}:${id}`}>{label} <select aria-label={`Slot ${label}`} disabled={disabled} value={selected?.kind === "enabled-bound" ? "preserve" : selected?.kind ?? off} onChange={(event) => update(changeVoiceSlot({ settings: edit, section, id, selection: event.target.value, saved }))}>
      <option value={off}>Deshabilitado</option>{eligible && <option value="enabled-unbound">Habilitado · falta binding validado</option>}
      {!eligible && selected?.kind === "enabled-unbound" && <option value="enabled-unbound" disabled>Referencia anterior sin binding · requiere narración textual habilitada</option>}
      {prior?.kind === "enabled-bound" && <option value="preserve">Conservar vinculación guardada · comprobar en preflight</option>}
    </select></label>;
  }
  return <section className="voice-panel">
    <h2>Configuración de audio de la representación</h2>
    <p>Guardar modo, slots y límites no genera audio ni llama al proveedor. Las cuotas cuentan solicitudes, no créditos ni dinero.</p>
    {document && <p>Revisión de voz {document.value.config.revision}; preparación fuente {document.value.baseRunConfigurationRevision}.</p>}
    {stale && <p role="alert">La preparación fuente cambió. Conciliá para revisar las identidades vigentes: se conserva el modo de audio anterior; no se importan automáticamente los cambios de audio del borrador.</p>}
    <button disabled={blocked || document === null} onClick={() => {
      if (document) onIntent({ kind: "reconcileSettings", runId, configRevision: document.value.config.revision, key: crypto.randomUUID() });
    }}>Conciliar con la preparación actual · sin proveedor</button>
    {changedRevision && <p role="status">Hay una nueva revisión guardada. El formulario conserva tus campos; cargá explícitamente la configuración vigente antes de volver a guardar.</p>}
    <button disabled={blocked || document === null} onClick={() => {
      if (document) { setEdit(editableVoiceSettings(document)); setBaseRevision(document.value.config.revision); setInvalid(null); }
    }}>Cargar configuración guardada en el formulario</button>
    {edit && <>
      <label>Modo de audio <select aria-label="Modo de audio" disabled={disabled} value={edit.audioMode.kind} onChange={(event) => {
        if (event.target.value === "disabled") update({ ...edit, audioMode: { kind: "disabled" } });
        else {
          const previous = saved?.audioMode;
          const model = models.find((item) => item.kind === "speech" && item.canDoTextToSpeech && item.languages.includes("es"));
          if (previous?.kind === "enabled") update({ ...edit, audioMode: previous });
          else if (model) update({ ...edit, audioMode: { kind: "enabled", language: "es", ttsMode: "manual-per-publication", ttsModelId: model.modelId, outputFormat: "mp3_44100_128", subtitles: true } });
          else setInvalid("Consultá y elegí un modelo TTS admitido antes de habilitar audio.");
        }
      }}><option value="disabled">Apagado</option><option value="enabled">Habilitado</option></select></label>
      <button disabled={blocked} onClick={onConsultModels}>Consultar modelos para configurar TTS</button>
      {audioMode?.kind === "enabled" && <>
        <label>Generación TTS <select aria-label="Generación TTS" disabled={disabled} value={audioMode.ttsMode} onChange={(event) => {
          if (edit.audioMode.kind === "enabled" && (event.target.value === "manual-per-publication" || event.target.value === "automatic-after-publication")) update({ ...edit, audioMode: { ...edit.audioMode, ttsMode: event.target.value } });
        }}><option value="manual-per-publication">Manual por publicación</option><option value="automatic-after-publication">Automática después de publicar</option></select></label>
        <p>El modo automático puede consumir créditos al publicarse texto confirmado. Guardar estos controles no sintetiza publicaciones anteriores.</p>
        <label>Modelo del audio <select aria-label="Modelo del audio" disabled={disabled} value={audioMode.ttsModelId} onChange={(event) => { if (edit.audioMode.kind === "enabled") update({ ...edit, audioMode: { ...edit.audioMode, ttsModelId: event.target.value } }); }}>
          {!models.some((item) => item.kind === "speech" && item.canDoTextToSpeech && item.languages.includes("es") && item.modelId === audioMode.ttsModelId) && <option value={audioMode.ttsModelId}>{audioMode.ttsModelId} · configuración conservada; no confirmado en el catálogo consultado</option>}
          {models.flatMap((item) => item.kind === "speech" && item.canDoTextToSpeech && item.languages.includes("es") ? [<option key={item.modelId} value={item.modelId}>{item.name}</option>] : [])}
        </select></label>
        <label>Formato del audio <select aria-label="Formato del audio" disabled={disabled} value={audioMode.outputFormat} onChange={(event) => {
          if (edit.audioMode.kind === "enabled") update({ ...edit, audioMode: VoiceSettingsInputSchema.shape.audioMode.parse({ ...edit.audioMode, outputFormat: event.target.value }) });
        }}>{["mp3_44100_128", "mp3_44100_192", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_44100"].map((format) => <option key={format}>{format}</option>)}</select></label>
        <label><input type="checkbox" disabled={disabled} checked={audioMode.subtitles} onChange={(event) => { if (edit.audioMode.kind === "enabled") update({ ...edit, audioMode: { ...edit.audioMode, subtitles: event.target.checked } }); }} />Subtítulos</label>
      </>}
      <h3>Slots de voz y sonido</h3><p>Un slot sin binding validado no produce audio. No se ingresan identificadores de bindings a mano.</p>
      {owners.map(({owner,label}) => slot(owner.kind === "narrator" ? "narrator" : "speaker", voiceOwnerKey(owner), label))}
      {!owners.some(({owner}) => owner.kind === "narrator") && <>
        <p>La narración textual está apagada. No se puede habilitar un nuevo slot narrador; una referencia anterior se conserva para revisión y comprobación en preflight.</p>
        {slot("narrator", "narrator", "Narrador", false)}
      </>}
      {soundOwners.map(({id,label}) => slot("effect", id, `Sonido de ${label}`))}
      <h3>Límites de solicitudes de esta representación</h3>
      {([ ["voiceDesignCalls", "Voice Design"], ["ttsCalls", "TTS"], ["sfxCalls", "SFX"] ] satisfies Array<[keyof Settings["quotaLimits"], string]>).map(([field,label]) => <label key={field}>Cuota {label} <input type="number" min={0} max={10000} step={1} disabled={disabled} value={Number.isNaN(edit.quotaLimits[field]) ? "" : edit.quotaLimits[field]} onChange={(event) => update({ ...edit, quotaLimits: { ...edit.quotaLimits, [field]: event.target.value === "" ? NaN : Number(event.target.value) } })} /></label>)}
      {invalid && <p role="alert">{invalid}</p>}
      <button disabled={disabled} onClick={() => {
        const parsed = VoiceSettingsInputSchema.safeParse(edit);
        if (!parsed.success) { setInvalid("Revisá cuotas enteras entre 0 y 10000 y los controles de audio."); return; }
        if (document) onIntent({ kind: "settings", runId, configRevision: document.value.config.revision, key: crypto.randomUUID(), settings: parsed.data });
      }}>Guardar configuración de audio · sin generar</button>
    </>}
  </section>;
}
