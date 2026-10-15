import { z } from 'zod';
import { ConfiguratorApprovalSchema, ConfiguratorContextSchema, ConfiguratorProposalSchema } from '../domain/configurator.ts';
import { ForkSourceSchema } from '../domain/fork-origin.ts';
import { PreparedCharacterSchema } from '../domain/preparation.ts';
import { WorldSnapshotSchema } from '../domain/world-schema.ts';
import { WorldContinuityFenceSchema } from '../domain/world-journal.ts';
import { CharacterIdSchema, ExperienceIdSchema, HashSchema, RevisionSchema } from '../domain/values.ts';
import { ForkSourceDataSchema } from './fork-source.ts';
import { configuratorValueHash, validateConfiguratorApproval } from './configurator-context.ts';
import { compileConfiguratorEvolutionContext } from './configurator-evolution-context.ts';
import { ReadyRunConfigurationSchema, readyConfigurationAtSnapshot } from './production-preflight.ts';

export const PreparedIdentityPromotionSchema = z.strictObject({
  kind: z.literal('prepared-identity-promotion'),
  activation: z.literal('requires-durable-boundary-and-new-session-epoch'),
  nextCommitIndex: RevisionSchema,
  configuration: ReadyRunConfigurationSchema,
  continuityFence: WorldContinuityFenceSchema,
  snapshot: WorldSnapshotSchema,
  promotion: z.strictObject({
    characterId: CharacterIdSchema, source: ForkSourceSchema,
    sourcePreparedHash: HashSchema, preparedHash: HashSchema,
    previousIdentityVersion: RevisionSchema, identityVersion: RevisionSchema,
    contextHash: HashSchema, proposalHash: HashSchema,
    proposal: ConfiguratorProposalSchema,
    evidenceExperienceIds: z.array(ExperienceIdSchema).min(1),
    approval: ConfiguratorApprovalSchema,
  }),
});
const RequestSchema = z.strictObject({
  source: z.strictObject({ kind: z.literal('found'), ...ForkSourceDataSchema.shape }),
  context: ConfiguratorContextSchema,
  proposal: ConfiguratorProposalSchema,
  approval: ConfiguratorApprovalSchema,
});

/** Host-only pure transformation, never an authorization or an applied revision.
 * The future durable command must bind its authenticated consent and current
 * lifecycle/commit, persist both versions, and reserve the new Pi session epoch.
 * No event, perception, memory write, inference, file or session is created here.
 */
export function prepareIdentityPromotion(raw: unknown) {
  const request = RequestSchema.parse(raw);
  const { context, proposal, approval } = validateConfiguratorApproval(request);
  if (context.scope.kind !== 'evolution' || proposal.kind !== 'identity-promotion-proposal')
    throw new Error('IDENTITY_PROMOTION_EVOLUTION_REQUIRED');
  const scope = context.scope;
  const compiled = compileConfiguratorEvolutionContext({ source: request.source, originalDossier: context.source,
    scope: scope.scope, characterId: context.target.characterId });
  if (configuratorValueHash(compiled) !== configuratorValueHash(context))
    throw new Error('IDENTITY_PROMOTION_SOURCE_DIVERGED');
  const before = request.source.configuration;
  const prepared = before.roster.preparedCharacters.find(actor => actor.characterId === context.target.characterId);
  if (prepared === undefined || configuratorValueHash(prepared) !== scope.anchor.preparedContextHash)
    throw new Error('IDENTITY_PROMOTION_PREPARED_DIVERGED');
  if (configuratorValueHash(prepared.identity.value) === configuratorValueHash(proposal.identity))
    throw new Error('IDENTITY_PROMOTION_NO_CHANGE');
  const evidenceIds = new Set(proposal.evidenceIds);
  const experienceIds = [...new Set(context.evolutionEvidence.flatMap(item =>
    item.kind === 'admitted-experience' && evidenceIds.has(item.evidenceId) ? [item.experience.envelope.experienceId] : []))].sort();
  if (experienceIds.length === 0) throw new Error('IDENTITY_PROMOTION_LIVED_EVIDENCE_REQUIRED');
  const identityVersion = RevisionSchema.parse(prepared.identityVersion + 1);
  const continuity = { continuityId: prepared.continuity.continuityId, revision: prepared.continuity.revision,
    contentHash: prepared.continuity.contentHash };
  const nextPrepared = PreparedCharacterSchema.parse({ ...prepared, identityVersion, identity: {
    // The complete lived evidence/anchor is retained in promotion below.
    // experience-cut is reserved for initialExperience, not identity sections.
    value: proposal.identity, provenance: { kind: 'curator-declaration', dossierRevision: prepared.dossierRevision,
      dossierHash: prepared.dossierHash, continuity, reason: `Promoción futura de identidad ${approval.operationId}; motivo completo y evidencia subjetiva conservados en su propuesta versionada.`,
      authoredBy: approval.operatorId, createdAt: approval.confirmedAt, sourceRefs: [] },
  } });
  const snapshot = WorldSnapshotSchema.parse({ ...request.source.snapshot,
    revision: RevisionSchema.parse(request.source.snapshot.revision + 1),
    entities: request.source.snapshot.entities.map(entity => {
      if (entity.kind !== 'character' || entity.characterId !== prepared.characterId) return entity;
      if (entity.preparation.kind !== 'prepared' || entity.preparation.identityVersion !== prepared.identityVersion)
        throw new Error('IDENTITY_PROMOTION_WORLD_PREPARATION_DIVERGED');
      return { ...entity, preparation: { ...entity.preparation, identityVersion } };
    }),
  });
  const preparedCharacters = before.roster.preparedCharacters.map(actor => actor.characterId === prepared.characterId ? nextPrepared : actor);
  const configuration = readyConfigurationAtSnapshot(ReadyRunConfigurationSchema.parse({ ...before,
    configRevision: RevisionSchema.parse(before.configRevision + 1), roster: { ...before.roster, preparedCharacters },
    preparedActorFences: preparedCharacters.map(actor => ({ characterId: actor.characterId, identityVersion: actor.identityVersion,
      dossierRevision: actor.dossierRevision, dossierHash: actor.dossierHash, continuity: {
        continuityId: actor.continuity.continuityId, revision: actor.continuity.revision, contentHash: actor.continuity.contentHash,
      } })),
  }), snapshot);
  const contexts = snapshot.entities.flatMap(entity => {
    if (entity.kind !== 'character' || entity.preparation.kind !== 'prepared') return [];
    const actor = preparedCharacters.find(item => item.characterId === entity.characterId);
    if (actor === undefined || actor.identityVersion !== entity.preparation.identityVersion)
      throw new Error('IDENTITY_PROMOTION_FENCE_DIVERGED');
    return [{ actorId: actor.characterId, continuityId: actor.continuity.continuityId,
      continuityRevision: actor.continuity.revision, continuityContentHash: actor.continuity.contentHash,
      identityVersion: actor.identityVersion, preparedContextHash: configuratorValueHash(actor) }];
  });
  return PreparedIdentityPromotionSchema.parse({ kind: 'prepared-identity-promotion',
    activation: 'requires-durable-boundary-and-new-session-epoch', nextCommitIndex: scope.anchor.source.commitIndex + 1,
    configuration, snapshot, continuityFence: { kind: 'prepared-contexts', atWorldSeq: snapshot.seq, contexts },
    promotion: { characterId: prepared.characterId, source: scope.anchor.source,
      sourcePreparedHash: scope.anchor.preparedContextHash, preparedHash: configuratorValueHash(nextPrepared),
      previousIdentityVersion: prepared.identityVersion, identityVersion, contextHash: configuratorValueHash(context),
      proposalHash: configuratorValueHash(proposal), proposal, evidenceExperienceIds: experienceIds, approval },
  });
}
