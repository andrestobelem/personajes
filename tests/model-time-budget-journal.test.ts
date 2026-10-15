import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { resolveReadyInferenceProfile } from '../src/domain/inference-profile.ts';
import { PulseIdSchema } from '../src/domain/values.ts';
import { canonical, setup } from './fixtures/continuista.ts';

function cleanFixture(fixture: Awaited<ReturnType<typeof setup>>): void {
  try { fixture.journal.close(); } catch { /* Some cases reopen the SQLite file after closing the original handle. */ }
  rmSync(fixture.directory, { recursive: true, force: true });
}

function scope(fixture: Awaited<ReturnType<typeof setup>>) {
  const database = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
  try {
    const row = database.prepare('SELECT pulse_id FROM actor_turn_jobs WHERE job_id=? AND generation=?')
      .get(fixture.claim.jobId, fixture.claim.generation);
    if (row === undefined) throw new Error('Fixture sin pulso');
    const pulseId = PulseIdSchema.parse(Reflect.get(row, 'pulse_id'));
    return {
      runId: fixture.claim.runId,
      pulseId,
      jobId: fixture.claim.jobId,
      generation: fixture.claim.generation,
    };
  } finally { database.close(); }
}

test('la corrida Ready nueva registra presupuesto conocido y resuelve el timeout histórico sin reescribirlo', async () => {
  const fixture = await setup();
  try {
    const budget = fixture.journal.readRunModelTimeBudget({ runId: fixture.claim.runId });
    assert.equal(budget?.status, 'known');
    if (budget?.status !== 'known') assert.fail('La configuración Ready nueva necesita estado de presupuesto conocido.');
    assert.equal(budget.wallTimeMeasuredMs, 0);
    assert.equal(budget.wallTimeRemainingMs, fixture.configuration.budget.maxWallTimeMs);
    assert.equal(budget.requestTimeoutMs, 30_000);
    assert.equal(Object.hasOwn(fixture.configuration.budget, 'requestTimeoutMs'), false, 'resolver el legado no muta su hash');
  } finally { cleanFixture(fixture); }
});

test('reserva duración y concurrencia compartidas en SQLite; cierre acredita el ceil real una sola vez', async () => {
  const fixture = await setup();
  const second = openJournal({ path: `${fixture.directory}/journal.sqlite` });
  const one = scope(fixture);
  const epoch = randomUUID();
  const owner = randomUUID();
  try {
    const first = fixture.journal.reserveNextRequest({ ...one, clockEpochId: epoch, ownerToken: owner });
    assert.equal(first.kind, 'reserved');
    if (first.kind !== 'reserved') assert.fail('No se concedió el grant');
    assert.deepEqual(first.wallTime, { reservedMs: 30_000, clockEpochId: epoch });
    const secondScope = { ...one, jobId: randomUUID() };
    const secondGrant = second.reserveNextRequest({ ...secondScope, clockEpochId: randomUUID(), ownerToken: randomUUID() });
    assert.equal(secondGrant.kind, 'reserved');
    const blocked = fixture.journal.reserveNextRequest({ ...one, jobId: randomUUID(), clockEpochId: randomUUID(), ownerToken: randomUUID() });
    assert.deepEqual(blocked, { kind: 'busy', scope: 'concurrency' });
    const reserved = fixture.journal.readRunModelTimeBudget({ runId: one.runId });
    assert.equal(reserved?.status, 'known');
    assert.equal(reserved?.wallTimeReservedMs, 60_000);
    assert.equal(reserved?.activePiRequests, 2);
    assert.equal(reserved?.wallTimeRemainingMs, 0);

    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: first.requestSeq,
      target: 'dispatched', ownerToken: owner, wallTime: { clockEpochId: epoch, monotonicNs: '1000000' } });
    assert.throws(() => fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation,
      requestSeq: first.requestSeq, target: 'completed', ownerToken: randomUUID(),
      wallTime: { clockEpochId: epoch, monotonicNs: '2000001' } }), /owner de la reserva/i);
    assert.throws(() => fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation,
      requestSeq: first.requestSeq, target: 'completed', ownerToken: owner,
      wallTime: { clockEpochId: randomUUID(), monotonicNs: '2000001' } }), /epoch|liquidación/i);
    assert.throws(() => fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation,
      requestSeq: first.requestSeq, target: 'completed', ownerToken: owner,
      wallTime: { clockEpochId: epoch, monotonicNs: '999999' } }), /precede/i);
    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: first.requestSeq,
      target: 'completed', ownerToken: owner, wallTime: { clockEpochId: epoch, monotonicNs: '2000001' } });
    assert.throws(() => second.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: first.requestSeq,
      target: 'completed', ownerToken: owner, wallTime: { clockEpochId: epoch, monotonicNs: '2000002' } }), /liquidación|muestra/i);
    const settled = fixture.journal.readRunModelTimeBudget({ runId: one.runId });
    assert.equal(settled?.status, 'known');
    assert.equal(settled?.wallTimeMeasuredMs, 2, '1,000,001 ns se redondea hacia arriba a 2 ms');
    assert.equal(settled?.wallTimeReservedMs, 30_000);
    assert.equal(settled?.activePiRequests, 1);
  } finally { second.close(); cleanFixture(fixture); }
});

test('timeout conserva grant y slot hasta el cierre tardío, aunque el stream exceda su duración reservada', async () => {
  const fixture = await setup();
  const one = scope(fixture);
  const epoch = randomUUID();
  try {
    const claimed = fixture.journal.claimActorTurnJob(fixture.claim);
    if (claimed.kind !== 'claimed' && claimed.kind !== 'existing') assert.fail('No se reclamó el job de prueba');
    const execution = { runId: one.runId, actorId: fixture.claim.actorId, pulseId: one.pulseId,
      jobId: one.jobId, generation: one.generation,
      lease: { ownerToken: fixture.claim.ownerToken, claimToken: fixture.claim.claimToken } };
    const prepared = fixture.configuration.roster.preparedCharacters.find((character) => character.characterId === fixture.claim.actorId);
    if (prepared === undefined) assert.fail('Falta contexto preparado para el actor de prueba');
    fixture.journal.registerActorPiSession({ runId: one.runId, actorId: fixture.claim.actorId, sessionId: 'wall-time-test',
      sessionPath: `${fixture.directory}/actor.jsonl`, preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex'),
      profile: resolveReadyInferenceProfile(fixture.configuration) });
    const reservation = fixture.journal.reserveActorJobRequest({ execution, clockEpochId: epoch });
    if (reservation.kind !== 'reserved') assert.fail('Sin grant temporal');
    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: reservation.requestSeq,
      target: 'dispatched', ownerToken: fixture.claim.ownerToken, wallTime: { clockEpochId: epoch, monotonicNs: '5000000' } });
    assert.equal(fixture.journal.expireActorJobRequest({ execution, requestSeq: reservation.requestSeq,
      clockEpochId: epoch, reason: 'timeout' }), 'expired');
    let budget = fixture.journal.readRunModelTimeBudget({ runId: one.runId });
    assert.equal(budget?.status, 'uncertain');
    assert.equal(budget?.wallTimeReservedMs, 30_000);
    assert.equal(budget?.activePiRequests, 1);
    assert.equal(budget?.uncertainRequests, 1);

    assert.equal(fixture.journal.settleActorJobRequestWallTime({ execution, requestSeq: reservation.requestSeq,
      clockEpochId: epoch, monotonicNs: '35005000000' }), 'settled');
    assert.equal(fixture.journal.settleActorJobRequestWallTime({ execution, requestSeq: reservation.requestSeq,
      clockEpochId: epoch, monotonicNs: '35005000000' }), 'existing');
    budget = fixture.journal.readRunModelTimeBudget({ runId: one.runId });
    assert.equal(budget?.status, 'known');
    assert.equal(budget?.wallTimeMeasuredMs, 35_000, 'el overrun real no se recorta al grant de 30 s');
    assert.equal(budget?.wallTimeReservedMs, 0);
    assert.equal(budget?.activePiRequests, 0);
    const database = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
    try {
      const lifecycle = database.prepare('SELECT lifecycle FROM world_runs WHERE run_id=?').get(one.runId);
      assert.equal(lifecycle === undefined ? undefined : Reflect.get(lifecycle, 'lifecycle'), 'paused');
    } finally { database.close(); }
  } finally { cleanFixture(fixture); }
});

test('el recovery tras restart vuelve incierto el transporte viejo y bloquea nuevas reservas sin reintentar', async () => {
  const fixture = await setup();
  const one = scope(fixture);
  const epoch = randomUUID();
  const oldOwner = randomUUID();
  const newOwner = randomUUID();
  try {
    const reservation = fixture.journal.reserveNextRequest({ ...one, clockEpochId: epoch, ownerToken: oldOwner });
    if (reservation.kind !== 'reserved') assert.fail('Sin grant temporal');
    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: reservation.requestSeq,
      target: 'dispatched', ownerToken: oldOwner, wallTime: { clockEpochId: epoch, monotonicNs: '2500000' } });
    fixture.journal.close();
    const recovered = openJournal({ path: `${fixture.directory}/journal.sqlite` });
    try {
      assert.deepEqual(recovered.recoverAbandonedModelTimeRequests({ ownerToken: newOwner }), {
        releasedReservations: 0, uncertainTransports: 1,
      });
      const budget = recovered.readRunModelTimeBudget({ runId: one.runId });
      assert.equal(budget?.status, 'uncertain');
      assert.equal(budget?.wallTimeMeasuredMs, 0, 'no se adjudica una duración que el proceso anterior no pudo cerrar');
      assert.equal(budget?.wallTimeReservedMs, 30_000);
      assert.equal(recovered.reserveNextRequest({ ...one, jobId: randomUUID(), clockEpochId: randomUUID(), ownerToken: newOwner }).kind, 'exhausted');
      assert.equal(recovered.readRunModelTimeBudget({ runId: one.runId })?.status, 'uncertain');
    } finally { recovered.close(); }
  } finally { cleanFixture(fixture); }
});

test('grant final se limita al remanente; recovery y undispatched devuelven sólo reservas no enviadas', async () => {
  const fixture = await setup();
  const one = scope(fixture);
  const firstEpoch = randomUUID();
  const secondEpoch = randomUUID();
  const firstOwner = randomUUID();
  const secondOwner = randomUUID();
    const thirdOwner = randomUUID();
  try {
    const first = fixture.journal.reserveNextRequest({ ...one, clockEpochId: firstEpoch, ownerToken: firstOwner });
    if (first.kind !== 'reserved') assert.fail('No se concedió el grant inicial');
    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: first.requestSeq,
      target: 'dispatched', ownerToken: firstOwner, wallTime: { clockEpochId: firstEpoch, monotonicNs: '0' } });
    fixture.journal.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: first.requestSeq,
      target: 'completed', ownerToken: firstOwner, wallTime: { clockEpochId: firstEpoch, monotonicNs: '50000000000' } });

    const remaining = fixture.journal.reserveNextRequest({ ...one, clockEpochId: secondEpoch, ownerToken: secondOwner });
    if (remaining.kind !== 'reserved') assert.fail('No se concedió el grant restante');
    assert.deepEqual(remaining.wallTime, { reservedMs: 10_000, clockEpochId: secondEpoch });
    fixture.journal.close();

    const recovered = openJournal({ path: `${fixture.directory}/journal.sqlite` });
    try {
      assert.deepEqual(recovered.recoverAbandonedModelTimeRequests({ ownerToken: randomUUID() }), {
        releasedReservations: 1, uncertainTransports: 0,
      });
      let budget = recovered.readRunModelTimeBudget({ runId: one.runId });
      assert.equal(budget?.status, 'known');
      assert.equal(budget?.wallTimeMeasuredMs, 50_000);
      assert.equal(budget?.wallTimeReservedMs, 0);
      assert.equal(budget?.wallTimeRemainingMs, 10_000);
      assert.equal(budget?.runCallsUsed, 1);

      const last = recovered.reserveNextRequest({ ...one, clockEpochId: randomUUID(), ownerToken: thirdOwner });
      if (last.kind !== 'reserved') assert.fail('La duración restante debería aceptar una reserva');
      recovered.transitionReservation({ jobId: one.jobId, generation: one.generation, requestSeq: last.requestSeq,
        target: 'undispatched', ownerToken: thirdOwner });
      budget = recovered.readRunModelTimeBudget({ runId: one.runId });
      assert.equal(budget?.wallTimeRemainingMs, 10_000);
      assert.equal(budget?.wallTimeReservedMs, 0);
      assert.equal(budget?.runCallsUsed, 1);
    } finally { recovered.close(); }
  } finally { cleanFixture(fixture); }
});

test('la migración v21 conserva reservas enviadas como tiempo histórico desconocido', async () => {
  const fixture = await setup();
  const one = scope(fixture);
  try {
    fixture.journal.close();
    const old = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
    try {
      old.prepare('INSERT INTO request_reservations VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), 0, 0, one.runId, one.pulseId, 'completed');
      old.exec('DROP TABLE model_time_spans; DROP TABLE model_time_run_state; DROP TABLE IF EXISTS actor_activation_invitation_jobs; DROP TABLE IF EXISTS actor_activation_invitations; DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances; DELETE FROM schema_version WHERE version IN(22,23,24,25,26,27,28,29,30,31,32);');
    } finally { old.close(); }
    const migrated = openJournal({ path: `${fixture.directory}/journal.sqlite` });
    try {
      const budget = migrated.readRunModelTimeBudget({ runId: one.runId });
      assert.equal(budget?.status, 'legacy-unknown');
      assert.equal(budget?.wallTimeMeasuredMs, null);
      assert.equal(budget?.wallTimeRemainingMs, null);
      assert.equal(budget?.unknownLegacyRequests, 1);
      assert.equal(migrated.reserveNextRequest({ ...one, jobId: randomUUID(), clockEpochId: randomUUID(), ownerToken: randomUUID() }).kind, 'exhausted');
      const inspect = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
      try {
        assert.equal(inspect.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version, 32);
        assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
      } finally { inspect.close(); }
    } finally { migrated.close(); }
  } finally { cleanFixture(fixture); }
});

test('registrar el accounting tras requests previas conserva desconocido en vez de inventar cero', async () => {
  const fixture = await setup();
  const one = scope(fixture);
  try {
    const database = new DatabaseSync(`${fixture.directory}/journal.sqlite`);
    try {
      database.prepare('DELETE FROM model_time_run_state WHERE run_id=?').run(one.runId);
      database.prepare('INSERT INTO request_reservations VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), 0, 0, one.runId, one.pulseId, 'completed');
    } finally { database.close(); }

    const attempt = fixture.journal.reserveNextRequest({ ...one, jobId: randomUUID(),
      clockEpochId: randomUUID(), ownerToken: randomUUID() });
    assert.deepEqual(attempt, { kind: 'exhausted', scope: 'legacy-unknown' });
    const budget = fixture.journal.readRunModelTimeBudget({ runId: one.runId });
    assert.equal(budget?.status, 'legacy-unknown');
    assert.equal(budget?.wallTimeMeasuredMs, null);
    assert.equal(budget?.unknownLegacyRequests, 1);
  } finally { cleanFixture(fixture); }
});
