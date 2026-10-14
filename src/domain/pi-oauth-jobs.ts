import { z } from 'zod';
import { JobIdSchema, RevisionSchema } from './values.ts';

export const PiOAuthJobStateSchema = z.enum(['queued','running','cancel-requested','succeeded','failed','canceled','interrupted']);
export const PiOAuthJobSafeCodeSchema = z.enum(['oauth-error','oauth-unavailable','oauth-callback-failed','logout-error','user-canceled','host-interrupted']);
export const PiOAuthJobViewSchema = z.strictObject({jobId:JobIdSchema,provider:z.literal('openai-codex'),kind:z.enum(['login','logout']),state:PiOAuthJobStateSchema,revision:RevisionSchema,
  createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true}),safeCode:PiOAuthJobSafeCodeSchema.nullable()}).superRefine((job,context)=>{
  const expected=job.state==='canceled'?'user-canceled':job.state==='interrupted'?'host-interrupted':null;
  if((job.state==='failed'&&(job.safeCode===null||job.safeCode==='user-canceled'||job.safeCode==='host-interrupted'))
    ||(job.state!=='failed'&&job.safeCode!==expected))context.addIssue({code:'custom',path:['safeCode'],message:'Diagnóstico OAuth no coincide con estado'});
});
export const PiOAuthJobCreateSchema = z.strictObject({principalId:z.string().trim().min(1).max(200),idempotencyKey:z.string().uuid(),kind:z.enum(['login','logout'])});
export const PiOAuthJobCreateResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('created'),job:PiOAuthJobViewSchema}),z.strictObject({kind:z.literal('existing'),job:PiOAuthJobViewSchema}),z.strictObject({kind:z.literal('idempotencyConflict')}),
]);
export const PiOAuthJobLookupSchema = z.strictObject({jobId:JobIdSchema});
export const PiOAuthJobClaimSchema = z.strictObject({jobId:JobIdSchema,expectedRevision:RevisionSchema,ownerToken:z.string().uuid(),claimToken:z.string().uuid()});
export const PiOAuthJobClaimResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('claimed'),job:PiOAuthJobViewSchema,lease:z.strictObject({ownerToken:z.string().uuid(),claimToken:z.string().uuid()})}),
  z.strictObject({kind:z.literal('existing'),job:PiOAuthJobViewSchema,lease:z.strictObject({ownerToken:z.string().uuid(),claimToken:z.string().uuid()})}),
  z.strictObject({kind:z.literal('terminal'),job:PiOAuthJobViewSchema}),z.strictObject({kind:z.literal('stale'),job:PiOAuthJobViewSchema}),
  z.strictObject({kind:z.literal('busy')}),z.strictObject({kind:z.literal('missing')}),
]);
export const PiOAuthJobCompletionSchema = z.strictObject({jobId:JobIdSchema,expectedRevision:RevisionSchema,lease:z.strictObject({ownerToken:z.string().uuid(),claimToken:z.string().uuid()}),
  outcome:z.enum(['succeeded','failed','canceled']),safeCode:PiOAuthJobSafeCodeSchema.nullable().default(null)}).superRefine((request,context)=>{
  if((request.outcome==='succeeded'&&request.safeCode!==null)||(request.outcome==='canceled'&&request.safeCode!==null&&request.safeCode!=='user-canceled')
    ||(request.outcome==='failed'&&(request.safeCode===null||request.safeCode==='user-canceled'||request.safeCode==='host-interrupted')))context.addIssue({code:'custom',path:['safeCode'],message:'Outcome OAuth requiere diagnóstico seguro válido'});
});
export const PiOAuthJobCancelSchema = z.strictObject({principalId:z.string().trim().min(1).max(200),idempotencyKey:z.string().uuid(),jobId:JobIdSchema,expectedRevision:RevisionSchema});
export const PiOAuthJobMutationResultSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('updated'),job:PiOAuthJobViewSchema}),z.strictObject({kind:z.literal('existing'),job:PiOAuthJobViewSchema}),
  z.strictObject({kind:z.literal('terminal'),job:PiOAuthJobViewSchema}),z.strictObject({kind:z.literal('stale'),job:PiOAuthJobViewSchema}),
  z.strictObject({kind:z.literal('missing')}),z.strictObject({kind:z.literal('idempotencyConflict')}),
]);

