import { z } from 'zod';
import { DossierSchema } from './catalog.ts';
import { CuratedIdentitySchema, PreparedCharacterSchema } from './preparation.ts';
import { AdministrativeRunScopeSchema } from './admin-roles.ts';
import { SelectableInferenceProfileSchema } from './inference-profile.ts';
import { ActorMindSchema, WorldEventSchema } from './world-schema.ts';
import { CharacterIdSchema, HashSchema, RevisionSchema, WorldSeqSchema } from './values.ts';

export const ConfiguratorScopeSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('preparation'),operationId:z.string().uuid(),profile:SelectableInferenceProfileSchema}),
  z.strictObject({kind:z.literal('evolution'),scope:AdministrativeRunScopeSchema}),
]);
export const ConfiguratorEvidenceSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('confirmed-event'),evidenceId:z.string().uuid(),event:WorldEventSchema,fullHash:HashSchema}),
  z.strictObject({kind:z.literal('committed-character-state'),evidenceId:z.string().uuid(),characterId:CharacterIdSchema,worldRevision:RevisionSchema,commitIndex:RevisionSchema,worldSeq:WorldSeqSchema,mind:ActorMindSchema,fullHash:HashSchema}),
]);
export const ConfiguratorContextSchema=z.strictObject({
  kind:z.literal('configurator-context'),schemaVersion:z.literal(1),role:z.literal('configurator'),scope:ConfiguratorScopeSchema,
  source:DossierSchema,target:DossierSchema,sourceFullHash:HashSchema,targetFullHash:HashSchema,
  preparedCharacter:PreparedCharacterSchema.optional(),
  documents:z.array(z.strictObject({sourceId:z.string().min(1).max(200),text:z.string().max(2000000),fullHash:HashSchema})).max(100),
  evolutionEvidence:z.array(ConfiguratorEvidenceSchema).max(1000),
});
const proposalBase={sourceRevision:RevisionSchema,targetRevision:RevisionSchema,sourceHash:HashSchema,targetHash:HashSchema,
  sourceFullHash:HashSchema,targetFullHash:HashSchema,reason:z.string().trim().min(1).max(8000),
  evidenceIds:z.array(z.string().uuid()).max(1000),sourceIds:z.array(z.string().min(1).max(200)).max(100),
};
export const ConfiguratorProposalSchema=z.discriminatedUnion('kind',[
  z.strictObject({...proposalBase,kind:z.literal('dossier-adaptation-proposal'),dossier:DossierSchema,
    unknownTreatments:z.array(z.strictObject({unknown:z.string().min(1).max(4000),kind:z.literal('declared-adaptation'),statement:z.string().min(1).max(8000)})).max(20000)}),
  z.strictObject({...proposalBase,kind:z.literal('identity-promotion-proposal'),expectedIdentityVersion:RevisionSchema,
    identity:CuratedIdentitySchema,effectiveBoundary:z.literal('future-coherent-boundary'),unknowns:z.array(z.string().max(4000)).max(20000)}),
]);
export const ConfiguratorApprovalSchema=z.strictObject({kind:z.literal('operator-consent'),proposalHash:HashSchema,contextHash:HashSchema,
  targetFullHash:HashSchema,operatorId:z.string().min(1).max(200),operationId:z.string().uuid(),confirmedAt:z.string().datetime({offset:true})});
export type ConfiguratorContext=z.infer<typeof ConfiguratorContextSchema>;
