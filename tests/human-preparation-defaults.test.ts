import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftFixture} from './fixtures/continuista.ts';
import {createEmptyRunConfigurationDraft} from '../src/domain/production.ts';
import {compileHumanForm,suggestHumanForm} from '../src/web/HumanPreparationEditor.tsx';

test('fictional identity suggestions remain local and use only an available scene and speech channel',()=>{
  const draft=draftFixture(),before=structuredClone(draft);
  for(const kind of ['visitor','reporter'] as const){
    const form=suggestHumanForm({draft,kind});
    const profile=compileHumanForm({draft,form});
    assert.equal(profile.presence.kind,'inScene');
    if(draft.worldSnapshot.kind==='empty')assert.fail();
    const world=draft.worldSnapshot.value;
    const scene=world.scenes?.find(scene=>scene.id===world.activeSceneId);
    assert.ok(scene?.placeIds?.includes(profile.presence.placeId));
    assert.match(profile.identity.lifeStoryMarkdown,/ficticia propuesta/);
    assert.doesNotMatch(profile.identity.identityMarkdown,/SECRET_OTHER_PREPARATION|SECRET_PRIVATE_OTHER_MEMORY/);
  }
  assert.deepEqual(draft,before);
  assert.notEqual(suggestHumanForm({draft,kind:'visitor'}).participantId,suggestHumanForm({draft,kind:'visitor'}).participantId);
});

test('a blank world never invents a usable human presence or bypasses profile validation',()=>{
  const draft=createEmptyRunConfigurationDraft({runId:crypto.randomUUID(),revision:0});
  const form=suggestHumanForm({draft,kind:'visitor'});
  assert.equal(form.placeId,'');assert.equal(form.sceneId,'');assert.equal(form.channelId,'');assert.equal(form.x,'');
  assert.throws(()=>compileHumanForm({draft,form}),/coordenadas/);
});
