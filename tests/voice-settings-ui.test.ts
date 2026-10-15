import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceConfigSnapshotSchema } from "../src/domain/voice.ts";
import { VoiceSettingsPanel, changeVoiceSlot, editableVoiceSettings } from "../src/web/VoiceSettingsPanel.tsx";
import { buildVoiceRequest, captureVoiceIntent, createVoiceClient, voiceConfigEtag, VoiceHttpRejection } from "../src/web/voice-client.ts";
const runId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";
function document() {
  const value = VoiceConfigSnapshotSchema.parse({
    config: { revision: 5, spanishVariety: {kind:"proposed", label:"Español de la puesta", source:"editorial-proposal"}, audioMode: {kind:"enabled",language:"es",ttsMode:"manual-per-publication",ttsModelId:"historic-model",outputFormat:"pcm_16000",subtitles:true}, speakerSlots: {max:{kind:"enabled-bound",speechBindingId:bindingId}}, narratorSlot:{kind:"absent"},soundEffectSlots:{fang:{kind:"disabled"}} },
    baseRunConfigurationRevision:3,baseRunConfigurationHash:"a".repeat(64),quotaLimits:{voiceDesignCalls:4,ttsCalls:9,sfxCalls:2},updatedBy:"operator",updatedAt:"2026-10-15T10:00:00.000Z",
  });
  return {value,etag:voiceConfigEtag(runId,5)};
}
test("audio settings capture complete typed payload and retry preserves key, CAS and CSRF", () => {
  const settings = editableVoiceSettings(document());
  const intent = captureVoiceIntent({kind:"settings",runId,key,configRevision:5,settings});
  const request = buildVoiceRequest({intent,csrfToken:"csrf"});
  assert.equal(request.path,`/api/v1/runs/${runId}/voice-settings`);
  assert.equal(request.init.method,"PUT");
  assert.deepEqual(JSON.parse(request.init.body),settings);
  assert.equal(request.init.headers["If-Match"],voiceConfigEtag(runId,5));
  assert.equal(request.init.headers["Idempotency-Key"],key);
  assert.equal(request.init.headers["X-CSRF-Token"],"csrf");
  assert.deepEqual(buildVoiceRequest({intent,csrfToken:"csrf"}),request);
  assert.throws(() => captureVoiceIntent({...intent,settings:{...settings,quotaLimits:{...settings.quotaLimits,ttsCalls:-1}}}));
  assert.throws(() => captureVoiceIntent({...intent,settings:{...settings,quotaLimits:{...settings.quotaLimits,sfxCalls:1.5}}}));
  assert.throws(() => captureVoiceIntent({...intent,settings:{...settings,providerSecret:"secret"}}));
});
test("reconciliation is a separate explicit no-provider command and preserves revision", () => {
  const intent = captureVoiceIntent({kind:"reconcileSettings",runId,key,configRevision:5});
  const request = buildVoiceRequest({intent,csrfToken:"csrf"});
  assert.equal(request.path,`/api/v1/runs/${runId}/voice-settings/reconcile`);
  assert.equal(request.init.method,"POST");
  assert.deepEqual(JSON.parse(request.init.body),{kind:"reconcileBase"});
  assert.equal(request.init.headers["If-Match"],voiceConfigEtag(runId,5));
  assert.equal(request.init.headers["Idempotency-Key"],key);
});
test("slot controls retain only existing bindings or set explicit disabled/unbound", () => {
  const saved = editableVoiceSettings(document());
  const disabled = changeVoiceSlot({settings:saved,saved,section:"speaker",id:"max",selection:"disabled"});
  assert.deepEqual(disabled.speakerSlots.max,{kind:"disabled"});
  const restored = changeVoiceSlot({settings:disabled,saved,section:"speaker",id:"max",selection:"preserve"});
  assert.deepEqual(restored.speakerSlots.max,saved.speakerSlots.max);
  assert.deepEqual(changeVoiceSlot({settings:saved,saved,section:"effect",id:"fang",selection:"enabled-unbound"}).soundEffectSlots.fang,{kind:"enabled-unbound"});
  assert.throws(() => changeVoiceSlot({settings:saved,saved,section:"effect",id:"fang",selection:"preserve"}));
  assert.deepEqual(changeVoiceSlot({settings:saved,saved,section:"narrator",id:"narrator",selection:"enabled-unbound"}).narratorSlot,{kind:"enabled-unbound"});
  assert.throws(() => changeVoiceSlot({settings:saved,saved,section:"speaker",id:"max",selection:bindingId}));
});
test("settings panel exposes complete operational controls and labels prior preparation without a raw binding field", () => {
  const html = renderToStaticMarkup(React.createElement(VoiceSettingsPanel,{runId,document:document(),owners:[{owner:{kind:"character",id:"max"},label:"Max <privado>",speakable:true}],soundOwners:[{id:"fang",label:"Fang"}],models:[],blocked:false,stale:true,onIntent(){},onConsultModels(){}}));
  for (const text of ["Modo de audio","Generación TTS","Modelo del audio","Formato del audio","Subtítulos","Cuota Voice Design","Cuota TTS","Cuota SFX","Conservar vinculación guardada · comprobar en preflight","Conciliar con la preparación actual","se conserva el modo de audio anterior","no confirmado en el catálogo consultado","Guardar configuración de audio · sin generar"]) assert.ok(html.includes(text),text);
  assert.ok(html.includes("Max &lt;privado&gt;"));
  assert.ok(!html.includes(bindingId));
  assert.match(html,/aria-label="Modo de audio" disabled=""/);
});
test("client parses reconciliation snapshot and settings response with exact etag", async () => {
  const calls:Array<{url:string;method:string|undefined}>=[];
  const doc = document();
  const api=createVoiceClient(async (url,init) => { calls.push({url:String(url),method:init?.method});return new Response(JSON.stringify(String(url).endsWith("/reconciliation") ? {kind:"voice-reconciliation-context",snapshot:doc.value,baseStale:true}:doc.value),{status:200,headers:{etag:doc.etag}}); },async()=>({csrfToken:"csrf",expiresAt:"2026-10-16T00:00:00.000Z"}));
  assert.deepEqual(await api.reconciliationContext(runId,new AbortController().signal),{document:doc,baseStale:true});
  const result=await api.mutate(captureVoiceIntent({kind:"settings",runId,key,configRevision:5,settings:editableVoiceSettings(doc)}),new AbortController().signal);
  assert.deepEqual(result,{kind:"settings",document:doc});
  assert.equal(calls.length,2);
  assert.ok(calls.every(({url})=>url.startsWith(`/api/v1/runs/${runId}/voice-settings`)));
});
test("client identifies only structured stale errors and rejects mismatched reconciliation etags",async()=>{
  const api=createVoiceClient(async()=>new Response(JSON.stringify({error:{kind:"conflict",code:"VOICE_BASE_CONFIGURATION_STALE",message:"La fuente cambió."},requestId:key}),{status:409}),async()=>({csrfToken:"csrf",expiresAt:"2026-10-16T00:00:00.000Z"}));
  await assert.rejects(api.settings(runId,new AbortController().signal),(error:unknown)=>error instanceof VoiceHttpRejection && error.safeCode==="VOICE_BASE_CONFIGURATION_STALE");
  const bad=createVoiceClient(async()=>new Response(JSON.stringify({kind:"voice-reconciliation-context",snapshot:document().value,baseStale:true}),{status:200,headers:{etag:voiceConfigEtag(runId,6)}}),async()=>({csrfToken:"csrf",expiresAt:"2026-10-16T00:00:00.000Z"}));
  await assert.rejects(bad.reconciliationContext(runId,new AbortController().signal),/revisión para conciliación/);
});

test("narrator absent from eligible owners cannot enable a new slot", () => {
  const html = renderToStaticMarkup(React.createElement(VoiceSettingsPanel,{runId,document:document(),owners:[],soundOwners:[],models:[],blocked:false,stale:false,onIntent(){},onConsultModels(){}}));
  const selector = html.match(/<select aria-label="Slot Narrador"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(selector);
  assert.ok(selector.includes('value="absent"'));
  assert.ok(!selector.includes('value="enabled-unbound"'));
  assert.ok(html.includes("La narración textual está apagada"));
  const prior = document();
  const bound = prior.value.config.speakerSlots.max;
  assert.ok(bound?.kind === "enabled-bound");
  prior.value.config.narratorSlot = {kind:"enabled-bound",speechBindingId:bound.speechBindingId};
  const preserved = renderToStaticMarkup(React.createElement(VoiceSettingsPanel,{runId,document:prior,owners:[],soundOwners:[],models:[],blocked:false,stale:false,onIntent(){},onConsultModels(){}}));
  assert.match(preserved, /<select aria-label="Slot Narrador"[^>]*>[\s\S]*?value="preserve"/);
});
