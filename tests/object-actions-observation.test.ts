import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { openJournal } from '../src/adapters/journal.ts';
import { createRunObservationApplication } from '../src/application/run-observation.ts';
import { collectScript } from '../src/application/script-export.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { sha256CanonicalJson } from '../src/domain/canonical-json.ts';
import { buildActorWorldView, emptyActorKnowledge, WorldActorActionSchema, WorldSnapshotSchema } from '../src/domain/world.ts';
import type { ActorKnowledge, WorldIdSource } from '../src/domain/world.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { ConfirmedEventPageSchema } from '../src/domain/run-observation.ts';
import { setup, actorId } from './fixtures/continuista.ts';

const ids:WorldIdSource={eventId:randomUUID,perceptionId:randomUUID,experienceId:randomUUID,offerId:randomUUID,
  entityHandle:randomUUID,placeHandle:randomUUID,channelHandle:randomUUID,offerHandle:randomUUID};

async function fixture() {
  const base=await setup();
  const journal=openJournal({path:join(base.directory,'objects-observation.sqlite')});
  const source=base.configuration.worldSnapshot;
  const owner=source.entities.find(entity=>entity.kind==='character'&&entity.characterId===actorId);
  const recipient=source.entities.find(entity=>entity.kind==='character'&&entity.characterId!==actorId);
  assert.ok(owner?.kind==='character'&&recipient?.kind==='character');
  const objectId=randomUUID();
  const snapshot=WorldSnapshotSchema.parse({...source,
    entities:[...source.entities.map(entity=>entity.kind!=='character'?entity:{...entity,
      capabilities:[...entity.capabilities,'take','offer','putDown'],
      ...(entity.characterId===actorId?{presentation:{kind:'ordinary',label:'Custodio'}}:
        {presentation:{kind:'ordinary',label:'Receptor'},placeId:owner.placeId,position:{x:3,y:2},presence:owner.presence})}),
      {kind:'object',entityId:objectId,label:'Maletín cerrado',description:'No establece su contenido.',portable:true,collisionRadius:0,blocksMovement:false}],
    inventory:[{objectEntityId:objectId,location:{kind:'heldBy',entityId:owner.entityId},revision:0}],
    scenes:source.scenes.map(scene=>({...scene,participantIds:[actorId,recipient.characterId]}))});
  const configuration=ReadyRunConfigurationSchema.parse({...base.configuration,worldSnapshot:snapshot,
    roster:{...base.configuration.roster,activeCharacterIds:[actorId,recipient.characterId]}});
  journal.registerWorldRun({initialSnapshot:snapshot,configurationRevision:configuration.configRevision,configuration,lifecycle:'running',
    continuityFence:{kind:'prepared-contexts',atWorldSeq:snapshot.seq,contexts:configuration.roster.preparedCharacters.map(prepared=>({
      actorId:prepared.characterId,identityVersion:prepared.identityVersion,preparedContextHash:sha256CanonicalJson(prepared),
      continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash}))}});
  async function act(characterId:string,choose:(knowledge:ActorKnowledge)=>z.infer<typeof WorldActorActionSchema>) {
    assert.equal((await createDeliverWorldWorker({journal,runId:configuration.runId,actorId:CharacterIdSchema.parse(characterId)}).drain()).kind,'completed');
    const world=journal.loadWorld({runId:configuration.runId});assert.ok(world);
    const prior=journal.readActorKnowledge({runId:configuration.runId,actorId:characterId,throughWorldSeq:world.seq});
    const projected=buildActorWorldView({snapshot:world,actorId:characterId,knowledge:prior?.knowledge??emptyActorKnowledge({runId:world.runId,actorId:characterId}),
      pendingPerceptions:journal.readDeliveredWorldPerceptions({runId:world.runId,actorId:characterId,throughWorldSeq:world.seq}),ids});
    assert.equal(journal.compareAndSwapActorKnowledge({kind:'actor-knowledge-cas',runId:world.runId,actorId:characterId,
      expectedWorldRevision:world.revision,expectedWorldSeq:world.seq,expectedKnowledgeRevision:prior?.revision??0,
      expectedContinuity:{continuityId:configuration.continuity.continuityId,revision:configuration.continuity.revision,contentHash:configuration.continuity.contentHash},
      knowledge:projected.knowledge}).kind,'stored');
    const proposalId=randomUUID();
    journal.registerWorldProposal({runId:world.runId,proposalId,version:1,jobId:randomUUID(),generation:0,proposalSlot:0,
      attempt:{...WorldActorActionSchema.parse(choose(projected.knowledge)),runId:world.runId,actorId:characterId,expectedRevision:world.revision,attemptId:randomUUID()}});
    const committed=journal.commitWorldAttempt({runId:world.runId,proposalId,version:1,ids});
    assert.equal(committed.resolution.kind,'applied');return committed;
  }
  const app=createRunObservationApplication({journal});
  return {base,journal,configuration,objectId,recipientId:recipient.characterId,recipientEntityId:recipient.entityId,act,app,
    close(){journal.close();base.close();}};
}

function entityHandle(knowledge:ActorKnowledge,entityId:string) {
  const binding=knowledge.bindings.find(candidate=>candidate.kind==='entity'&&candidate.entityId===entityId);
  assert.ok(binding?.kind==='entity');return binding.handle;
}

test('ofrecer no se narra como entrega; aceptar y dejar son acotaciones distintas respaldadas por cortes históricos',async()=>{
  const f=await fixture();
  try {
    const offered=await f.act(actorId,knowledge=>({kind:'offer',objectHandle:entityHandle(knowledge,f.objectId),recipientHandle:entityHandle(knowledge,f.recipientEntityId)}));
    const proposalPage=f.app.readEvents({runId:f.configuration.runId,toWorldSeq:offered.resolution.newSnapshot.seq});
    assert.equal(proposalPage.kind,'found');if(proposalPage.kind!=='found')assert.fail('No public events');
    assert.deepEqual(ConfirmedEventPageSchema.parse(proposalPage.value).items.map(item=>item.summary),['Custodio ofreció Maletín cerrado a Receptor.']);
    const open=offered.resolution.newSnapshot.offers.find(offer=>offer.state==='open');assert.ok(open);
    await f.act(f.recipientId,()=>({kind:'acceptOffer',offerHandle:open.handle}));
    const placed=await f.act(f.recipientId,knowledge=>({kind:'putDown',objectHandle:entityHandle(knowledge,f.objectId)}));
    const page=f.app.readEvents({runId:f.configuration.runId});
    assert.equal(page.kind,'found');if(page.kind!=='found')assert.fail('No public events');
    assert.deepEqual(ConfirmedEventPageSchema.parse(page.value).items.map(item=>item.summary),[
      'Custodio ofreció Maletín cerrado a Receptor.',
      'Receptor aceptó la entrega de Maletín cerrado de Custodio.',
      'Receptor dejó Maletín cerrado en Sala.',
    ]);
    const before=f.app.readStage({runId:f.configuration.runId,atCommitIndex:offered.commitIndex});
    const after=f.app.readStage({runId:f.configuration.runId,atCommitIndex:placed.commitIndex});
    assert.ok(before.kind==='found'&&after.kind==='found');
    const original=before.value.entities.find(entity=>entity.entityId===f.objectId);
    const ground=after.value.entities.find(entity=>entity.entityId===f.objectId);
    assert.ok(original?.kind==='object'&&original.holderEntityId!==null);
    assert.ok(ground?.kind==='object');assert.equal(ground.holderEntityId,null);assert.equal(ground.placeId,'sala');assert.deepEqual(ground.position,{x:3,y:2});
    const script=collectScript({journal:f.journal,runId:f.configuration.runId,commitIndex:placed.commitIndex,capturedAt:Date.now()});
    assert.equal(script.communicationCount,0);assert.equal(script.eventCount,3);
    assert.match(script.text,/!Custodio ofreció Maletín cerrado a Receptor\./);
    assert.match(script.text,/!Receptor aceptó la entrega de Maletín cerrado de Custodio\./);
    assert.match(script.text,/!Receptor dejó Maletín cerrado en Sala\./);
    assert.doesNotMatch(script.text,/SECRET_|trueDisplayName|PRIVATE_|contenido secreto|cambió de estado/);
    const historical=collectScript({journal:f.journal,runId:f.configuration.runId,commitIndex:offered.commitIndex,capturedAt:Date.now()});
    assert.match(historical.text,/ofreció/);assert.doesNotMatch(historical.text,/aceptó la entrega|dejó Maletín/);
  } finally {f.close();}
});

test('vencer una oferta se exporta como vencimiento y no como entrega consumada',async()=>{
  const f=await fixture();
  try {
    const offered=await f.act(actorId,knowledge=>({kind:'offer',objectHandle:entityHandle(knowledge,f.objectId),recipientHandle:entityHandle(knowledge,f.recipientEntityId)}));
    const waited=await f.act(actorId,()=>WorldActorActionSchema.parse({kind:'wait',durationMs:1000}));
    const page=f.app.readEvents({runId:f.configuration.runId});
    assert.ok(page.kind==='found');
    assert.ok(ConfirmedEventPageSchema.parse(page.value).items.some(item=>item.eventType==='offerInvalidated'&&item.summary==='Venció la oferta de Maletín cerrado.'));
    const script=collectScript({journal:f.journal,runId:f.configuration.runId,commitIndex:waited.commitIndex,capturedAt:Date.now()});
    assert.match(script.text,/!Venció la oferta de Maletín cerrado\./);
    assert.doesNotMatch(script.text,/aceptó la entrega|dejó Maletín|SECRET_|cambió de estado/);
    const earlier=collectScript({journal:f.journal,runId:f.configuration.runId,commitIndex:offered.commitIndex,capturedAt:Date.now()});
    assert.doesNotMatch(earlier.text,/Venció/);
  } finally {f.close();}
});
