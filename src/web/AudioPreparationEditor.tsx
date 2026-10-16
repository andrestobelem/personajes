import React from 'react';
import type { CatalogPage } from '../domain/http.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { AUDIO_OUTPUT_FORMATS, applyAudioPreparation, audioPreparationForm, audioRoster, spanishAudioPreset, type AudioPreparationForm } from './audio-preparation-form.ts';
import { draftFieldState } from './draft-form.ts';
import { createVoiceClient, VoiceHttpRejection, type VoiceClient } from './voice-client.ts';

const defaultVoiceClient = createVoiceClient();
type ProviderModel = Awaited<ReturnType<VoiceClient['models']>>[number];
type SpeechModel = Extract<ProviderModel, { kind: 'speech' }>;
export function AudioPreparationEditor(props: { draft: RunConfigurationDraft; catalog: CatalogPage['items']; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void; voiceClient?: Pick<VoiceClient, 'models'> }) {
  const [form, setForm] = React.useState(() => audioPreparationForm(props.draft));
  const [error, setError] = React.useState('');
  const [models, setModels] = React.useState<ProviderModel[] | null>(null);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [modelError, setModelError] = React.useState('');
  const modelRequest = React.useRef<AbortController | null>(null);
  const voiceClient = props.voiceClient ?? defaultVoiceClient;
  const roster = audioRoster(props.draft);
  const audio = props.draft.audio.kind === 'empty' ? undefined : props.draft.audio.value;
  const narrationEnabled = props.draft.narrationMode.kind !== 'empty' && props.draft.narrationMode.value.kind === 'enabled';
  const state = draftFieldState(props.draft.audio);
  const compatibleModels = models?.filter((item): item is SpeechModel => item.kind === 'speech' && item.canDoTextToSpeech && item.languages.includes('es')) ?? [];
  React.useEffect(() => () => modelRequest.current?.abort(), []);
  function edit(next: AudioPreparationForm) { setForm(next); setError(''); props.onPendingChange(true); }
  async function consultModels() {
    modelRequest.current?.abort();
    const controller = new AbortController(); modelRequest.current = controller;
    setModelBusy(true); setModelError('');
    try {
      const result = await voiceClient.models('speech', controller.signal);
      if (!controller.signal.aborted) { setModels(result); setModelBusy(false); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setModelError(failure instanceof VoiceHttpRejection && failure.safeCode === 'ELEVENLABS_CREDENTIAL_MISSING'
          ? 'No hay una credencial de ElevenLabs configurada. Configurala en Voces y sonido para consultar el catálogo; esta pantalla no la solicita ni la guarda.'
          : failure instanceof Error ? failure.message : 'No se pudieron consultar los modelos TTS.');
        setModelBusy(false);
      }
    }
  }
  function label(id: string) { return props.catalog.find(item => item.characterId === id)?.displayName ?? id; }
  function slots(kind: 'speakers' | 'effects') {
    const rows = form[kind];
    const ids = [...new Set([...roster.filter(actor => kind === 'effects' ? actor.canUseEffects : actor.canSpeak).map(actor => actor.characterId), ...rows.map(row => row.characterId)])];
    return <fieldset><legend>{kind === 'speakers' ? 'Voces del reparto' : 'Efectos del reparto'}</legend>{ids.length === 0 && <p>No hay identidades preparadas para esta selección.</p>}{ids.map(id => {
      const row = rows.find(item => item.characterId === id);
      const actor = roster.find(item => item.characterId === id);
      const eligible = actor !== undefined && (kind === 'effects' ? actor.canUseEffects : actor.canSpeak);
      const old = kind === 'speakers' ? audio?.speakerSlots.find(item => item.characterId === id)?.slot : audio?.soundEffectSlots.find(item => item.characterId === id)?.slot;
      return <div key={id}><label>{kind === 'speakers' ? 'Voz' : 'Efecto'} de {label(id)}<select value={row?.choice ?? ''} onChange={event => {
        const choice = event.target.value;
        if (choice !== '' && choice !== 'preserve' && choice !== 'disabled' && choice !== 'enabled-unbound' && choice !== 'remove') return;
        edit({ ...form, [kind]: [...rows.filter(item => item.characterId !== id), { characterId: id, choice }] });
      }}><option value="">Elegir explícitamente</option>{old && <option value="preserve">Conservar: {old.kind === 'enabled-bound' ? 'vinculación conservada (comprobación pendiente)' : old.kind === 'disabled' ? 'desactivado' : 'habilitado sin vincular'}</option>}{eligible && <><option value="disabled">Desactivado</option><option value="enabled-unbound">Habilitado, vincular después</option></>}{row && <option value="remove">Quitar entrada explícitamente</option>}</select></label>{!eligible && <p className="edit-notice">Entrada anterior fuera del reparto activo habilitado para este tipo de sonido. Se conserva hasta que elijas quitarla; la validación puede exigir retirarla.</p>}{kind === 'effects' && actor?.canUseEffects && <p className="field-help">Esta identidad no tiene capacidad de habla preparada: sólo se ofrecen efectos, sin voz hablada.</p>}</div>;
    })}</fieldset>;
  }
  return <section className="draft-section" id="draft-audio"><div className="section-heading"><h3>Audio de la representación</h3><span className={`field-state field-state-${state.kind}`} title={state.detail}>{state.label}</span></div>
    <label>Audio<select value={form.mode} onChange={event => edit({ ...form, mode: event.target.value })}><option value="">Elegir audio</option><option value="disabled">Desactivado</option><option value="enabled">Activado</option></select></label>
    <p className="field-help">El preset es una propuesta local editable: mantiene el modelo y las vinculaciones que ya existan, no inventa IDs ni consulta al proveedor.</p><button type="button" onClick={() => edit(spanishAudioPreset(form))}>Usar preset local: español con subtítulos · manual por publicación</button>
    {form.mode === 'enabled' && <><p>Idioma de síntesis: español (es).</p><label>Cuándo sintetizar<select value={form.ttsMode} onChange={event => edit({ ...form, ttsMode: event.target.value })}><option value="">Elegir comportamiento</option><option value="manual-per-publication">Manualmente por publicación</option><option value="automatic-after-publication">Automáticamente después de publicar</option></select></label><button type="button" disabled={modelBusy} onClick={() => void consultModels()}>{modelBusy ? 'Consultando modelos TTS…' : 'Consultar modelos TTS para español'}</button>{modelError && <p role="alert" className="error">{modelError}</p>}{models !== null && compatibleModels.length === 0 && <p role="status">La consulta terminó, pero no hay modelos compatibles con TTS y español en este catálogo.</p>}<label>Modelo TTS compatible con español<select aria-label="Modelo TTS compatible con español" value={form.ttsModelId} onChange={event => edit({ ...form, ttsModelId: event.target.value })}><option value="">Elegí un modelo consultado</option>{form.ttsModelId !== '' && !compatibleModels.some(item => item.modelId === form.ttsModelId) && <option value={form.ttsModelId}>{form.ttsModelId} · configuración conservada; {models === null ? 'todavía no consultada' : models.some(item => item.kind === 'speech' && item.modelId === form.ttsModelId) ? 'no compatible con TTS en español' : 'ausente del catálogo consultado'}</option>}{compatibleModels.map(item => <option key={item.modelId} value={item.modelId}>{item.name} · {item.modelId}</option>)}</select></label><label>Formato de audio<select value={form.outputFormat} onChange={event => edit({ ...form, outputFormat: event.target.value })}><option value="">Elegir formato</option>{AUDIO_OUTPUT_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}</select></label><label>Subtítulos<select value={form.subtitles} onChange={event => edit({ ...form, subtitles: event.target.value })}><option value="">Elegir subtítulos</option><option value="true">Activados</option><option value="false">Desactivados</option></select></label></>}
    {slots('speakers')}{slots('effects')}
    <label>Voz del narrador<select value={form.narrator} onChange={event => {
      const narrator = event.target.value;
      if (narrator === '' || narrator === 'preserve' || narrator === 'absent' || narrator === 'enabled-unbound') edit({ ...form, narrator });
    }}><option value="">Elegir voz del narrador</option>{audio && <option value="preserve">Conservar: {audio.narratorSlot.kind === 'enabled-bound' ? 'vinculación conservada (comprobación pendiente)' : audio.narratorSlot.kind === 'absent' ? 'ausente' : 'habilitado sin vincular'}</option>}<option value="absent">Sin voz de narrador</option>{narrationEnabled && <option value="enabled-unbound">Habilitada, vincular después</option>}</select></label>
    {!narrationEnabled && audio?.narratorSlot.kind !== 'absent' && audio?.narratorSlot !== undefined && <p className="edit-notice">La narración textual está desactivada o pendiente. La selección anterior se conserva hasta que elijas retirarla; revisala antes de validar.</p>}
    <p className="field-help">Guardar o aplicar no sintetiza audio ni crea voces. Las voces y efectos se vinculan después en Voces y sonido; una referencia conservada todavía requiere comprobar su vigencia. Si desactivás o reemplazás una selección, volver a habilitarla exige vincularla allí.</p>
    <p className="field-help">El audio activado requiere una variedad de español confirmada y la comprobación de ejecución revisa la compatibilidad del modelo y las vinculaciones. Este editor no confirma la variedad automáticamente ni presupone modelos disponibles.</p>
    {error && <p role="alert" className="error">{error}</p>}<button type="button" onClick={() => { try { props.onChange(applyAudioPreparation({ draft: props.draft, form })); props.onPendingChange(false); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Revisá la configuración de audio.'); } }}>Aplicar audio</button>
  </section>;
}
