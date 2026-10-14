import { z } from 'zod';
import { RunIdSchema, RevisionSchema, WorldSeqSchema } from './values.ts';
/** Read invalidation only. These revisions are not a durable SSE stream offset. */
export const RunRefreshSchema=z.strictObject({kind:z.literal('run.refresh'),runId:RunIdSchema,
 configRevision:RevisionSchema,worldRevision:RevisionSchema,lifecycleRevision:RevisionSchema,lastWorldSeq:WorldSeqSchema});
export type RunRefresh=z.infer<typeof RunRefreshSchema>;
