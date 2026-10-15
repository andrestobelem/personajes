import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createElevenLabsClient } from '../src/adapters/elevenlabs.ts';
import { validateRunConfiguration, VoiceReadinessSchema } from '../src/application/production-preflight.ts';
import { canonicalDirectorValue } from '../src/application/director-context.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'personajes-voice-preflight-'));
  const host=openLocalHost({privateDataRoot:root});
  let calls=0;
  const client=createElevenLabsClient({getApiKey:()=> 'synthetic-key',transport:async(url)=>{
    calls++; const path=String(url);
    if(path.includes('/models')) return Response.json([{model_id:'speech-model',name:'Speech',can_do_text_to_speech:true,languages:[{language_id:'es',name:'Spanish'}]}]);
    if(path.includes('/voices'))return Response.json({voices:[{voice_id:'provider-voice',name:'Sintética',description:'Fixture',labels:{language:'es'}}],has_more:false,next_page_token:null});
    if(path.includes('/text-to-speech')) {
      const tone=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-f','mp3','pipe:1']);
      assert.equal(tone.status,0);
      return Response.json({audio_base64:tone.stdout.toString('base64')});
    }
    throw new Error('Unexpected synthetic provider request');
  }});
  const voices=createVoiceRuntime({host,client});
  const original=draftFixture();
  const result=validateRunConfiguration({draft:RunConfigurationDraftSchema.parse({...original,spanishVariety:{kind:'configured',evidence:{kind:'operator-choice',operatorId:'operator',recordedAt:new Date().toISOString()},value:{kind:'confirmed',label:'Español de prueba',source:'operator',confirmedBy:'operator',confirmedAt:new Date().toISOString()}}})});
  assert.equal(result.kind,'ready');if(result.kind!=='ready')assert.fail('Synthetic configuration invalid');
  const configuration=result.configuration;
  host.journal.registerWorldRun({initialSnapshot:configuration.worldSnapshot,configurationRevision:configuration.configRevision,configuration,
    continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,contexts:configuration.roster.preparedCharacters.map(actor=>({actorId:actor.characterId,continuityId:actor.continuity.continuityId,continuityRevision:actor.continuity.revision,continuityContentHash:actor.continuity.contentHash,identityVersion:actor.identityVersion,preparedContextHash:createHash('sha256').update(canonicalDirectorValue(actor)).digest('hex')}))},lifecycle:'ready'});
  const read=()=>voices.readPreflightReadiness({runId:configuration.runId,configRevision:configuration.configRevision});
  const click=()=>({operationId:randomUUID(),principal:'operator',runId:configuration.runId,expectedRevision:voices.config.read(configuration.runId).config.revision});
  return {root,host,voices,configuration,read,click,get calls(){return calls;},async close(){await voices.close();host.close();rmSync(root,{recursive:true,force:true});rmSync(`${root}-auth`,{recursive:true,force:true});}};
}

test('voice preflight reads effective defaults without initializing settings, credentials, receipts or paid calls',async()=>{
  const f=fixture();try {
    const db=new DatabaseSync(join(f.root,'world.sqlite'));
    try {
      const before=db.prepare('SELECT count(*) n FROM voice_config_versions').get();
      const result=VoiceReadinessSchema.parse(await f.read());assert.equal(result.kind,'ready');
      if(result.kind!=='ready')assert.fail();
      assert.equal(result.effectiveConfig?.audioMode.kind,'disabled');assert.equal(result.credential,'missing');
      assert.deepEqual(db.prepare('SELECT count(*) n FROM voice_config_versions').get(),before);
      assert.equal(db.prepare('SELECT count(*) n FROM voice_config_receipts').get()?.n,0);
      assert.equal(f.calls,0);
    }finally{db.close();}
  }finally{await f.close();}
});

test('effective enabled config replaces disabled Ready audio and validates accepted local binding without new provider call',async()=>{
 const f=fixture();try {
  const initial=f.voices.config.read(f.configuration.runId);const actorId=f.configuration.roster.activeCharacterIds[0];assert.ok(actorId);
  f.voices.credentials.replace({apiKey:'synthetic-key'});
  const settings=f.voices.config.update({...f.click(),settings:{audioMode:{kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'speech-model',outputFormat:'mp3_44100_128',subtitles:true},speakerSlots:{[actorId]:{kind:'enabled-unbound'}},narratorSlot:{kind:'absent'},soundEffectSlots:{},quotaLimits:{voiceDesignCalls:0,ttsCalls:2,sfxCalls:0}}});
  assert.equal(initial.config.audioMode.kind,'disabled');assert.equal(settings.config.audioMode.kind,'enabled');
  const draft=await f.voices.service.createBindingDraft(f.click(),{owner:{kind:'character',id:actorId},source:{kind:'providerVoice',providerVoiceId:'provider-voice'},ttsModelId:'speech-model'});
  const queued=f.voices.service.requestBindingTest(f.click(),draft.bindingDraftId,{sampleText:'Texto original de prueba.',sampleOrigin:{kind:'operator-entered'}});
  const executed=await f.voices.service.execute(queued.operationId);const artifactId=executed.artifactIds[0];assert.ok(artifactId);
  f.voices.service.recordListened({artifactId,principal:'operator',idempotencyKey:randomUUID()});
  const accepted=f.voices.service.acceptBinding(f.click(),{kind:'accept',bindingDraftId:draft.bindingDraftId,artifactId});assert.equal(accepted.kind,'accepted');if(accepted.kind!=='accepted')assert.fail();
  f.voices.config.bindSpeech({...f.click(),speechBindingId:accepted.binding.speechBindingId});
  const calls=f.calls;const result=VoiceReadinessSchema.parse(await f.read());assert.equal(result.kind,'ready');if(result.kind!=='ready')assert.fail();
  assert.equal(result.effectiveConfig?.speakerSlots[actorId]?.kind,'enabled-bound');assert.equal(result.bindings.length,1);assert.equal(f.calls,calls);
  assert.throws(()=>f.voices.service.readBindingProof({runId:randomUUID(),kind:'speech',bindingId:accepted.binding.speechBindingId}),/VOICE_BINDING_PROOF_INVALID/);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-key|bindingDraftId|artifactId|principal/);
  unlinkSync(join(f.root,'media',`${artifactId}.bin`));
  assert.deepEqual(await f.read(),{kind:'unavailable',code:'voice-local-evidence-unavailable'});assert.equal(f.calls,calls);
 }finally{await f.close();}
});

test('wrong Ready revision and corrupted effective config fail local readiness without provider requests',async()=>{
 const f=fixture();try {
  assert.equal((await f.voices.readPreflightReadiness({runId:f.configuration.runId,configRevision:f.configuration.configRevision+1})).kind,'unavailable');
  f.voices.config.read(f.configuration.runId);
  const db=new DatabaseSync(join(f.root,'world.sqlite'));try{db.prepare("UPDATE voice_config_versions SET data_hash=? WHERE run_id=?").run('0'.repeat(64),f.configuration.runId);}finally{db.close();}
  assert.equal((await f.read()).kind,'unavailable');assert.equal(f.calls,0);
 }finally{await f.close();}
});
