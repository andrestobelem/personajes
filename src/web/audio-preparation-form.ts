import { AudioModeSchema, ProductionAudioSchema, type ProductionAudio, type RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField } from './draft-form.ts';

export const AUDIO_OUTPUT_FORMATS = AudioModeSchema.options[1].shape.outputFormat.options;
type SlotChoice = '' | 'preserve' | 'disabled' | 'enabled-unbound' | 'remove';
type SlotForm = { characterId: ProductionAudio['speakerSlots'][number]['characterId']; choice: SlotChoice };
export type AudioPreparationForm = {
  mode: string; ttsMode: string; ttsModelId: string; outputFormat: string; subtitles: string;
  speakers: SlotForm[]; effects: SlotForm[]; narrator: '' | 'preserve' | 'absent' | 'enabled-unbound';
};
export function audioRoster(draft: RunConfigurationDraft) {
  if (draft.roster.kind === 'empty') return [];
  const roster = draft.roster.value;
  return roster.activeCharacterIds.map(characterId => {
    const prepared = roster.preparedCharacters.find(item => item.characterId === characterId);
    return { characterId, canUseEffects: prepared?.voice.value.kind === 'nonverbal', canSpeak: prepared?.voice.value.kind === 'spoken' && prepared.capabilities.value.some(item => item.kind === 'speech'), prepared: prepared !== undefined };
  });
}
export function audioPreparationForm(draft: RunConfigurationDraft): AudioPreparationForm {
  const audio = draft.audio.kind === 'empty' ? undefined : draft.audio.value;
  return {
    mode: audio?.mode.kind ?? '', ttsMode: audio?.mode.kind === 'enabled' ? audio.mode.ttsMode : '',
    ttsModelId: audio?.mode.kind === 'enabled' ? audio.mode.ttsModelId : '',
    outputFormat: audio?.mode.kind === 'enabled' ? audio.mode.outputFormat : '',
    subtitles: audio?.mode.kind === 'enabled' ? String(audio.mode.subtitles) : '',
    speakers: audio?.speakerSlots.map(item => ({ characterId: item.characterId, choice: 'preserve' })) ?? [],
    effects: audio?.soundEffectSlots.map(item => ({ characterId: item.characterId, choice: 'preserve' })) ?? [],
    narrator: audio === undefined ? '' : 'preserve',
  };
}
export function applyAudioPreparation(input: { draft: RunConfigurationDraft; form: AudioPreparationForm }): RunConfigurationDraft {
  const { draft, form } = input;
  const previous = draft.audio.kind === 'empty' ? undefined : draft.audio.value;
  if (!['enabled', 'disabled'].includes(form.mode)) throw new Error('Elegí explícitamente si esta puesta usará audio.');
  const mode = form.mode === 'disabled' ? { kind: 'disabled' } : {
    kind: 'enabled', language: 'es', ttsMode: form.ttsMode, ttsModelId: form.ttsModelId.trim(), outputFormat: form.outputFormat,
    subtitles: form.subtitles === 'true' ? true : form.subtitles === 'false' ? false : undefined,
  };
  function entries(rows: SlotForm[], originals: ProductionAudio['speakerSlots'] | ProductionAudio['soundEffectSlots']) {
    return rows.flatMap(row => {
      if (row.choice === 'remove') return [];
      if (row.choice === 'preserve') {
        const original = originals.find(item => item.characterId === row.characterId);
        if (original === undefined) throw new Error('La selección conservada ya no existe. Revisá el slot.');
        return [original];
      }
      if (!row.choice) throw new Error(`Elegí explícitamente el slot de ${row.characterId}.`);
      return [{ characterId: row.characterId, slot: { kind: row.choice } }];
    });
  }
  let narratorSlot: unknown;
  switch (form.narrator) {
    case 'preserve': if (previous === undefined) throw new Error('No hay una voz de narrador anterior para conservar.'); narratorSlot = previous.narratorSlot; break;
    case 'absent': narratorSlot = { kind: 'absent' }; break;
    case 'enabled-unbound': if (draft.narrationMode.kind === 'empty' || draft.narrationMode.value.kind !== 'enabled') throw new Error('Activá primero la narración textual.'); narratorSlot = { kind: 'enabled-unbound' }; break;
    case '': throw new Error('Elegí explícitamente la voz del narrador o su ausencia.');
    default: { const exhaustive: never = form.narrator; return exhaustive; }
  }
  for (const row of form.speakers) {
    if (row.choice !== 'preserve' && row.choice !== 'remove' && !audioRoster(draft).some(actor => actor.characterId === row.characterId && actor.canSpeak)) throw new Error('Sólo un actor activo con habla preparada puede recibir un slot nuevo de voz.');
  }
  for (const row of form.effects) {
    if (row.choice !== 'preserve' && row.choice !== 'remove' && !audioRoster(draft).some(actor => actor.characterId === row.characterId && actor.canUseEffects)) throw new Error('Sólo un actor activo con voz no verbal preparada puede recibir un slot nuevo de efectos.');
  }
  const audio = ProductionAudioSchema.parse({ mode, speakerSlots: entries(form.speakers, previous?.speakerSlots ?? []), soundEffectSlots: entries(form.effects, previous?.soundEffectSlots ?? []), narratorSlot });
  if (audio.mode.kind === 'enabled') {
    for (const actor of audioRoster(draft)) if (actor.canSpeak && !audio.speakerSlots.some(item => item.characterId === actor.characterId)) throw new Error(`Elegí un slot explícito de voz para ${actor.characterId}.`);
  }
  return changeDraftField({ draft, field: 'audio', value: audio });
}
