import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { applyDayNightForm, dayNightForm, minuteTime, timeMinute } from '../src/web/day-night-form.ts';
import { DayNightCycleEditor } from '../src/web/DayNightCycleEditor.tsx';
import { WorldPreparationEditor } from '../src/web/WorldPreparationEditor.tsx';
import { changeDraftField, setDraftMoment } from '../src/web/draft-form.ts';
import { worldCandidate, formBlank, matchesWorldFormVariant } from '../src/web/world-preparation.ts';
import { stageMapData } from '../src/web/RunStageWorkspace.tsx';
import { StageMap } from '../src/web/StageMap.tsx';
import { stageFixture } from './fixtures/run-stage.ts';
const runId='abcd1234-1111-4111-8111-111111111111';
const empty=()=>createEmptyRunConfigurationDraft({runId,revision:0});
function timed() { const result=setDraftMoment({draft:empty(),dateTime:'1968-06-01T23:30:00',offset:'-03:00'}); if(result.kind!=='applied')throw new Error(result.message);return result.draft; }
const chosen={mode:'configured',day:'07:30',night:'21:00',disambiguation:'compatible'};

test('day-night preparation is explicit, removable and preserves clock instant and convention',()=>{
  assert.deepEqual(dayNightForm(empty()),{mode:'absent',day:'',night:'',disambiguation:''});
  assert.throws(()=>applyDayNightForm({draft:empty(),...chosen}));
  const base=timed();const clock=worldCandidate(base).clock;
  assert.throws(()=>applyDayNightForm({draft:base,...chosen,disambiguation:''}));
  assert.throws(()=>applyDayNightForm({draft:base,...chosen,night:'07:30'}));
  const configured=applyDayNightForm({draft:base,...chosen});
  assert.deepEqual(worldCandidate(configured).clock,{...clock,dayNight:{dayStartsAtMinute:450,nightStartsAtMinute:1260,disambiguation:'compatible'}});
  const moved=setDraftMoment({draft:configured,dateTime:'1968-06-02T00:00:00',offset:'+02:00'});
  assert.equal(moved.kind,'applied');if(moved.kind==='applied')assert.deepEqual(worldCandidate(moved.draft).clock?.dayNight,worldCandidate(configured).clock?.dayNight);
  const removed=applyDayNightForm({draft:configured,...chosen,mode:'absent'});
  assert.deepEqual(worldCandidate(removed).clock,clock);
});
test('daily clock inputs reserve 24:00 for closing a window and do not silently populate policy',()=>{
  assert.equal(timeMinute('00:00'),0);assert.equal(timeMinute('23:59'),1439);assert.equal(timeMinute('24:00',true),1440);assert.equal(minuteTime(1440),'24:00');
  for(const value of ['24:00','7:30','23:60','-01:00',''])assert.throws(()=>timeMinute(value));
  const blank=formBlank({type:'object',properties:{kind:{const:'daily'},disambiguation:{const:'compatible'}}});assert.deepEqual(blank,{kind:'daily'});
});
test('cycle editor has empty explicit clocks and explains the physical boundary',()=>{
  const html=renderToStaticMarkup(React.createElement(DayNightCycleEditor,{draft:applyDayNightForm({draft:timed(),...chosen}),onChange:()=>{},onPendingChange:()=>{}}));
  assert.match(html,/value="07:30"/);assert.match(html,/value="21:00"/);assert.match(html,/No cambia la iluminación física/);assert.match(html,/primera ocurrencia/);
});
test('daily character routine editor renders human local times and explicit DST policy',()=>{
  const entity=WorldSnapshotSchema.shape.entities.element.options[0].parse({kind:'character',entityId:'11111111-1111-4111-8111-111111111111',characterId:'maxwell-smart',trueDisplayName:'Max',species:'human',presentation:{kind:'ordinary',label:'Max'},placeId:'11111111-2222-4222-8222-111111111111',position:{x:1,y:1},collisionRadius:0,blocksMovement:false,presence:{kind:'absent'},preparation:{kind:'notPrepared',reason:'Prueba sintética'},capabilities:[],availability:{kind:'available'},routine:{kind:'daily',defaultState:'available',disambiguation:'compatible',windows:[{fromMinute:1320,toMinute:420,state:'unavailable'}]},mind:{goals:[],beliefs:[],relationships:[],recognizedCharacterIds:[],experiences:[]}});
  const draft=changeDraftField({draft:timed(),field:'worldSnapshot',value:{...worldCandidate(timed()),entities:[entity]}});
  const html=renderToStaticMarkup(React.createElement(WorldPreparationEditor,{draft,initialSection:'entities',onChange:()=>{},onPendingChange:()=>{}}));
  assert.match(html,/value="22:00"/);assert.match(html,/value="07:00"/);assert.match(html,/cruza medianoche/);assert.match(html,/Resolución de cambios horarios/);
});
test('public stage phase remains optional and does not conflate physical lights',()=>{
  const original=stageFixture();assert.equal(stageMapData(original).dayNightPhase,undefined);
  const phase=stageMapData({...original,dayNightPhase:'night'});const html=renderToStaticMarkup(React.createElement(StageMap,{data:phase}));
  assert.match(html,/Noche/);assert.match(html,/no modifica la iluminación física/);assert.deepEqual(phase.places,original.places);
});

test('public phase is derived separately for each historical snapshot clock',async()=>{
  const {setup}=await import('./fixtures/continuista.ts');
  const {projectRunStage}=await import('../src/application/run-observation.ts');
  const fixture=await setup();
  try {
    const source=fixture.configuration.worldSnapshot;
    const base={...source.clock,convention:{kind:'fixedOffset',offsetMinutes:0,label:'UTC'},dayNight:{dayStartsAtMinute:420,nightStartsAtMinute:1260,disambiguation:'compatible'}};
    const before=WorldSnapshotSchema.parse({...source,clock:{...base,instant:Date.UTC(1968,5,1,20,59)}});
    const after=WorldSnapshotSchema.parse({...source,clock:{...base,instant:Date.UTC(1968,5,1,21,0)}});
    const first=projectRunStage({snapshot:before,configuration:fixture.configuration,lifecycle:'running'});
    const second=projectRunStage({snapshot:after,configuration:fixture.configuration,lifecycle:'paused'});
    assert.equal(first.dayNightPhase,'day');assert.equal(second.dayNightPhase,'night');assert.deepEqual(first.places,second.places);
    const legacy=projectRunStage({snapshot:source,configuration:fixture.configuration,lifecycle:'running'});
    assert.equal(Object.hasOwn(legacy,'dayNightPhase'),false);
  }finally{fixture.close();}
});

test('a new daily variant stays editable before selecting its mandatory time-change policy',()=>{
  const daily={type:'object',properties:{kind:{const:'daily'},disambiguation:{const:'compatible'}}};
  const blank=formBlank(daily);
  assert.equal(matchesWorldFormVariant(daily,blank),true);
  assert.equal(matchesWorldFormVariant({type:'object',properties:{kind:{const:'always'}}},blank),false);
  assert.equal(matchesWorldFormVariant(daily,{kind:'always'}),false);
  assert.deepEqual(blank,{kind:'daily'},'selecting a variant does not consent to a calendar policy');
});
