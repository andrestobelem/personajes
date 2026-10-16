import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import {
  DramaticStructureEventSchema,
  DramaticStructureLookupResultSchema,
  DramaticStructureMutationResultSchema,
  DramaticStructureSceneOptionsSchema,
  DramaticStructureViewSchema,
  DramaticStructureWriteSchema,
} from '../domain/world-journal.ts';
import { DramaticStructurePresentationSchema } from '../domain/dramatic-structure.ts';
import { RunIdSchema, RevisionSchema, WorldSeqSchema } from '../domain/values.ts';
import { WorldSnapshotSchema } from '../domain/world-schema.ts';

const StructureReadRequestSchema = z.strictObject({ runId: RunIdSchema });
const StructureCutReadRequestSchema = z.strictObject({ runId: RunIdSchema, worldRevision: RevisionSchema, worldSeq: WorldSeqSchema });
const StructureEventsReadRequestSchema = z.strictObject({
  runId: RunIdSchema,
  afterStructureRevision: RevisionSchema.nullable().optional(),
  throughCommitIndex: RevisionSchema.nullable().optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
});
const StructureEventsPageSchema = z.strictObject({
  events: z.array(DramaticStructureEventSchema).max(1_000),
  hasMore: z.boolean(),
  structureRevision: RevisionSchema,
});
const StructureLookupRequestSchema = z.strictObject({
  runId: RunIdSchema,
  principalId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
});

type Journal = Pick<ReturnType<typeof openJournal>,
  'readDramaticStructure' | 'readDramaticStructureAtCut' | 'readDramaticStructureEvents' | 'readDramaticStructureOperation' | 'applyDramaticStructureCommand' | 'loadWorld' | 'readInspectorWorldCut'>;

function presentStructure(rawStructure: unknown, rawSnapshot: unknown) {
  const structure = DramaticStructureViewSchema.parse(rawStructure);
  const snapshot = WorldSnapshotSchema.parse(rawSnapshot);
  const assigned = new Set(structure.episodes.flatMap((episode) => episode.sceneIds));
  for (const scene of structure.unassignedLegacyScenes) assigned.add(scene.id);
  return DramaticStructurePresentationSchema.parse({
    ...structure,
    sceneLabels: snapshot.scenes.filter((scene) => assigned.has(scene.id)).map(({ id, label }) => ({ id, label })),
  });
}

/** Operator-facing dramatic structure, backed only by the journal's durable receipts. */
export function createDramaticStructureApplication(input: { journal: Journal }) {
  function read(rawInput: unknown) {
    const request = StructureReadRequestSchema.parse(rawInput);
    const value = input.journal.readDramaticStructure(request);
    if (value === undefined) return undefined;
    const snapshot = input.journal.loadWorld(request);
    if (snapshot === undefined) return undefined;
    return presentStructure(value, snapshot);
  }

  function readAtCut(rawInput: unknown) {
    const request = StructureCutReadRequestSchema.parse(rawInput);
    const value = input.journal.readDramaticStructureAtCut(request);
    if (value === undefined) return undefined;
    const cut = input.journal.readInspectorWorldCut({ runId: request.runId, atCommitIndex: value.commitIndex });
    if (cut === undefined) return undefined;
    return {
      ...presentStructure(value.structure, cut.snapshot),
      worldRevision: RevisionSchema.parse(value.worldRevision),
      worldSeq: WorldSeqSchema.parse(value.worldSeq),
      commitIndex: RevisionSchema.parse(value.commitIndex),
    };
  }

  function readSceneOptions(rawInput: unknown) {
    const request = StructureReadRequestSchema.parse(rawInput);
    const rawWorld = input.journal.loadWorld({ runId: request.runId });
    if (rawWorld === undefined) return undefined;
    const world = WorldSnapshotSchema.parse(rawWorld);
    return DramaticStructureSceneOptionsSchema.parse({
      runId: world.runId,
      worldRevision: world.revision,
      places: world.places.map((place) => ({ id: place.id, label: place.name })),
      participants: world.entities.flatMap((entity) => entity.kind === 'character' && entity.preparation.kind === 'prepared'
        ? [{ characterId: entity.characterId, label: entity.presentation.label, placeId: entity.placeId }]
        : []),
    });
  }

  function readEvents(rawInput: unknown) {
    const request = StructureEventsReadRequestSchema.parse(rawInput);
    const value = input.journal.readDramaticStructureEvents({
      runId: request.runId,
      afterStructureRevision: request.afterStructureRevision ?? null,
      throughCommitIndex: request.throughCommitIndex ?? null,
      limit: request.limit ?? 100,
    });
    return value === undefined ? undefined : StructureEventsPageSchema.parse(value);
  }

  function apply(rawInput: unknown) {
    const request = DramaticStructureWriteSchema.parse(rawInput);
    return DramaticStructureMutationResultSchema.parse(input.journal.applyDramaticStructureCommand(request));
  }

  function readOperation(rawInput: unknown) {
    const request = StructureLookupRequestSchema.parse(rawInput);
    return DramaticStructureLookupResultSchema.parse(input.journal.readDramaticStructureOperation(request));
  }

  return Object.freeze({ read, readAtCut, readSceneOptions, readEvents, apply, readOperation });
}
