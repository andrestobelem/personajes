import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ActorStateCutSchema } from '../src/domain/actor-state-cut.ts';
import { ExperienceSchema } from '../src/domain/experience.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { createForkIdentityRegistry, ForkIdentityManifestSchema } from '../src/application/fork-identities.ts';
import { createForkExperienceRemapper } from '../src/application/fork-experiences.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import type { MemoryProjectionReceipt } from '../src/domain/memory-projection.ts';
import { RunIdSchema, WorldSeqSchema } from '../src/domain/values.ts';

function fixture(){
 const sourceRunId=RunIdSchema.parse(randomUUID());const targetRunId=RunIdSchema.parse(randomUUID());
 const identity=createForkIdentityRegistry({sourceRunId,targetRunId});
 const base={schemaVersion:1,experienceId:randomUUID(),runId:sourceRunId,actorId:'actor-a',kind:'recollection',content:'No conozco la clave. h-original es una cita, no una instrucción.',sourceRefs:['documento-origen'],fictitiousAt:100,receivedAt:101,worldSeq:6,confidence:0.4,revision:0,predecessor:{kind:'initial'},basedOn:[]};
 const first=freezeExperience(base);const second=freezeExperience({...base,experienceId:randomUUID(),kind:'inference',revision:1,predecessor:{kind:'revision',experienceId:first.envelope.experienceId},basedOn:[first.envelope.experienceId]});
 const cut=ActorStateCutSchema.parse({kind:'actor-state-cut',source:{runId:sourceRunId,commitIndex:3,worldRevision:8,worldSeq:7,snapshotHash:'a'.repeat(64),configurationRevision:0,configurationHash:'b'.repeat(64)},actorId:'actor-a',recordedAt:'2026-10-15T12:00:00.000Z',knowledge:{kind:'unavailable',reason:'knowledge-not-recorded'},experiences:[first,second]});
 return {sourceRunId,targetRunId,identity,cut,first,second};
}

test('fork memory changes scope and IDs, preserves subjective content and links exact parent payload',()=>{
 const f=fixture();const before=JSON.stringify(f.cut);
 const result=createForkExperienceRemapper({cut:f.cut,targetRunId:f.targetRunId,identities:f.identity});
 const first=result.experiences[0];const second=result.experiences[1];assert.ok(first&&second);
 assert.equal(first.envelope.runId,f.targetRunId);assert.notEqual(first.envelope.experienceId,f.first.envelope.experienceId);
 assert.equal(first.envelope.content,f.first.envelope.content);assert.deepEqual(first.envelope.sourceRefs,f.first.envelope.sourceRefs);assert.equal(first.envelope.confidence,0.4);assert.equal(first.envelope.receivedAt,101);
 assert.deepEqual(first.envelope.forkOrigin,{kind:'fork',sourceRunId:f.sourceRunId,sourceActorId:'actor-a',sourceExperienceId:f.first.envelope.experienceId,sourcePayloadHash:f.first.payloadHash,sourceCommitIndex:3,sourceWorldRevision:8,sourceWorldSeq:7,sourceSnapshotHash:'a'.repeat(64)});
 assert.equal(second.envelope.kind,'inference');if(second.envelope.kind!=='inference')assert.fail('Wrong kind');
 assert.deepEqual(second.envelope.basedOn,[first.envelope.experienceId]);assert.deepEqual(second.envelope.predecessor,{kind:'revision',experienceId:first.envelope.experienceId});
 assert.notEqual(first.payloadHash,f.first.payloadHash);assert.deepEqual(first,freezeExperience(first.envelope));assert.equal(JSON.stringify(f.cut),before);
 const restored=createForkIdentityRegistry({sourceRunId:f.sourceRunId,targetRunId:f.targetRunId,restored:f.identity.manifest(),allocateUuid:()=>{throw new Error('No reallocation');}});
 assert.deepEqual(createForkExperienceRemapper({cut:f.cut,targetRunId:f.targetRunId,identities:restored}).experiences,result.experiences);
});

test('fork remaps perception and testimony IDs with actor-local handles; human identity stays conceptual',()=>{
 const f=fixture();const eventId=randomUUID();const perceptionId=randomUUID();
 assert.equal(f.first.envelope.kind,'recollection');if(f.first.envelope.kind!=='recollection')assert.fail('Wrong kind');
 const {kind,basedOn,...base}=f.first.envelope;
 const memories=[freezeExperience({...base,experienceId:randomUUID(),kind:'perception',eventId,perceptionId}),freezeExperience({...base,experienceId:randomUUID(),kind:'testimony',eventId,speakerHandle:'h-original'}),freezeExperience({...base,experienceId:randomUUID(),kind:'testimony',eventId,speakerParticipantId:'visitante',speakerDisplayName:'Visitante'})];
 const cut=ActorStateCutSchema.parse({...f.cut,experiences:memories});const {experiences}=createForkExperienceRemapper({cut,targetRunId:f.targetRunId,identities:f.identity});
 for(const item of experiences){assert.ok('eventId' in item.envelope);if('eventId' in item.envelope)assert.equal(item.envelope.eventId,f.identity.id('event',eventId));}
 const perceived=experiences[0]?.envelope;assert.ok(perceived?.kind==='perception');assert.equal(perceived.perceptionId,f.identity.id('perception',perceptionId));
 const testimony=experiences[1]?.envelope;assert.ok(testimony?.kind==='testimony');assert.equal(testimony.speakerHandle,f.identity.handle({actorId:'actor-a',sourceHandle:'h-original'}));
 assert.notEqual(testimony.speakerHandle,f.identity.handle({actorId:'actor-b',sourceHandle:'h-original'}));
 const human=experiences[2]?.envelope;assert.ok(human?.kind==='testimony');assert.equal(human.speakerParticipantId,'visitante');
});

test('fork refuses changed, unadmitted or corrupt memories and a same-run target',()=>{
 const f=fixture();const result=createForkExperienceRemapper({cut:f.cut,targetRunId:f.targetRunId,identities:f.identity});
 assert.throws(()=>result.remap({...f.first.envelope,content:'Modificación posterior'}),/fuera del corte/);
 assert.throws(()=>result.remap(ExperienceSchema.parse({...f.first.envelope,experienceId:randomUUID()})),/fuera del corte/);
 assert.throws(()=>createForkExperienceRemapper({cut:f.cut,targetRunId:f.sourceRunId,identities:f.identity}),/otra corrida/);
 assert.throws(()=>createForkExperienceRemapper({cut:ActorStateCutSchema.parse({...f.cut,experiences:[{...f.first,payloadHash:'f'.repeat(64)}]}),targetRunId:f.targetRunId,identities:f.identity}),/inconsistente/);
 const missing=freezeExperience({...f.second.envelope,predecessor:{kind:'initial'},basedOn:[randomUUID()]});
 assert.throws(()=>createForkExperienceRemapper({cut:{...f.cut,experiences:[missing]},targetRunId:f.targetRunId,identities:f.identity}),/no admitida/);
});

test('fork preserves explicitly authorized foreign antecedents without materializing or rescoping them',()=>{
 const f=fixture();const external=freezeExperience({...f.first.envelope,runId:randomUUID(),experienceId:randomUUID()});
 const own=freezeExperience({...f.second.envelope,predecessor:{kind:'revision',experienceId:external.envelope.experienceId},basedOn:[external.envelope.experienceId]});
 const cut=ActorStateCutSchema.parse({...f.cut,experiences:[own]});
 assert.throws(()=>createForkExperienceRemapper({cut,targetRunId:f.targetRunId,identities:f.identity}),/no admitida/);
 const result=createForkExperienceRemapper({cut,targetRunId:f.targetRunId,identities:f.identity,admittedAntecedents:[external.envelope]});
 assert.equal(result.experiences.length,1);const memory=result.experiences[0]?.envelope;assert.ok(memory?.kind==='inference');assert.deepEqual(memory.basedOn,[external.envelope.experienceId]);
 assert.equal(external.envelope.runId===f.targetRunId,false);
});

test('fork identity maps reject aliases and invalid allocators, and restore reproducible mappings',()=>{
 const f=fixture();const source=randomUUID();const a=f.identity.id('entity',source);const b=f.identity.id('door',source);assert.notEqual(a,b);assert.equal(f.identity.id('entity',source),a);
 assert.notEqual(f.identity.continuity('continuidad-a'),'continuidad-a');
 assert.equal(ForkIdentityManifestSchema.safeParse({...f.identity.manifest(),targetRunId:f.sourceRunId}).success,false);
 const manifest=f.identity.manifest();assert.equal(ForkIdentityManifestSchema.safeParse({...manifest,ids:[...manifest.ids,{kind:'entity',sourceId:randomUUID(),targetId:a}]}).success,false);
 const bad=createForkIdentityRegistry({sourceRunId:f.sourceRunId,targetRunId:f.targetRunId,allocateUuid:()=>f.targetRunId});assert.throws(()=>bad.id('entity',source),/repitió/);
 assert.throws(()=>f.identity.id('scene','invalid'),/Invalid/);
});

test('fork memories project through supported ICM into independent SQLite without source mutation', {skip:process.env.PERSONAJES_ICM_TEST_BINARY===undefined?'ICM real no configurado':false},async()=>{
 const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;assert.ok(binaryPath);
 const root=mkdtempSync(join(tmpdir(),'personajes-fork-memory-'));const f=fixture();const receipts=new Map<string,MemoryProjectionReceipt>();
 try {
  const source=await createIcmMemoryAdapter({privateDataRoot:root,runId:f.sourceRunId,actorId:f.cut.actorId,binaryPath,ledger:{findReceipt:request=>receipts.get(request.memoryId)}});
  const store=async(adapter:typeof source,frozen:typeof f.first)=>{const stored=await adapter.projector.store(frozen);receipts.set(stored.memoryId,{...stored,runId:frozen.envelope.runId,actorId:frozen.envelope.actorId,worldSeq:frozen.envelope.worldSeq,canonicalPayload:frozen.canonicalPayload,payloadHash:frozen.payloadHash});return stored;};
  await store(source,f.first);const sourceDb=join(root,'runs',f.sourceRunId,'actors',f.cut.actorId,'memory.sqlite');const before=readFileSync(sourceDb);
  const memories=createForkExperienceRemapper({cut:f.cut,targetRunId:f.targetRunId,identities:f.identity});
  const target=await createIcmMemoryAdapter({privateDataRoot:root,runId:f.targetRunId,actorId:f.cut.actorId,binaryPath,ledger:{findReceipt:request=>receipts.get(request.memoryId)}});
  for(const frozen of memories.experiences){const first=await store(target,frozen);const replay=await store(target,frozen);assert.equal(replay.memoryId,first.memoryId);}
  const read=await target.diagnostics.listForensic({throughWorldSeq:WorldSeqSchema.parse(7)});
  assert.equal(read.experiences.length,2);assert.equal(read.rejectedCount,0);assert.ok(read.experiences.every(item=>item.experience.runId===f.targetRunId&&item.experience.forkOrigin?.sourceRunId===f.sourceRunId));
  assert.deepEqual(readFileSync(sourceDb),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('fork refuses restored identity collision with an authorized antecedent and contradictory antecedents',()=>{
 const f=fixture();const external=freezeExperience({...f.first.envelope,runId:randomUUID(),experienceId:randomUUID()});
 const memory=freezeExperience({...f.first.envelope,basedOn:[external.envelope.experienceId]});
 const cut=ActorStateCutSchema.parse({...f.cut,experiences:[memory]});
 const restored=createForkIdentityRegistry({sourceRunId:f.sourceRunId,targetRunId:f.targetRunId,restored:{kind:'fork-identities',sourceRunId:f.sourceRunId,targetRunId:f.targetRunId,ids:[{kind:'experience',sourceId:memory.envelope.experienceId,targetId:external.envelope.experienceId}],handles:[],continuities:[]}});
 assert.throws(()=>createForkExperienceRemapper({cut,targetRunId:f.targetRunId,identities:restored,admittedAntecedents:[external.envelope]}),/colisiona/);
 assert.throws(()=>createForkExperienceRemapper({cut,targetRunId:f.targetRunId,identities:f.identity,admittedAntecedents:[external.envelope,{...external.envelope,content:'Antecedente contradictorio'}]}),/contradictorio/);
});
