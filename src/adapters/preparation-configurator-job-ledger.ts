import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { constants, openSync, readFileSync, closeSync } from 'node:fs';
import { z } from 'zod';
import type { openJournal } from './journal.ts';
import { canonicalJson, sha256CanonicalJson } from '../domain/canonical-json.ts';
import { PreparationConfiguratorExecutionSchema, PreparationConfiguratorSessionSchema, PreparationConfiguratorCheckpointSchema,
  PreparationConfiguratorCandidateSchema, PreparationConfiguratorPrefixSchema, PreparationConfiguratorTerminalProofSchema, PreparationConfiguratorApplySchema,
  type PreparationConfiguratorExecution } from '../domain/preparation-configurator-jobs.ts';
import { RevisionSchema } from '../domain/values.ts';
import { validatePreparationConfiguratorProposal, PREPARATION_CONFIGURATOR_PROMPT } from '../application/preparation-configurator-context.ts';
import { readPiSessionCheckpointPrefix, verifyPiSessionCheckpointChain } from './pi-session-integrity.ts';

type Journal=ReturnType<typeof openJournal>;
/** Host-owned adapter. No reads schedule work; accepted output is still a proposal. */
export function openPreparationConfiguratorJobLedger(input:{journal:Journal;journalPath:string;privateDataRoot:string;ownerToken:string}) {
  const ownerToken=z.uuid().parse(input.ownerToken),db=new DatabaseSync(input.journalPath,{readOnly:true});
  const {journal}=input;
  function stored(execution:PreparationConfiguratorExecution) {
    const row=z.strictObject({principal_id:z.string()}).parse(db.prepare('SELECT principal_id FROM preparation_configurator_jobs WHERE job_id=?').get(execution.scope.jobId));
    return journal.readPreparationConfiguratorJob({principalId:row.principal_id,jobId:execution.scope.jobId});
  }
  function active(raw:unknown) {
    const execution=PreparationConfiguratorExecutionSchema.parse(raw);
    if(execution.lease.ownerToken!==ownerToken)throw new Error('PREPARATION_CONFIGURATOR_OWNER_MISMATCH');
    journal.assertPreparationConfiguratorActive(execution);return execution;
  }
  function reservation(execution:PreparationConfiguratorExecution,requestSeq:number) {
    const row=z.strictObject({run_id:z.string(),pulse_id:z.string(),state:z.enum(['reserved','dispatched','completed','undispatched','ambiguous'])}).parse(
      db.prepare('SELECT run_id,pulse_id,state FROM request_reservations WHERE job_id=? AND generation=? AND request_seq=?').get(execution.scope.jobId,execution.scope.generation,requestSeq));
    if(row.run_id!==execution.scope.runId||row.pulse_id!==execution.scope.jobId)throw new Error('PREPARATION_CONFIGURATOR_RESERVATION_SCOPE');return row;
  }
  function record(execution:PreparationConfiguratorExecution,kind:'session'|'job-base'|'request-input'|'terminal-candidate'|'candidate'|'accepted-proof',requestSeq=-1) {
    const value=journal.readPreparationConfiguratorRecord({jobId:execution.scope.jobId,generation:execution.scope.generation,kind,requestSeq});
    if(value===undefined||canonicalJson(value.execution)!==canonicalJson(execution))throw new Error('PREPARATION_CONFIGURATOR_RECORD_MISSING');return value;
  }
  function session(execution:PreparationConfiguratorExecution) {
    const value=record(execution,'session');if(value.kind!=='session')throw new Error('PREPARATION_CONFIGURATOR_SESSION_MISSING');return value.value;
  }
  function checkpoint(execution:PreparationConfiguratorExecution,kind:'job-base'|'request-input'|'terminal-candidate',requestSeq=-1) {
    const value=record(execution,kind,requestSeq);if(value.kind!=='checkpoint')throw new Error('PREPARATION_CONFIGURATOR_CHECKPOINT_MISSING');return value;
  }
  function prefix(execution:PreparationConfiguratorExecution,snapshot:z.infer<typeof PreparationConfiguratorCheckpointSchema>['snapshot']) {
    if(snapshot.sessionPath===null||snapshot.candidateLeafId===null)throw new Error('PREPARATION_CONFIGURATOR_LEAF_MISSING');
    const proof=readPiSessionCheckpointPrefix({privateDataRoot:input.privateDataRoot,runId:execution.scope.runId,role:'configurador',sessionId:snapshot.sessionId,sessionPath:snapshot.sessionPath,leafId:snapshot.candidateLeafId});
    if(proof.kind!=='verified')throw new Error('PREPARATION_CONFIGURATOR_CHECKPOINT_INVALID');return PreparationConfiguratorPrefixSchema.parse(proof);
  }
  function terminalProof(execution:PreparationConfiguratorExecution,candidate:z.infer<typeof PreparationConfiguratorCandidateSchema>) {
    const registered=session(execution),terminal=checkpoint(execution,'terminal-candidate'),purpose=terminal.value.purpose;
    if(purpose.kind!=='terminal-candidate'||purpose.outcome!=='completed'||purpose.lastRequestSeq===null||terminal.prefix===null)throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_INCOMPLETE');
    const requests=db.prepare(`SELECT r.request_seq,r.state,s.state span_state FROM request_reservations r LEFT JOIN model_time_spans s USING(job_id,generation,request_seq)
      WHERE r.job_id=? AND r.generation=? ORDER BY r.request_seq`).all(execution.scope.jobId,execution.scope.generation).map(raw=>z.strictObject({request_seq:RevisionSchema,state:z.string(),span_state:z.string().nullable()}).parse(raw));
    if(requests.length===0||requests.at(-1)?.request_seq!==purpose.lastRequestSeq||reservation(execution,purpose.lastRequestSeq).state!=='completed'
      ||requests.some(row=>!['completed','undispatched'].includes(row.state)||(row.state==='completed'&&row.span_state!=='settled')))throw new Error('PREPARATION_CONFIGURATOR_REQUESTS_UNSETTLED');
    const completed=requests.filter(row=>row.state==='completed'),first=completed[0];
    if(first===undefined)throw new Error('PREPARATION_CONFIGURATOR_COMPLETED_REQUEST_MISSING');
    const original=checkpoint(execution,'request-input',first.request_seq);
    if(original.prefix===null)throw new Error('PREPARATION_CONFIGURATOR_INPUT_PREFIX_MISSING');
    let lastInputPrefixHash:string|undefined;
    for(const request of completed){
      const frozen=checkpoint(execution,'request-input',request.request_seq);if(frozen.prefix===null)throw new Error('PREPARATION_CONFIGURATOR_INPUT_PREFIX_MISSING');
      const verified=verifyPiSessionCheckpointChain({privateDataRoot:input.privateDataRoot,runId:execution.scope.runId,role:'configurador',sessionId:registered.sessionId,sessionPath:registered.sessionPath,baseLeafId:registered.baseLeafId,
        inputLeafId:frozen.prefix.leafId,terminalLeafId:terminal.prefix.leafId,expectedInputPrefixHash:frozen.prefix.prefixHash,expectedTerminalPrefixHash:terminal.prefix.prefixHash});
      if(verified.kind!=='verified')throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_CHAIN_INVALID');
      if(request.request_seq===purpose.lastRequestSeq)lastInputPrefixHash=verified.inputPrefixHash;
    }
    if(lastInputPrefixHash===undefined)throw new Error('PREPARATION_CONFIGURATOR_LAST_INPUT_MISSING');
    const proof=verifyPiSessionCheckpointChain({privateDataRoot:input.privateDataRoot,runId:execution.scope.runId,role:'configurador',sessionId:registered.sessionId,sessionPath:registered.sessionPath,baseLeafId:registered.baseLeafId,
      inputLeafId:original.prefix.leafId,terminalLeafId:terminal.prefix.leafId,expectedInputPrefixHash:original.prefix.prefixHash,expectedTerminalPrefixHash:terminal.prefix.prefixHash});
    if(proof.kind!=='verified')throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_CHAIN_INVALID');
    const fd=openSync(proof.sessionPath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
    try{bytes=readFileSync(fd);}finally{closeSync(fd);}
    if(bytes.byteLength!==proof.byteLength||createHash('sha256').update(bytes).digest('hex')!==proof.fileHash)throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_BYTES_CHANGED');
    const entries=bytes.toString('utf8').trimEnd().split('\n').slice(1).map(line=>z.object({id:z.string(),parentId:z.string().nullable()}).passthrough().parse(JSON.parse(line)));
    const byId=new Map(entries.map(entry=>[entry.id,entry])),chain:typeof entries=[];let leaf:string|null=terminal.prefix.leafId;
    while(leaf!==null){const entry=byId.get(leaf);if(entry===undefined)throw new Error('PREPARATION_CONFIGURATOR_BRANCH_MISSING');chain.push(entry);if(entry.id===original.prefix.leafId)break;leaf=entry.parentId;}
    if(chain.at(-1)?.id!==original.prefix.leafId)throw new Error('PREPARATION_CONFIGURATOR_INPUT_NOT_ANCESTOR');chain.reverse();
    const messages=chain.filter(entry=>entry.type==='message').map(entry=>z.object({role:z.string()}).passthrough().parse(entry.message));
    const user=messages[0],text=user===undefined?'':typeof user.content==='string'?user.content:z.array(z.object({type:z.literal('text'),text:z.string()})).parse(user.content).map(part=>part.text).join('');
    if(user?.role!=='user'||text!==PREPARATION_CONFIGURATOR_PROMPT)throw new Error('PREPARATION_CONFIGURATOR_INPUT_PROMPT_MISMATCH');
    const frozen=stored(execution),profile=frozen.context.profile;
    const calls=messages.flatMap((message,messageIndex)=>{
      if(message.role!=='assistant')return [];
      if(message.provider!==profile.provider||message.model!==profile.model||message.api!==profile.api)throw new Error('PREPARATION_CONFIGURATOR_MODEL_PROFILE_MISMATCH');
      return z.array(z.record(z.string(),z.unknown())).parse(message.content).filter(part=>part.type==='toolCall'&&part.name==='submit_preparation_proposal').map(part=>({part,messageIndex}));
    });
    const proven=calls.some(call=>{
      const result=messages.find((message,index)=>index>call.messageIndex&&message.role==='toolResult'&&message.toolCallId===call.part.id&&message.toolName==='submit_preparation_proposal'&&message.isError===false);
      if(result===undefined)return false;
      try{return sha256CanonicalJson(validatePreparationConfiguratorProposal({context:frozen.context,proposal:call.part.arguments}))===sha256CanonicalJson(candidate.proposal)
        &&z.object({candidateId:z.uuid()}).passthrough().parse(result.details).candidateId===candidate.candidateId;}catch{return false;}
    });
    if(!proven)throw new Error('PREPARATION_CONFIGURATOR_TOOL_CALL_NOT_PROVEN');
    return PreparationConfiguratorTerminalProofSchema.parse({kind:'verified-preparation-configurator-terminal',inputPrefixHash:proof.inputPrefixHash,terminalPrefixHash:proof.terminalPrefixHash,fileHash:proof.fileHash,
      terminalLeafId:proof.terminalLeafId,lastRequestSeq:purpose.lastRequestSeq,lastInputPrefixHash,candidateHash:candidate.candidateHash});
  }
  return {
    create:journal.createPreparationConfiguratorJob,
    read(input:Parameters<Journal['readPreparationConfiguratorJob']>[0]){return journal.readPreparationConfiguratorJob(input).job;},
    readStored:journal.readPreparationConfiguratorJob,
    list:journal.listPreparationConfiguratorJobs,
    start:journal.startPreparationConfiguratorJob,
    cancel:journal.cancelPreparationConfiguratorJob,
    claim(input:Parameters<Journal['claimPreparationConfiguratorJob']>[0]){return journal.claimPreparationConfiguratorJob(input);},
    assertActive(raw:unknown){active(raw);},
    recordSession(raw:unknown){const request=z.strictObject({execution:PreparationConfiguratorExecutionSchema,session:PreparationConfiguratorSessionSchema}).parse(raw);active(request.execution);
      return journal.recordPreparationConfiguratorRecord({kind:'session',execution:request.execution,value:request.session});},
    recordCheckpoint(raw:unknown){const request=z.strictObject({execution:PreparationConfiguratorExecutionSchema,checkpoint:PreparationConfiguratorCheckpointSchema}).parse(raw);const execution=active(request.execution),registered=session(execution),value=request.checkpoint;
      if(value.snapshot.sessionId!==registered.sessionId||value.snapshot.sessionPath!==registered.sessionPath)throw new Error('PREPARATION_CONFIGURATOR_CHECKPOINT_SESSION');
      const purpose=value.purpose;
      if(purpose.kind==='job-base'&&value.snapshot.candidateLeafId!==registered.baseLeafId)throw new Error('PREPARATION_CONFIGURATOR_BASE_LEAF');
      if(purpose.kind==='request-input'&&reservation(execution,purpose.requestSeq).state!=='reserved')throw new Error('PREPARATION_CONFIGURATOR_INPUT_WITHOUT_RESERVATION');
      if(purpose.kind==='terminal-candidate'&&purpose.outcome==='completed'&&(purpose.lastRequestSeq===null||reservation(execution,purpose.lastRequestSeq).state!=='completed'))throw new Error('PREPARATION_CONFIGURATOR_TERMINAL_WITHOUT_COMPLETION');
      const proof=purpose.kind==='job-base'||value.snapshot.candidateLeafId===null?null:prefix(execution,value.snapshot);
      if(purpose.kind!=='job-base'&&proof===null)throw new Error('PREPARATION_CONFIGURATOR_CHECKPOINT_LEAF_MISSING');
      return journal.recordPreparationConfiguratorRecord({kind:'checkpoint',execution,value,prefix:proof});},
    assertDispatch(raw:unknown){const request=z.strictObject({execution:PreparationConfiguratorExecutionSchema,requestSeq:RevisionSchema}).parse(raw);const execution=active(request.execution);
      if(reservation(execution,request.requestSeq).state!=='reserved')throw new Error('PREPARATION_CONFIGURATOR_DISPATCH_RESERVATION');
      const original=checkpoint(execution,'request-input',request.requestSeq),actual=prefix(execution,original.value.snapshot);
      if(original.prefix?.prefixHash!==actual.prefixHash)throw new Error('PREPARATION_CONFIGURATOR_INPUT_PREFIX_CHANGED');},
    recordCandidate(raw:unknown){const request=z.strictObject({execution:PreparationConfiguratorExecutionSchema,candidateId:z.uuid(),proposal:z.unknown()}).parse(raw);const execution=active(request.execution),frozen=stored(execution);session(execution);
      const proposal=validatePreparationConfiguratorProposal({context:frozen.context,proposal:request.proposal});
      const candidate=PreparationConfiguratorCandidateSchema.parse({candidateId:request.candidateId,proposal,candidateHash:sha256CanonicalJson({execution,candidateId:request.candidateId,proposal})});
      journal.recordPreparationConfiguratorRecord({kind:'candidate',execution,value:candidate});return candidate;},
    finish(raw:unknown){const request=z.strictObject({execution:PreparationConfiguratorExecutionSchema,outcome:z.enum(['accepted','blocked']),failureCode:z.string().nullable()}).parse(raw);const execution=request.outcome==='accepted'?active(request.execution):PreparationConfiguratorExecutionSchema.parse(request.execution);
      if(execution.lease.ownerToken!==ownerToken)throw new Error('PREPARATION_CONFIGURATOR_OWNER_MISMATCH');
      if(request.outcome==='accepted'){const candidate=record(execution,'candidate');if(candidate.kind!=='candidate')throw new Error('PREPARATION_CONFIGURATOR_CANDIDATE_MISSING');
        journal.recordPreparationConfiguratorRecord({kind:'accepted-proof',execution,value:terminalProof(execution,candidate.value)});}
      return journal.finishPreparationConfiguratorJob(request);},
    readAccepted(raw:unknown){const frozen=journal.readPreparationConfiguratorJob(raw);if(frozen.job.state!=='accepted'||frozen.lease===null)throw new Error('PREPARATION_CONFIGURATOR_NOT_ACCEPTED');
      const execution=PreparationConfiguratorExecutionSchema.parse({role:'preparation-configurator',scope:frozen.job.scope,lease:frozen.lease}),candidate=record(execution,'candidate'),proof=record(execution,'accepted-proof');
      if(candidate.kind!=='candidate'||proof.kind!=='accepted-proof')throw new Error('PREPARATION_CONFIGURATOR_ACCEPTED_PROOF_MISSING');
      const actual=terminalProof(execution,candidate.value),{fileHash:_prior,...prior}=proof.value,{fileHash:_actual,...current}=actual;
      if(canonicalJson(prior)!==canonicalJson(current))throw new Error('PREPARATION_CONFIGURATOR_ACCEPTED_PROOF_CHANGED');return candidate.value;},
    readApplyReceipt:journal.readPreparationConfiguratorApplyReceipt,
    apply(raw:unknown){const request=PreparationConfiguratorApplySchema.parse(raw),replay=journal.readPreparationConfiguratorApplyReceipt(request);if(replay!==undefined)return replay;
      const frozen=journal.readPreparationConfiguratorJob({principalId:request.principalId,jobId:request.jobId});
      if(frozen.job.state!=='accepted'||frozen.lease===null)throw new Error('PREPARATION_CONFIGURATOR_NOT_ACCEPTED');
      const execution=PreparationConfiguratorExecutionSchema.parse({role:'preparation-configurator',scope:frozen.job.scope,lease:frozen.lease}),candidate=record(execution,'candidate'),proof=record(execution,'accepted-proof');
      if(candidate.kind!=='candidate'||proof.kind!=='accepted-proof')throw new Error('PREPARATION_CONFIGURATOR_ACCEPTED_PROOF_MISSING');
      const actual=terminalProof(execution,candidate.value),{fileHash:_prior,...prior}=proof.value,{fileHash:_actual,...current}=actual;
      if(canonicalJson(prior)!==canonicalJson(current))throw new Error('PREPARATION_CONFIGURATOR_ACCEPTED_PROOF_CHANGED');
      return journal.applyPreparationConfiguratorProposal(request);},
    recoverInterrupted:journal.interruptPreparationConfiguratorJobs,
    close(){db.close();},
  };
}
