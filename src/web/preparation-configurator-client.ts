import {z} from 'zod';
import {RunIdSchema,JobIdSchema} from '../domain/values.ts';
import {ApiProblemSchema} from '../domain/http.ts';
import {PreparationConfiguratorIntentSchema,PreparationConfiguratorChoicesSchema,PreparationConfiguratorJobPageSchema,PreparationConfiguratorPublicJobSchema,PreparationConfiguratorPublicReviewSchema,preparationConfiguratorJobEtag,type PreparationConfiguratorIntent,type PreparationConfiguratorPublicJob,PreparationConfiguratorApplyIntentSchema,PreparationConfiguratorApplyReceiptSchema,preparationConfiguratorDraftEtag,type PreparationConfiguratorApplyIntent} from '../domain/preparation-configurator-http.ts';
import {bootstrapSession} from './client.ts';
import {canonicalJson} from '../domain/canonical-encoding.ts';

async function canonicalHash(value:unknown){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value)));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}

export class PreparationConfiguratorRejection extends Error{constructor(readonly status:number,readonly code:string){super('La operación de preparación fue rechazada.');}}
async function parse<T>(response:Response,schema:z.ZodType<T>):Promise<T>{
  // Session revocation is authoritative even for empty/HTML responses.
  if(response.status===401||response.status===403)throw new PreparationConfiguratorRejection(response.status,'PREPARATION_CONFIGURATOR_SESSION_REQUIRED');
  const value:unknown=await response.json();if(!response.ok){const problem=ApiProblemSchema.safeParse(value);if(response.status>=400&&response.status<500&&response.status!==408&&problem.success)throw new PreparationConfiguratorRejection(response.status,problem.data.error.code);throw new Error('Resultado de preparación incierto');}return schema.parse(value);
}
function validateJob(response:Response,job:PreparationConfiguratorPublicJob,anchor:{runId:string;jobId?:string}){if(job.scope.runId!==anchor.runId||anchor.jobId!==undefined&&job.scope.jobId!==anchor.jobId||response.headers.get('etag')!==preparationConfiguratorJobEtag(job))throw new Error('La respuesta corresponde a otro trabajo o revisión.');return job;}
export function createPreparationConfiguratorClient(request:typeof fetch=(url,init)=>fetch(url,init),bootstrap=bootstrapSession){
  async function get(path:string,signal:AbortSignal){await bootstrap();signal.throwIfAborted();return await request(path,{credentials:'same-origin',signal});}
  return Object.freeze({
    async choices(runId:string,signal:AbortSignal){const id=RunIdSchema.parse(runId),response=await get(`/api/v1/runs/${id}/preparation-configurator/choices`,signal),choices=await parse(response,PreparationConfiguratorChoicesSchema);if(choices.runId!==id)throw new Error('Las fuentes corresponden a otra preparación.');return choices;},
    async list(runId:string,signal:AbortSignal,pagination:{limit?:number;offset?:number}={}){const id=RunIdSchema.parse(runId),query=z.strictObject({limit:z.number().int().min(1).max(100).default(50),offset:z.number().int().nonnegative().max(100000).default(0)}).parse(pagination),response=await get(`/api/v1/runs/${id}/preparation-configurator?limit=${query.limit}&offset=${query.offset}`,signal),page=await parse(response,PreparationConfiguratorJobPageSchema);if(page.runId!==id||page.items.some(job=>job.scope.runId!==id))throw new Error('El historial corresponde a otra preparación.');return page;},
    async read(input:{runId:string;jobId:string},signal:AbortSignal){const runId=RunIdSchema.parse(input.runId),jobId=JobIdSchema.parse(input.jobId),response=await get(`/api/v1/preparation-configurator/${jobId}`,signal);return validateJob(response,await parse(response,PreparationConfiguratorPublicJobSchema),{runId,jobId});},
    async review(input:{runId:string;jobId:string},signal:AbortSignal){const runId=RunIdSchema.parse(input.runId),jobId=JobIdSchema.parse(input.jobId),response=await get(`/api/v1/preparation-configurator/${jobId}/review`,signal),review=await parse(response,PreparationConfiguratorPublicReviewSchema);validateJob(response,review.job,{runId,jobId});if(review.proposal!==null&&await canonicalHash(review.proposal)!==review.proposalHash)throw new Error('La propuesta no coincide con su hash confirmado.');signal.throwIfAborted();return review;},
    async execute(raw:PreparationConfiguratorIntent,signal:AbortSignal){const intent=PreparationConfiguratorIntentSchema.parse(raw),session=await bootstrap();signal.throwIfAborted();
      const base={'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':intent.idempotencyKey};
      const path=intent.kind==='create'?`/api/v1/runs/${intent.runId}/preparation-configurator`:`/api/v1/preparation-configurator/${intent.job.scope.jobId}${intent.kind==='start'?'/start':''}`;
      const response=await request(path,{method:intent.kind==='cancel'?'DELETE':'POST',credentials:'same-origin',signal,headers:intent.kind==='create'?base:{...base,'If-Match':preparationConfiguratorJobEtag(intent.job)},body:JSON.stringify(intent.kind==='create'?intent.body:{})});
      const job=validateJob(response,await parse(response,PreparationConfiguratorPublicJobSchema),{runId:intent.runId,...(intent.kind==='create'?{}:{jobId:intent.job.scope.jobId})});
      const expected=intent.kind==='create'?intent.body:intent.job.scope;
      if(job.scope.draftRevision!==expected.draftRevision||job.scope.draftHash!==expected.draftHash||intent.kind!=='create'&&job.scope.contextHash!==intent.job.scope.contextHash)throw new Error('La operación cambió el corte de preparación.');return job;
    },
    async apply(raw:PreparationConfiguratorApplyIntent,signal:AbortSignal){const intent=PreparationConfiguratorApplyIntentSchema.parse(raw),session=await bootstrap();signal.throwIfAborted();const response=await request(`/api/v1/preparation-configurator/${intent.jobId}/apply`,{method:'POST',credentials:'same-origin',signal,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':intent.idempotencyKey,'If-Match':preparationConfiguratorDraftEtag({runId:intent.runId,...intent.body})},body:JSON.stringify(intent.body)});
      const receipt=await parse(response,PreparationConfiguratorApplyReceiptSchema);if(receipt.jobId!==intent.jobId||receipt.runId!==intent.runId||receipt.candidateId!==intent.body.candidateId||receipt.proposalHash!==intent.body.proposalHash||receipt.baseDraftRevision!==intent.body.draftRevision||receipt.baseDraftHash!==intent.body.draftHash||receipt.selectionHash!==await canonicalHash(intent.body.selection))throw new Error('El recibo corresponde a otra aplicación, selección o borrador.');signal.throwIfAborted();return receipt;
    },
  });
}
export type PreparationConfiguratorClient=ReturnType<typeof createPreparationConfiguratorClient>;
