import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {applyOperationalDefaults,OperationalDefaultPresetSchema} from '../src/web/operational-defaults.ts';
import {RunConfigurationDraftSchema} from '../src/domain/production.ts';
import {CLAUDE_INFERENCE_PROFILE} from '../src/domain/inference-profile.ts';
import {createIcmWorkspaceSnapshot,hashIcmMarkdown} from '../src/domain/icm-workspace.ts';
import {draftFixture} from './fixtures/continuista.ts';

const recordedAt='2026-10-16T16:00:00Z';
test('elegir actuación libre cambia sólo cinco secciones operativas y conserva ficción/modelo/ICM',()=>{
  const draft=draftFixture();
  const before=JSON.stringify(draft);
  const result=applyOperationalDefaults({draft,presetId:'free-performance',operatorId:'test-operator',recordedAt});
  assert.equal(JSON.stringify(draft),before,'el helper no muta el borrador original');
  assert.deepEqual(Object.keys(result).filter(key=>JSON.stringify(result[RunConfigurationDraftSchema.keyof().parse(key)])!==JSON.stringify(draft[RunConfigurationDraftSchema.keyof().parse(key)])).sort(),['audio','budget','circadianPolicy','narrationMode','spanishVariety']);
  assert.deepEqual(result.budget.kind==='configured'&&result.budget.value,{maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:300000});
  assert.deepEqual(result.circadianPolicy.kind==='configured'&&result.circadianPolicy.value,{kind:'advance-while-running',maxAdvanceMs:60000});
  assert.equal(result.spanishVariety.kind==='configured'&&result.spanishVariety.value.kind,'proposed');
  assert.deepEqual(result.inferenceProfile,draft.inferenceProfile);
  assert.equal(result.revision,draft.revision);
});

test('dirección manual y narración textual son elecciones explícitas; audio permanece independiente',()=>{
  const draft=draftFixture();
  const manual=applyOperationalDefaults({draft,presetId:'manual-direction',operatorId:'test-operator',recordedAt});
  assert.deepEqual(manual.circadianPolicy.kind==='configured'&&manual.circadianPolicy.value,{kind:'manual-only'});
  assert.equal(manual.narrationMode.kind==='configured'&&manual.narrationMode.value.kind,'disabled');
  const narrator=applyOperationalDefaults({draft,presetId:'text-narrator',operatorId:'test-operator',recordedAt});
  assert.equal(narrator.narrationMode.kind==='configured'&&narrator.narrationMode.value.kind,'enabled');
  assert.equal(narrator.audio.kind==='configured'&&narrator.audio.value.mode.kind,'disabled');
  assert.equal(OperationalDefaultPresetSchema.safeParse('unknown').success,false);
});

test('conserva Claude, fuente ICM y vínculos existentes sin crear credenciales o IDs de voz',()=>{
  const base=draftFixture();const actor=base.roster.kind==='configured'?base.roster.value.activeCharacterIds[0]:undefined;assert.ok(actor);
  const voiceId=randomUUID(),narratorVoiceId=randomUUID();
  const draft=RunConfigurationDraftSchema.parse({...base,
    inferenceProfile:{kind:'configured',value:CLAUDE_INFERENCE_PROFILE,evidence:{kind:'operator-choice',operatorId:'previous',recordedAt}},
    icmWorkspace:{kind:'configured',evidence:{kind:'operator-choice',operatorId:'previous',recordedAt},value:createIcmWorkspaceSnapshot({sources:[{sourceId:'role.configurator',audience:{role:'configurator'},revision:0,sourceHash:hashIcmMarkdown('Contrato congelado'),sections:[{sectionId:'process',markdown:'Contrato congelado'}]}]})},
    audio:{kind:'configured',evidence:{kind:'operator-choice',operatorId:'previous',recordedAt},value:{
      mode:{kind:'enabled',language:'es',ttsMode:'manual-per-publication',ttsModelId:'operator-model',outputFormat:'mp3_44100_128',subtitles:true},
      speakerSlots:[{characterId:actor,slot:{kind:'enabled-bound',speechBindingId:voiceId}}],narratorSlot:{kind:'enabled-bound',speechBindingId:narratorVoiceId},soundEffectSlots:[],
    }},
  });
  const result=applyOperationalDefaults({draft,presetId:'free-performance',operatorId:'test-operator',recordedAt});
  assert.deepEqual(result.inferenceProfile,draft.inferenceProfile);
  assert.deepEqual(result.icmWorkspace,draft.icmWorkspace);
  if(result.audio.kind!=='configured'||draft.audio.kind!=='configured')assert.fail('Audio no configurado');
  assert.deepEqual(result.audio.value.speakerSlots,draft.audio.value.speakerSlots);
  assert.deepEqual(result.audio.value.narratorSlot,draft.audio.value.narratorSlot);
  assert.deepEqual(result.humanParticipants,draft.humanParticipants);
  assert.equal(result.audio.value.mode.kind,'disabled');
});
