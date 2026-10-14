import { z } from 'zod';
import {
  CharacterIdSchema,
  ExperienceIdSchema,
  HashSchema,
  RunIdSchema,
  WorldSeqSchema,
} from './values.ts';

/** ICM 0.11.4 assigns ULIDs; this schema validates the ID returned by its CLI. */
export const IcmMemoryIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u).brand<'IcmMemoryId'>();

/** Public ledger projection. All fields except memoryId are derived from its experience FK. */
export const MemoryProjectionReceiptSchema = z.strictObject({
  memoryId: IcmMemoryIdSchema,
  experienceId: ExperienceIdSchema,
  runId: RunIdSchema,
  actorId: CharacterIdSchema,
  worldSeq: WorldSeqSchema,
  canonicalPayload: z.string(),
  payloadHash: HashSchema,
});

export type IcmMemoryId = z.infer<typeof IcmMemoryIdSchema>;
export type MemoryProjectionReceipt = z.infer<typeof MemoryProjectionReceiptSchema>;
