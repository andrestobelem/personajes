import {z} from 'zod';
import {canonicalJson} from '../domain/canonical-json.ts';
import {JobIdSchema,PulseIdSchema} from '../domain/values.ts';
import {PreparationConfiguratorJobSchema,PreparationConfiguratorExecutionSchema,PreparationConfiguratorSessionSchema,PreparationConfiguratorCheckpointSchema,
  type PreparationConfiguratorExecution} from '../domain/preparation-configurator-jobs.ts';
import type {PreparationConfiguratorContext,PreparationConfiguratorProposal} from '../domain/preparation-configurator.ts';
import type {IcmContextPacket} from '../domain/icm-workspace.ts';
import {createPiSession,type CreatePiSessionInput,type PiSessionHandle,type PiRuntime,type PiRequestPort,type PiIdentity,type PiRequestScope,type PiCheckpointCandidate,type ReserveNextResult,type RequestReservationTarget} from '../adapters/pi.ts';
import {renderIcmContextPacket} from './icm-context-compiler.ts';
import {validatePreparationConfiguratorContext,projectPreparationConfiguratorModelContext,preparationConfiguratorPolicy,PREPARATION_CONFIGURATOR_PROMPT} from './preparation-configurator-context.ts';
import {createPreparationConfiguratorProposalTool} from './preparation-configurator-tools.ts';
import {requirePreparationConfiguratorAdmission,type PreparationConfiguratorAdmissionHost} from './preparation-configurator-admission.ts';

type Job=z.infer<typeof PreparationConfiguratorJobSchema>;
type Execution=PreparationConfiguratorExecution;
export type PreparationConfiguratorWorkerLedger={
  claim(input:{principalId:string;jobId:Job['scope']['jobId'];ownerToken:string;expectedRevision:number}):{execution:Execution;context:PreparationConfiguratorContext;packet:IcmContextPacket};
  assertActive(execution:Execution):void;
  assertDispatch(input:{execution:Execution;requestSeq:number}):void;
  recordSession(input:{execution:Execution;session:z.infer<typeof PreparationConfiguratorSessionSchema>}):unknown;
  recordCheckpoint(input:{execution:Execution;checkpoint:z.infer<typeof PreparationConfiguratorCheckpointSchema>}):unknown;
  recordCandidate(input:{execution:Execution;candidateId:string;proposal:PreparationConfiguratorProposal}):unknown;
  finish(input:{execution:Execution;outcome:'accepted'|'blocked';failureCode:string|null}):Job;
};
export type PreparationConfiguratorBudgetPort={
  reservePreparationConfiguratorRequest(input:{execution:Execution;clockEpochId:string}):ReserveNextResult;
  transitionPreparationConfiguratorReservation(input:{execution:Execution;requestSeq:number;target:RequestReservationTarget;wallTime?:{clockEpochId:string;monotonicNs:string}}):void;
  expirePreparationConfiguratorRequest(input:{execution:Execution;requestSeq:number;clockEpochId:string;reason:'timeout'|'cancelled'}):void;
  settlePreparationConfiguratorRequestWallTime(input:{execution:Execution;requestSeq:number;clockEpochId:string;monotonicNs:string}):void;
};

/** A fresh administrative session per explicit generation. No coordinator,
 * WorldRun, scene, actor session, filesystem tool or automatic retry is created. */
export function createPreparationConfiguratorPiWorker(input:{ledger:PreparationConfiguratorWorkerLedger;budget:PreparationConfiguratorBudgetPort;runtime:PiRuntime;ownerToken:string;admission:PreparationConfiguratorAdmissionHost;sessionFactory?:(input:CreatePiSessionInput)=>Promise<PiSessionHandle>}){
  async function run(raw:unknown,options:{signal?:AbortSignal}={}){
    const job=PreparationConfiguratorJobSchema.parse(raw);
    const claimed=input.ledger.claim({principalId:job.principalId,jobId:job.scope.jobId,ownerToken:input.ownerToken,expectedRevision:job.revision});
    const execution=PreparationConfiguratorExecutionSchema.parse(claimed.execution),context=validatePreparationConfiguratorContext(claimed.context),request=context.request;
    const scope:PiRequestScope={runId:execution.scope.runId,pulseId:PulseIdSchema.parse(execution.scope.jobId),jobId:JobIdSchema.parse(execution.scope.jobId),generation:execution.scope.generation};
    let session:PiSessionHandle|undefined,disposing:Promise<void>|undefined;
    const dispose=()=>{if(session===undefined)return Promise.resolve();disposing??=session.abortAndDispose();return disposing;};
    const cancel=()=>{void dispose().catch(()=>undefined);};
    const active=()=>{options.signal?.throwIfAborted();input.ledger.assertActive(execution);};
    const eligible=()=>{try{active();return {kind:'active'} as const;}catch{return {kind:'inactive',reason:'preparation-job-inactive'} as const;}};
    function bind(identity:PiIdentity,actual:PiRequestScope){if(identity.kind!=='admin'||identity.role!=='configurador'||canonicalJson(actual)!==canonicalJson(scope))throw new Error('PREPARATION_CONFIGURATOR_SCOPE_MISMATCH');}
    const port:PiRequestPort={
      checkEligibility({purpose,scope:actual}){bind(purpose,actual);return eligible();},
      reserveNextRequest({purpose,scope:actual,clockEpochId}){bind(purpose,actual);active();if(clockEpochId===undefined)throw new Error('PREPARATION_CONFIGURATOR_CLOCK_REQUIRED');return input.budget.reservePreparationConfiguratorRequest({execution,clockEpochId});},
      async transitionReservation({purpose,scope:actual,requestSeq,target,wallTime}){bind(purpose,actual);if(target==='dispatched'){
        // This port has not handed control to the provider yet. A failed local
        // admission can release the reserved grant without claiming a dispatch.
        try{active();await requirePreparationConfiguratorAdmission({host:input.admission,profile:context.profile,...(options.signal===undefined?{}:{signal:options.signal})});active();input.ledger.assertDispatch({execution,requestSeq});}
        catch(error){input.budget.transitionPreparationConfiguratorReservation({execution,requestSeq,target:'undispatched'});throw error;}
      }input.budget.transitionPreparationConfiguratorReservation({execution,requestSeq,target,...(wallTime===undefined?{}:{wallTime})});},
      expireReservation({purpose,scope:actual,requestSeq,clockEpochId,reason}){bind(purpose,actual);input.budget.expirePreparationConfiguratorRequest({execution,requestSeq,clockEpochId,reason});},
      settleWallTime({purpose,scope:actual,requestSeq,clockEpochId,monotonicNs}){bind(purpose,actual);input.budget.settlePreparationConfiguratorRequestWallTime({execution,requestSeq,clockEpochId,monotonicNs});},
      recordCheckpointCandidate(candidate){bind(candidate.identity,candidate.purpose.baseScope);input.ledger.recordCheckpoint({execution,checkpoint:PreparationConfiguratorCheckpointSchema.parse({purpose:purpose(candidate,bind),snapshot:candidate.snapshot})});},
    };
    try{
      active();
      if(request.runId!==scope.runId||request.jobId!==scope.jobId||request.generation!==scope.generation||request.draftRevision!==execution.scope.draftRevision||request.draftHash!==execution.scope.draftHash||context.contextHash!==execution.scope.contextHash)throw new Error('PREPARATION_CONFIGURATOR_CONTEXT_SCOPE_MISMATCH');
      const packet=claimed.packet;
      const packetScope={runId:request.runId,configurationRevision:request.draftRevision,jobId:request.jobId,generation:request.generation,audience:{role:'configurator' as const},cut:{kind:'preparation-cut' as const,draftRevision:request.draftRevision,draftHash:request.draftHash}};
      if(packet.hostPolicyMarkdown!==preparationConfiguratorPolicy(context)||packet.diegeticContextMarkdown!==canonicalJson(projectPreparationConfiguratorModelContext(context)))throw new Error('PREPARATION_CONFIGURATOR_PACKET_CONTEXT_MISMATCH');
      const systemPrompt=renderIcmContextPacket({packet,expectedPacketHash:packet.packetHash,scope:packetScope,workspace:context.workspace});
      const tool=createPreparationConfiguratorProposalTool({context,checkEligibility:eligible,...(options.signal===undefined?{}:{signal:options.signal})});
      await requirePreparationConfiguratorAdmission({host:input.admission,profile:context.profile,...(options.signal===undefined?{}:{signal:options.signal})});active();
      session=await(input.sessionFactory??createPiSession)({runtime:input.runtime,profile:context.profile,runId:scope.runId,identity:{kind:'admin',role:'configurador'},preparedContextHash:context.contextHash,checkpoint:{kind:'fresh'},systemPrompt,tools:[tool.tool],adminToolAllowlist:{configurador:['submit_preparation_proposal']},requestPort:port});
      options.signal?.addEventListener('abort',cancel,{once:true});active();
      const base=session.checkpoint();if(base.sessionPath===null)throw new Error('PREPARATION_CONFIGURATOR_SESSION_MISSING');
      // A fresh Pi session may already contain setup metadata. Its job base is
      // still null; only a resumed leaf checkpoint supplies a committed base.
      input.ledger.recordSession({execution,session:PreparationConfiguratorSessionSchema.parse({sessionId:base.sessionId,sessionPath:base.sessionPath,baseLeafId:null,profile:context.profile})});
      const terminal=await session.prompt({text:PREPARATION_CONFIGURATOR_PROMPT,scope});active();
      if(terminal.outcome!=='completed'||terminal.candidateLeafId===null)throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_INCOMPLETE');
      const candidate=tool.readCandidate();if(candidate===undefined)throw new Error('PREPARATION_CONFIGURATOR_PROPOSAL_MISSING');
      input.ledger.recordCandidate({execution,candidateId:candidate.candidateId,proposal:candidate.proposal});
      return input.ledger.finish({execution,outcome:'accepted',failureCode:null});
    }catch(error){const failureCode=options.signal?.aborted?'PREPARATION_CONFIGURATOR_CANCELLED':error instanceof Error&&/^PREPARATION_CONFIGURATOR_[A-Z_]+$/.test(error.message)?error.message:'PREPARATION_CONFIGURATOR_EXECUTION_FAILED';return input.ledger.finish({execution,outcome:'blocked',failureCode});}
    finally{options.signal?.removeEventListener('abort',cancel);await dispose();}
  }
  return Object.freeze({run});
}

function purpose(candidate:PiCheckpointCandidate,bind:(identity:PiIdentity,scope:PiRequestScope)=>void){switch(candidate.purpose.kind){case 'job-base':return {kind:'job-base'} as const;case 'request-input':bind(candidate.identity,candidate.purpose.request.scope);return {kind:'request-input' as const,requestSeq:candidate.purpose.request.requestSeq};case 'terminal-candidate':if(candidate.purpose.lastRequest!==undefined)bind(candidate.identity,candidate.purpose.lastRequest.scope);return {kind:'terminal-candidate' as const,outcome:candidate.purpose.outcome,lastRequestSeq:candidate.purpose.lastRequest?.requestSeq??null};default:{const exhaustive:never=candidate.purpose;return exhaustive;}}}
