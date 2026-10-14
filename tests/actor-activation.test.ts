import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { nextRoutineAdvance, planActorActivationInvitations } from '../src/domain/actor-activation.ts';
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
