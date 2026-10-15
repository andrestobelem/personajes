import {z} from 'zod';
import {configuratorValueHash,validateConfiguratorContext} from '../application/configurator-context.ts';
import type {SessionMode} from '../domain/http.ts';
import {RunIdSchema,RevisionSchema} from '../domain/values.ts';
import {IdentityPromotionApproveBodySchema,IdentityPromotionContextViewSchema,IdentityPromotionJobViewSchema,IdentityPromotionJobPageSchema,IdentityPromotionReviewSchema,IdentityPromotionStartBodySchema,identityPromotionContextEtag,identityPromotionJobEtag} from '../domain/identity-promotion-http.ts';
import {OperatorResponseSchema,operatorJson,type OperatorExtension,type OperatorRequest} from './operator-extension.ts';

export type IdentityPromotionAuthority={readonly principalId:string;readonly mode:SessionMode;readonly inspectionRunIds:readonly string[]};
type JobIdentity={jobId:string;authority:IdentityPromotionAuthority};
type JobWrite=JobIdentity&{expectedRevision:number;idempotencyKey:string};
export type IdentityPromotionApplicationPort={
 context(input:{runId:string;authority:IdentityPromotionAuthority}):unknown|Promise<unknown>;
 list(input:{runId:string;authority:IdentityPromotionAuthority}):unknown|Promise<unknown>;
 readJob(input:JobIdentity):unknown|undefined|Promise<unknown|undefined>;
 readReview(input:JobIdentity):unknown|Promise<unknown>;
 start(input:{runId:string;body:z.infer<typeof IdentityPromotionStartBodySchema>;ifMatch:string;idempotencyKey:string;authority:IdentityPromotionAuthority}):unknown|Promise<unknown>;
 approve(input:JobWrite&{body:z.infer<typeof IdentityPromotionApproveBodySchema>}):unknown|Promise<unknown>;
 retry(input:JobWrite):unknown|Promise<unknown>;
 reject(input:JobWrite):unknown|Promise<unknown>;
 cancel(input:JobWrite):unknown|Promise<unknown>;
};
function requireInspection(authority:IdentityPromotionAuthority,runId:string){if(!authority.inspectionRunIds.includes(runId))throw new Error('IDENTITY_PROMOTION_INSPECTION_REQUIRED');}
function requireDirector(authority:IdentityPromotionAuthority,runId:string){if(authority.mode.kind!=='director'||authority.mode.runId!==runId||authority.mode.scope.kind!=='run')throw new Error('IDENTITY_PROMOTION_DIRECTOR_REQUIRED');}
function jobRevision(request:OperatorRequest,jobId:string){const match=/^"configurator-job:([0-9a-f-]{36}):r(0|[1-9][0-9]{0,15})"$/.exec(request.ifMatch??'');if(match?.[1]!==jobId)throw new Error('IDENTITY_PROMOTION_IF_MATCH_REQUIRED');return RevisionSchema.parse(Number(match[2]));}

/** Inspection authority comes only from the HTTP session. Job metadata is read
 * first, so an unauthorized review never touches the private context/proposal. */
export function createIdentityPromotionRoutes(input:{application:()=>IdentityPromotionApplicationPort|undefined}):OperatorExtension{
 return {name:'identity-promotion',matches({path}){return (path[0]==='runs'&&path[2]==='identity-promotions'&&(path.length===3||(path.length===4&&path[3]==='context')))||path[0]==='identity-promotions';},
 async handle(request){
  try{
   z.strictObject({}).parse(Object.fromEntries(request.query));
   const application=input.application();if(application===undefined)throw new Error('IDENTITY_PROMOTION_UNAVAILABLE');
   const authority:IdentityPromotionAuthority={principalId:request.principalId,mode:request.mode,inspectionRunIds:request.inspectionRunIds??[]};
   if(request.path[0]==='runs'){
    const runId=RunIdSchema.parse(request.path[1]);
    if(request.path.length===3&&request.kind==='read'){
     const page=IdentityPromotionJobPageSchema.parse(await application.list({runId,authority}));if(page.items.some(job=>job.runId!==runId))throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');return operatorJson(page);
    }
    if(request.path.length===4&&request.path[3]==='context'&&request.kind==='read'){
     const context=IdentityPromotionContextViewSchema.parse(await application.context({runId,authority}));if(context.runId!==runId)throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');return operatorJson(context,200,{ETag:identityPromotionContextEtag(context)});
    }
    if(request.path.length===3&&request.kind==='write'&&request.method==='POST'){
     requireDirector(authority,runId);requireInspection(authority,runId);
     const body=IdentityPromotionStartBodySchema.parse(request.body);
     if(request.ifMatch===null)throw new Error('IDENTITY_PROMOTION_IF_MATCH_REQUIRED');
     const expected=identityPromotionContextEtag({runId,lifecycleRevision:body.expectedLifecycleRevision,commitIndex:body.expectedCommitIndex,worldRevision:body.expectedWorldRevision,worldSeq:body.expectedWorldSeq,configurationRevision:body.expectedConfigurationRevision});
     if(request.ifMatch!==expected)throw new Error('IDENTITY_PROMOTION_IF_MATCH_REQUIRED');
     const job=IdentityPromotionJobViewSchema.parse(await application.start({runId,body,ifMatch:request.ifMatch,idempotencyKey:request.idempotencyKey,authority}));if(job.runId!==runId||job.actorId!==body.actorId)throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');return operatorJson(job,202,{ETag:identityPromotionJobEtag(job),Location:`/api/v1/identity-promotions/${job.jobId}`});
    }
   }
   if(request.path[0]==='identity-promotions'&&request.path.length>=2&&request.path.length<=3){
    const jobId=z.uuid().parse(request.path[1]);const raw=await application.readJob({jobId,authority});if(raw===undefined)throw new Error('IDENTITY_PROMOTION_NOT_FOUND');
    const job=IdentityPromotionJobViewSchema.parse(raw);if(job.jobId!==jobId)throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');
    if(request.path.length===2&&request.kind==='read')return operatorJson(job,200,{ETag:identityPromotionJobEtag(job)});
    const action=request.path[2];
    if(request.path.length===3&&action==='review'&&request.kind==='read'){
     requireInspection(authority,job.runId);
     const review=IdentityPromotionReviewSchema.parse(await application.readReview({jobId,authority}));
     const context=validateConfiguratorContext(review.context);
     if(review.job.jobId!==jobId||review.job.runId!==job.runId||review.job.actorId!==job.actorId||context.scope.kind!=='evolution'||context.scope.scope.runId!==job.runId||context.scope.scope.jobId!==jobId||context.target.characterId!==job.actorId||configuratorValueHash(context.scope.anchor.source)!==configuratorValueHash(job.source)||configuratorValueHash(context)!==job.contextHash||review.targetFullHash!==context.targetFullHash||(review.proposal===null?review.proposalHash!==null:review.proposalHash!==configuratorValueHash(review.proposal)))throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');
     return operatorJson(review,200,{ETag:identityPromotionJobEtag(review.job)});
    }
    if(request.kind==='write'&&((request.path.length===2&&request.method==='DELETE')||(request.path.length===3&&request.method==='POST'&&['approve','retry','reject'].includes(action??'')))){
     requireDirector(authority,job.runId);requireInspection(authority,job.runId);
     const context={jobId,authority,expectedRevision:jobRevision(request,jobId),idempotencyKey:request.idempotencyKey};
     let result:unknown;
     if(action==='approve'){const body=IdentityPromotionApproveBodySchema.parse(request.body);result=await application.approve({...context,body});}
     else{z.strictObject({}).parse(request.body);result=await(request.method==='DELETE'?application.cancel(context):action==='retry'?application.retry(context):application.reject(context));}
     const updated=IdentityPromotionJobViewSchema.parse(result);if(updated.jobId!==jobId||updated.runId!==job.runId||updated.actorId!==job.actorId)throw new Error('IDENTITY_PROMOTION_SCOPE_INVALID');return operatorJson(updated,action==='retry'?202:200,{ETag:identityPromotionJobEtag(updated)});
    }
   }
   throw new Error('IDENTITY_PROMOTION_ROUTE_NOT_FOUND');
  }catch(error){
   const invalid=error instanceof z.ZodError;
   const code=invalid?'IDENTITY_PROMOTION_REQUEST_INVALID':error instanceof Error&&error.message.length<=80&&/^(?:IDENTITY_PROMOTION|CONFIGURATOR)_[A-Z_]{1,95}$/.test(error.message)?error.message:'IDENTITY_PROMOTION_FAILED';
   const forbidden=code.endsWith('INSPECTION_REQUIRED')||code.endsWith('DIRECTOR_REQUIRED');const missing=code.endsWith('NOT_FOUND');const precondition=code.includes('IF_MATCH')||code.includes('REVISION_CONFLICT')||code.endsWith('SOURCE_DIVERGED');const dependency=code.endsWith('UNAVAILABLE');
   return OperatorResponseSchema.parse({kind:'problem',status:forbidden?403:missing?404:precondition?412:dependency?503:invalid?422:409,error:{kind:forbidden?'forbidden':missing?'notFound':precondition?'precondition':dependency?'dependency':invalid?'validation':'conflict',code,message:code.endsWith('INSPECTION_REQUIRED')?'Activá explícitamente el inspector privado de esta representación.':forbidden?'La escritura requiere Dirección con alcance de toda esta representación.':'La promoción requiere revisar su estado y sus versiones.',...(invalid?{issues:[]}:{}),...(dependency?{safeCode:code,retryable:true}:{})}});
  }
 }};
}
