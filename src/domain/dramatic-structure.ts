/** Browser-safe contracts for episodic and scene structure. Persistence/authority live in the journal and host. */
import { z } from 'zod';
import { ForkSourceSchema } from './fork-origin.ts';
import {
  CharacterIdSchema, EventIdSchema, HashSchema, RevisionSchema, RunIdSchema, WorldSeqSchema,
} from './values.ts';
import { PlaceIdSchema, SceneIdSchema, WorldSceneSchema } from './world-schema.ts';

const Uuid = z.string().uuid();
export const EpisodeIdSchema = Uuid.brand<'EpisodeId'>();
export const ActIdSchema = Uuid.brand<'ActId'>();

export const DramaticCutSchema = z.strictObject({
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  structureRevision: RevisionSchema,
  commitIndex: RevisionSchema,
});

export const DramaticLineEvidenceSchema = z.strictObject({
  lineId: z.string().trim().min(1).max(120),
  evidenceEventIds: z.array(EventIdSchema).min(1).max(1_000),
}).superRefine((line, context) => {
  if (new Set(line.evidenceEventIds).size !== line.evidenceEventIds.length) {
    context.addIssue({ code: 'custom', path: ['evidenceEventIds'], message: 'Evidencia duplicada para la línea dramática' });
  }
});

export const DramaticActViewSchema = z.strictObject({
  actId: ActIdSchema,
  ordinal: z.number().int().min(1).max(10_000),
  title: z.string().trim().min(1).max(200),
  sceneIds: z.array(SceneIdSchema).min(1).max(10_000),
});

export const DramaticEpisodeViewSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  ordinal: z.number().int().min(1).max(10_000),
  title: z.string().trim().min(1).max(200).nullable(),
  lifecycle: z.enum(['open', 'closed']),
  openingCut: DramaticCutSchema,
  closingCut: DramaticCutSchema.nullable(),
  consequenceEventIds: z.array(EventIdSchema).max(10_000),
  openLines: z.array(DramaticLineEvidenceSchema).max(10_000),
  sceneIds: z.array(SceneIdSchema).max(10_000),
  acts: z.array(DramaticActViewSchema).max(1_000),
  forkOrigins: z.array(z.strictObject({
    source: ForkSourceSchema, sourceStructureHash: HashSchema, episodeId: EpisodeIdSchema,
    openingCut: DramaticCutSchema, closingCut: DramaticCutSchema.nullable(),
    consequenceEventIds: z.array(EventIdSchema).max(10_000),
    openLines: z.array(DramaticLineEvidenceSchema).max(10_000),
  })).optional(),
});

/** Explicitly derived scenes from pre-v29 runs; migration never invents episodes or closures. */
export const DramaticStructureViewSchema = z.strictObject({
  runId: RunIdSchema,
  structureRevision: RevisionSchema,
  activeEpisodeId: EpisodeIdSchema.nullable(),
  activeSceneId: SceneIdSchema.nullable(),
  episodes: z.array(DramaticEpisodeViewSchema).max(10_000),
  unassignedLegacyScenes: z.array(WorldSceneSchema).max(10_000),
});

/** Presentation-only metadata from the confirmed world cut; excluded from durable structure hashes. */
export const DramaticStructurePresentationSchema = DramaticStructureViewSchema.extend({
  sceneLabels: z.array(z.strictObject({ id: SceneIdSchema, label: z.string().min(1).max(200) })).max(10_000).optional(),
});

export const DramaticStructureSceneOptionsSchema = z.strictObject({
  runId: RunIdSchema,
  worldRevision: RevisionSchema,
  places: z.array(z.strictObject({ id: PlaceIdSchema, label: z.string().min(1).max(200) })).max(10_000),
  participants: z.array(z.strictObject({ characterId: CharacterIdSchema, label: z.string().min(1).max(200), placeId: PlaceIdSchema })).max(100_000),
});

export const DramaticStructureEventSchema = z.strictObject({
  runId: RunIdSchema,
  structureRevision: RevisionSchema,
  operationId: Uuid,
  principalId: z.string().min(1).max(200),
  kind: z.enum(['episodeOpened', 'episodeClosed', 'sceneOpened', 'sceneClosed', 'actsSet']),
  payload: z.record(z.string(), z.unknown()),
  payloadHash: HashSchema,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  commitIndex: RevisionSchema,
  recordedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const DramaticStructureCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('openEpisode'), episodeId: EpisodeIdSchema, title: z.string().trim().min(1).max(200).optional() }),
  z.strictObject({
    kind: z.literal('closeEpisode'), episodeId: EpisodeIdSchema,
    consequenceEventIds: z.array(EventIdSchema).max(10_000),
    openLines: z.array(DramaticLineEvidenceSchema).max(10_000),
  }).superRefine((command, context) => {
    if (new Set(command.consequenceEventIds).size !== command.consequenceEventIds.length) context.addIssue({ code: 'custom', path: ['consequenceEventIds'], message: 'Consecuencia duplicada' });
    if (new Set(command.openLines.map((line) => line.lineId)).size !== command.openLines.length) context.addIssue({ code: 'custom', path: ['openLines'], message: 'Línea dramática duplicada' });
  }),
  z.strictObject({
    kind: z.literal('openScene'),
    scene: z.strictObject({ id: SceneIdSchema, label: z.string().trim().min(1).max(200), participantIds: z.array(CharacterIdSchema).min(1).max(100), placeIds: z.array(PlaceIdSchema).min(1).max(100) }),
  }).superRefine((command, context) => {
    if (new Set(command.scene.participantIds).size !== command.scene.participantIds.length) context.addIssue({ code: 'custom', path: ['scene', 'participantIds'], message: 'Participante duplicado' });
    if (new Set(command.scene.placeIds).size !== command.scene.placeIds.length) context.addIssue({ code: 'custom', path: ['scene', 'placeIds'], message: 'Lugar duplicado' });
  }),
  z.strictObject({ kind: z.literal('closeScene'), sceneId: SceneIdSchema, reason: z.string().trim().min(1).max(500) }),
  z.strictObject({
    kind: z.literal('setEpisodeActs'), episodeId: EpisodeIdSchema,
    acts: z.array(z.strictObject({ actId: ActIdSchema, title: z.string().trim().min(1).max(200), sceneIds: z.array(SceneIdSchema).min(1).max(10_000) })).max(1_000),
  }).superRefine((command, context) => {
    if (new Set(command.acts.map((act) => act.actId)).size !== command.acts.length) context.addIssue({ code: 'custom', path: ['acts'], message: 'Acto duplicado' });
    const sceneIds = command.acts.flatMap((act) => act.sceneIds);
    if (new Set(sceneIds).size !== sceneIds.length) context.addIssue({ code: 'custom', path: ['acts'], message: 'Una escena no puede pertenecer a varios actos' });
  }),
]);
export type DramaticStructureCommand = z.infer<typeof DramaticStructureCommandSchema>;

export const DramaticStructureWriteSchema = z.strictObject({
  runId: RunIdSchema,
  principalId: z.string().trim().min(1).max(200),
  operationId: Uuid,
  idempotencyKey: Uuid,
  expectedWorldRevision: RevisionSchema,
  expectedStructureRevision: RevisionSchema,
  command: DramaticStructureCommandSchema,
});

const DramaticStructureReceiptSchema = z.strictObject({
  operationId: Uuid,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  structureRevision: RevisionSchema,
  commitIndex: RevisionSchema,
  activeEpisodeId: EpisodeIdSchema.nullable(),
  activeSceneId: SceneIdSchema.nullable(),
});

export const DramaticStructureMutationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stored'), receipt: DramaticStructureReceiptSchema }),
  z.strictObject({ kind: z.literal('existing'), receipt: DramaticStructureReceiptSchema }),
  z.strictObject({ kind: z.literal('conflict'), worldRevision: RevisionSchema, structureRevision: RevisionSchema }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('invalidState'), code: z.enum([
    'runNotActive', 'episodeAlreadyOpen', 'episodeMissing', 'episodeNotOpen', 'episodeHasOpenScenes', 'episodeHasNoScenes',
    'sceneMissing', 'sceneAlreadyOpen', 'sceneNotOpen', 'noActiveScene', 'actorJobsActive', 'invalidParticipants',
    'invalidPlaceReference', 'invalidConsequenceReference', 'invalidActGrouping',
  ]) }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);

export const DramaticStructureLookupSchema = z.strictObject({ runId: RunIdSchema, principalId: z.string().trim().min(1).max(200), idempotencyKey: Uuid });
export const DramaticStructureLookupResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('found'), result: DramaticStructureMutationResultSchema }),
  z.strictObject({ kind: z.literal('idempotencyConflict') }),
]);
