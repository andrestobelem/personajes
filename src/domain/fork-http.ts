import { z } from 'zod';
import { ForkJobSchema } from './fork-job.ts';
import { OperationIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from './values.ts';

export const ForkSourceSelectionSchema=z.strictObject({runId:RunIdSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema});
export const ForkBeginBodySchema=ForkSourceSelectionSchema.omit({runId:true}).extend({operationId:OperationIdSchema,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000)});
const publicShape=ForkJobSchema.options[0].omit({principalId:true,idempotencyKey:true}).shape;
export const ForkJobViewSchema=z.discriminatedUnion('state',[
 z.strictObject({...publicShape,kind:z.literal('fork-job'),state:z.literal('staging')}),
 z.strictObject({...publicShape,kind:z.literal('fork-job'),state:z.literal('ready'),publishedAt:z.number().int().nonnegative()}),
 z.strictObject({...publicShape,kind:z.literal('fork-job'),state:z.literal('failed'),code:ForkJobSchema.options[2].shape.code}),
]);
export type ForkJobView=z.infer<typeof ForkJobViewSchema>;
export const ForkBeginRequestSchema=ForkBeginBodySchema.extend({runId:RunIdSchema,principalId:z.string().trim().min(1).max(200),idempotencyKey:z.string().uuid()});
export const ForkReadRequestSchema=z.strictObject({operationId:OperationIdSchema,principalId:z.string().trim().min(1).max(200)});
export const ForkRetryRequestSchema=ForkReadRequestSchema.extend({expectedRevision:RevisionSchema,idempotencyKey:z.string().uuid()});
export const ForkBeginResultSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('created'),job:ForkJobViewSchema}),z.strictObject({kind:z.literal('existing'),job:ForkJobViewSchema}),
 z.strictObject({kind:z.literal('missing')}),z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['invalid-cut','checkpoint-not-recorded','configuration-not-ready'])}),
 z.strictObject({kind:z.literal('idempotencyConflict')}),z.strictObject({kind:z.literal('dependencyUnavailable')}),
]);
export const ForkRetryResultSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('created'),job:ForkJobViewSchema}),z.strictObject({kind:z.literal('existing'),job:ForkJobViewSchema}),
 z.strictObject({kind:z.literal('missing')}),z.strictObject({kind:z.literal('stale'),currentRevision:RevisionSchema}),z.strictObject({kind:z.literal('invalidState')}),
 z.strictObject({kind:z.literal('idempotencyConflict')}),z.strictObject({kind:z.literal('dependencyUnavailable')}),
]);
export function forkSourceEtag(source:z.input<typeof ForkSourceSelectionSchema>){return `"fork-source:${source.runId}:c${source.commitIndex}:w${source.worldRevision}:s${source.worldSeq}"`;}
export function forkJobEtag(job:{operationId:string;revision:number}){return `"fork:${job.operationId}:r${job.revision}"`;}
