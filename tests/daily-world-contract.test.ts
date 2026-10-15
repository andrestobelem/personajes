import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActorWorldViewSchema, WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { buildActorWorldView, emptyActorKnowledge } from '../src/domain/world.ts';
import { actorId, setup } from './fixtures/continuista.ts';

test('an editorial day/night schedule never enters actor clock or acquires a sensory experience', async () => {
  const fixture = await setup();
  try {
    const snapshot = fixture.configuration.worldSnapshot;
    const initial = buildActorWorldView({ snapshot, actorId,
      knowledge: emptyActorKnowledge({ runId: snapshot.runId, actorId }),
      pendingPerceptions: [], ids: fixture.ids });
    const dayNight = { dayStartsAtMinute: 420, nightStartsAtMinute: 1260, disambiguation: 'compatible' };
    const configured = WorldSnapshotSchema.parse({ ...snapshot, clock: { ...snapshot.clock, dayNight } });
    const projected = buildActorWorldView({ snapshot: configured, actorId,
      knowledge: initial.knowledge, pendingPerceptions: [], ids: fixture.ids });
    assert.deepEqual(projected.view, initial.view,
      'an editorial configuration change reveals nothing new to the same actor');
    assert.deepEqual(projected.view.now, { instant: snapshot.clock.instant, convention: snapshot.clock.convention });
    assert.equal(Object.hasOwn(projected.view.now, 'dayNight'), false);
    assert.deepEqual(projected.view.inbox, []);
    assert.equal(ActorWorldViewSchema.safeParse({ ...projected.view,
      now: { ...projected.view.now, dayNight } }).success, false,
    'the actor boundary rejects accidentally reintroduced editorial metadata');
  } finally { fixture.close(); }
});
