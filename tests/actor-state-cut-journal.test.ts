import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { validateRunConfiguration, ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { ActorStateCutSchema } from '../src/domain/actor-state-cut.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { canonical, draftFixture } from './fixtures/continuista.ts';

function fixture(withInitialExperience=false) {
  const directory = mkdtempSync(join(tmpdir(),'personajes-private-cut-'));
  const path = join(directory,'journal.sqlite');
  let journal = openJournal({path});
  const ready = validateRunConfiguration({draft:draftFixture()});
  assert.equal(ready.kind,'ready'); if (ready.kind !== 'ready') assert.fail();
  const first = ready.configuration.worldSnapshot.entities.find(entity=>entity.kind==='character');
  assert.ok(first?.kind==='character');
  const experience = freezeExperience({schemaVersion:1,experienceId:randomUUID(),runId:ready.configuration.runId,
    actorId:'ausente-prueba',kind:'belief',content:'Recuerdo privado del personaje ausente.',sourceRefs:[],
    fictitiousAt:ready.configuration.worldSnapshot.clock.instant,receivedAt:ready.configuration.worldSnapshot.clock.instant,
    worldSeq:ready.configuration.worldSnapshot.seq,confidence:1,revision:0,predecessor:{kind:'initial'},basedOn:[]});
  const snapshot = WorldSnapshotSchema.parse({...ready.configuration.worldSnapshot,
    entities:[...ready.configuration.worldSnapshot.entities,{...first,entityId:randomUUID(),characterId:'ausente-prueba',
      presence:{kind:'absent'},mind:{...first.mind,experiences:[experience.envelope]}}]});
  const basePrepared = ready.configuration.roster.preparedCharacters[0];assert.ok(basePrepared);
  const foreign = freezeExperience({...experience.envelope,experienceId:randomUUID(),runId:randomUUID(),actorId:basePrepared.characterId,
    content:'Antecedente explícito procedente de otra corrida.'});
  const continuity={continuityId:basePrepared.continuity.continuityId,revision:basePrepared.continuity.revision,contentHash:basePrepared.continuity.contentHash};
  const configuration = ReadyRunConfigurationSchema.parse({...ready.configuration,worldSnapshot:snapshot,
    roster:{...ready.configuration.roster,preparedCharacters:ready.configuration.roster.preparedCharacters.map(actor=>actor.characterId===basePrepared.characterId&&withInitialExperience
      ?{...actor,initialExperience:{value:{kind:'run-cut',runId:foreign.envelope.runId,throughWorldSeq:foreign.envelope.worldSeq,
        throughFictionalAt:foreign.envelope.receivedAt,continuity,experiences:[foreign.envelope]},
        provenance:{kind:'experience-cut',dossierRevision:actor.dossierRevision,dossierHash:actor.dossierHash,continuity,
          runId:foreign.envelope.runId,throughWorldSeq:foreign.envelope.worldSeq,throughFictionalAt:foreign.envelope.receivedAt,
          admittedBy:'synthetic-test',admittedAt:'2026-10-15T00:00:00Z',experienceIds:[foreign.envelope.experienceId]}}}:actor)}});
  const prepared = configuration.roster.preparedCharacters[0]; assert.ok(prepared);
  const register = () => journal.registerWorldRun({initialSnapshot:snapshot,configurationRevision:configuration.configRevision,configuration,
    lifecycle:'running',continuityFence:{kind:'prepared-contexts',atWorldSeq:snapshot.seq,contexts:[{actorId:prepared.characterId,
      continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,
      continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,
      preparedContextHash:createHash('sha256').update(canonical(prepared)).digest('hex')}]}});
  register();
  const read = (commitIndex=0,actorId:string=prepared.characterId) => {
    const db = new DatabaseSync(path);
    try {
      const row=commitIndex===0?{world_revision:snapshot.revision,last_seq:snapshot.seq}:db.prepare('SELECT world_revision,last_seq FROM world_commits WHERE run_id=? AND commit_index=?').get(snapshot.runId,commitIndex);
      assert.ok(row);
      return journal.readActorStateCut({runId:snapshot.runId,actorId,commitIndex,worldRevision:row.world_revision,worldSeq:row.last_seq});
    } finally {db.close();}
  };
  return {get journal(){return journal;},path,snapshot,configuration,prepared,experience,foreign,register,read,
    mutate(operation:(db:DatabaseSync)=>void){const db=new DatabaseSync(path);try{operation(db);}finally{db.close();}},
    change(level:'dim'|'bright') {
      const world=journal.loadWorld({runId:snapshot.runId});assert.ok(world);
      const options=journal.readCircumstanceOptions({runId:snapshot.runId,scope:{kind:'run'}});assert.ok(options);
      const result=journal.applyCircumstanceCommand({runId:snapshot.runId,principalId:'private-cut-test',operationId:randomUUID(),idempotencyKey:randomUUID(),
        expectedWorldRevision:world.revision,expectedDirectionRevision:options.directionRevision,
        payload:{kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:'sala',level}}});
      assert.equal(result.kind,'stored');return result;
    },
    reopen(){journal.close();journal=openJournal({path});},
    close(){journal.close();rmSync(directory,{recursive:true,force:true});},
  };
}

test('corte0 cubre todos los personajes, incluso ausentes sin knowledge y su memoria propia del snapshot',()=>{
  const f=fixture();try{
    const actor=f.read();assert.equal(actor.kind,'found');if(actor.kind!=='found')assert.fail();
    assert.equal(actor.cut.knowledge.kind,'recorded');assert.deepEqual(actor.cut.experiences,[]);
    const absent=f.read(0,'ausente-prueba');assert.equal(absent.kind,'found');if(absent.kind!=='found')assert.fail();
    assert.deepEqual(absent.cut.knowledge,{kind:'unavailable',reason:'knowledge-not-recorded'});
    assert.deepEqual(absent.cut.experiences,[f.experience]);
    assert.equal(f.register(),'existing');assert.deepEqual(f.read(0,'ausente-prueba'),absent);f.reopen();assert.deepEqual(f.read(0,'ausente-prueba'),absent);
    assert.deepEqual(f.read(0,'personaje-inexistente'),{kind:'unavailable',reason:'actor-not-in-cut'});
    assert.deepEqual(f.journal.readActorStateCut({runId:randomUUID(),actorId:f.prepared.characterId,worldRevision:0,worldSeq:0}),{kind:'missing'});
  }finally{f.close();}
});

test('experiencia aceptada tarde con mismo seq y conocimiento posterior no reescriben el corte anterior',()=>{
  const f=fixture();try{
    f.change('dim');const first=f.read(1);assert.equal(first.kind,'found');if(first.kind!=='found')assert.fail();
    const world=f.journal.loadWorld({runId:f.snapshot.runId});assert.ok(world);
    const late=freezeExperience({...f.experience.envelope,experienceId:randomUUID(),actorId:f.prepared.characterId,
      content:'Aprendido después del commit, mismo worldSeq.',worldSeq:world.seq});
    assert.deepEqual(f.journal.recordExperience(late),{kind:'stored'});
    const knowledge=f.journal.readActorKnowledge({runId:f.snapshot.runId,actorId:f.prepared.characterId,throughWorldSeq:world.seq});assert.ok(knowledge);
    assert.equal(f.journal.compareAndSwapActorKnowledge({kind:'actor-knowledge-cas',runId:f.snapshot.runId,actorId:f.prepared.characterId,
      expectedWorldRevision:world.revision,expectedWorldSeq:world.seq,expectedContinuity:{continuityId:f.prepared.continuity.continuityId,revision:f.prepared.continuity.revision,contentHash:f.prepared.continuity.contentHash},
      expectedKnowledgeRevision:knowledge.revision,knowledge:knowledge.knowledge}).kind,'stored');
    assert.deepEqual(f.read(1),first);f.change('bright');
    const second=f.read(2);assert.equal(second.kind,'found');if(second.kind!=='found')assert.fail();
    assert.deepEqual(second.cut.experiences,[late]);assert.equal(second.cut.knowledge.kind,'recorded');
    if(second.cut.knowledge.kind==='recorded')assert.equal(second.cut.knowledge.revision,knowledge.revision+1);
    f.reopen();assert.deepEqual(f.read(1),first);assert.deepEqual(f.read(2),second);
  }finally{f.close();}
});

test('unión de memoria valida IDs idénticos y rechaza payload contradictorio con rollback del mundo completo',()=>{
  const f=fixture();try{
    f.journal.recordExperience(f.experience);f.change('dim');const accepted=f.read(1,'ausente-prueba');assert.equal(accepted.kind,'found');
    if(accepted.kind==='found')assert.equal(accepted.cut.experiences.length,1);
    const corrupted=freezeExperience({...f.experience.envelope,content:'Payload contradictorio para el mismo ID.'});
    f.mutate(db=>db.prepare('UPDATE experiences SET canonical_payload=?,payload_hash=? WHERE experience_id=?').run(corrupted.canonicalPayload,corrupted.payloadHash,corrupted.envelope.experienceId));
    const before=f.journal.loadWorld({runId:f.snapshot.runId});
    assert.throws(()=>f.change('bright'),/ExperienceId contradictorio/);
    assert.deepEqual(f.journal.loadWorld({runId:f.snapshot.runId}),before);
    f.mutate(db=>{assert.equal(db.prepare('SELECT COUNT(*) count FROM world_commits').get()?.count,1);assert.equal(db.prepare('SELECT COUNT(*) count FROM actor_state_cut_batches').get()?.count,2);});
    assert.deepEqual(f.read(1,'ausente-prueba'),accepted);
  }finally{f.close();}
});

for(const corruption of ['payload','missing-actor','manifest','envelope'] as const)test(`lectura falla cerrada si se altera ${corruption}, incluso en otro actor del lote`,()=>{
  const f=fixture();try{
    f.change('dim');assert.equal(f.read(1).kind,'found');
    f.mutate(db=>{
      if(corruption==='payload')db.prepare("UPDATE actor_state_cuts SET payload_hash=? WHERE actor_id='ausente-prueba' AND commit_index=1").run('0'.repeat(64));
      if(corruption==='missing-actor')db.exec("DELETE FROM actor_state_cuts WHERE actor_id='ausente-prueba' AND commit_index=1");
      if(corruption==='manifest')db.exec("UPDATE actor_state_cut_batches SET manifest_json='{}' WHERE commit_index=1");
      if(corruption==='envelope'){
        const row=db.prepare("SELECT payload_json FROM actor_state_cuts WHERE actor_id='ausente-prueba' AND commit_index=1").get();assert.ok(row);
        const cut=ActorStateCutSchema.parse(JSON.parse(String(row.payload_json)));const frozen=cut.experiences[0];assert.ok(frozen);frozen.payloadHash='0'.repeat(64) as typeof frozen.payloadHash;
        const text=canonical(cut);const hash=createHash('sha256').update(text).digest('hex');
        db.prepare("UPDATE actor_state_cuts SET payload_json=?,payload_hash=? WHERE actor_id='ausente-prueba' AND commit_index=1").run(text,hash);
        const batch=db.prepare('SELECT manifest_json FROM actor_state_cut_batches WHERE commit_index=1').get();assert.ok(batch);
        const manifest=JSON.parse(String(batch.manifest_json)) as {actors:{actorId:string;cutHash:string}[]};const entry=manifest.actors.find(a=>a.actorId==='ausente-prueba');assert.ok(entry);entry.cutHash=hash;
        const encoded=canonical(manifest);db.prepare('UPDATE actor_state_cut_batches SET manifest_json=?,manifest_hash=? WHERE commit_index=1').run(encoded,createHash('sha256').update(encoded).digest('hex'));
      }
    });
    assert.deepEqual(f.read(1),{kind:'unavailable',reason:'invalid-cut'});
  }finally{f.close();}
});

test('fallo al insertar una fila del corte revierte también evento, Dirección y snapshot',()=>{
  const f=fixture();try{
    const before=f.journal.loadWorld({runId:f.snapshot.runId});
    f.mutate(db=>db.exec("CREATE TRIGGER reject_private_cut BEFORE INSERT ON actor_state_cuts WHEN NEW.commit_index>0 BEGIN SELECT RAISE(ABORT,'forced-private-cut-failure'); END"));
    assert.throws(()=>f.change('dim'),/forced-private-cut-failure/);assert.deepEqual(f.journal.loadWorld({runId:f.snapshot.runId}),before);
    f.mutate(db=>{for(const table of ['world_commits','world_events','direction_events'])assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM actor_state_cut_batches').get()?.count,1);});
  }finally{f.close();}
});

for (const invalid of ['basedOn','predecessor','fictitiousAt','receivedAt'] as const) test(`captura rechaza experiencia ${invalid} fuera del corte y revierte toda la transacción`,()=>{
  const f=fixture();try{
    const malformed=freezeExperience({...f.experience.envelope,actorId:f.prepared.characterId,experienceId:randomUUID(),
      ...(invalid==='basedOn'?{kind:'inference',basedOn:[randomUUID()]}:{}),
      ...(invalid==='predecessor'?{predecessor:{kind:'revision',experienceId:randomUUID()}}:{}),
      ...(invalid==='fictitiousAt'?{fictitiousAt:f.snapshot.clock.instant+1}:{}),
      ...(invalid==='receivedAt'?{receivedAt:f.snapshot.clock.instant+1}:{})});
    f.journal.recordExperience(malformed);
    assert.throws(()=>f.change('dim'),/corte privado/);
    assert.deepEqual(f.journal.loadWorld({runId:f.snapshot.runId}),f.snapshot);
    f.mutate(db=>{assert.equal(db.prepare('SELECT COUNT(*) count FROM actor_state_cut_batches').get()?.count,1);assert.equal(db.prepare('SELECT COUNT(*) count FROM world_commits').get()?.count,0);});
  }finally{f.close();}
});

test('antecedente externo autorizado permite cierre sin copiarlo al lote de experiencias propias',()=>{
  const f=fixture(true);try{
    const initial=f.read();assert.equal(initial.kind,'found');if(initial.kind==='found')assert.deepEqual(initial.cut.experiences,[]);
    const inferred=freezeExperience({...f.experience.envelope,actorId:f.prepared.characterId,experienceId:randomUUID(),kind:'inference',
      content:'Inferencia propia fundada en el antecedente preparado.',basedOn:[f.foreign.envelope.experienceId],
      predecessor:{kind:'revision',experienceId:f.foreign.envelope.experienceId}});
    f.journal.recordExperience(inferred);f.change('dim');const cut=f.read(1);assert.equal(cut.kind,'found');
    if(cut.kind==='found')assert.deepEqual(cut.cut.experiences,[inferred]);f.reopen();assert.deepEqual(f.read(1),cut);
  }finally{f.close();}
});

test('commit estructural sin evento captura conocimiento subjetivo y distingue cortes con worldSeq idéntico',()=>{
  const f=fixture();try{
    const initial=f.read();assert.equal(initial.kind,'found');
    const knowledge=f.journal.readActorKnowledge({runId:f.snapshot.runId,actorId:f.prepared.characterId,throughWorldSeq:f.snapshot.seq});assert.ok(knowledge);
    assert.equal(f.journal.compareAndSwapActorKnowledge({kind:'actor-knowledge-cas',runId:f.snapshot.runId,actorId:f.prepared.characterId,
      expectedWorldRevision:f.snapshot.revision,expectedWorldSeq:f.snapshot.seq,
      expectedContinuity:{continuityId:f.prepared.continuity.continuityId,revision:f.prepared.continuity.revision,contentHash:f.prepared.continuity.contentHash},
      expectedKnowledgeRevision:knowledge.revision,knowledge:knowledge.knowledge}).kind,'stored');
    const result=f.journal.applyDramaticStructureCommand({runId:f.snapshot.runId,principalId:'private-cut-test',operationId:randomUUID(),idempotencyKey:randomUUID(),
      expectedWorldRevision:f.snapshot.revision,expectedStructureRevision:0,
      command:{kind:'closeScene',sceneId:f.snapshot.activeSceneId,reason:'Cierre sintético.'}});
    assert.equal(result.kind,'stored');const next=f.read(1);assert.equal(next.kind,'found');
    if(next.kind==='found'){
      assert.equal(next.cut.source.worldSeq,f.snapshot.seq);assert.equal(next.cut.source.worldRevision,f.snapshot.revision+1);
      assert.equal(next.cut.knowledge.kind,'recorded');if(next.cut.knowledge.kind==='recorded')assert.equal(next.cut.knowledge.revision,knowledge.revision+1);
      assert.deepEqual(f.journal.readActorStateCut({runId:f.snapshot.runId,actorId:f.prepared.characterId,worldRevision:next.cut.source.worldRevision,worldSeq:next.cut.source.worldSeq}),next);
      assert.deepEqual(f.journal.readActorStateCut({runId:f.snapshot.runId,actorId:f.prepared.characterId,commitIndex:1,worldRevision:f.snapshot.revision,worldSeq:f.snapshot.seq}),{kind:'unavailable',reason:'invalid-cut'});
    }
    assert.deepEqual(f.read(),initial);f.mutate(db=>assert.equal(db.prepare('SELECT COUNT(*) count FROM world_events').get()?.count,0));
  }finally{f.close();}
});

test('puesta editable reemplaza corte0 junto con snapshot/configuración y replay conserva la captura',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-private-cut-editable-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const {kind,schemaVersion,runId,revision,...patch}=draftFixture();
    const created=journal.createRunConfigurationDraft({principalId:'private-cut-test',idempotencyKey:randomUUID(),patch});
    assert.equal(created.kind,'created');if(created.kind!=='created')assert.fail();
    const request={principalId:'private-cut-test',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:created.draft.revision};
    const first=journal.validateRunConfigurationDraft(request);assert.equal(first.kind,'ready');
    const world=journal.loadWorld({runId:created.draft.runId});assert.ok(world);const actor=world.entities.find(e=>e.kind==='character');assert.ok(actor?.kind==='character');
    const read=()=>journal.readActorStateCut({runId:world.runId,actorId:actor.characterId,commitIndex:0,worldRevision:world.revision,worldSeq:world.seq});
    const old=read();assert.equal(old.kind,'found');
    const changed=journal.updateRunConfigurationDraft({principalId:'private-cut-test',idempotencyKey:randomUUID(),runId:created.draft.runId,
      expectedRevision:created.draft.revision,patch:{name:{kind:'configured',value:'Nombre revisado',evidence:{kind:'operator-choice',operatorId:'private-cut-test',recordedAt:new Date().toISOString()}}}});
    assert.equal(changed.kind,'stored');if(changed.kind!=='stored')assert.fail();
    const nextRequest={...request,idempotencyKey:randomUUID(),expectedRevision:changed.draft.revision};
    const promoted=journal.validateRunConfigurationDraft(nextRequest);assert.equal(promoted.kind,'ready');
    const next=read();assert.equal(next.kind,'found');if(next.kind!=='found'||old.kind!=='found')assert.fail();
    assert.equal(next.cut.source.configurationRevision,old.cut.source.configurationRevision+1);
    assert.notEqual(next.cut.source.configurationHash,old.cut.source.configurationHash);
    journal.validateRunConfigurationDraft(nextRequest);assert.deepEqual(read(),next);
    const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT COUNT(*) count FROM actor_state_cut_batches').get()?.count,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

for(const invalid of ['unknown-reference','future-date'] as const)test(`lectura rechaza ${invalid} aun si payload, frozen y manifest fueron recalculados`,()=>{
  const f=fixture();try{
    f.change('dim');
    f.mutate(db=>{
      const row=db.prepare("SELECT payload_json FROM actor_state_cuts WHERE actor_id='ausente-prueba' AND commit_index=1").get();assert.ok(row);
      const cut=ActorStateCutSchema.parse(JSON.parse(String(row.payload_json)));const original=cut.experiences[0];assert.ok(original);
      cut.experiences=[freezeExperience({...original.envelope,
        ...(invalid==='unknown-reference'?{kind:'inference',basedOn:[randomUUID()]}:{receivedAt:f.snapshot.clock.instant+1})})];
      const payload=canonical(cut);const hash=createHash('sha256').update(payload).digest('hex');
      db.prepare("UPDATE actor_state_cuts SET payload_json=?,payload_hash=? WHERE actor_id='ausente-prueba' AND commit_index=1").run(payload,hash);
      const batch=db.prepare('SELECT manifest_json FROM actor_state_cut_batches WHERE commit_index=1').get();assert.ok(batch);
      const manifest=JSON.parse(String(batch.manifest_json)) as {actors:{actorId:string;cutHash:string}[]};const entry=manifest.actors.find(item=>item.actorId==='ausente-prueba');assert.ok(entry);entry.cutHash=hash;
      const encoded=canonical(manifest);db.prepare('UPDATE actor_state_cut_batches SET manifest_json=?,manifest_hash=? WHERE commit_index=1').run(encoded,createHash('sha256').update(encoded).digest('hex'));
    });
    assert.deepEqual(f.read(1),{kind:'unavailable',reason:'invalid-cut'});
  }finally{f.close();}
});
