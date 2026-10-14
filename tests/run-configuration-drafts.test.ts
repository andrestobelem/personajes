import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJournal } from '../src/adapters/journal.ts';
import { setup as setupWorldFixture } from './fixtures/continuista.ts';
import { ReadyRunConfigurationSchema, validateRunConfiguration } from '../src/application/production-preflight.ts';

const principalId='host-operator-test';
function uuid(number:number){return `00000000-0000-4000-8000-${number.toString(16).padStart(12,'0')}`;}
const forgedEvidence={kind:'operator-choice',operatorId:'spoofed-client',recordedAt:'1900-01-01T00:00:00Z'};

test('draft vacío durable usa ID/autor host, historial e idempotencia tras migración v16/restart sin WorldRun',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-draft-v17-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    journal.configureRun({runId:uuid(1),maxCalls:4});journal.close();
    const before=new DatabaseSync(path);
    try{before.exec('DROP TABLE model_time_spans;DROP TABLE model_time_run_state;DROP TABLE run_preflight_job_operations;DROP TABLE run_preflight_job_results;DROP TABLE run_preflight_job_history;DROP TABLE run_preflight_jobs;DROP TABLE pi_access_job_operations;DROP TABLE pi_access_job_results;DROP TABLE pi_access_job_history;DROP TABLE pi_access_jobs;DROP TABLE pi_oauth_job_operations;DROP TABLE pi_oauth_job_history;DROP TABLE pi_oauth_jobs;DROP TABLE run_draft_validation_reports;DROP TABLE run_draft_operations;DROP TABLE run_configuration_draft_history;DROP TABLE run_configuration_drafts;DELETE FROM schema_version WHERE version IN(17,18,19,20,21,22,23,24,25,26,27);');}finally{before.close();}
    journal=openJournal({path});
    const request={principalId,idempotencyKey:uuid(2)};
    const first=journal.createRunConfigurationDraft(request);if(first.kind!=='created')assert.fail('Draft no creado');
    assert.equal(first.draft.revision,0);assert.equal(first.draft.name.kind,'empty');assert.equal(first.draft.fictionalAt.kind,'empty');
    assert.equal(first.draft.worldSnapshot.kind,'empty');assert.equal(first.draft.roster.kind,'empty');
    assert.equal(validateRunConfiguration({draft:first.draft}).kind,'incomplete');
    journal.close();journal=openJournal({path});
    const replay=journal.createRunConfigurationDraft(request);if(replay.kind!=='existing')assert.fail('Replay no recuperado');
    assert.deepEqual(replay.draft,first.draft);assert.deepEqual(journal.readRunConfigurationDraft({runId:first.draft.runId}),first.draft);
    assert.equal(journal.createRunConfigurationDraft({...request,patch:{name:{kind:'empty'}}}).kind,'idempotencyConflict');
    const other=journal.createRunConfigurationDraft({...request,principalId:'another-host-principal'});assert.equal(other.kind,'created');
    assert.equal(journal.listRunConfigurationDrafts().length,2);
    const history=journal.readRunConfigurationDraftHistory({runId:first.draft.runId});assert.equal(history.length,1);assert.equal(history[0]?.principalId,principalId);
    assert.match(history[0]?.recordedAt??'',/^\d{4}-\d{2}-\d{2}T/);
    const inspect=new DatabaseSync(path);try{
      assert.equal(inspect.prepare('SELECT MAX(version) version FROM schema_version').get()?.version,27);
      assert.equal(inspect.prepare('SELECT max_calls FROM run_budgets WHERE run_id=?').get(uuid(1))?.max_calls,4);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events').get()?.n,0);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);
      assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('draft CAS y replay preservan revisiones, evidencia host y valores ficticios explícitos',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-draft-cas-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});let second:ReturnType<typeof openJournal>|undefined;
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(10),patch:{name:{kind:'configured',value:'Mi puesta',evidence:forgedEvidence}}});
    if(created.kind!=='created')assert.fail('Sin draft');const runId=created.draft.runId;
    assert.equal(created.draft.name.kind,'configured');if(created.draft.name.kind!=='configured')assert.fail('Sin nombre');
    assert.equal(created.draft.name.evidence.kind,'operator-choice');if(created.draft.name.evidence.kind!=='operator-choice')assert.fail('Sin evidencia');
    assert.equal(created.draft.name.evidence.operatorId,principalId);assert.notEqual(created.draft.name.evidence.recordedAt,forgedEvidence.recordedAt);
    const update={principalId,idempotencyKey:uuid(11),runId,expectedRevision:0,patch:{
      fictionalAt:{kind:'configured',value:0,evidence:forgedEvidence},
      worldSnapshot:{kind:'configured',value:{runId:uuid(999),clock:{instant:0,convention:{kind:'fixedOffset',offsetMinutes:0,label:'UTC de prueba'}}},evidence:forgedEvidence},
      spanishVariety:{kind:'configured',value:{kind:'confirmed',label:'Español elegido',source:'operator',confirmedBy:'spoof',confirmedAt:'1900-01-01T00:00:00Z'},evidence:forgedEvidence},
    }};
    second=openJournal({path});const first=journal.updateRunConfigurationDraft(update);if(first.kind!=='stored')assert.fail('Sin update');
    assert.equal(first.draft.revision,1);assert.equal(first.draft.fictionalAt.kind,'configured');
    if(first.draft.fictionalAt.kind==='configured')assert.equal(first.draft.fictionalAt.value,0,'el host no inventa la fecha ficticia');
    if(first.draft.worldSnapshot.kind!=='configured')assert.fail('Sin snapshot');assert.equal(first.draft.worldSnapshot.value.runId,runId);
    if(first.draft.spanishVariety.kind!=='configured'||first.draft.spanishVariety.value.kind!=='confirmed')assert.fail('Sin variedad');
    assert.equal(first.draft.spanishVariety.value.confirmedBy,principalId);assert.notEqual(first.draft.spanishVariety.value.confirmedAt,'1900-01-01T00:00:00Z');
    assert.equal(validateRunConfiguration({draft:first.draft}).kind,'incomplete','guardar candidato no lo valida ni crea un Escenario');
    const conflictRequest={...update,idempotencyKey:uuid(12),patch:{name:{kind:'empty'}}};
    assert.deepEqual(second.updateRunConfigurationDraft(conflictRequest),{kind:'conflict',currentRevision:1});
    const newer=journal.updateRunConfigurationDraft({...update,idempotencyKey:uuid(13),expectedRevision:1,patch:{name:{kind:'empty'}}});assert.equal(newer.kind,'stored');
    assert.deepEqual(second.updateRunConfigurationDraft(conflictRequest),{kind:'conflict',currentRevision:1},'replay conserva diagnóstico original aunque CAS actual avanzó');
    journal.close();journal=openJournal({path});const replay=journal.updateRunConfigurationDraft(update);if(replay.kind!=='existing')assert.fail('Sin replay');assert.deepEqual(replay.draft,first.draft);
    assert.equal(journal.updateRunConfigurationDraft({...update,patch:{name:{kind:'empty'}}}).kind,'idempotencyConflict');
    assert.equal(journal.createRunConfigurationDraft({principalId,idempotencyKey:update.idempotencyKey}).kind,'idempotencyConflict','clave compartida entre operaciones de borrador');
    assert.deepEqual(journal.readRunConfigurationDraft({runId,revision:0}),created.draft);assert.equal(journal.readRunConfigurationDraftHistory({runId}).length,3);
    assert.equal(journal.readRunConfigurationDraft({runId})?.revision,2);
    assert.throws(()=>journal.updateRunConfigurationDraft({...update,patch:{runId:uuid(50)}}));
    assert.throws(()=>journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(14),runId:uuid(51)}));
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,0);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM request_reservations').get()?.n,0);}finally{inspect.close();}
  }finally{second?.close();journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('draft history y resultado idempotente detectan corrupción del payload y metadata',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-draft-integrity-'));const path=join(directory,'journal.sqlite');const journal=openJournal({path});
  try{
    const create={principalId,idempotencyKey:uuid(20)};const result=journal.createRunConfigurationDraft(create);if(result.kind!=='created')assert.fail('Sin draft');
    const missing={principalId,idempotencyKey:uuid(21),runId:uuid(90),expectedRevision:0,patch:{name:{kind:'empty'}}};assert.equal(journal.updateRunConfigurationDraft(missing).kind,'missing');assert.equal(journal.updateRunConfigurationDraft(missing).kind,'missing');
    const inspect=new DatabaseSync(path);try{inspect.prepare('UPDATE run_configuration_draft_history SET principal_id=? WHERE run_id=?').run('spoofed-principal',result.draft.runId);
      assert.throws(()=>journal.readRunConfigurationDraft({runId:result.draft.runId}),/metadatos/);
      inspect.prepare('UPDATE run_draft_operations SET result_json=? WHERE principal_id=? AND idempotency_key=?').run('{}',principalId,create.idempotencyKey);
      assert.throws(()=>journal.createRunConfigurationDraft(create));
    }finally{inspect.close();}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});


test('draft World usa campos estructurales cerrados sin requerir completar Escenario',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-draft-worlddto-'));const journal=openJournal({path:join(directory,'journal.sqlite')});
  try{
    const request={principalId,idempotencyKey:uuid(30),patch:{worldSnapshot:{kind:'configured',value:{places:[{id:'sala',name:'Sala a completar',description:'Lugar definido por operador'}]},evidence:forgedEvidence}}};
    const created=journal.createRunConfigurationDraft(request);if(created.kind!=='created')assert.fail('Incompleto no guardable');
    if(created.draft.worldSnapshot.kind!=='configured')assert.fail('Sin candidate');assert.deepEqual(created.draft.worldSnapshot.value,{places:[{id:'sala',name:'Sala a completar',description:'Lugar definido por operador'}],runId:created.draft.runId});
    assert.equal(validateRunConfiguration({draft:created.draft}).kind,'incomplete');
    for(const key of ['authPath','sessionPath','apiKey','privateDataRoot','systemPrompt']){
      assert.throws(()=>journal.createRunConfigurationDraft({...request,idempotencyKey:uuid(31),patch:{worldSnapshot:{kind:'configured',value:{[key]:'secret'},evidence:forgedEvidence}}}));
      assert.throws(()=>journal.createRunConfigurationDraft({...request,idempotencyKey:uuid(31),patch:{worldSnapshot:{kind:'configured',value:{clock:{instant:0,convention:{kind:'fixedOffset',offsetMinutes:0,label:'UTC'},[key]:'secret'}},evidence:forgedEvidence}}}));
    }
    assert.equal(journal.listRunConfigurationDrafts().length,1,'DTO rechazados no crean borradores ni operaciones');
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

function canonical(value:unknown):string{
  if(value===null||typeof value!=='object'){const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Dato no serializable');return encoded;}
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

test('draft nuevo se bloquea al registrar World activo y replay anterior conserva resultado sin efectos',async()=>{
  const template=await setupWorldFixture();const directory=mkdtempSync(join(tmpdir(),'personajes-draft-lifecycle-'));const journal=openJournal({path:join(directory,'journal.sqlite')});
  try{
    const created=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(40)});if(created.kind!=='created')assert.fail('Sin draft');
    const command={principalId,idempotencyKey:uuid(41),runId:created.draft.runId,expectedRevision:0,patch:{name:{kind:'configured',value:'Puesta elegida',evidence:forgedEvidence}}};
    const updated=journal.updateRunConfigurationDraft(command);if(updated.kind!=='stored')assert.fail('Sin update');
    const world={...template.configuration.worldSnapshot,runId:created.draft.runId,entities:template.configuration.worldSnapshot.entities.map((entity)=>entity.kind==='character'?{...entity,mind:{...entity.mind,experiences:[]}}:entity)};
    journal.registerWorldRun({initialSnapshot:world,configurationRevision:1,configuration:{test:'explicit-synthetic-world'},lifecycle:'ready',continuityFence:{kind:'prepared-contexts',atWorldSeq:world.seq,
      contexts:template.configuration.roster.preparedCharacters.filter((item)=>world.scenes.find((scene)=>scene.id===world.activeSceneId)?.participantIds.includes(item.characterId)).map((item)=>({actorId:item.characterId,
        continuityId:item.continuity.continuityId,continuityRevision:item.continuity.revision,continuityContentHash:item.continuity.contentHash,identityVersion:item.identityVersion,
        preparedContextHash:createHash('sha256').update(canonical(item)).digest('hex')}))}});
    const readyEdited=journal.updateRunConfigurationDraft({...command,idempotencyKey:uuid(44),expectedRevision:1,patch:{name:{kind:'configured',value:'Puesta revisada antes de actuar',evidence:forgedEvidence}}});
    if(readyEdited.kind!=='stored')assert.fail('Ready no admite edición');
    assert.equal(ReadyRunConfigurationSchema.safeParse(journal.readWorldConfiguration({runId:created.draft.runId})).success,false);
    const invalidation=new DatabaseSync(join(directory,'journal.sqlite'));try{assert.equal(invalidation.prepare('SELECT lifecycle FROM world_runs WHERE run_id=?').get(created.draft.runId)?.lifecycle,'draft');assert.equal(invalidation.prepare('SELECT config_revision FROM world_runs WHERE run_id=?').get(created.draft.runId)?.config_revision,2);}finally{invalidation.close();}
    assert.deepEqual(journal.loadWorld({runId:created.draft.runId}),world);
    assert.equal(journal.readWorldEvents({runId:created.draft.runId}).length,0);
    // Transiciones mecánicas sintéticas para ejercitar el guard independiente; no son una promoción Ready real.
    assert.equal(journal.setWorldLifecycle({runId:created.draft.runId,expectedWorldRevision:world.revision,expectedConfigRevision:2,target:'ready'}),'updated');
    assert.equal(journal.setWorldLifecycle({runId:created.draft.runId,expectedWorldRevision:world.revision,expectedConfigRevision:2,target:'running'}),'updated');
    const rejected=journal.updateRunConfigurationDraft({...command,idempotencyKey:uuid(42),expectedRevision:2});assert.deepEqual(rejected,{kind:'invalidLifecycle',lifecycle:'running'});
    const replay=journal.updateRunConfigurationDraft(command);if(replay.kind!=='existing')assert.fail('Replay previo perdido');assert.deepEqual(replay.draft,updated.draft);
    assert.equal(journal.readRunConfigurationDraftHistory({runId:created.draft.runId}).length,3);assert.equal(journal.readRunConfigurationDraft({runId:created.draft.runId})?.revision,2);
    assert.equal(journal.setWorldLifecycle({runId:created.draft.runId,expectedWorldRevision:world.revision,expectedConfigRevision:2,target:'paused'}),'updated');
    assert.deepEqual(journal.updateRunConfigurationDraft({...command,idempotencyKey:uuid(43),expectedRevision:2}),{kind:'invalidLifecycle',lifecycle:'paused'});
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});template.close();}
});


test('defaults host y evidencia de campos sin cambio se preservan al enviar formulario completo',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-draft-evidence-'));const journal=openJournal({path:join(directory,'journal.sqlite')});
  try{
    const empty=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(50)});if(empty.kind!=='created')assert.fail('Sin draft');
    const defaults={audio:empty.draft.audio,humanParticipants:empty.draft.humanParticipants,narrationMode:empty.draft.narrationMode,maxReformulations:empty.draft.maxReformulations};
    const second=journal.createRunConfigurationDraft({principalId,idempotencyKey:uuid(51),patch:defaults});if(second.kind!=='created')assert.fail('Sin segundo draft');
    for(const key of ['audio','humanParticipants','narrationMode','maxReformulations'] satisfies (keyof typeof defaults)[]){assert.deepEqual(second.draft[key],defaults[key]);if(second.draft[key].kind!=='configured')assert.fail('Default sin campo');}
    const first=journal.updateRunConfigurationDraft({principalId,idempotencyKey:uuid(52),runId:empty.draft.runId,expectedRevision:0,patch:{name:{kind:'configured',value:'Nombre elegido',evidence:forgedEvidence}}});if(first.kind!=='stored')assert.fail('Sin nombre');
    if(first.draft.name.kind!=='configured')assert.fail('Sin campo nombre');
    const again=journal.updateRunConfigurationDraft({principalId:'another-host-principal',idempotencyKey:uuid(53),runId:first.draft.runId,expectedRevision:1,
      patch:{...defaults,name:{...first.draft.name,evidence:forgedEvidence}}});if(again.kind!=='stored')assert.fail('Sin update');
    assert.deepEqual(again.draft.name,first.draft.name,'el eco del formulario no es una nueva elección de otro principal');
    for(const key of ['audio','humanParticipants','narrationMode','maxReformulations'] satisfies (keyof typeof defaults)[])assert.deepEqual(again.draft[key],defaults[key]);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
