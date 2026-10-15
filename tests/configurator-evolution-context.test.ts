import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';
import { compileConfiguratorEvolutionContext } from '../src/application/configurator-evolution-context.ts';
import { configuratorValueHash,configuratorEvidencePayload,validateConfiguratorContext,validateConfiguratorProposal,validateConfiguratorApproval } from '../src/application/configurator-context.ts';
import { ConfiguratorEvidenceSchema } from '../src/domain/configurator.ts';
import { RevisionSchema } from '../src/domain/values.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';

test('host compiler derives deterministic actor-owned admitted evidence from exact SQLite cut without global memory or fabricated events',async()=>{
 const f=await configuratorEvolutionFixture();try{
  const before=f.base.journal.loadWorld({runId:f.source.snapshot.runId});const replay=compileConfiguratorEvolutionContext({source:f.source,originalDossier:f.originalDossier,scope:f.scope,characterId:f.characterId});assert.deepEqual(replay,f.context);
  assert.equal(f.context.scope.kind,'evolution');if(f.context.scope.kind!=='evolution')assert.fail('Wrong scope');assert.equal('pulseId' in f.context.scope.scope,false);assert.deepEqual(f.context.scope.anchor.source,f.source.cuts[0]?.source);assert.equal(f.context.scope.actorStateCut.actorId,f.characterId);assert.equal(f.context.scope.anchor.preparedContextHash,configuratorValueHash(f.context.preparedCharacter));
  const memories=f.context.evolutionEvidence.filter(item=>item.kind==='admitted-experience');assert.ok(memories.length>=2,'real delivery plus the synthetic own belief');assert.equal(memories.length,f.context.scope.actorStateCut.experiences.length);assert.ok(memories.some(item=>item.epistemicStatus==='reported'));assert.ok(memories.some(item=>item.epistemicStatus==='believed'));
  assert.equal(f.context.evolutionEvidence.some(item=>item.kind==='confirmed-event'),false);assert.doesNotMatch(JSON.stringify(f.context),/SECRET_PRIVATE_OTHER_MEMORY|SECRET_OTHER_PREPARATION|SECRET_PRIVATE_PLACE/);
  for(const item of f.context.evolutionEvidence)assert.equal(item.fullHash,configuratorValueHash(configuratorEvidencePayload(item)));
  assert.equal(validateConfiguratorProposal({context:f.context,proposal:f.proposal}).kind,'identity-promotion-proposal');assert.equal(validateConfiguratorApproval({context:f.context,proposal:f.proposal,approval:f.approval}).approval.operatorId,'synthetic-operator');assert.deepEqual(f.base.journal.loadWorld({runId:f.source.snapshot.runId}),before);
 }finally{f.close();}
});

test('host compiler rejects mixed snapshots/configurations/profiles and unprepared or foreign actors',async()=>{
 const f=await configuratorEvolutionFixture();try{
  const request={source:f.source,originalDossier:f.originalDossier,scope:f.scope,characterId:f.characterId};
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,scope:{...f.scope,worldRevision:f.scope.worldRevision+1}}),/boundary/);
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,scope:{...f.scope,fictitiousAt:f.scope.fictitiousAt+1}}),/boundary/);
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,source:{...f.source,configuration:{...f.source.configuration,name:'Modified source'}}}),/boundary/);
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,source:{...f.source,cuts:[f.source.cuts[0]]}}),/checkpoint batch|prepared actor/);
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,characterId:'not-the-actor'}),/exact prepared actor/);
  assert.throws(()=>compileConfiguratorEvolutionContext({...request,source:{...f.source,snapshot:{...f.source.snapshot,clock:{...f.source.snapshot.clock,instant:f.source.snapshot.clock.instant+1}}}}),/boundary/);
 }finally{f.close();}
});

test('context validation refuses future receipt, forged subjectivity/hash and wrong commit even with self-consistent evidence hash',async()=>{
 const f=await configuratorEvolutionFixture();try{
  const context=f.context;const evolution=context.scope;if(evolution.kind!=='evolution')assert.fail('Wrong scope');
  const memory=context.evolutionEvidence.find(item=>item.kind==='admitted-experience');assert.ok(memory?.kind==='admitted-experience');
  const changed=ConfiguratorEvidenceSchema.parse({...memory,epistemicStatus:memory.epistemicStatus==='believed'?'perceived':'believed'});
  assert.throws(()=>validateConfiguratorContext({...context,evolutionEvidence:context.evolutionEvidence.map(item=>item===memory?{...changed,fullHash:configuratorValueHash(configuratorEvidencePayload(changed))}:item)}),/integrity|receipt/);
  const state=context.evolutionEvidence.find(item=>item.kind==='committed-character-state');assert.ok(state?.kind==='committed-character-state');const wrong={...state,commitIndex:RevisionSchema.parse(state.commitIndex+1)};assert.throws(()=>validateConfiguratorContext({...context,evolutionEvidence:context.evolutionEvidence.map(item=>item===state?{...wrong,fullHash:configuratorValueHash(configuratorEvidencePayload(wrong))}:item)}),/exact actor checkpoint/);
  const future=freezeExperience({...memory.experience.envelope,receivedAt:f.scope.fictitiousAt+1});assert.throws(()=>validateConfiguratorContext({...context,scope:{...evolution,actorStateCut:{...evolution.actorStateCut,experiences:evolution.actorStateCut.experiences.map(item=>item.envelope.experienceId===memory.experience.envelope.experienceId?future:item)}}}),/future/);
  const foreign=freezeExperience({...memory.experience.envelope,experienceId:randomUUID(),actorId:'other-actor'});assert.throws(()=>validateConfiguratorContext({...context,scope:{...evolution,actorStateCut:{...evolution.actorStateCut,experiences:[foreign]}}}),/./);
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...f.proposal,evidenceIds:[state.evidenceId]}}),/lived evidence/);
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...f.proposal,unknowns:[]}}),/unknowns/);
 }finally{f.close();}
});

test('identity contradictions need an exact explanation supported by cited admitted experience and cannot be silently erased',async()=>{
 const f=await configuratorEvolutionFixture();try{
  assert.ok(f.context.preparedCharacter);if(f.context.scope.kind!=='evolution')assert.fail('Wrong scope');
  const prepared={...f.context.preparedCharacter,identity:{...f.context.preparedCharacter.identity,value:{...f.context.preparedCharacter.identity.value,contradictions:['Ansía confianza y sospecha de todos']}}};
  const context=validateConfiguratorContext({...f.context,preparedCharacter:prepared,scope:{...f.context.scope,anchor:{...f.context.scope.anchor,preparedContextHash:configuratorValueHash(prepared)}}});
  const proposal={...f.proposal,identity:{...prepared.identity.value,contradictions:[]}};
  assert.throws(()=>validateConfiguratorProposal({context,proposal}),/contradictions/);
  const resolution={contradiction:'Ansía confianza y sospecha de todos',reason:'El cambio propuesto explica cómo reconoce y enfrenta esa tensión.',evidenceIds:f.proposal.evidenceIds};
  assert.equal(validateConfiguratorProposal({context,proposal:{...proposal,contradictionResolutions:[resolution]}}).kind,'identity-promotion-proposal');
  for(const resolutions of [[resolution,resolution],[{...resolution,contradiction:'No existía'}],[{...resolution,evidenceIds:[randomUUID()]}],[{...resolution,evidenceIds:[...resolution.evidenceIds,...resolution.evidenceIds]}]])assert.throws(()=>validateConfiguratorProposal({context,proposal:{...proposal,contradictionResolutions:resolutions}}),/contradictions|duplicate/);
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...proposal,identity:prepared.identity.value,contradictionResolutions:[resolution]}}),/contradictions/);
 }finally{f.close();}
});

test('confirmed event evidence requires actual access in the same actor admitted receipt',async()=>{
 const f=await configuratorEvolutionFixture();try{
  const events=f.base.journal.readWorldEvents({runId:f.source.snapshot.runId,toWorldSeq:f.source.snapshot.seq});
  const event=events[0];assert.ok(event);
  const evidence={kind:'confirmed-event',evidenceId:randomUUID(),event,fullHash:configuratorValueHash(event)};
  assert.doesNotThrow(()=>validateConfiguratorContext({...f.context,evolutionEvidence:[...f.context.evolutionEvidence,evidence]}));
  const inaccessible={...event,id:randomUUID()};assert.throws(()=>validateConfiguratorContext({...f.context,evolutionEvidence:[...f.context.evolutionEvidence,{...evidence,event:inaccessible,fullHash:configuratorValueHash(inaccessible)}]}),/inaccessible/);
 }finally{f.close();}
});
