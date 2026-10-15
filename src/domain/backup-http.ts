import { z } from 'zod';
import { BackupIdSchema } from './backup.ts';
import { HashSchema,RevisionSchema,RunIdSchema,WorldSeqSchema } from './values.ts';

/** Verified cut metadata only; never a bundle path or its private inventory. */
export const BackupSourcesSchema=z.strictObject({
 kind:z.literal('backup-sources'),backupId:BackupIdSchema,
 sources:z.array(z.strictObject({runId:RunIdSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,snapshotHash:HashSchema})).max(100000),
});
