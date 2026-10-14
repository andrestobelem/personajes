import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { acquireHostOwnership } from '../src/adapters/host-ownership.ts';
import { createElevenLabsClient } from '../src/adapters/elevenlabs.ts';
import { openVoiceService } from '../src/application/voice-service.ts';
import { VoiceConfigSchema } from '../src/domain/voice.ts';
import { openVoiceConfigStore } from '../src/application/voice-config-store.ts';
import { voiceHash } from '../src/application/voice-hash.ts';

function setup() {
  const root=mkdtempSync(join(tmpdir(),'personajes-voice-integrity-review-'));
  const ownership=acquireHostOwnership({privateDataRoot:root});
  const dispatched: unknown[]=[];
  const config=VoiceConfigSchema.parse({revision:0,spanishVariety:{kind:'confirmed',label:'español rioplatense',source:'operator',confirmedBy:'operator',confirmedAt:new Date().toISOString()},audioMode:{kind:'disabled'},speakerSlots:{max:{kind:'disabled'}},narratorSlot:{kind:'absent'},soundEffectSlots:{}});
  const client=createElevenLabsClient({getApiKey:()=> 'synthetic-local-key',transport:async (_url,options)=>{dispatched.push(JSON.parse(String(options?.body)));throw new Error('Deterministic transport ends without provider');}});
  const service=openVoiceService({privateDataRoot:root,ownerToken:ownership.ownerToken,client,hasCredential:()=>true,readConfig:()=>config,readPublication:()=>null,speakableIds:()=>['max'],quotaLimits:()=>({voiceDesignCalls:2,ttsCalls:2,sfxCalls:2})});
  const click={operationId:randomUUID(),runId:'run',principal:'operator',expectedRevision:0};
  const request={owner:{kind:'character',id:'max'},sampleText:'Este texto original se usa para comparar una voz española clara y natural durante una prueba sintética de interpretación.',sampleOrigin:{kind:'operator-entered'},voiceDescription:'Una voz original en español rioplatense clara y natural.',modelId:'eleven_ttv_v3',language:'es',originalSampleConfirmed:true,descriptionReviewed:true};
  function alter(column:'work'|'data',change:(value:Record<string,unknown>)=>Record<string,unknown>) {
    const database=new DatabaseSync(join(root,'world.sqlite'));
    try {
      const row=database.prepare(`SELECT ${column} value FROM voice_operations WHERE id=?`).get(click.operationId);
      assert.ok(row);
      assert.equal(typeof row?.value,'string');
      database.prepare(`UPDATE voice_operations SET ${column}=? WHERE id=?`).run(JSON.stringify(change(JSON.parse(String(row.value)))),click.operationId);
    } finally { database.close(); }
  }
  return {root,service,click,request,dispatched,alter,cleanup(){try{service.close();}finally{ownership.release();rmSync(root,{recursive:true,force:true});}}};
}

test('frozen Voice Design work alterado se rechaza antes de transporte',async()=>{
  const fixture=setup();
  try {
    await fixture.service.requestDesign(fixture.click,fixture.request);
    fixture.alter('work',work=>({...work,request:{...(work.request as Record<string,unknown>),sampleText:'Texto sustituido sin autorización que cumple el mínimo de longitud para una prueba de integridad del trabajo administrativo congelado.'}}));
    try { await fixture.service.execute(fixture.click.operationId); } catch { /* Integrity failure may be a thrown error or a durable failed job. */ }
    assert.equal(fixture.dispatched.length,0,'La alteración del trabajo no debe llamar al transporte');
  } finally {fixture.cleanup();}
});

test('JSON work inválido libera el slot activo incluso cuando metadata hash coincide',async()=>{
  const fixture=setup();
  try {
    await fixture.service.requestDesign(fixture.click,fixture.request);
    const database=new DatabaseSync(join(fixture.root,'world.sqlite'));
    try {const work='{';database.prepare('UPDATE voice_operations SET work=?,work_hash=? WHERE id=?').run(work,voiceHash(JSON.stringify({id:fixture.click.operationId,principal:fixture.click.principal,runId:fixture.click.runId,work})),fixture.click.operationId);} finally {database.close();}
    await fixture.service.execute(fixture.click.operationId);
    assert.equal(fixture.dispatched.length,0);
    assert.doesNotThrow(()=>fixture.service.close());
  } finally {fixture.cleanup();}
});

test('binding con hash contextual válido conserva identidad semántica de la clave SQL',()=>{
  const fixture=setup();
  try {
    const key=randomUUID();
    const binding={kind:'speech',speechBindingId:randomUUID(),owner:{kind:'character',id:'max'},provider:'elevenlabs',voiceId:'synthetic-voice',voiceName:'Voz sintética',voiceDescription:'Sintética',language:'es',ttsModelId:'synthetic-model',varietyLabel:'español rioplatense',configRevision:0,validationEvidenceId:randomUUID(),provenance:{kind:'existing-provider-voice-selected',providerCatalogRef:'synthetic'}};
    const data=JSON.stringify(binding);const database=new DatabaseSync(join(fixture.root,'world.sqlite'));
    try {database.prepare('INSERT INTO voice_entities(kind,id,data,data_hash) VALUES(?,?,?,?)').run('binding',key,data,voiceHash(JSON.stringify({kind:'binding',id:key,data})));}finally{database.close();}
    assert.throws(()=>fixture.service.getBinding(key));
  } finally {fixture.cleanup();}
});

test('staged media con hash válido no puede declarar otra operationId',async()=>{
  const fixture=setup();
  try {
    await fixture.service.requestDesign(fixture.click,fixture.request);
    const database=new DatabaseSync(join(fixture.root,'world.sqlite'));
    try {
      const row=database.prepare('SELECT data FROM voice_operations WHERE id=?').get(fixture.click.operationId);assert.ok(row);
      const op=JSON.parse(String(row.data));op.state='response-received';const data=JSON.stringify(op);
      database.prepare('UPDATE voice_operations SET data=?,data_hash=? WHERE id=?').run(data,voiceHash(JSON.stringify({id:fixture.click.operationId,principal:fixture.click.principal,runId:fixture.click.runId,data})),fixture.click.operationId);
      const artifactId=randomUUID();const bytes=Buffer.from('synthetic-media');
      const metadata=JSON.stringify({artifactId,operationId:randomUUID(),kind:'preview',state:'available',sourceId:'synthetic',text:'Muestra',textHash:voiceHash('Muestra'),textRevision:0,configRevision:0,modelId:'eleven_ttv_v3',bindingId:null,mediaType:'audio/mpeg',byteLength:bytes.byteLength,hash:voiceHash(bytes),providerAudioHash:voiceHash(bytes),providerOutputFormat:null,durationSeconds:null,subtitles:{kind:'unverified',text:'Muestra'}});
      database.prepare('INSERT INTO voice_staged_media(operation_id,artifact_id,metadata,bytes,metadata_hash) VALUES(?,?,?,?,?)').run(fixture.click.operationId,artifactId,metadata,bytes,voiceHash(JSON.stringify({operationId:fixture.click.operationId,artifactId,metadata})));
    } finally {database.close();}
    await assert.rejects(()=>fixture.service.reconcileLocal(fixture.click.operationId,fixture.click.principal),/SCOPE/);
    assert.equal(fixture.dispatched.length,0);
  } finally {fixture.cleanup();}
});

test('operation.data no puede cambiar el principal autenticado guardado en la fila SQL',async()=>{
  const fixture=setup();
  try {
    await fixture.service.requestDesign(fixture.click,fixture.request);
    fixture.alter('data',data=>({...data,principal:'other-principal'}));
    assert.throws(()=>fixture.service.getOperation(fixture.click.operationId,'other-principal'));
  } finally {fixture.cleanup();}
});

test('snapshot de configuración de voz alterado no se acepta por conservar hash del core',()=>{
  const root=mkdtempSync(join(tmpdir(),'personajes-voice-config-review-'));
  const ownership=acquireHostOwnership({privateDataRoot:root});
  const initial=VoiceConfigSchema.parse({revision:0,spanishVariety:{kind:'proposed',source:'editorial-proposal',label:'español rioplatense'},audioMode:{kind:'disabled'},speakerSlots:{max:{kind:'disabled'}},narratorSlot:{kind:'absent'},soundEffectSlots:{}});
  const store=openVoiceConfigStore({privateDataRoot:root,ownerToken:ownership.ownerToken,readBaseConfiguration:()=>({configurationRevision:0,configurationHash:'a'.repeat(64),voiceConfig:initial,speakableIds:['max']}),readSpeechBinding:()=>undefined,readSoundBinding:()=>undefined,initialQuotaLimits:{voiceDesignCalls:2,ttsCalls:2,sfxCalls:2}});
  try {
    store.read('run');
    const database=new DatabaseSync(join(root,'world.sqlite'));
    try {
      const row=database.prepare('SELECT data FROM voice_config_versions WHERE run_id=? AND revision=0').get('run');
      assert.ok(row);
      assert.equal(typeof row?.data,'string');
      const snapshot=JSON.parse(String(row.data));
      snapshot.quotaLimits.voiceDesignCalls=99999;
      database.prepare('UPDATE voice_config_versions SET data=? WHERE run_id=? AND revision=0').run(JSON.stringify(snapshot),'run');
    } finally {database.close();}
    assert.throws(()=>store.read('run'));
  } finally {store.close();ownership.release();rmSync(root,{recursive:true,force:true});}
});
