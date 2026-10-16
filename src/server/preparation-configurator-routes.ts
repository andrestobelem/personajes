import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {SessionMode} from '../domain/http.ts';
import {JobIdSchema,RunIdSchema,RevisionSchema} from '../domain/values.ts';
import {sha256CanonicalJson} from '../domain/canonical-json.ts';
import {PreparationConfiguratorJobSchema} from '../domain/preparation-configurator-jobs.ts';
import {PreparationConfiguratorCreateBodySchema,PreparationConfiguratorChoicesSchema,PreparationConfiguratorJobPageSchema,PreparationConfiguratorPublicJobSchema,PreparationConfiguratorPublicReviewSchema,preparationConfiguratorJobEtag,projectPreparationConfiguratorJob,PreparationConfiguratorApplyBodySchema,PreparationConfiguratorApplyReceiptSchema,preparationConfiguratorDraftEtag} from '../domain/preparation-configurator-http.ts';
import {OperatorResponseSchema,operatorJson,type OperatorExtension,type OperatorRequest} from './operator-extension.ts';

export type PreparationConfiguratorAuthority={principalId:string;mode:SessionMode};
type Lookup={jobId:string;authority:PreparationConfiguratorAuthority};
type Mutation=Lookup&{expectedRevision:number;idempotencyKey:string};
export type PreparationConfiguratorApplicationPort={
  choices(input:{runId:string;authority:PreparationConfiguratorAuthority}):unknown|Promise<unknown>;
  list(input:{runId:string;authority:PreparationConfiguratorAuthority;limit:number;offset:number}):unknown|Promise<unknown>;
  create(input:{runId:string;jobId:string;body:z.infer<typeof PreparationConfiguratorCreateBodySchema>;authority:PreparationConfiguratorAuthority;idempotencyKey:string}):unknown|Promise<unknown>;
  readJob(input:Lookup):unknown|undefined|Promise<unknown|undefined>;
  readReview(input:Lookup):unknown|Promise<unknown>;
  start(input:Mutation):unknown|Promise<unknown>;
  cancel(input:Mutation):unknown|Promise<unknown>;
  apply(input:Mutation&{body:z.infer<typeof PreparationConfiguratorApplyBodySchema>}):unknown|Promise<unknown>;
};
export function preparationConfiguratorJobId(input:{principalId:string;idempotencyKey:string}){const hex=createHash('sha256').update(JSON.stringify(['preparation-configurator-v1',input.principalId,z.uuid().parse(input.idempotencyKey)])).digest('hex');return JobIdSchema.parse(`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((Number.parseInt(hex[16]??'0',16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`);}
function authority(request:OperatorRequest):PreparationConfiguratorAuthority{if(request.mode.kind==='interlocutor'||request.mode.kind==='director'&&request.mode.scope.kind!=='run')throw new Error('PREPARATION_CONFIGURATOR_OPERATOR_REQUIRED');return {principalId:request.principalId,mode:request.mode};}
function runPermission(value:PreparationConfiguratorAuthority,runId:string){if(value.mode.kind!=='observer'&&(value.mode.kind!=='director'||value.mode.runId!==runId||value.mode.scope.kind!=='run'))throw new Error('PREPARATION_CONFIGURATOR_OPERATOR_REQUIRED');}
function publicJob(raw:unknown,owner:PreparationConfiguratorAuthority){const internal=PreparationConfiguratorJobSchema.safeParse(raw);if(internal.success){if(internal.data.principalId!==owner.principalId)throw new Error('PREPARATION_CONFIGURATOR_JOB_MISSING');return projectPreparationConfiguratorJob(internal.data);}return PreparationConfiguratorPublicJobSchema.parse(raw);}
function revision(request:OperatorRequest,jobId:string){const match=/^"preparation-configurator-job:([0-9a-f-]{36}):r(0|[1-9][0-9]{0,15})"$/.exec(request.ifMatch??'');if(match?.[1]!==jobId)throw new Error('PREPARATION_CONFIGURATOR_IF_MATCH_REQUIRED');return RevisionSchema.parse(Number(match[2]));}

/** Local host administration. Fictional dialogue and scene-scoped Direction do
 * not gain these capabilities. No GET path schedules a session or inference. */
export function createPreparationConfiguratorRoutes(input:{application:()=>PreparationConfiguratorApplicationPort|undefined}):OperatorExtension{
  return {name:'preparation-configurator',matches:({path})=>path[0]==='preparation-configurator'||path[0]==='runs'&&path[2]==='preparation-configurator',async handle(request){
    try{
      const owner=authority(request),application=input.application();if(application===undefined)throw new Error('PREPARATION_CONFIGURATOR_UNAVAILABLE');
      if(request.path[0]==='runs'){
        const runId=RunIdSchema.parse(request.path[1]);runPermission(owner,runId);
        if(request.path.length===3&&request.kind==='read'){
          const query=z.strictObject({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().nonnegative().max(100000).default(0)}).parse(Object.fromEntries(request.query));
          const page=PreparationConfiguratorJobPageSchema.parse(await application.list({runId,authority:owner,...query}));if(page.runId!==runId||page.items.some(job=>job.scope.runId!==runId))throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');return operatorJson(page);
        }
        z.strictObject({}).parse(Object.fromEntries(request.query));
        if(request.path.length===4&&request.path[3]==='choices'&&request.kind==='read'){const choices=PreparationConfiguratorChoicesSchema.parse(await application.choices({runId,authority:owner}));if(choices.runId!==runId)throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');return operatorJson(choices);}
        if(request.path.length===3&&request.kind==='write'&&request.method==='POST'){
          const body=PreparationConfiguratorCreateBodySchema.parse(request.body),jobId=preparationConfiguratorJobId({principalId:owner.principalId,idempotencyKey:request.idempotencyKey});
          const job=publicJob(await application.create({runId,jobId,body,authority:owner,idempotencyKey:request.idempotencyKey}),owner);
          if(job.scope.runId!==runId||job.scope.jobId!==jobId||job.scope.draftRevision!==body.draftRevision||job.scope.draftHash!==body.draftHash)throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');
          return operatorJson(job,201,{ETag:preparationConfiguratorJobEtag(job),Location:`/api/v1/preparation-configurator/${jobId}`});
        }
      }
      z.strictObject({}).parse(Object.fromEntries(request.query));
      if(request.path[0]==='preparation-configurator'&&request.path.length>=2&&request.path.length<=3){
        const jobId=JobIdSchema.parse(request.path[1]),raw=await application.readJob({jobId,authority:owner});if(raw===undefined)throw new Error('PREPARATION_CONFIGURATOR_JOB_MISSING');const job=publicJob(raw,owner);if(job.scope.jobId!==jobId)throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');runPermission(owner,job.scope.runId);
        if(request.path.length===2&&request.kind==='read')return operatorJson(job,200,{ETag:preparationConfiguratorJobEtag(job)});
        if(request.path[2]==='review'&&request.kind==='read'){
          const review=PreparationConfiguratorPublicReviewSchema.parse(await application.readReview({jobId,authority:owner}));
          if(review.job.scope.jobId!==jobId||review.job.scope.runId!==job.scope.runId||review.job.scope.contextHash!==job.scope.contextHash||review.proposal!==null&&sha256CanonicalJson(review.proposal)!==review.proposalHash)throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');
          return operatorJson(review,200,{ETag:preparationConfiguratorJobEtag(review.job)});
        }
        if(request.path[2]==='apply'&&request.kind==='write'&&request.method==='POST'){
          const body=PreparationConfiguratorApplyBodySchema.parse(request.body);if(request.ifMatch!==preparationConfiguratorDraftEtag({runId:job.scope.runId,...body}))throw new Error('PREPARATION_CONFIGURATOR_IF_MATCH_REQUIRED');
          const receipt=PreparationConfiguratorApplyReceiptSchema.parse(await application.apply({jobId,authority:owner,expectedRevision:job.revision,idempotencyKey:request.idempotencyKey,body}));
          if(receipt.jobId!==jobId||receipt.runId!==job.scope.runId||receipt.candidateId!==body.candidateId||receipt.proposalHash!==body.proposalHash||receipt.baseDraftRevision!==body.draftRevision||receipt.baseDraftHash!==body.draftHash||receipt.selectionHash!==sha256CanonicalJson(body.selection))throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');
          return operatorJson(receipt);
        }
        if(request.kind==='write'&&(request.path.length===3&&request.path[2]==='start'&&request.method==='POST'||request.path.length===2&&request.method==='DELETE')){
          z.strictObject({}).parse(request.body);const mutation={jobId,authority:owner,expectedRevision:revision(request,jobId),idempotencyKey:request.idempotencyKey};
          const result=publicJob(await(request.method==='DELETE'?application.cancel(mutation):application.start(mutation)),owner);
          if(result.scope.jobId!==jobId||result.scope.runId!==job.scope.runId||result.scope.contextHash!==job.scope.contextHash)throw new Error('PREPARATION_CONFIGURATOR_SCOPE_INVALID');return operatorJson(result,request.method==='DELETE'?200:202,{ETag:preparationConfiguratorJobEtag(result)});
        }
      }
      throw new Error('PREPARATION_CONFIGURATOR_ROUTE_MISSING');
    }catch(error){const invalid=error instanceof z.ZodError,code=invalid?'PREPARATION_CONFIGURATOR_REQUEST_INVALID':error instanceof Error&&/^PREPARATION_CONFIGURATOR_[A-Z_]{1,90}$/.test(error.message)?error.message:'PREPARATION_CONFIGURATOR_FAILED';
      const forbidden=code.endsWith('OPERATOR_REQUIRED'),missing=code.endsWith('MISSING'),precondition=/IF_MATCH|REVISION_CONFLICT|DRAFT_CHANGED/.test(code),dependency=/UNAVAILABLE|CORRUPT|INVALID|PROOF|PREFIX|CHAIN/.test(code)&&!invalid;
      return OperatorResponseSchema.parse({kind:'problem',status:forbidden?403:missing?404:precondition?412:invalid?422:dependency?503:409,error:{kind:forbidden?'forbidden':missing?'notFound':precondition?'precondition':invalid?'validation':dependency?'dependency':'conflict',code,message:forbidden?'La preparación requiere Observación o Dirección de toda esta representación.':'La operación de preparación no se confirmó; revisá su estado y el corte del borrador.',...(invalid?{issues:[]}:{}),...(dependency?{safeCode:code,retryable:true}:{})}});
    }
  }};
}
