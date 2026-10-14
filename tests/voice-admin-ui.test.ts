import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceConfigSnapshotSchema } from '../src/domain/voice.ts';
import { captureVoiceAdminIntent,buildVoiceAdminRequest,createVoiceAdminClient,VoiceAdminRejection } from '../src/web/voice-admin-client.ts';
import { VoiceHostPanel,parseVoiceQuota } from '../src/web/VoiceHostPanel.tsx';
import { VoiceSoundPanel } from '../src/web/VoiceSoundPanel.tsx';
const runId='11111111-1111-4111-8111-111111111111';const key='22222222-2222-4222-8222-222222222222';
function snapshot(){return VoiceConfigSnapshotSchema.parse({config:{revision:1,spanishVariety:{kind:'confirmed',label:'Español rioplatense',source:'operator',confirmedBy:'local-operator',confirmedAt:'2026-10-14T12:00:00Z'},audioMode:{kind:'disabled'},speakerSlots:{},narratorSlot:{kind:'absent'},soundEffectSlots:{}},baseRunConfigurationRevision:0,baseRunConfigurationHash:'a'.repeat(64),quotaLimits:{voiceDesignCalls:2,ttsCalls:3,sfxCalls:4},updatedBy:'local-operator',updatedAt:'2026-10-14T12:00:00Z'});}

test('audio quota input preserves invalid blank instead of silently converting it to zero',()=>{
  assert.equal(parseVoiceQuota('0'),0);assert.equal(parseVoiceQuota('10000'),10000);
  for(const invalid of ['', ' ', '-1','1.5','1e3','10001','NaN'])assert.throws(()=>parseVoiceQuota(invalid));
});

test('uncertain audio settings retry preserves original body, ETag and key despite later local edits',async()=>{
  const body={audioMode:{kind:'disabled'},speakerSlots:{},narratorSlot:{kind:'absent'},soundEffectSlots:{},quotaLimits:{voiceDesignCalls:2,ttsCalls:3,sfxCalls:4}};
  const intent=captureVoiceAdminIntent({path:`/api/v1/runs/${runId}/voice-settings`,method:'PUT',key,etag:`"voice-config:${runId}:r0"`,body});body.quotaLimits.ttsCalls=999;
  const requests:Array<RequestInit|undefined>=[];let count=0;
  const api=createVoiceAdminClient(async(_url,init)=>{requests.push(init);count++;return count===1?new Response('{}',{status:503}):new Response(JSON.stringify(snapshot()),{status:200,headers:{ETag:`"voice-config:${runId}:r1"`}});},async()=>({csrfToken:'local-csrf',expiresAt:'2026-10-14T13:00:00Z'}));
  await assert.rejects(()=>api.settings(runId,intent));await api.settings(runId,intent);assert.deepEqual(requests[0],requests[1]);assert.equal(JSON.parse(String(requests[1]?.body)).quotaLimits.ttsCalls,3);
});

test('definitive HTTP rejection differs from unknown transport and never reports provider failure as sound',async()=>{
 const api=createVoiceAdminClient(async()=>new Response(JSON.stringify({requestId:key,error:{kind:'conflict',code:'VOICE_CONFIG_STALE',message:'Revisión de voz obsoleta.'}}),{status:409}),async()=>({csrfToken:'csrf',expiresAt:'2026-10-14T13:00:00Z'}));
 await assert.rejects(()=>api.settings(runId),error=>error instanceof VoiceAdminRejection&&error.status===409);
});

test('credential field is password-only and administrative SSR does not start provider calls or enable sound',()=>{
 const html=renderToStaticMarkup(React.createElement(VoiceHostPanel,{runId}));assert.match(html,/type="password"/);assert.match(html,/Máximo de diseños de voz/);assert.doesNotMatch(html,/voiceDesignCalls/);assert.match(html,/<fieldset disabled=""/);assert.match(html,/no se almacena en el navegador/);
 const sound=renderToStaticMarkup(React.createElement(VoiceSoundPanel,{runId,owners:[{id:'fang',label:'Fang'}]}));assert.match(sound,/nunca voz de habla/);assert.match(sound,/<textarea[^>]*><\/textarea>/);assert.match(sound,/disabled=""[^>]*>Generar efecto/);assert.doesNotMatch(sound,/<audio/);
 const request=buildVoiceAdminRequest({path:'/api/v1/integrations/elevenlabs/credential',method:'PUT',key,body:{apiKey:'test-only-not-a-real-key'}},'local-csrf');assert.equal(request.headers['X-CSRF-Token'],'local-csrf');assert.equal(request.headers['Idempotency-Key'],key);
});
