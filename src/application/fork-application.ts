import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { ForkJobSchema,type ForkJob } from '../domain/fork-job.ts';
import { ForkBeginRequestSchema,ForkBeginResultSchema,ForkJobViewSchema,ForkReadRequestSchema,ForkRetryRequestSchema,ForkRetryResultSchema } from '../domain/fork-http.ts';

type RetryRequest=z.infer<typeof ForkRetryRequestSchema>;
export type ForkRuntimeApplicationPort={
 begin(request:z.infer<typeof ForkBeginRequestSchema>):unknown;
 retry(request:RetryRequest):unknown;
};
function callRuntime(work:()=>unknown){try{return work();}catch(error){if(error instanceof Error&&['FORK_RUNTIME_CLOSED','FORK_ADMISSIONS_SUSPENDED'].includes(error.message))return {kind:'dependencyUnavailable'};throw error;}}
function publicJob(raw:unknown){const {principalId:_principal,idempotencyKey:_key,...job}=ForkJobSchema.parse(raw);return ForkJobViewSchema.parse({kind:'fork-job',...job});}
/** Only the authenticated operator identity reaches the private journal. Reads never schedule work. */
export function createForkApplication(input:{journal:Pick<ReturnType<typeof openJournal>,'readForkJob'>;runtime?:ForkRuntimeApplicationPort}){
 return {
  begin(raw:unknown){
   const request=ForkBeginRequestSchema.parse(raw);if(input.runtime===undefined)return ForkBeginResultSchema.parse({kind:'dependencyUnavailable'});
   const runtime=input.runtime;const result=callRuntime(()=>runtime.begin(request));
   const success=z.object({kind:z.enum(['created','existing']),job:ForkJobSchema}).safeParse(result);
   return ForkBeginResultSchema.parse(success.success?{kind:success.data.kind,job:publicJob(success.data.job)}:result);
  },
  read(raw:unknown){const request=ForkReadRequestSchema.parse(raw);const job:ForkJob|undefined=input.journal.readForkJob(request);return job===undefined?{kind:'missing' as const}:{kind:'found' as const,job:publicJob(job)};},
  retry(raw:unknown){
   const request=ForkRetryRequestSchema.parse(raw);if(input.runtime===undefined)return ForkRetryResultSchema.parse({kind:'dependencyUnavailable'});
   const runtime=input.runtime;const result=callRuntime(()=>runtime.retry(request));
   const withJob=z.object({kind:z.enum(['updated','existing']),job:ForkJobSchema}).safeParse(result);
   if(withJob.success)return ForkRetryResultSchema.parse({kind:withJob.data.kind==='updated'?'created':'existing',job:publicJob(withJob.data.job)});
   const conflict=z.strictObject({kind:z.literal('conflict'),currentRevision:z.number().int().nonnegative()}).safeParse(result);
   return ForkRetryResultSchema.parse(conflict.success?{kind:'stale',currentRevision:conflict.data.currentRevision}:result);
  },
 };
}
export type ForkApplicationPort=ReturnType<typeof createForkApplication>;
