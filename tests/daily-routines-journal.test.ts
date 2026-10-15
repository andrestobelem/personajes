import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { RunIdSchema } from '../src/domain/values.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import { actorId, canonical, setup, type Fixture } from './fixtures/continuista.ts';

const midnight = Date.parse('2026-10-14T00:00:00Z');
const minute = 60_000;
const day = 24 * 60 * minute;
const dailyRoutine = { kind: 'daily', defaultState: 'unavailable', disambiguation: 'compatible',
  windows: [{ fromMinute: 1, toMinute: 2, state: 'available' }] };

function registerDailyRun(fixture: Fixture, options: { routine?: unknown; maxAdvanceMs?: number; dayNight?: unknown } = {}) {
  const runId = RunIdSchema.parse(randomUUID());
  const worldSnapshot = WorldSnapshotSchema.parse({ ...fixture.configuration.worldSnapshot, runId, revision: 0, seq: 0,
    clock: { instant: midnight, convention: { kind: 'fixedOffset', offsetMinutes: 0, label: 'UTC sintético' },
      ...(options.dayNight === undefined ? {} : { dayNight: options.dayNight }) },
    scenes: fixture.configuration.worldSnapshot.scenes.map(scene => ({ ...scene, lifecycle: { kind: 'open', startedAt: midnight } })),
    entities: fixture.configuration.worldSnapshot.entities.map(entity => entity.kind === 'character'
      ? { ...entity, routine: entity.characterId === actorId ? options.routine ?? dailyRoutine : entity.routine,
        mind: { ...entity.mind, experiences: entity.mind.experiences.map(experience => ({ ...experience, runId })) } }
      : entity),
    actionDurations: { ...fixture.configuration.worldSnapshot.actionDurations, maxWaitMs: 5 * minute },
  });
  const configuration = ReadyRunConfigurationSchema.parse({ ...fixture.configuration, runId, fictionalAt: midnight,
    circadianPolicy: { kind: 'advance-while-running', maxAdvanceMs: options.maxAdvanceMs ?? day }, worldSnapshot,
    snapshotFence: { runId, revision: 0, seq: 0, fictionalAt: midnight } });
  const contexts = configuration.roster.activeCharacterIds.map(characterId => {
    const prepared = configuration.roster.preparedCharacters.find(candidate => candidate.characterId === characterId);
    assert.ok(prepared);
    return { actorId: characterId, continuityId: prepared.continuity.continuityId,
      continuityRevision: prepared.continuity.revision, continuityContentHash: prepared.continuity.contentHash,
      identityVersion: prepared.identityVersion, preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex') };
  });
  assert.equal(fixture.journal.registerWorldRun({ initialSnapshot: worldSnapshot, configurationRevision: configuration.configRevision,
    configuration, continuityFence: { kind: 'prepared-contexts', atWorldSeq: 0, contexts }, lifecycle: 'running' }), 'stored');
  return { runId, configuration };
}

test('daily routines create distinct absolute boundary causes on consecutive days; receipts survive reopen without duplicate events', async () => {
  const fixture = await setup();
  try {
    const { runId } = registerDailyRun(fixture);
    const receipts = [];
    const expectedBoundaries = [minute, 2 * minute, day + minute, day + 2 * minute, 2 * day + minute, 2 * day + 2 * minute];
    for (const boundary of expectedBoundaries) {
      const operationId = randomUUID();
      const result = fixture.journal.advanceRoutineClock({ runId, operationId });
      assert.equal(result.kind, 'advanced');
      if (result.kind !== 'advanced') assert.fail(`No se alcanzó la frontera diaria ${boundary}`);
      assert.equal(fixture.journal.loadWorld({ runId })?.clock.instant, midnight + boundary);
      assert.equal(result.activationIds.length, boundary % day === minute ? 1 : 0);
      receipts.push({ operationId, result });
    }
    const activationIds = receipts.flatMap(({ result }) => result.activationIds);
    assert.equal(new Set(activationIds).size, 3, 'el mismo minuto civil de días distintos no reutiliza una causa');
    const inspect = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM world_events WHERE run_id=?').get(runId)?.n, 6);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM actor_activation_causes WHERE run_id=?').get(runId)?.n, 3);
    } finally { inspect.close(); }
    const reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    try {
      for (const { operationId, result } of receipts) assert.deepEqual(reopened.advanceRoutineClock({ runId, operationId }), { ...result, kind: 'existing' });
      assert.equal(reopened.loadWorld({ runId })?.clock.instant, midnight + 2 * day + 2 * minute);
      // Advance to the third daily availability; stale earlier causes are not mistaken for the same daily minute.
      const next = reopened.advanceRoutineClock({ runId, operationId: randomUUID() });
      assert.equal(next.kind, 'advanced');
      if (next.kind !== 'advanced') assert.fail('Falta siguiente día');
      const begun = reopened.beginCoordinatorPulse({ runId });
      assert.equal(begun.kind, 'started');
      if (begun.kind !== 'started') assert.fail('Falta convocatoria diaria vigente');
      assert.deepEqual(begun.pulse.cause, { kind: 'actorActivation', id: next.activationIds[0],
        trigger: { kind: 'routine-boundary', boundaryAt: midnight + 3 * day + minute } });
      assert.equal(begun.jobs.length, 1);
      assert.deepEqual(begun.jobs[0]?.perceptionIds, [], 'la rutina no fabrica experiencias sensoriales');
      const inspectAfterReplay = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
      try {
        assert.equal(inspectAfterReplay.prepare('SELECT COUNT(*) n FROM world_events WHERE run_id=?').get(runId)?.n, 7);
        assert.equal(inspectAfterReplay.prepare('SELECT COUNT(*) n FROM actor_activation_causes WHERE run_id=?').get(runId)?.n, 4);
      } finally { inspectAfterReplay.close(); }
    } finally { reopened.close(); }
  } finally { fixture.close(); }
});

test('an action crossing daily windows admits only the current availability boundary, never expired windows', async () => {
  const fixture = await setup();
  try {
    for (const durationMs of [150_000, 240_000]) {
      const { runId } = registerDailyRun(fixture, { routine: { ...dailyRoutine,
        windows: [{ fromMinute: 0, toMinute: 1, state: 'available' }, { fromMinute: 2, toMinute: 3, state: 'available' }] } });
      const proposalId = randomUUID();
      assert.equal(fixture.journal.registerWorldProposal({ runId, proposalId, version: 1, jobId: randomUUID(), generation: 0, proposalSlot: 0,
        attempt: { kind: 'wait', attemptId: randomUUID(), runId, actorId, expectedRevision: 0, durationMs } }), 'stored');
      const result = fixture.journal.commitWorldAttempt({ runId, proposalId, version: 1, ids: fixture.ids });
      assert.equal(result.resolution.kind, 'applied');
      const begun = fixture.journal.beginCoordinatorPulse({ runId });
      if (durationMs === 150_000) {
        assert.equal(begun.kind, 'started');
        if (begun.kind !== 'started') assert.fail('No convocó ventana vigente');
        assert.equal(begun.pulse.cause.kind, 'actorActivation');
        if (begun.pulse.cause.kind === 'actorActivation') assert.deepEqual(begun.pulse.cause.trigger,
          { kind: 'routine-boundary', boundaryAt: midnight + 2 * minute });
      } else assert.equal(begun.kind, 'idle', 'no revive ventanas completas atravesadas por una acción');
    }
  } finally { fixture.close(); }
});

test('daily clock honors maximum advance, pause and closed scene without persisting speculative clock effects', async () => {
  const fixture = await setup();
  try {
    const capped = registerDailyRun(fixture, { maxAdvanceMs: minute - 1 });
    const maxResult = fixture.journal.advanceRoutineClock({ runId: capped.runId, operationId: randomUUID() });
    assert.equal(maxResult.kind, 'notApplicable');
    if (maxResult.kind === 'notApplicable') assert.equal(maxResult.reason, 'boundary-too-far');
    const paused = registerDailyRun(fixture);
    assert.equal(fixture.journal.setWorldLifecycle({ runId: paused.runId, expectedWorldRevision: 0,
      expectedConfigRevision: paused.configuration.configRevision, target: 'paused' }), 'updated');
    const pauseResult = fixture.journal.advanceRoutineClock({ runId: paused.runId, operationId: randomUUID() });
    assert.equal(pauseResult.kind, 'notApplicable');
    if (pauseResult.kind === 'notApplicable') assert.equal(pauseResult.reason, 'inactive');
    const closed = registerDailyRun(fixture);
    const sceneId = closed.configuration.worldSnapshot.activeSceneId;
    assert.ok(sceneId);
    assert.equal(fixture.journal.applyDramaticStructureCommand({ runId: closed.runId, principalId: 'test-operator',
      operationId: randomUUID(), idempotencyKey: randomUUID(), expectedWorldRevision: 0, expectedStructureRevision: 0,
      command: { kind: 'closeScene', sceneId, reason: 'Cierre sintético' } }).kind, 'stored');
    const closeResult = fixture.journal.advanceRoutineClock({ runId: closed.runId, operationId: randomUUID() });
    assert.equal(closeResult.kind, 'notApplicable');
    if (closeResult.kind === 'notApplicable') assert.equal(closeResult.reason, 'no-active-scene');
    for (const { runId } of [capped, paused, closed]) assert.equal(fixture.journal.loadWorld({ runId })?.clock.instant, midnight);
  } finally { fixture.close(); }
});

test('crossing a civil day preserves durable inference quotas and reserved model time', async () => {
  const fixture = await setup();
  try {
    const { runId, configuration } = registerDailyRun(fixture);
    const pulseId = randomUUID();
    fixture.journal.configureRun({ runId, maxCalls: configuration.budget.maxPiCallsPerRun });
    fixture.journal.configurePulse({ runId, pulseId, maxCalls: configuration.budget.maxPiCallsPerPulse });
    const reservation = fixture.journal.reserveRequest({ runId, pulseId, jobId: randomUUID(), generation: 0, requestSeq: 0,
      clockEpochId: randomUUID(), ownerToken: randomUUID() });
    assert.equal(reservation.kind, 'reserved');
    const before = fixture.journal.readRunModelTimeBudget({ runId });
    assert.ok(before);
    assert.equal(before.runCallsUsed, 1);
    assert.ok(before.wallTimeReservedMs > 0);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(fixture.journal.advanceRoutineClock({ runId, operationId: randomUUID() }).kind, 'advanced');
    }
    assert.equal(fixture.journal.loadWorld({ runId })?.clock.instant, midnight + 2 * day + minute);
    assert.deepEqual(fixture.journal.readRunModelTimeBudget({ runId }), before,
      'la fecha ficticia no reinicia cuota por representación ni tiempo de transporte');
  } finally { fixture.close(); }
});

test('day/night clock boundaries persist across midnight without actor invitations or implicit changes to room lighting', async () => {
  const fixture = await setup();
  try {
    const { runId, configuration } = registerDailyRun(fixture, { routine: { kind: 'always' },
      dayNight: { dayStartsAtMinute: 360, nightStartsAtMinute: 1080, disambiguation: 'compatible' } });
    for (const boundary of [6 * 60 * minute, 18 * 60 * minute, day + 6 * 60 * minute]) {
      const advanced = fixture.journal.advanceRoutineClock({ runId, operationId: randomUUID() });
      assert.equal(advanced.kind, 'advanced');
      if (advanced.kind !== 'advanced') assert.fail('Falta frontera de día/noche');
      assert.deepEqual(advanced.activationIds, [], 'el ciclo temporal no obliga a actuar a nadie');
      const snapshot = fixture.journal.loadWorld({ runId });
      assert.equal(snapshot?.clock.instant, midnight + boundary);
      assert.deepEqual(snapshot?.places, configuration.worldSnapshot.places,
        'la fase solar no modifica por sí misma iluminación interior');
    }
    const events = fixture.journal.readObservationEvents({ runId, fromWorldSeq: 1, toWorldSeq: 3,
      afterWorldSeq: null, limit: 10, communicationsOnly: false });
    assert.deepEqual(events?.map(row => row.event.kind), ['clockAdvanced', 'clockAdvanced', 'clockAdvanced']);
    const inspect = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      for (const table of ['actor_activation_causes', 'world_perceptions'])
        assert.equal(inspect.prepare(`SELECT COUNT(*) n FROM ${table} WHERE run_id=?`).get(runId)?.n, 0);
    } finally { inspect.close(); }
  } finally { fixture.close(); }
});
