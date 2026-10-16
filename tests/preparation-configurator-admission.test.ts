import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_INFERENCE_PROFILE,CLAUDE_INFERENCE_PROFILE} from '../src/domain/inference-profile.ts';
import {HashSchema} from '../src/domain/values.ts';
import {fingerprintInferenceProfile} from '../src/application/pi-access-check.ts';
import {requirePreparationConfiguratorAdmission,type PreparationConfiguratorAdmissionHost} from '../src/application/preparation-configurator-admission.ts';

function fixture(profile=DEFAULT_INFERENCE_PROFILE){
  const fingerprint=HashSchema.parse(fingerprintInferenceProfile(profile)),account=HashSchema.parse('a'.repeat(64)),now=Date.parse('2026-10-16T12:00:00Z');let reads=0;
  const sdk={kind:'ready',piCodingAgentVersion:'1.2.0',piAiVersion:'1.2.0',sessionFactoryAvailable:true};
  const auth={kind:'authenticated',provider:profile.provider,method:'oauth',accountFingerprint:account};
  const access={kind:'passed',provider:profile.provider,accountFingerprint:account,profileFingerprint:fingerprint,checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString()};
  const host={async readPiSdkStatus(){reads++;return sdk;},async readPiModelProfile(){reads++;return {kind:'configured',profile:{...profile,fingerprint}};},async readInferenceAuthenticationStatus(){reads++;return auth;},async readInferenceAccessCheckReceipt(input){reads++;assert.equal(input.accountFingerprint,account);assert.equal(input.profileFingerprint,fingerprint);return access;}} satisfies PreparationConfiguratorAdmissionHost;
  return {host,sdk,auth,access,now,get reads(){return reads;}};
}

test('admisión usa perfil congelado y cuatro lecturas sin sesión, refresh ni inferencia; ambos proveedores OAuth',async()=>{
  for(const profile of [DEFAULT_INFERENCE_PROFILE,CLAUDE_INFERENCE_PROFILE]){const f=fixture(profile);assert.equal(f.reads,0);await requirePreparationConfiguratorAdmission({host:f.host,profile,now:()=>f.now});assert.equal(f.reads,4);}
});

test('admisión falla cerrada por SDK, perfil, OAuth, huellas o vigencia sin sustituir modelo',async()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.access.expiresAt=new Date(f.now).toISOString();},(f:ReturnType<typeof fixture>)=>{f.access.checkedAt=new Date(f.now+1).toISOString();},(f:ReturnType<typeof fixture>)=>{f.access.profileFingerprint=HashSchema.parse('b'.repeat(64));},(f:ReturnType<typeof fixture>)=>{f.access.accountFingerprint=HashSchema.parse('b'.repeat(64));}]){const f=fixture();mutate(f);await assert.rejects(requirePreparationConfiguratorAdmission({host:f.host,profile:DEFAULT_INFERENCE_PROFILE,now:()=>f.now}),/ACCESS_REQUIRED/);}
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.sdk.piAiVersion='0.0.0';},(f:ReturnType<typeof fixture>)=>{f.auth.method='api_key';}]){const f=fixture();mutate(f);await assert.rejects(requirePreparationConfiguratorAdmission({host:f.host,profile:DEFAULT_INFERENCE_PROFILE,now:()=>f.now}),/ADMISSION_UNAVAILABLE/);}
  const f=fixture();await assert.rejects(requirePreparationConfiguratorAdmission({host:f.host,profile:CLAUDE_INFERENCE_PROFILE,now:()=>f.now}),/PROFILE_UNAVAILABLE/);
  const controller=new AbortController();controller.abort();const aborted=fixture();await assert.rejects(requirePreparationConfiguratorAdmission({host:aborted.host,profile:DEFAULT_INFERENCE_PROFILE,signal:controller.signal}));assert.equal(aborted.reads,0);
});

test('missing access receipt is actionable while arbitrary provider errors stay private', async () => {
  const f=fixture();
  await assert.rejects(requirePreparationConfiguratorAdmission({host:{...f.host,async readInferenceAccessCheckReceipt(){return {kind:'missing'};}},profile:DEFAULT_INFERENCE_PROFILE,now:()=>f.now}),/^Error: PREPARATION_CONFIGURATOR_ACCESS_REQUIRED$/);
  await assert.rejects(requirePreparationConfiguratorAdmission({host:{...f.host,async readInferenceAccessCheckReceipt(){throw new Error('PRIVATE_ACCOUNT_OR_PROVIDER_DIAGNOSTIC');}},profile:DEFAULT_INFERENCE_PROFILE,now:()=>f.now}),/^Error: PREPARATION_CONFIGURATOR_ADMISSION_UNAVAILABLE$/);
});
