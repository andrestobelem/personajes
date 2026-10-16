import { z } from 'zod';
import { assertCharacterBiographyPreserved, CuratedLifeHistorySchema, CharacterDesireSchema, CuratedCharacterDesiresSchema } from '../domain/character-biography.ts';
import { DossierSourceSchema, type DossierSource } from '../domain/dossier-source.ts';
import { DossierSchema, type Dossier } from '../domain/catalog.ts';
import { PreparedCharacterSchema, type PreparedCharacter, type ContinuityContext, GoalSchema, CapabilitySchema, CapabilityIdSchema, InventoryItemSchema, RelationshipSchema, AdmittedAntecedentSchema, PreparationProvenanceSchema } from '../domain/preparation.ts';
import { changeDraftField } from './draft-form.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';

export const CharacterCurationFormSchema = z.strictObject({
  selfReference: z.string(), selfConcept: z.string(), values: z.string(), dispositions: z.string(), contradictions: z.string(),
  lifeNarrative: z.string(), lifeAntecedentIds: z.array(AdmittedAntecedentSchema.shape.antecedentId), lifeUnknowns: z.string(), lifeContradictions: z.string(),
  desires: z.array(CharacterDesireSchema.safeExtend({ description: z.string(), stakes: z.string(), tension: z.string() })),
  voiceKind: z.enum(['spoken', 'nonverbal']), voice: z.string(),
  antecedents: z.array(z.strictObject({ antecedentId: AdmittedAntecedentSchema.shape.antecedentId, kind: AdmittedAntecedentSchema.shape.kind, statement: AdmittedAntecedentSchema.shape.statement, applicability: AdmittedAntecedentSchema.shape.applicability })),
  goals: z.array(GoalSchema), relationships: z.array(RelationshipSchema), capabilities: z.array(z.union([
    CapabilitySchema,
    z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('world-action'), action: z.literal(''), description: z.string().min(1).max(2_000) }),
  ])), inventory: z.array(InventoryItemSchema),
  unknownTopics: z.string(), noInitialExperiences: z.boolean(),
  provenanceKind: z.enum(['unselected', 'dossier-evidence', 'explicit-adaptation', 'curator-declaration']), reason: z.string(), sourceRefs: z.array(z.string()),
});
export type CharacterCurationForm = z.infer<typeof CharacterCurationFormSchema>;
const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
export function emptyCharacterCurationForm(): CharacterCurationForm {
  return { selfReference: '', selfConcept: '', values: '', dispositions: '', contradictions: '', lifeNarrative: '', lifeAntecedentIds: [], lifeUnknowns: '', lifeContradictions: '', desires: [], voiceKind: 'spoken', voice: '', antecedents: [], goals: [], relationships: [], capabilities: [], inventory: [], unknownTopics: '', noInitialExperiences: false, provenanceKind: 'unselected', reason: '', sourceRefs: [] };
}
export function characterCurationForm(character?: PreparedCharacter): CharacterCurationForm {
  if (!character) return emptyCharacterCurationForm();
  return { ...emptyCharacterCurationForm(), selfReference: character.identity.value.selfReference, selfConcept: character.identity.value.selfConcept,
    lifeNarrative: character.identity.value.lifeHistory?.narrative ?? '', lifeAntecedentIds: [...(character.identity.value.lifeHistory?.antecedentIds ?? [])], lifeUnknowns: (character.identity.value.lifeHistory?.unknowns ?? []).join('\n'), lifeContradictions: (character.identity.value.lifeHistory?.contradictions ?? []).join('\n'), desires: structuredClone(character.identity.value.desires ?? []),
    values: character.identity.value.values.join('\n'), dispositions: character.identity.value.dispositions.join('\n'), contradictions: character.identity.value.contradictions.join('\n'),
    voiceKind: character.voice.value.kind, voice: character.voice.value.kind === 'spoken' ? character.voice.value.recipe : character.voice.value.description,
    antecedents: character.antecedents.value.map(({ provenance: _provenance, ...antecedent }) => antecedent),
    goals: structuredClone(character.goals.value), relationships: structuredClone(character.relationships.value), capabilities: structuredClone(character.capabilities.value), inventory: structuredClone(character.inventory.value),
    unknownTopics: character.unknownPolicy.value.fields.filter((field) => field.kind === 'source-not-established').map((field) => field.topic).join('\n'),
    noInitialExperiences: character.initialExperience.value.kind === 'none' };
}
export function curateCharacter(input: { form: CharacterCurationForm; dossier: Dossier; continuity: ContinuityContext; existing?: PreparedCharacter; dossierSource?: DossierSource; uuid: () => string; recordedAt: string }): PreparedCharacter {
  const form = CharacterCurationFormSchema.parse(input.form); const dossier = DossierSchema.parse(input.dossier);
  if (form.capabilities.some((capability) => capability.kind === 'world-action' && capability.action === '')) {
    throw new Error('Elegí una acción del Escenario para cada capacidad operativa antes de aplicar el contexto.');
  }
  const lifeHistory = CuratedLifeHistorySchema.safeParse({ kind: 'curated-life-history', narrative: form.lifeNarrative, antecedentIds: form.lifeAntecedentIds, unknowns: lines(form.lifeUnknowns), contradictions: lines(form.lifeContradictions) });
  const desires = CuratedCharacterDesiresSchema.safeParse(form.desires);
  if (!lifeHistory.success || !desires.success) throw new Error('Completá la historia de vida y al menos un deseo con lo que está en juego, su tensión y sus objetivos vinculados. La biografía no se importa automáticamente del expediente.');
  if (lifeHistory.data.antecedentIds.some(id => !form.antecedents.some(antecedent => antecedent.antecedentId === id)) || desires.data.some(desire => desire.goalIds.some(id => !form.goals.some(goal => goal.goalId === id)))) throw new Error('Los antecedentes de la biografía y los objetivos de los deseos deben existir en este contexto.');
  if (input.existing !== undefined) assertCharacterBiographyPreserved({ previous: input.existing.identity.value, next: { lifeHistory: lifeHistory.data, desires: desires.data } });
  const capabilities = form.capabilities.map((capability) => CapabilitySchema.parse(capability));
  const suppliedSource = input.dossierSource ?? input.existing?.dossierSource;
  const dossierSource = suppliedSource === undefined ? undefined : DossierSourceSchema.parse(suppliedSource);
  if (dossierSource && JSON.stringify(dossierSource.frozenDossier) !== JSON.stringify(dossier)) throw new Error('La fuente completa no coincide con el expediente seleccionado.');
  if (form.provenanceKind === 'unselected') throw new Error('Elegí la procedencia de esta versión antes de aplicarla.');
  const known = new Set(dossier.sourceRefs.map((ref) => ref.id));
  if (form.sourceRefs.some((ref) => !known.has(ref))) throw new Error('Una referencia no pertenece al expediente seleccionado.');
  const common = { dossierRevision: dossier.revision, dossierHash: dossier.contentHash, continuity: { continuityId: input.continuity.continuityId, revision: input.continuity.revision, contentHash: input.continuity.contentHash }, sourceRefs: form.sourceRefs };
  const provenance = PreparationProvenanceSchema.parse(form.provenanceKind === 'dossier-evidence'
    ? { ...common, kind: form.provenanceKind, curatedBy: 'local-user', curatedAt: input.recordedAt }
    : { ...common, kind: form.provenanceKind, reason: form.reason, authoredBy: 'local-user', createdAt: input.recordedAt, ...(form.provenanceKind === 'explicit-adaptation' ? { adaptationId: input.uuid() } : {}) });
  const curated = <T,>(value: T) => ({ value, provenance });
  if (!form.noInitialExperiences && !input.existing) throw new Error('Declarar explícitamente que no hay experiencias de otra corrida, o conservar un corte existente.');
  const initialExperience = form.noInitialExperiences ? curated({ kind: 'none' }) : input.existing?.initialExperience;
  const preservedExceptions = input.existing?.unknownPolicy.value.fields.filter((field) => field.kind === 'character-knowledge-adaptation') ?? [];
  if (preservedExceptions.length > 0) throw new Error('Esta preparación contiene excepciones enlazadas a adaptaciones. Conservá la versión; su edición específica aún no está disponible.');
  return PreparedCharacterSchema.parse({ kind: 'prepared-character', schemaVersion: 1, characterId: dossier.characterId, ...(dossierSource ? { dossierSource } : {}), dossierRevision: dossier.revision, dossierHash: dossier.contentHash, continuity: input.continuity, identityVersion: (input.existing?.identityVersion ?? 0) + 1,
    identity: curated({ lifeHistory: lifeHistory.data, desires: desires.data, selfReference: form.selfReference, selfConcept: form.selfConcept, values: lines(form.values), dispositions: lines(form.dispositions), contradictions: lines(form.contradictions) }),
    voice: curated(form.voiceKind === 'spoken' ? { kind: 'spoken', recipe: form.voice } : { kind: 'nonverbal', description: form.voice }),
    antecedents: curated(form.antecedents.map((entry) => ({ ...entry, provenance }))), goals: curated(form.goals), relationships: curated(form.relationships), capabilities: curated(capabilities), inventory: curated(form.inventory), initialExperience,
    unknownPolicy: curated({ defaultTreatment: 'do-not-infer-or-assert', fields: lines(form.unknownTopics).map((topic) => ({ kind: 'source-not-established', topic })) }) });
}
export function applyCuratedCharacter(input: { draft: RunConfigurationDraft; character: PreparedCharacter }): RunConfigurationDraft {
  const character = PreparedCharacterSchema.parse(input.character);
  if (input.draft.continuity.kind === 'empty' || JSON.stringify(input.draft.continuity.value) !== JSON.stringify(character.continuity)) throw new Error('La continuidad cambió. Revisá la preparación antes de aplicarla.');
  const roster = input.draft.roster.kind === 'empty' ? { eligibleCharacterIds: [character.characterId], activeCharacterIds: [character.characterId], preparedCharacters: [] } : input.draft.roster.value;
  return changeDraftField({ draft: input.draft, field: 'roster', value: { ...roster, eligibleCharacterIds: [...new Set([...roster.eligibleCharacterIds, character.characterId])], preparedCharacters: [...roster.preparedCharacters.filter((item) => item.characterId !== character.characterId), character], ...(roster.preparationDrafts === undefined ? {} : { preparationDrafts: roster.preparationDrafts.filter(item => item.characterId !== character.characterId) }) } });
}

/** Source changes preserve authored text while requiring a fresh provenance admission. */
export function recuratingCharacterSource(form: CharacterCurationForm): CharacterCurationForm {
  return { ...form, provenanceKind: 'unselected', sourceRefs: [], reason: '' };
}
