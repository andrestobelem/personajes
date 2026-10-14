import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openLocalHost } from '../src/application/local-host.ts';
import { createVoiceRuntime } from '../src/application/voice-runtime.ts';
import { createElevenLabsClient } from '../src/adapters/elevenlabs.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { canonicalDirectorValue } from '../src/application/director-context.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { setup } from './fixtures/continuista.ts';
import { createRunLifecycleApplication } from '../src/application/run-lifecycle.ts';

test('voice composition opens separate credentials and zero quotas without contacting provider or starting work',async()=>{
  const root=mkdtempSync(join(tmpdir(),'personajes-voice-runtime-'));
  const host=openLocalHost({privateDataRoot:root});let calls=0;
  const voices=createVoiceRuntime({host,client:createElevenLabsClient({getApiKey:()=>undefined,transport:async()=>{calls++;throw new Error('No provider expected');}})});
  try {
    const ready=validateRunConfiguration({draft:draftFixture()});
    assert.equal(ready.kind,'ready');if(ready.kind!=='ready')assert.fail('Invalid synthetic setup');
    const configuration=ready.configuration;
    host.journal.registerWorldRun({initialSnapshot:configuration.worldSnapshot,configurationRevision:configuration.configRevision,configuration,
      continuityFence:{kind:'prepared-contexts',atWorldSeq:configuration.worldSnapshot.seq,contexts:configuration.roster.preparedCharacters.map(actor=>({actorId:actor.characterId,continuityId:actor.continuity.continuityId,continuityRevision:actor.continuity.revision,continuityContentHash:actor.continuity.contentHash,identityVersion:actor.identityVersion,preparedContextHash:createHash('sha256').update(canonicalDirectorValue(actor)).digest('hex')}))},lifecycle:'ready'});
    const snapshot=voices.config.read(configuration.runId);
    assert.deepEqual(snapshot.quotaLimits,{voiceDesignCalls:0,ttsCalls:0,sfxCalls:0});
    assert.equal(voices.credentials.status().credentialConfigured,false);
    const response=await voices.routes.handle({kind:'read',method:'GET',path:['runs',configuration.runId,'voice-owners'],query:new URLSearchParams(),principalId:'local-operator',mode:{kind:'observer'},ifMatch:null,ifNoneMatch:null});
    assert.equal(response.kind,'json');if(response.kind!=='json')assert.fail('Owner projection failed');
    const serialized=JSON.stringify(response.body);
    assert.match(serialized,/personaje-prueba/);assert.match(serialized,/recipe/);
    assert.doesNotMatch(serialized,/identityMarkdown|selfConcept|lifeStoryMarkdown/);
    await voices.waitForIdle();assert.equal(calls,0);
    assert.equal(host.journal.readWorldLifecycle({runId:configuration.runId})?.lifecycle,'ready');
  } finally {await voices.close();host.close();rmSync(root,{recursive:true,force:true});rmSync(`${root}-auth`,{recursive:true,force:true});}
});

test('audio budget unavailable does not block pausing inference and successful counters are visible',async()=>{
  const fixture=await setup();
  try {
    const app=createRunLifecycleApplication({journal:fixture.journal,readVoiceBudget:()=>{throw new Error('audio unreadable');}});
    const view=app.readRunView({runId:fixture.claim.runId});assert.ok(view);
    assert.equal(view.budget.status,'available');assert.equal(view.budget.audioBudgetStatus,'unavailable');
    const paused=await app.controlRun({runId:view.runId,principalId:'local-operator',idempotencyKey:randomUUID(),expectedConfigurationRevision:view.configRevision,expectedWorldRevision:view.worldRevision,expectedLifecycleRevision:view.lifecycleRevision,command:{kind:'pause'}});
    assert.equal(paused.kind,'updated');
    const known=createRunLifecycleApplication({journal:fixture.journal,readVoiceBudget:()=>({voiceDesignCalls:{limit:3,used:1,reserved:1,remaining:1},ttsCalls:{limit:8,used:2,reserved:0,remaining:6},sfxCalls:{limit:1,used:0,reserved:0,remaining:1}})}).readRunView({runId:view.runId});
    assert.ok(known);assert.equal(known.budget.audioBudgetStatus,'known');assert.equal(known.budget.ttsCalls.used,2);assert.equal(known.limits.maxDesignCallsPerRun,3);
  } finally {fixture.close();}
});
