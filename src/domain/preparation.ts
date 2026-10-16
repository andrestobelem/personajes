import { z } from 'zod';
import { ExperienceSchema } from './experience.ts';
import { ForkSourceSchema } from './fork-origin.ts';
import { DossierSourceSchema, addPreparationDossierSourceIssues } from './dossier-source.ts';
import {CuratedLifeHistorySchema,CuratedCharacterDesiresSchema,addCharacterBiographyLinkIssues} from './character-biography.ts';
import {
  CharacterIdSchema, ExperienceIdSchema, FictionalInstantSchema, HashSchema,
  JobIdSchema, OperationIdSchema, RevisionSchema, RunIdSchema, SourceRefIdSchema, WorldSeqSchema,
} from './values.ts';

export const ContinuityIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'ContinuityId'>();
export const ContinuityMilestoneIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'ContinuityMilestoneId'>();
export const ContinuityInclusionIdSchema = z.string().uuid().brand<'ContinuityInclusionId'>();
export const PreparationAdaptationIdSchema = z.string().uuid().brand<'PreparationAdaptationId'>();
export const AntecedentIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'AntecedentId'>();
export const GoalIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'GoalId'>();
export const CapabilityIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'CapabilityId'>();
export const InventoryItemIdSchema = z.string().min(1).max(120)
  .regex(/^[a-z0-9-]+$/).brand<'InventoryItemId'>();

const ContinuityReferenceFields = {
  continuityId: ContinuityIdSchema,
  revision: RevisionSchema,
  contentHash: HashSchema,
};

export const ContinuityReferenceSchema = z.strictObject(ContinuityReferenceFields);
export type ContinuityReference = z.infer<typeof ContinuityReferenceSchema>;

export const ContinuityMilestoneSchema = z.strictObject({
  milestoneId: ContinuityMilestoneIdSchema,
  label: z.string().min(1).max(500),
  status: z.enum(['reached', 'notReached', 'undetermined']),
  sourceRefs: z.array(SourceRefIdSchema).max(1_000),
});

export const ContinuityInclusionSchema = z.strictObject({
  inclusionId: ContinuityInclusionIdSchema,
  label: z.string().min(1).max(1_000),
  sourceRefs: z.array(SourceRefIdSchema).max(1_000),
  confirmedBy: z.string().min(1).max(200),
  confirmedAt: z.string().datetime({ offset: true }),
});

/**
 * A versioned continuity cut. Milestone states and explicit inclusions are
 * selected for the fictional continuity; documentary broadcast dates are not
 * modeled here and must never be used to infer a fictional milestone.
 */
export const ContinuityContextSchema = z.strictObject({
  ...ContinuityReferenceFields,
  kind: z.enum(['original', 'adaptation']),
  label: z.string().min(1).max(1_000),
  milestones: z.array(ContinuityMilestoneSchema).max(10_000),
  inclusions: z.array(ContinuityInclusionSchema).max(10_000),
}).superRefine((continuity, context) => {
  const milestones = new Set<string>();
  for (const [index, milestone] of continuity.milestones.entries()) {
    if (milestones.has(milestone.milestoneId)) {
      context.addIssue({ code: 'custom', path: ['milestones', index, 'milestoneId'], message: 'Hito duplicado en la continuidad' });
    }
    milestones.add(milestone.milestoneId);
  }
  const inclusions = new Set<string>();
  for (const [index, inclusion] of continuity.inclusions.entries()) {
    if (inclusions.has(inclusion.inclusionId)) {
      context.addIssue({ code: 'custom', path: ['inclusions', index, 'inclusionId'], message: 'Inclusión duplicada en la continuidad' });
    }
    inclusions.add(inclusion.inclusionId);
  }
});
export type ContinuityContext = z.infer<typeof ContinuityContextSchema>;

export const PreparationProvenanceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('dossier-evidence'),
    dossierRevision: RevisionSchema,
    dossierHash: HashSchema,
    continuity: ContinuityReferenceSchema,
    curatedBy: z.string().min(1).max(200),
    curatedAt: z.string().datetime({ offset: true }),
    sourceRefs: z.array(SourceRefIdSchema).min(1).max(1_000),
  }),
  z.strictObject({
    kind: z.literal('explicit-adaptation'),
    dossierRevision: RevisionSchema,
    dossierHash: HashSchema,
    continuity: ContinuityReferenceSchema,
    adaptationId: PreparationAdaptationIdSchema,
    reason: z.string().min(1).max(4_000),
    authoredBy: z.string().min(1).max(200),
    createdAt: z.string().datetime({ offset: true }),
    sourceRefs: z.array(SourceRefIdSchema).max(1_000),
  }),
  z.strictObject({
    kind: z.literal('curator-declaration'),
    dossierRevision: RevisionSchema,
    dossierHash: HashSchema,
    continuity: ContinuityReferenceSchema,
    reason: z.string().min(1).max(4_000),
    authoredBy: z.string().min(1).max(200),
    createdAt: z.string().datetime({ offset: true }),
    sourceRefs: z.array(SourceRefIdSchema).max(1_000),
  }),
  z.strictObject({
    kind: z.literal('experience-cut'),
    dossierRevision: RevisionSchema,
    dossierHash: HashSchema,
    continuity: ContinuityReferenceSchema,
    runId: RunIdSchema,
    throughWorldSeq: WorldSeqSchema,
    throughFictionalAt: FictionalInstantSchema,
    admittedBy: z.string().min(1).max(200),
    admittedAt: z.string().datetime({ offset: true }),
    experienceIds: z.array(ExperienceIdSchema).min(1).max(10_000),
  }),
]);
export type PreparationProvenance = z.infer<typeof PreparationProvenanceSchema>;

export const CuratedIdentitySchema = z.strictObject({
  selfReference: z.string().min(1).max(500),
  selfConcept: z.string().min(1).max(8_000),
  values: z.array(z.string().min(1).max(2_000)).max(100),
  dispositions: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  contradictions: z.array(z.string().min(1).max(2_000)).max(100),
  lifeHistory:CuratedLifeHistorySchema.optional(),
  desires:CuratedCharacterDesiresSchema.optional(),
}).superRefine((identity,ctx)=>{if((identity.lifeHistory===undefined)!==(identity.desires===undefined))ctx.addIssue({code:'custom',path:['lifeHistory'],message:'La historia de vida y los deseos deben declararse juntos; su ausencia conjunta sólo conserva una identidad legacy'});});
export type CuratedIdentity = z.infer<typeof CuratedIdentitySchema>;

export const VoiceProfileSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('spoken'), recipe: z.string().min(1).max(20_000) }),
  z.strictObject({ kind: z.literal('nonverbal'), description: z.string().min(1).max(4_000) }),
]);
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const AntecedentApplicabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unconditional') }),
  z.strictObject({
    kind: z.literal('milestone-state'),
    milestoneId: ContinuityMilestoneIdSchema,
    requires: z.enum(['reached', 'notReached']),
  }),
  z.strictObject({ kind: z.literal('explicit-inclusion'), inclusionId: ContinuityInclusionIdSchema }),
]);
export type AntecedentApplicability = z.infer<typeof AntecedentApplicabilitySchema>;

export const AdmittedAntecedentSchema = z.strictObject({
  antecedentId: AntecedentIdSchema,
  kind: z.enum(['biography', 'milestone', 'recollection', 'testimony']),
  statement: z.string().min(1).max(8_000),
  applicability: AntecedentApplicabilitySchema,
  provenance: PreparationProvenanceSchema,
}).superRefine((antecedent, context) => {
  if (antecedent.kind === 'milestone' && antecedent.applicability.kind === 'unconditional') {
    context.addIssue({ code: 'custom', path: ['applicability'], message: 'Un hito de episodio necesita una condición explícita de continuidad o inclusión' });
  }
});
export type AdmittedAntecedent = z.infer<typeof AdmittedAntecedentSchema>;

export const GoalReviewConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('milestone-state'),
    milestoneId: ContinuityMilestoneIdSchema,
    requires: z.enum(['reached', 'notReached']),
  }),
  z.strictObject({ kind: z.literal('circumstance'), description: z.string().min(1).max(2_000) }),
]);

const individualGoalFields = {
  goalId: GoalIdSchema,
  ownerCharacterId: CharacterIdSchema,
  desiredOutcome: z.string().min(1).max(4_000),
  priority: z.number().finite().min(0).max(1),
  reviewConditions: z.array(GoalReviewConditionSchema).max(100),
  status: z.enum(['active', 'suspended', 'achieved', 'abandoned']),
  evidenceRefs: z.array(SourceRefIdSchema).max(1_000),
};

export const GoalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...individualGoalFields, kind: z.literal('durable') }),
  z.strictObject({ ...individualGoalFields, kind: z.literal('situated') }),
  z.strictObject({
    goalId: GoalIdSchema,
    kind: z.literal('shared'),
    participantIds: z.array(CharacterIdSchema).min(2).max(100),
    sharedOutcome: z.string().min(1).max(4_000),
    ownMotivation: z.string().min(1).max(4_000),
    priority: z.number().finite().min(0).max(1),
    reviewConditions: z.array(GoalReviewConditionSchema).max(100),
    status: z.enum(['active', 'suspended', 'achieved', 'abandoned']),
    evidenceRefs: z.array(SourceRefIdSchema).max(1_000),
  }),
]);
export type Goal = z.infer<typeof GoalSchema>;

export const RelationshipSchema = z.strictObject({
  ownerCharacterId: CharacterIdSchema,
  otherCharacterId: CharacterIdSchema,
  otherReference: z.string().min(1).max(500),
  descriptionFromOwnerPerspective: z.string().min(1).max(4_000),
  confidence: z.number().finite().min(0).max(1),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

/** Operational world actions are explicit grants, never inferred from prose. */
export const WorldActionSchema = z.enum(['observe', 'take', 'offer', 'putDown', 'wait', 'rest']);
export type WorldAction = z.infer<typeof WorldActionSchema>;

export const CapabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('speech'), description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('gesture'), description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('movement'), description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('nonverbal-sound'), description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('operate-device'), deviceId: z.string().min(1).max(120), description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('world-action'), action: WorldActionSchema, description: z.string().min(1).max(2_000) }),
  z.strictObject({ capabilityId: CapabilityIdSchema, kind: z.literal('other'), description: z.string().min(1).max(2_000) }),
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const InventoryItemSchema = z.strictObject({
  itemId: InventoryItemIdSchema,
  name: z.string().min(1).max(500),
  description: z.string().min(1).max(2_000),
  quantity: z.number().int().positive().max(1_000_000),
  condition: z.enum(['usable', 'damaged', 'unknown']),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const UnknownFieldPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source-not-established'), topic: z.string().min(1).max(500) }),
  z.strictObject({
    kind: z.literal('character-knowledge-adaptation'),
    topic: z.string().min(1).max(500),
    adaptationId: PreparationAdaptationIdSchema,
    reason: z.string().min(1).max(2_000),
    antecedentIds: z.array(AntecedentIdSchema).min(1).max(10_000),
  }),
]);

export const UnknownPolicySchema = z.strictObject({
  defaultTreatment: z.literal('do-not-infer-or-assert'),
  fields: z.array(UnknownFieldPolicySchema).max(10_000),
});
export type UnknownPolicy = z.infer<typeof UnknownPolicySchema>;

export const InitialExperienceSetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('run-cut'),
    runId: RunIdSchema,
    throughWorldSeq: WorldSeqSchema,
    throughFictionalAt: FictionalInstantSchema,
    continuity: ContinuityReferenceSchema,
    experiences: z.array(ExperienceSchema).min(1).max(10_000),
  }),
]);
export type InitialExperienceSet = z.infer<typeof InitialExperienceSetSchema>;

export function CuratedValueSchema<const T extends z.ZodType>(valueSchema: T) {
  return z.strictObject({ value: valueSchema, provenance: PreparationProvenanceSchema });
}

const CuratedIdentityValueSchema = CuratedValueSchema(CuratedIdentitySchema);
const CuratedVoiceValueSchema = CuratedValueSchema(VoiceProfileSchema);
const CuratedAntecedentsValueSchema = CuratedValueSchema(z.array(AdmittedAntecedentSchema).max(10_000));
const CuratedGoalsValueSchema = CuratedValueSchema(z.array(GoalSchema).min(1).max(1_000));
const CuratedRelationshipsValueSchema = CuratedValueSchema(z.array(RelationshipSchema).max(10_000));
const CuratedCapabilitiesValueSchema = CuratedValueSchema(z.array(CapabilitySchema).min(1).max(1_000));
const CuratedInventoryValueSchema = CuratedValueSchema(z.array(InventoryItemSchema).max(10_000));
const CuratedInitialExperienceValueSchema = CuratedValueSchema(InitialExperienceSetSchema);
const CuratedUnknownPolicyValueSchema = CuratedValueSchema(UnknownPolicySchema);

function PreparationSectionDraftSchema<const T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('empty') }),
    z.strictObject({ kind: z.literal('declared'), value: valueSchema }),
  ]);
}

export const PreparationFieldSchema = z.enum([
  'identity', 'voice', 'antecedents', 'goals', 'relationships', 'capabilities',
  'inventory', 'initialExperience', 'unknownPolicy',
]);
export type PreparationField = z.infer<typeof PreparationFieldSchema>;

export const PreparationDraftSchema = z.strictObject({
  kind: z.literal('preparation-draft'),
  schemaVersion: z.literal(1),
  characterId: CharacterIdSchema,
  dossierRevision: RevisionSchema,
  dossierHash: HashSchema,
  dossierSource: DossierSourceSchema.optional(),
  continuity: ContinuityContextSchema,
  identityVersion: RevisionSchema,
  identity: PreparationSectionDraftSchema(CuratedIdentityValueSchema),
  voice: PreparationSectionDraftSchema(CuratedVoiceValueSchema),
  antecedents: PreparationSectionDraftSchema(CuratedAntecedentsValueSchema),
  goals: PreparationSectionDraftSchema(CuratedGoalsValueSchema),
  relationships: PreparationSectionDraftSchema(CuratedRelationshipsValueSchema),
  capabilities: PreparationSectionDraftSchema(CuratedCapabilitiesValueSchema),
  inventory: PreparationSectionDraftSchema(CuratedInventoryValueSchema),
  initialExperience: PreparationSectionDraftSchema(CuratedInitialExperienceValueSchema),
  unknownPolicy: PreparationSectionDraftSchema(CuratedUnknownPolicyValueSchema),
}).superRefine(addPreparationDossierSourceIssues);
export type PreparationDraft = z.infer<typeof PreparationDraftSchema>;

export const PreparedCharacterForkOriginSchema = z.strictObject({
  kind:z.literal('fork'),
  source:ForkSourceSchema,
  sourcePreparedHash:HashSchema,
  sourceContinuity:ContinuityReferenceSchema,
  principalId:z.string().min(1).max(200),recordedAt:z.string().datetime({offset:true}),operationId:OperationIdSchema,
});

const PreparedCharacterObjectSchema = z.strictObject({
  kind: z.literal('prepared-character'),
  forkOrigin:PreparedCharacterForkOriginSchema.optional(),
  schemaVersion: z.literal(1),
  characterId: CharacterIdSchema,
  dossierRevision: RevisionSchema,
  dossierHash: HashSchema,
  dossierSource: DossierSourceSchema.optional(),
  continuity: ContinuityContextSchema,
  identityVersion: RevisionSchema,
  identity: CuratedIdentityValueSchema,
  voice: CuratedVoiceValueSchema,
  antecedents: CuratedAntecedentsValueSchema,
  goals: CuratedGoalsValueSchema,
  relationships: CuratedRelationshipsValueSchema,
  capabilities: CuratedCapabilitiesValueSchema,
  inventory: CuratedInventoryValueSchema,
  initialExperience: CuratedInitialExperienceValueSchema,
  unknownPolicy: CuratedUnknownPolicyValueSchema,
});
type PreparedCharacterObject = z.infer<typeof PreparedCharacterObjectSchema>;

function sameContinuityReference(left: ContinuityReference, right: ContinuityReference): boolean {
  return left.continuityId === right.continuityId
    && left.revision === right.revision
    && left.contentHash === right.contentHash;
}

function provenanceMatches(
  provenance: PreparationProvenance,
  expected: { dossierRevision: number; dossierHash: string; continuity: ContinuityReference },
): boolean {
  return provenance.dossierRevision === expected.dossierRevision
    && provenance.dossierHash === expected.dossierHash
    && sameContinuityReference(provenance.continuity, expected.continuity);
}

function applicabilityMatches(continuity: ContinuityContext, applicability: AntecedentApplicability): boolean {
  switch (applicability.kind) {
    case 'unconditional':
      return true;
    case 'milestone-state': {
      const milestone = continuity.milestones.find((item) => item.milestoneId === applicability.milestoneId);
      return milestone !== undefined && milestone.status === applicability.requires;
    }
    case 'explicit-inclusion':
      return continuity.inclusions.some((item) => item.inclusionId === applicability.inclusionId);
    default: {
      const _exhaustive: never = applicability;
      return _exhaustive;
    }
  }
}

function addPreparedCharacterIssues(character: PreparedCharacterObject, context: z.RefinementCtx): void {
  addPreparationDossierSourceIssues(character, context);
  const expected = {
    dossierRevision: character.dossierRevision,
    dossierHash: character.dossierHash,
    continuity: {
      continuityId: character.continuity.continuityId,
      revision: character.continuity.revision,
      contentHash: character.continuity.contentHash,
    },
  };
  const provenanceEntries: Array<{ path: (string | number)[]; provenance: PreparationProvenance }> = [
    { path: ['identity'], provenance: character.identity.provenance },
    { path: ['voice'], provenance: character.voice.provenance },
    { path: ['antecedents'], provenance: character.antecedents.provenance },
    { path: ['goals'], provenance: character.goals.provenance },
    { path: ['relationships'], provenance: character.relationships.provenance },
    { path: ['capabilities'], provenance: character.capabilities.provenance },
    { path: ['inventory'], provenance: character.inventory.provenance },
    { path: ['initialExperience'], provenance: character.initialExperience.provenance },
    { path: ['unknownPolicy'], provenance: character.unknownPolicy.provenance },
  ];
  for (const entry of provenanceEntries) {
    if (!provenanceMatches(entry.provenance, expected)) {
      context.addIssue({ code: 'custom', path: [...entry.path, 'provenance'], message: 'La procedencia no coincide con la revisión de ficha y continuidad preparada' });
    }
    if (entry.path[0] !== 'initialExperience' && entry.provenance.kind === 'experience-cut') {
      context.addIssue({ code: 'custom', path: [...entry.path, 'provenance'], message: 'Un corte de experiencias sólo puede justificar la experiencia inicial' });
    }
  }

  const antecedentIds = new Set<string>();
  for (const [index, antecedent] of character.antecedents.value.entries()) {
    if (antecedentIds.has(antecedent.antecedentId)) {
      context.addIssue({ code: 'custom', path: ['antecedents', 'value', index, 'antecedentId'], message: 'El ID de antecedente debe ser único en la preparación' });
    }
    antecedentIds.add(antecedent.antecedentId);
    if (!provenanceMatches(antecedent.provenance, expected)) {
      context.addIssue({ code: 'custom', path: ['antecedents', 'value', index, 'provenance'], message: 'El antecedente cita otra revisión o continuidad' });
    }
    if (!applicabilityMatches(character.continuity, antecedent.applicability)) {
      context.addIssue({ code: 'custom', path: ['antecedents', 'value', index, 'applicability'], message: 'El antecedente no aplica al corte de continuidad seleccionado' });
    }
  }

  for (const [index, goal] of character.goals.value.entries()) {
    if (goal.kind !== 'shared' && goal.ownerCharacterId !== character.characterId) {
      context.addIssue({ code: 'custom', path: ['goals', 'value', index, 'ownerCharacterId'], message: 'El goal individual debe pertenecer al personaje preparado' });
    }
    if (goal.kind === 'shared') {
      if (!goal.participantIds.includes(character.characterId)) {
        context.addIssue({ code: 'custom', path: ['goals', 'value', index, 'participantIds'], message: 'El personaje preparado debe participar del goal compartido' });
      }
      if (new Set(goal.participantIds).size !== goal.participantIds.length) {
        context.addIssue({ code: 'custom', path: ['goals', 'value', index, 'participantIds'], message: 'El goal compartido no puede repetir participantes' });
      }
    }
    for (const [conditionIndex, condition] of goal.reviewConditions.entries()) {
      if (condition.kind === 'milestone-state'
        && !character.continuity.milestones.some((milestone) => milestone.milestoneId === condition.milestoneId)) {
        context.addIssue({
          code: 'custom', path: ['goals', 'value', index, 'reviewConditions', conditionIndex, 'milestoneId'],
          message: 'La condición del goal refiere un hito ausente de la continuidad preparada',
        });
      }
    }
  }

  addCharacterBiographyLinkIssues({identity:character.identity.value,antecedentIds,ownGoalIds:new Set(character.goals.value.filter(goal=>goal.kind==='shared'?goal.participantIds.includes(character.characterId):goal.ownerCharacterId===character.characterId).map(goal=>goal.goalId))},context);

  for (const [index, relationship] of character.relationships.value.entries()) {
    if (relationship.ownerCharacterId !== character.characterId) {
      context.addIssue({ code: 'custom', path: ['relationships', 'value', index, 'ownerCharacterId'], message: 'La relación debe expresar la perspectiva del personaje preparado' });
    }
    if (relationship.otherCharacterId === character.characterId) {
      context.addIssue({ code: 'custom', path: ['relationships', 'value', index, 'otherCharacterId'], message: 'Una relación propia debe apuntar a otra identidad' });
    }
  }

  if (character.voice.value.kind === 'nonverbal'
    && character.capabilities.value.some((capability) => capability.kind === 'speech')) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Una voz no verbal no puede habilitar capacidad de habla' });
  }

  const experienceSet = character.initialExperience.value;
  const experienceProvenance = character.initialExperience.provenance;
  if (experienceSet.kind === 'none') {
    if (experienceProvenance.kind === 'experience-cut') {
      context.addIssue({ code: 'custom', path: ['initialExperience', 'provenance'], message: 'Una experiencia inicial vacía no puede declarar un corte de experiencias' });
    }
  } else {
    if (!sameContinuityReference(experienceSet.continuity, expected.continuity)) {
      context.addIssue({ code: 'custom', path: ['initialExperience', 'value', 'continuity'], message: 'La experiencia inicial proviene de otra versión de continuidad' });
    }
    if (experienceProvenance.kind !== 'experience-cut'
      || experienceProvenance.runId !== experienceSet.runId
      || experienceProvenance.throughWorldSeq !== experienceSet.throughWorldSeq
      || experienceProvenance.throughFictionalAt !== experienceSet.throughFictionalAt) {
      context.addIssue({ code: 'custom', path: ['initialExperience', 'provenance'], message: 'La procedencia debe identificar el corte exacto de las experiencias iniciales' });
    }
    const experienceIds = new Set<string>();
    for (const [index, experience] of experienceSet.experiences.entries()) {
      if (experience.actorId !== character.characterId) {
        context.addIssue({ code: 'custom', path: ['initialExperience', 'value', 'experiences', index, 'actorId'], message: 'La experiencia no pertenece al personaje preparado' });
      }
      if (experience.runId !== experienceSet.runId) {
        context.addIssue({ code: 'custom', path: ['initialExperience', 'value', 'experiences', index, 'runId'], message: 'La experiencia pertenece a otra corrida' });
      }
      if (experience.worldSeq > experienceSet.throughWorldSeq
        || experience.fictitiousAt > experienceSet.throughFictionalAt
        || experience.receivedAt > experienceSet.throughFictionalAt) {
        context.addIssue({ code: 'custom', path: ['initialExperience', 'value', 'experiences', index], message: 'La experiencia es posterior al corte declarado' });
      }
      if (experienceIds.has(experience.experienceId)) {
        context.addIssue({ code: 'custom', path: ['initialExperience', 'value', 'experiences', index, 'experienceId'], message: 'La experiencia inicial está duplicada' });
      }
      experienceIds.add(experience.experienceId);
    }
    if (experienceProvenance.kind === 'experience-cut') {
      const provenanceIds = new Set<string>(experienceProvenance.experienceIds);
      const sameIds = provenanceIds.size === experienceIds.size
        && [...experienceIds].every((experienceId) => provenanceIds.has(experienceId));
      if (!sameIds || provenanceIds.size !== experienceProvenance.experienceIds.length) {
        context.addIssue({ code: 'custom', path: ['initialExperience', 'provenance', 'experienceIds'], message: 'La procedencia no coincide exactamente con las experiencias incluidas' });
      }
    }
  }

  const unknownProvenance = character.unknownPolicy.provenance;
  for (const [index, field] of character.unknownPolicy.value.fields.entries()) {
    if (field.kind === 'character-knowledge-adaptation') {
      if (unknownProvenance.kind !== 'explicit-adaptation' || unknownProvenance.adaptationId !== field.adaptationId) {
        context.addIssue({ code: 'custom', path: ['unknownPolicy', 'value', 'fields', index], message: 'Afirmar qué sabe el personaje requiere una adaptación explícita con la misma identidad' });
      }
      const linkedAntecedentIds = new Set<string>();
      for (const [antecedentIndex, antecedentId] of field.antecedentIds.entries()) {
        if (linkedAntecedentIds.has(antecedentId)) {
          context.addIssue({
            code: 'custom', path: ['unknownPolicy', 'value', 'fields', index, 'antecedentIds', antecedentIndex],
            message: 'La excepción de conocimiento no puede repetir antecedentes',
          });
        }
        linkedAntecedentIds.add(antecedentId);
        const antecedent = character.antecedents.value.find((item) => item.antecedentId === antecedentId);
        if (antecedent === undefined
          || antecedent.provenance.kind !== 'explicit-adaptation'
          || antecedent.provenance.adaptationId !== field.adaptationId) {
          context.addIssue({
            code: 'custom', path: ['unknownPolicy', 'value', 'fields', index, 'antecedentIds', antecedentIndex],
            message: 'La excepción de conocimiento debe enlazar un antecedente presente, curado con la misma adaptación explícita',
          });
        }
      }
    }
  }
}

export const PreparedCharacterSchema = PreparedCharacterObjectSchema.superRefine(addPreparedCharacterIssues);
export type PreparedCharacter = z.infer<typeof PreparedCharacterSchema>;

export const SpanishVarietyForActingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('proposed'), label: z.string().min(1).max(300), source: z.literal('editorial-proposal') }),
  z.strictObject({
    kind: z.literal('confirmed'),
    label: z.string().min(1).max(300),
    source: z.literal('operator'),
    confirmedBy: z.string().min(1).max(200),
    confirmedAt: z.string().datetime({ offset: true }),
  }),
]);
export type SpanishVarietyForActing = z.infer<typeof SpanishVarietyForActingSchema>;

/** Identifies the exact actor and fictional cut requested from the host projection port. */
export const ActorWorldProjectionRequestSchema = z.strictObject({
  actorId: CharacterIdSchema,
  identityVersion: RevisionSchema,
  runId: RunIdSchema,
  continuity: ContinuityReferenceSchema,
  expectedWorldRevision: RevisionSchema,
  atWorldSeq: WorldSeqSchema,
  fictionalAt: FictionalInstantSchema,
  /** A claimed job carries its frozen inbox into prompt compilation. */
  actorJob: z.strictObject({
    jobId: JobIdSchema,
    generation: RevisionSchema,
    ownerToken: z.string().uuid(),
    claimToken: z.string().uuid(),
  }).optional(),
});
export type ActorWorldProjectionRequest = z.infer<typeof ActorWorldProjectionRequestSchema>;

