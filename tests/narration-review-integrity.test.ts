import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HashSchema } from '../src/domain/values.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { DEFAULT_INFERENCE_PROFILE,CLAUDE_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { NarratorContextSchema,NarrationProposalSchema } from '../src/domain/narration.ts';
import { projectNarratorPhysicalSnapshot,narratorContextHash,narrationValueHash } from '../src/application/narrator-context.ts';
import { validateNarrationReviewContext,validateNarrationReviewDecision } from '../src/application/narration-review-context.ts';
import { createNarrationReviewTool } from '../src/application/narration-review-tools.ts';

function fixture() {
  const ready=validateRunConfiguration({draft:draftFixture()});if(ready.kind!=='ready')throw new Error('Synthetic Ready fixture unavailable');
  const world=ready.configuration.worldSnapshot;
  const narrator=NarratorContextSchema.parse({kind:'narrator-context',schemaVersion:1,role:'narrator',scope:{runId:world.runId,pulseId:randomUUID(),jobId:randomUUID(),generation:0,lifecycleRevision:1,configurationRevision:ready.configuration.configRevision,worldRevision:world.revision,throughWorldSeq:world.seq,fictitiousAt:world.clock.instant,profile:DEFAULT_INFERENCE_PROFILE},authorization:{kind:'omniscient-confirmed-world'},language:'es',snapshot:projectNarratorPhysicalSnapshot(world),confirmedEvents:[],previousNarrations:[]});
  const proposal=NarrationProposalSchema.options[0].parse({kind:'narrate',text:'La escena está preparada.',sourceEventIds:[],sourceWorldRevision:world.revision,uncertainty:{kind:'none'}});
  const context=validateNarrationReviewContext({kind:'narration-review-context',schemaVersion:1,role:'narration-reviewer',scope:{...narrator.scope,jobId:randomUUID()},parent:{scope:narrator.scope,contextHash:narratorContextHash(narrator),proposalHash:narrationValueHash(proposal)},narratorContext:narrator,proposal});
  const decision={kind:'accepted',confirmedSourcesOnly:true,privateReasoningExcluded:true,uncertaintyExplicit:true,reason:'Comprobación sintética local, sin proveedor.',checks:[{startOffset:0,text:proposal.text,source:{kind:'world-snapshot',worldRevision:world.revision},epistemicKind:'physical-fact',reason:'La escena está configurada.'}]};
  return {context,decision};
}

test('review child binds parent lifecycle, profile, generation and exact text, not only run or pulse',()=>{
  const {context}=fixture();
  for(const patch of [{lifecycleRevision:context.scope.lifecycleRevision+1},{profile:CLAUDE_INFERENCE_PROFILE},{configurationRevision:context.scope.configurationRevision+1},{worldRevision:context.scope.worldRevision+1},{pulseId:randomUUID()}])assert.throws(()=>validateNarrationReviewContext({...context,scope:{...context.scope,...patch}}));
  assert.throws(()=>validateNarrationReviewContext({...context,proposal:{...context.proposal,text:context.proposal.text+' Otra frase.'}}),/HASH/);
  assert.throws(()=>validateNarrationReviewContext({...context,parent:{...context.parent,contextHash:'0'.repeat(64)}}),/HASH/);
  assert.throws(()=>validateNarrationReviewContext({...context,parent:{...context.parent,scope:{...context.parent.scope,generation:context.parent.scope.generation+1}}}));
});

test('review callback cannot authorize after cancellation while eligibility is awaited',async()=>{
  const {context,decision}=fixture();const controller=new AbortController();
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  const tool=createNarrationReviewTool({context,signal:controller.signal,checkEligibility:async()=>{await waiting;return {kind:'active'};}});
  const result=tool.tool.execute('pending',decision);controller.abort();release();await assert.rejects(result);assert.equal(tool.readCandidate(),undefined);
});

test('review tool freezes context, returns detached candidate and rejects authority fields and unreviewed trailing text',async()=>{
  const {context,decision}=fixture();const tool=createNarrationReviewTool({context,checkEligibility:()=>({kind:'active'})});
  context.parent.proposalHash=HashSchema.parse('0'.repeat(64));
  await tool.tool.execute('local',decision);const candidate=tool.readCandidate();assert.ok(candidate);
  candidate.decision.reason='Mutable external copy';assert.notEqual(tool.readCandidate()?.decision.reason,'Mutable external copy');
  const original=fixture();assert.throws(()=>validateNarrationReviewDecision({context:original.context,decision:{...original.decision,reviewEvidenceId:randomUUID()}}));
  const longer={...original.context.proposal,text:original.context.proposal.text+' Texto sin revisión.'};
  const changed={...original.context,proposal:longer,parent:{...original.context.parent,proposalHash:narrationValueHash(longer)}};
  assert.throws(()=>validateNarrationReviewDecision({context:changed,decision:original.decision}),/INCOMPLETE/);
});
