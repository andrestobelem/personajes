import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createRunObservationApplication } from '../src/application/run-observation.ts';
import { ContinuistaCriterionSchema } from '../src/domain/world-journal.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import { ConversationPageSchema } from '../src/domain/run-observation.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { setup, deterministicFactory, draftFixture } from './fixtures/continuista.ts';
import { recordSyntheticPassedPreflight } from './fixtures/preflight.ts';

test('a future human utterance admits only its public presence and an actor reply persists human reception without ICM delivery',async()=>{
 const f=await setup();try{
  const {journal}=f;
  assert.equal(f.configuration.worldSnapshot.humanParticipants,undefined,'the original snapshot is not backfilled');
  const current=journal.loadWorld({runId:f.claim.runId});assert.ok(current);
  assert.equal(current.humanParticipants?.[0]?.label,'Visitante');
  assert.doesNotMatch(JSON.stringify(current.humanParticipants),/identityMarkdown|lifeStoryMarkdown/);
  const actor=deterministicFactory(f,{proposeAction(){
   const world=journal.loadWorld({runId:f.claim.runId});assert.ok(world);
   const knowledge=journal.readActorKnowledge({runId:f.claim.runId,actorId:f.claim.actorId,throughWorldSeq:world.seq});assert.ok(knowledge);
   const human=knowledge.knowledge.bindings.find(binding=>binding.kind==='human');assert.ok(human);
   const channel=knowledge.knowledge.bindings.find(binding=>binding.kind==='channel');assert.ok(channel);
   return {kind:'communicate',channelHandle:channel.handle,audienceHandles:[human.handle],content:{kind:'speech',text:'Visitante, recibí su consulta.'}};
  }});
  const worker=createActorTurnWorker({journal,runtime:f.runtime,ids:f.ids,sessionFactory:actor.factory,
   memoryForActor:()=>({async recall(){return {source:'ranked-recall',throughWorldSeq:WorldSeqSchema.parse(0),experiences:[],rejectedCount:0};}}),
   continuista:{async review({proposal}){return {kind:'continuista',proposalId:proposal.proposalId,version:proposal.version,runId:proposal.runId,actorId:proposal.actorId,stateRevision:proposal.baseRevision,exactContentHash:proposal.exactContentHash,...(proposal.nextInitiative===undefined?{}:{nextInitiative:proposal.nextInitiative}),verdict:'allow',complete:true,criterionCodes:ContinuistaCriterionSchema.options,evidenceRefs:['fixture-situated-reply']};}}});
  const result=await worker.run(f.claim);assert.equal(result.kind,'committed');
  if(result.kind!=='committed')assert.fail('Actor did not publish');
  const event=result.commit.resolution.events.find(item=>item.kind==='communicated');assert.ok(event?.kind==='communicated');
  assert.deepEqual(event.requestedAudience,[]);assert.deepEqual(event.effectiveAudience,[]);
  assert.deepEqual(event.requestedHumanAudience,['visitante-prueba']);assert.deepEqual(event.effectiveHumanAudience,['visitante-prueba']);
  assert.deepEqual(journal.readObservationDeliveries({runId:f.claim.runId,eventId:event.id}),[],'human reception is not an actor memory delivery');
  const app=createRunObservationApplication({journal});const raw=app.readConversations({runId:f.claim.runId,limit:100});assert.equal(raw.kind,'found');
  if(raw.kind!=='found')assert.fail();
  const message=ConversationPageSchema.parse(raw.value).items.find(item=>item.eventId===event.id);assert.ok(message);
  assert.deepEqual(message.effectiveHumanAudience,[{participantId:'visitante-prueba',label:'Visitante'}]);assert.deepEqual(message.deliveries,[]);
  const replay=await worker.run(f.claim);assert.equal(replay.kind,'recovered');
  const after=app.readConversations({runId:f.claim.runId,limit:100});if(after.kind!=='found')assert.fail();
  assert.equal(after.value.items.filter(item=>item.eventId===event.id).length,1);
 }finally{f.close();}
});

test('start admits configured human presence in a new durable cut without rewriting the initial snapshot',async()=>{
 const f=await setup();try{
  const principalId='operator';
  const {kind:_kind,schemaVersion:_version,runId:_run,revision:_revision,...patch}=draftFixture({humanParticipants:f.configuration.humanParticipants});
  const created=f.journal.createRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),patch});assert.equal(created.kind,'created');if(created.kind!=='created')assert.fail();
  const promoted=f.journal.validateRunConfigurationDraft({principalId,idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:created.draft.revision});assert.equal(promoted.kind,'ready');
  const runId=created.draft.runId;const initial=f.journal.loadWorld({runId});assert.ok(initial);assert.equal(initial.humanParticipants,undefined);
  const before=JSON.stringify(initial);const preflightJobId=recordSyntheticPassedPreflight({journal:f.journal,runId});
  const state=f.journal.readWorldLifecycle({runId});assert.ok(state);
  const request={principalId,idempotencyKey:randomUUID(),runId,expectedLifecycleRevision:state.lifecycleRevision,expectedConfigRevision:state.configRevision,expectedWorldRevision:state.worldRevision,command:{kind:'start' as const},preflightJobId};
  assert.equal(f.journal.applyRunLifecycleCommand(request).kind,'updated');
  const started=f.journal.loadWorld({runId});assert.ok(started);assert.deepEqual(started.humanParticipants,f.configuration.humanParticipants.map(profile=>({participantId:profile.identity.participantId,label:profile.identity.displayName,presence:profile.presence})));
  const old=f.journal.readInspectorWorldCut({runId,atCommitIndex:0});assert.ok(old);assert.equal(JSON.stringify(old.snapshot),before);
  const configuration=ReadyRunConfigurationSchema.parse(f.journal.readWorldConfiguration({runId}));assert.equal(configuration.worldSnapshot.humanParticipants,undefined);
  assert.equal(f.journal.applyRunLifecycleCommand(request).kind,'updated');assert.deepEqual(f.journal.loadWorld({runId}),started);
 }finally{f.close();}
});
