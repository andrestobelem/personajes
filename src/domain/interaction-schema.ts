/** Browser-safe human participation contracts, separate from host world projection. */
import { z } from 'zod';
import { CharacterIdSchema, FictionalInstantSchema, HumanParticipantIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';
import { ChannelIdSchema, PlaceIdSchema, SceneIdSchema, HumanParticipantPresenceSchema } from './world-schema.ts';

const Utf8TextSchema = (maxBytes: number, minCodepoints = 0) => z.string().min(minCodepoints).refine(
  (text) => !text.includes('\0') && new TextEncoder().encode(text).byteLength <= maxBytes,
  `El texto debe ser UTF-8 válido de hasta ${maxBytes} bytes y no contener NUL`,
);

/** A user-authored fictional identity; it has no Pi actor or AI-controlled memory. */
export const HumanParticipantIdentitySchema = z.strictObject({
  participantId: HumanParticipantIdSchema,
  displayName: z.string().trim().min(1).max(120),
  identityMarkdown: Utf8TextSchema(32_768, 1),
  lifeStoryMarkdown: Utf8TextSchema(131_072, 1),
});
export type HumanParticipantIdentity = z.infer<typeof HumanParticipantIdentitySchema>;

export { HumanParticipantPresenceSchema } from './world-schema.ts';
export type { HumanParticipantPresence } from './world-schema.ts';

export const HumanParticipantProfileSchema = z.strictObject({
  identity: HumanParticipantIdentitySchema,
  presence: HumanParticipantPresenceSchema,
});
export type HumanParticipantProfile = z.infer<typeof HumanParticipantProfileSchema>;

const HumanSpeechTextSchema = Utf8TextSchema(16_384, 1);

/** Client payload only; the host derives speaker and origin from authenticated session mode. */
export const HumanInterventionRequestSchema = z.strictObject({
  kind: z.literal('speech'),
  /** Empty means broadcast; addressed channels require at least one recipient at resolution time. */
  recipientCharacterIds: z.array(CharacterIdSchema).max(100),
  channelId: ChannelIdSchema,
  content: z.strictObject({ kind: z.literal('speech'), text: HumanSpeechTextSchema }),
}).superRefine((request, context) => {
  if (new Set(request.recipientCharacterIds).size !== request.recipientCharacterIds.length) {
    context.addIssue({ code: 'custom', path: ['recipientCharacterIds'], message: 'No se puede repetir destinatario' });
  }
});

export type HumanInterventionRequest = z.infer<typeof HumanInterventionRequestSchema>;

export const HumanInteractionContextSchema = z.strictObject({
  kind: z.literal('human-interaction-context'),
  runId: RunIdSchema,
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  fictionalAt: FictionalInstantSchema,
  scene: z.strictObject({ id: SceneIdSchema, label: z.string().min(1).max(200) }),
  place: z.strictObject({ id: PlaceIdSchema, label: z.string().min(1).max(200) }),
  channel: z.strictObject({ id: ChannelIdSchema, label: z.string().min(1).max(120), scope: z.enum(['addressed', 'broadcast']) }),
  recipients: z.array(z.strictObject({ characterId: CharacterIdSchema, displayName: z.string().min(1).max(200) })).max(100),
});
export type HumanInteractionContext = z.infer<typeof HumanInteractionContextSchema>;

