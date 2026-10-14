import { z } from 'zod';

const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'Se requiere UUID v4 en minúsculas',
);
const deterministicUuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'Se requiere UUID v5 en minúsculas',
);

export const RunIdSchema = uuid.brand<'RunId'>();
export const EventIdSchema = uuid.brand<'EventId'>();
export const HumanInterventionIdSchema = uuid.brand<'HumanInterventionId'>();
export const ExperienceIdSchema = uuid.brand<'ExperienceId'>();
export const PerceptionIdSchema = uuid.brand<'PerceptionId'>();
/** Proposal identity may be deterministically derived from a durable actor job. */
export const ProposalIdSchema = z.union([uuid, deterministicUuid]).brand<'ProposalId'>();
export const JobIdSchema = uuid.brand<'JobId'>();
export const PulseIdSchema = uuid.brand<'PulseId'>();
export const OperationIdSchema = uuid.brand<'OperationId'>();
export const CharacterIdSchema = z.string().min(1).max(80)
  .regex(/^[a-z0-9-]+$/).brand<'CharacterId'>();
export const HumanParticipantIdSchema = z.string().min(1).max(80)
  .regex(/^[a-z0-9-]+$/).brand<'HumanParticipantId'>();
export const EntityHandleSchema = z.string().min(1).max(120).brand<'EntityHandle'>();
export const SourceRefIdSchema = z.string().min(1).max(120).brand<'SourceRefId'>();
export const RevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  .brand<'Revision'>();
export const WorldSeqSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  .brand<'WorldSeq'>();
export const DurationMsSchema = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)
  .brand<'DurationMs'>();
export const FictionalInstantSchema = z.number().int()
  .min(-8_640_000_000_000_000).max(8_640_000_000_000_000)
  .brand<'FictionalInstant'>();
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/).brand<'ContentHash'>();

export type RunId = z.infer<typeof RunIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type HumanInterventionId = z.infer<typeof HumanInterventionIdSchema>;
export type ExperienceId = z.infer<typeof ExperienceIdSchema>;
export type CharacterId = z.infer<typeof CharacterIdSchema>;
export type HumanParticipantId = z.infer<typeof HumanParticipantIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;
export type PulseId = z.infer<typeof PulseIdSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type WorldSeq = z.infer<typeof WorldSeqSchema>;
export type DurationMs = z.infer<typeof DurationMsSchema>;

export function unreachable(value: never): never {
  void value;
  throw new Error('Variante interna sin manejar');
}
