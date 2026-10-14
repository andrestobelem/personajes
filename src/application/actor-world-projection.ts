import { z } from 'zod';
import {
  ActorKnowledgeSchema, WorldPerceptionSchema, WorldSnapshotSchema,
  buildActorWorldView,
} from '../domain/world.ts';
import type { WorldIdSource } from '../domain/world.ts';
import { ActorWorldProjectionRequestSchema, ContinuityReferenceSchema } from '../domain/preparation.ts';
import type { ActorWorldProjectionRequest } from '../domain/preparation.ts';
import {
  CharacterIdSchema, PerceptionIdSchema, RevisionSchema, WorldSeqSchema,
} from '../domain/values.ts';

import { ActorFacingWorldViewSchema, ActorWorldProjectionSchema } from '../domain/actor-world-projection.ts';
export { ActorFacingWorldViewSchema, ActorWorldProjectionSchema } from '../domain/actor-world-projection.ts';
import type { ActorWorldProjection } from '../domain/actor-world-projection.ts';
export type { ActorFacingWorldView, ActorWorldProjection } from '../domain/actor-world-projection.ts';

const ActorWorldHostCutSchema = z.strictObject({
  kind: z.literal('actor-world-host-cut'),
  continuity: ContinuityReferenceSchema,
  snapshot: WorldSnapshotSchema,
  knowledgeRevision: RevisionSchema,
  knowledge: ActorKnowledgeSchema,
  /** Only perceptions confirmed delivered to this actor and admitted through the requested cut. */
  pendingPerceptions: z.array(WorldPerceptionSchema).max(100_000),
  pendingPerceptionIds: z.array(PerceptionIdSchema).max(100_000),
});

const KnowledgeWriteSchema = z.strictObject({
  kind: z.literal('actor-knowledge-cas'),
  actorId: CharacterIdSchema,
  runId: ActorKnowledgeSchema.shape.runId,
  expectedWorldRevision: RevisionSchema,
  expectedWorldSeq: WorldSeqSchema,
  expectedContinuity: ContinuityReferenceSchema,
  expectedKnowledgeRevision: RevisionSchema,
  knowledge: ActorKnowledgeSchema,
}).superRefine((write, context) => {
  if (write.knowledge.actorId !== write.actorId || write.knowledge.runId !== write.runId) {
    context.addIssue({ code: 'custom', path: ['knowledge'], message: 'El conocimiento CAS no pertenece al actor/corrida del comando' });
  }
});

const KnowledgeWriteReceiptSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stored'), knowledgeRevision: RevisionSchema }),
  z.strictObject({ kind: z.literal('conflict') }),
]);

export type ActorWorldProjectionHostPort = {
  /** Loads one immutable World cut plus host-owned actor knowledge and delivered perceptions. */
  loadActorWorldCut(input: ActorWorldProjectionRequest): Promise<unknown>;
  /** Atomically persists opaque-handle knowledge only while both World and knowledge revisions match. */
  compareAndSwapActorKnowledge(input: unknown): Promise<unknown>;
};

export type ActorWorldProjectionPort = {
  projectForActor(input: ActorWorldProjectionRequest): Promise<unknown>;
};

function sameContinuity(
  left: z.infer<typeof ContinuityReferenceSchema>,
  right: z.infer<typeof ContinuityReferenceSchema>,
): boolean {
  return left.continuityId === right.continuityId
    && left.revision === right.revision
    && left.contentHash === right.contentHash;
}

function validateHostCut(input: {
  request: ActorWorldProjectionRequest;
  cut: z.infer<typeof ActorWorldHostCutSchema>;
}): void {
  const { request, cut } = input;
  if (cut.snapshot.runId !== request.runId
    || cut.snapshot.revision !== request.expectedWorldRevision
    || cut.snapshot.seq !== request.atWorldSeq
    || cut.snapshot.clock.instant !== request.fictionalAt
    || cut.knowledge.runId !== request.runId
    || cut.knowledge.actorId !== request.actorId
    || !sameContinuity(cut.continuity, request.continuity)) {
    throw new Error('El host no devolvió la corrida, continuidad o corte ficticio exactos solicitados');
  }
  const actor = cut.snapshot.entities.find((entity) => entity.kind === 'character' && entity.characterId === request.actorId);
  if (actor?.kind !== 'character'
    || actor.preparation.kind !== 'prepared'
    || actor.preparation.continuityId !== request.continuity.continuityId
    || actor.preparation.identityVersion !== request.identityVersion) {
    throw new Error('El actor del snapshot no usa la identidad y continuidad preparadas para esta compilación');
  }
  const seenPerceptions = new Set<string>();
  const cutIds = new Set(cut.pendingPerceptionIds);
  if (cutIds.size !== cut.pendingPerceptionIds.length
    || cut.pendingPerceptions.length !== cut.pendingPerceptionIds.length
    || cut.pendingPerceptions.some((perception) => !cutIds.has(perception.id))) {
    throw new Error('El cursor de inbox no coincide con las percepciones proyectadas');
  }
  for (const perception of cut.pendingPerceptions) {
    if (perception.runId !== request.runId || perception.recipientCharacterId !== request.actorId) {
      throw new Error('El host incluyó una percepción no dirigida a este actor y corrida');
    }
    if (seenPerceptions.has(perception.id)) throw new Error('El host duplicó una percepción pendiente');
    seenPerceptions.add(perception.id);
    if ('fictitiousAt' in perception && perception.fictitiousAt > request.fictionalAt) {
      throw new Error('El host incluyó una percepción posterior al corte ficticio');
    }
  }
}

/**
 * Builds an actor-facing projection and persists any newly allocated opaque handles
 * before the projection can leave the host boundary.
 */
export function createActorWorldProjectionPort(input: {
  host: ActorWorldProjectionHostPort;
  ids: WorldIdSource;
}): ActorWorldProjectionPort {
  return {
    async projectForActor(rawRequest: ActorWorldProjectionRequest): Promise<ActorWorldProjection> {
      const request = ActorWorldProjectionRequestSchema.parse(rawRequest);
      const cut = ActorWorldHostCutSchema.parse(await input.host.loadActorWorldCut(request));
      validateHostCut({ request, cut });

      const built = buildActorWorldView({
        snapshot: cut.snapshot,
        actorId: request.actorId,
        knowledge: cut.knowledge,
        pendingPerceptions: cut.pendingPerceptions,
        ids: input.ids,
      });
      if (built.view.revision !== cut.snapshot.revision || built.view.now.instant !== request.fictionalAt) {
        throw new Error('El proyector World no conservó la revisión y el instante exactos del corte');
      }
      const { beliefs, experiences, ...selfWithoutPrivateMemory } = built.view.self;
      void beliefs;
      void experiences;
      const world = ActorFacingWorldViewSchema.parse({
        ...built.view,
        self: selfWithoutPrivateMemory,
      });
      const projection = ActorWorldProjectionSchema.parse({
        kind: 'actor-world-projection',
        actorId: request.actorId,
        runId: request.runId,
        continuity: request.continuity,
        worldRevision: cut.snapshot.revision,
        atWorldSeq: request.atWorldSeq,
        fictionalAt: request.fictionalAt,
        inputPerceptionIds: cut.pendingPerceptionIds,
        world,
      });

      const write = KnowledgeWriteSchema.parse({
        kind: 'actor-knowledge-cas',
        actorId: request.actorId,
        runId: request.runId,
        expectedWorldRevision: cut.snapshot.revision,
        expectedWorldSeq: request.atWorldSeq,
        expectedContinuity: request.continuity,
        expectedKnowledgeRevision: cut.knowledgeRevision,
        knowledge: built.knowledge,
      });
      const expectedKnowledgeRevision = RevisionSchema.parse(cut.knowledgeRevision + 1);
      const receipt = KnowledgeWriteReceiptSchema.parse(await input.host.compareAndSwapActorKnowledge(write));
      if (receipt.kind === 'conflict') {
        throw new Error('Cambió el Escenario o el conocimiento del actor; debe recalcularse la proyección');
      }
      if (receipt.knowledgeRevision !== expectedKnowledgeRevision) {
        throw new Error('El host confirmó una revisión de conocimiento inesperada');
      }
      return projection;
    },
  };
}
