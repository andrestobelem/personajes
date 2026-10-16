import {z} from 'zod';
import {DossierSchema} from './catalog.ts';
import {DossierSourceReferenceSchema,DossierSourceSchema} from './dossier-source.ts';
import {SelectableInferenceProfileSchema} from './inference-profile.ts';
import {IcmWorkspaceSnapshotStructureSchema,IcmContextPacketSourceRefStructureSchema} from './icm-workspace-schema.ts';
import {RunBudgetSchema,RunConfigurationDraftSchema,WorldPreparationCandidateSchema,DramaticLineSchema,DramaticReferencesSchema,CircadianPolicySchema,NarrationModeSchema} from './production.ts';
import {AdmittedAntecedentSchema,CuratedIdentitySchema,VoiceProfileSchema,GoalSchema,RelationshipSchema,CapabilitySchema,InventoryItemSchema,UnknownFieldPolicySchema,ContinuityContextSchema,SpanishVarietyForActingSchema} from './preparation.ts';
import {WorldSnapshotSchema} from './world-schema.ts';
import {CharacterIdSchema,FictionalInstantSchema,HashSchema,JobIdSchema,ProposalIdSchema,RevisionSchema,RunIdSchema,SourceRefIdSchema} from './values.ts';

/** Host-only input contracts, not public admission endpoints. Integrity is
 * checked by the compiler; ownership/admission must come from the future ledger. */
export const PreparationConfiguratorRequestSchema=z.strictObject({
  kind:z.literal('preparation-configurator-request'),schemaVersion:z.literal(1),
  runId:RunIdSchema,draftRevision:RevisionSchema,draftHash:HashSchema,
  jobId:JobIdSchema,generation:RevisionSchema,instructions:z.string().trim().min(1).max(16000),
  actorSources:z.array(DossierSourceReferenceSchema).max(1000),
  documentIds:z.array(SourceRefIdSchema).max(100),
});
export const PreparationConfiguratorDocumentSchema=z.strictObject({sourceId:SourceRefIdSchema,text:z.string().max(200000),fullHash:HashSchema});
export const PreparationConfiguratorContextBodySchema=z.strictObject({
  kind:z.literal('preparation-configurator-context'),schemaVersion:z.literal(1),
  request:PreparationConfiguratorRequestSchema,draft:RunConfigurationDraftSchema,
  profile:SelectableInferenceProfileSchema,budget:RunBudgetSchema,workspace:IcmWorkspaceSnapshotStructureSchema,
  actorSources:z.array(DossierSourceSchema).max(1000),documents:z.array(PreparationConfiguratorDocumentSchema).max(100),
});
export const PreparationConfiguratorContextSchema=PreparationConfiguratorContextBodySchema.extend({contextHash:HashSchema});
export type PreparationConfiguratorContext=z.infer<typeof PreparationConfiguratorContextSchema>;
/** Projection for the model: the durable snapshot remains complete, while ICM
 * contracts from other audiences contribute metadata only, never their bytes. */
export const PreparationConfiguratorModelContextSchema=z.strictObject({
  ...PreparationConfiguratorContextBodySchema.shape,kind:z.literal('preparation-configurator-model-context'),contextHash:HashSchema,
  draft:RunConfigurationDraftSchema.omit({icmWorkspace:true}),
  workspace:z.strictObject({snapshotHash:HashSchema,sources:z.array(IcmContextPacketSourceRefStructureSchema).max(512)}),
});

const Explanation={reason:z.string().trim().min(1).max(4000),sourceRefs:z.array(SourceRefIdSchema).max(1000),
  treatment:z.enum(['documentary-selection','declared-adaptation']),unknowns:z.array(z.string().min(1).max(4000)).max(1000)};
function suggestion<const K extends string,const S extends z.ZodType>(section:K,value:S){return z.strictObject({section:z.literal(section),value,...Explanation});}

// The model cannot stamp confirmations, authors, administrative seals or revisions,
// memories, actor minds, prepared identities, or human participant profiles.
// Exact context/source hashes in the envelope bind to host inputs, not new authority.
export const PreparationContinuitySuggestionSchema=z.strictObject({
  ...ContinuityContextSchema.shape,
  contentHash:z.never().optional(),
  inclusions:z.array(z.strictObject({inclusionId:ContinuityContextSchema.shape.inclusions.element.shape.inclusionId,
    label:ContinuityContextSchema.shape.inclusions.element.shape.label,sourceRefs:ContinuityContextSchema.shape.inclusions.element.shape.sourceRefs})).max(10000),
}).omit({contentHash:true,revision:true});
const physicalEntities=z.array(z.union([WorldSnapshotSchema.shape.entities.element.options[1],WorldSnapshotSchema.shape.entities.element.options[2]])).max(100000);
export const PreparationWorldLayoutSuggestionSchema=z.strictObject({
  clock:WorldSnapshotSchema.shape.clock.optional(),places:WorldPreparationCandidateSchema.shape.places,
  doors:WorldPreparationCandidateSchema.shape.doors,connections:WorldPreparationCandidateSchema.shape.connections,
  perceptualPaths:WorldPreparationCandidateSchema.shape.perceptualPaths,channels:WorldPreparationCandidateSchema.shape.channels,
  entities:physicalEntities.optional(),inventory:WorldPreparationCandidateSchema.shape.inventory,
  scenes:WorldPreparationCandidateSchema.shape.scenes,activeSceneId:WorldPreparationCandidateSchema.shape.activeSceneId,
  actionDurations:WorldPreparationCandidateSchema.shape.actionDurations,
});
export const PreparationSettingSuggestionSchema=z.discriminatedUnion('section',[
  suggestion('name',z.string().trim().min(1).max(120)),suggestion('fictionalAt',FictionalInstantSchema),
  suggestion('continuity',PreparationContinuitySuggestionSchema),suggestion('worldLayout',PreparationWorldLayoutSuggestionSchema),
  suggestion('dramaticLine',DramaticLineSchema),suggestion('dramaticReferences',DramaticReferencesSchema),
  suggestion('circadianPolicy',CircadianPolicySchema),suggestion('spanishVariety',SpanishVarietyForActingSchema.options[0]),
  suggestion('narrationMode',NarrationModeSchema),suggestion('maxReformulations',z.number().int().min(0).max(2)),
  suggestion('audio',z.strictObject({kind:z.enum(['disabled','enabled'])})),
]);
const antecedent=z.strictObject({antecedentId:AdmittedAntecedentSchema.shape.antecedentId,kind:AdmittedAntecedentSchema.shape.kind,
  statement:AdmittedAntecedentSchema.shape.statement,applicability:AdmittedAntecedentSchema.shape.applicability});
export const PreparationUnknownPolicySuggestionSchema=z.strictObject({defaultTreatment:z.literal('do-not-infer-or-assert'),fields:z.array(z.discriminatedUnion('kind',[
  UnknownFieldPolicySchema.options[0],
  z.strictObject({kind:z.literal('character-knowledge-adaptation'),topic:UnknownFieldPolicySchema.options[1].shape.topic,
    reason:UnknownFieldPolicySchema.options[1].shape.reason,antecedentIds:UnknownFieldPolicySchema.options[1].shape.antecedentIds}),
])).max(10000)});
export const PreparationActorSectionSuggestionSchema=z.discriminatedUnion('section',[
  suggestion('identity',CuratedIdentitySchema),suggestion('voice',VoiceProfileSchema),
  suggestion('antecedents',z.array(antecedent).max(10000)),suggestion('goals',z.array(GoalSchema).min(1).max(1000)),
  suggestion('relationships',z.array(RelationshipSchema).max(10000)),suggestion('capabilities',z.array(CapabilitySchema).min(1).max(1000)),
  suggestion('inventory',z.array(InventoryItemSchema).max(10000)),
  suggestion('initialExperience',z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('none')}),z.strictObject({kind:z.literal('preserve-existing')})])),
  suggestion('unknownPolicy',PreparationUnknownPolicySuggestionSchema),
]);
const character=WorldSnapshotSchema.shape.entities.element.options[0];
export const PreparationActorPlacementSuggestionSchema=z.strictObject({
  characterId:CharacterIdSchema,trueDisplayName:character.shape.trueDisplayName,species:character.shape.species,presentation:character.shape.presentation,
  placeId:character.shape.placeId,position:character.shape.position,collisionRadius:character.shape.collisionRadius,blocksMovement:character.shape.blocksMovement,
  presence:character.shape.presence,availability:character.shape.availability,routine:character.shape.routine,
  recognizedCharacterIds:z.array(CharacterIdSchema).max(10000),...Explanation,
});
export const PreparationActorSuggestionSchema=z.strictObject({characterId:CharacterIdSchema,sourceFullHash:HashSchema,
  sections:z.array(PreparationActorSectionSuggestionSchema).max(9),
  unknowns:DossierSchema.shape.unknowns,contradictions:DossierSchema.shape.contradictions,
  contradictionTreatments:z.array(z.strictObject({contradiction:z.string().min(1).max(2000),reason:Explanation.reason,sourceRefs:Explanation.sourceRefs})).max(1000).describe('Sólo trata contradicciones PREVIAMENTE curadas en la identidad de este actor que la identidad propuesta elimina: exactamente un tratamiento por contradicción eliminada, con motivo y referencias admitidas; la identidad debe declararse como adaptación. Usar [] si no existe identidad curada previa o si no se elimina ninguna de sus contradicciones. Las contradicciones documentales del dossier se conservan en actors[].contradictions; no generan tratamientos por sí mismas.')});
export const PreparationConfiguratorProposalSchema=z.strictObject({
  kind:z.literal('preparation-configurator-proposal'),schemaVersion:z.literal(1),contextHash:HashSchema,
  settings:z.array(PreparationSettingSuggestionSchema).max(11),actors:z.array(PreparationActorSuggestionSchema).max(1000),
  placements:z.array(PreparationActorPlacementSuggestionSchema).max(1000),
  openQuestions:z.array(z.string().trim().min(1).max(4000)).max(1000),
});
export type PreparationConfiguratorProposal=z.infer<typeof PreparationConfiguratorProposalSchema>;
export const PreparationConfiguratorReviewSchema=z.strictObject({
  kind:z.literal('preparation-configurator-review'),schemaVersion:z.literal(1),state:z.literal('proposed-only'),
  proposalId:ProposalIdSchema,contextHash:HashSchema,proposalHash:HashSchema,
  baseDraftHash:HashSchema,baseDraft:RunConfigurationDraftSchema,proposal:PreparationConfiguratorProposalSchema,
  changes:z.strictObject({
    settings:z.array(z.strictObject({kind:z.literal('proposed'),source:z.literal('configurator'),proposalId:ProposalIdSchema,suggestion:PreparationSettingSuggestionSchema})).max(11),
    actors:z.array(z.strictObject({kind:z.literal('proposed'),source:z.literal('configurator'),proposalId:ProposalIdSchema,suggestion:PreparationActorSuggestionSchema})).max(1000),
    placements:z.array(z.strictObject({kind:z.literal('proposed'),source:z.literal('configurator'),proposalId:ProposalIdSchema,suggestion:PreparationActorPlacementSuggestionSchema})).max(1000),
  }),
});

export {PreparationConfiguratorSelectionSchema} from './preparation-configurator-selection.ts';
export type {PreparationConfiguratorSelection} from './preparation-configurator-selection.ts';
