import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { currentRoutineAvailabilityBoundary, nextRoutineAdvance, planActorActivationInvitations } from '../src/domain/actor-activation.ts';
import { draftFixture } from './fixtures/continuista.ts';

function snapshot() {
  const ready = validateRunConfiguration({ draft: draftFixture({}) });
  if (ready.kind !== 'ready') throw new Error('fixture not ready');
  return ready.configuration.worldSnapshot;
}

test('initial goal invitation is technical, deterministic and does not fabricate perceptions or mutate world', () => {
  const world = snapshot();
  const actor = world.entities.find(entity => entity.kind === 'character');
  assert.ok(actor);
  const withGoal = WorldSnapshotSchema.parse({ ...world, entities: world.entities.map(entity => entity === actor
    ? { ...actor, mind: { ...actor.mind, goals: [{ kind: 'durable', id: '00000000-0000-4000-8000-000000000777', description: 'Deseo propio', priority: 1, state: 'active', revision: 0, history: [] }] } } : entity) });
  const before = JSON.stringify(withGoal);
  const request = { snapshot: withGoal, activeCharacterIds: [actor.characterId] };
  const planned = planActorActivationInvitations(request);
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0]?.trigger, { kind: 'initial-goal' });
  assert.deepEqual(planActorActivationInvitations(request), planned);
  assert.equal(JSON.stringify(withGoal), before);
  assert.equal(JSON.stringify(planned).includes('perception'), false);
  const unavailable = { ...withGoal, entities: withGoal.entities.map(entity => entity === withGoal.entities.find(item => item.kind === 'character')
    ? { ...entity, availability: { kind: 'unavailable', reason: 'descanso' } } : entity) };
  assert.deepEqual(planActorActivationInvitations({ ...request, snapshot: unavailable }), []);
  assert.deepEqual(planActorActivationInvitations({ ...request, activeCharacterIds: [] }), []);
});

test('routine scheduling uses fictional boundaries and bounded running policy, never offline wall time', () => {
  const world = snapshot();
  const now = world.clock.instant;
  const routineWorld = WorldSnapshotSchema.parse({ ...world, entities: world.entities.map(entity => entity.kind === 'character'
    ? { ...entity, routine: { kind: 'windows', defaultState: 'unavailable', windows: [{ from: now + 1000, to: now + 2000, state: 'available' }] } } : entity) });
  assert.equal(nextRoutineAdvance({ snapshot: routineWorld, lifecycle: 'running', policy: { kind: 'manual-only' } }), undefined);
  assert.equal(nextRoutineAdvance({ snapshot: routineWorld, lifecycle: 'paused', policy: { kind: 'advance-while-running', maxAdvanceMs: 2000 } }), undefined);
  assert.equal(nextRoutineAdvance({ snapshot: routineWorld, lifecycle: 'running', policy: { kind: 'advance-while-running', maxAdvanceMs: 999 } }), undefined);
  assert.equal(nextRoutineAdvance({ snapshot: routineWorld, lifecycle: 'running', policy: { kind: 'advance-while-running', maxAdvanceMs: 1000 } }), now + 1000);
  const advanced = { ...routineWorld, clock: { ...routineWorld.clock, instant: now + 1000 } };
  const ids = routineWorld.entities.flatMap(entity => entity.kind === 'character' ? [entity.characterId] : []);
  assert.equal(planActorActivationInvitations({ snapshot: advanced, activeCharacterIds: ids, previousInstant: now }).filter(item => item.trigger.kind === 'routine-boundary').length, 1);
  assert.equal(planActorActivationInvitations({ snapshot: advanced, activeCharacterIds: ids, previousInstant: now + 1000 }).filter(item => item.trigger.kind === 'routine-boundary').length, 0);
});


test('routine boundaries represent effective unavailable→available transitions including the default outside windows',()=>{
  const window=(from:number,to:number,state:'available'|'unavailable')=>({from,to,state});
  const cases=[
    {defaultState:'available',windows:[window(10,20,'unavailable')],instant:20,expected:20},
    {defaultState:'available',windows:[window(10,20,'unavailable')],instant:19,expected:undefined},
    {defaultState:'available',windows:[window(10,20,'available')],instant:15,expected:undefined},
    {defaultState:'available',windows:[window(10,20,'available')],instant:20,expected:undefined},
    {defaultState:'unavailable',windows:[window(10,20,'unavailable')],instant:20,expected:undefined},
    {defaultState:'unavailable',windows:[window(20,30,'available'),window(10,20,'available')],instant:25,expected:10},
    {defaultState:'unavailable',windows:[window(10,20,'available'),window(20,30,'available')],instant:30,expected:undefined},
    {defaultState:'available',windows:[window(10,20,'unavailable'),window(20,30,'unavailable')],instant:30,expected:30},
    {defaultState:'available',windows:[window(10,20,'unavailable'),window(20,30,'available')],instant:25,expected:20},
    {defaultState:'unavailable',windows:[window(10,20,'available'),window(30,40,'available')],instant:35,expected:30},
    {defaultState:'unavailable',windows:[window(0,20,'available')],instant:0,expected:0},
  ];
  for(const {defaultState,windows,instant,expected} of cases)
    assert.equal(currentRoutineAvailabilityBoundary({routine:{kind:'windows',defaultState,windows},instant}),expected,JSON.stringify({defaultState,windows,instant}));
  assert.equal(currentRoutineAvailabilityBoundary({routine:{kind:'always'},instant:20}),undefined);
});

test('planner invites on effective availability and neither repeats contiguous windows nor revives an expired interval',()=>{
  const source=snapshot();const actor=source.entities.find((entity)=>entity.kind==='character');assert.ok(actor);
  const now=source.clock.instant;const actorId=actor.characterId;
  function planned(routine:unknown,previous:number,current:number){
    const world=WorldSnapshotSchema.parse({...source,clock:{...source.clock,instant:now+current},
      entities:source.entities.map((entity)=>entity===actor?{...entity,routine}:entity)});
    return planActorActivationInvitations({snapshot:world,activeCharacterIds:[actorId],previousInstant:now+previous})
      .filter((invitation)=>invitation.trigger.kind==='routine-boundary').map((invitation)=>invitation.trigger);
  }
  assert.deepEqual(planned({kind:'windows',defaultState:'available',windows:[{from:now,to:now+20,state:'unavailable'}]},0,20),
    [{kind:'routine-boundary',boundaryAt:now+20}]);
  const contiguous={kind:'windows',defaultState:'unavailable',windows:[{from:now+10,to:now+20,state:'available'},{from:now+20,to:now+30,state:'available'}]};
  assert.deepEqual(planned(contiguous,15,20),[]);
  assert.deepEqual(planned(contiguous,0,25),[{kind:'routine-boundary',boundaryAt:now+10}]);
  assert.deepEqual(planned(contiguous,0,30),[]);
  assert.deepEqual(planned({kind:'windows',defaultState:'available',windows:[{from:now+10,to:now+20,state:'available'}]},0,15),[]);
});
