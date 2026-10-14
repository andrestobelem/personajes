import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { openJournal } from '../src/adapters/journal.ts';
import { createCoordinatorPulseSupervisor } from '../src/application/coordinator-pulse-supervisor.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import {
  ActorJobExecutionSchema,
  ActorTurnJobClaimSchema,
} from '../src/domain/world-journal.ts';
import {
  createEmptyRunConfigurationDraft,
  ProductionAudioSchema,
  RunConfigurationDraftSchema,
} from '../src/domain/production.ts';
import type { ProductionRoster } from '../src/domain/production.ts';
import { ContinuityContextSchema, PreparedCharacterSchema, SpanishVarietyForActingSchema } from '../src/domain/preparation.ts';
import type { PreparedCharacter } from '../src/domain/preparation.ts';
import { WorldSnapshotSchema } from '../src/domain/world.ts';
import { CharacterIdSchema, HashSchema, PulseIdSchema, RunIdSchema } from '../src/domain/values.ts';
import type { ActorTurnWorkerResult } from '../src/application/actor-turn-worker.ts';

const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000101');
const actorId = CharacterIdSchema.parse('personaje-coordinador-prueba');
const secondActorId = CharacterIdSchema.parse('personaje-coordinador-secundario');
const sceneId = '00000000-0000-4000-8000-000000000102';
const channelId = '00000000-0000-4000-8000-000000000104';
const entityId = '00000000-0000-4000-8000-000000000103';
const secondEntityId = '00000000-0000-4000-8000-000000000105';
const recordedAt = '2026-10-14T12:00:00.000Z';

function continuityFixture() {
  return ContinuityContextSchema.parse({
    continuityId: 'continuidad-coordinador-prueba', revision: 1, contentHash: 'a'.repeat(64),
    kind: 'original', label: 'Fixture sintético', milestones: [], inclusions: [],
  });
}

function preparedFixture(characterId = actorId): PreparedCharacter {
  const continuity = continuityFixture();
  const provenance = {
    kind: 'curator-declaration', dossierRevision: 1, dossierHash: 'd'.repeat(64),
    continuity: { continuityId: continuity.continuityId, revision: continuity.revision, contentHash: continuity.contentHash },
    reason: 'Fixture sintético explícito para las pruebas del coordinador.',
    authoredBy: 'test-operator', createdAt: recordedAt, sourceRefs: [],
  };
  return PreparedCharacterSchema.parse({
    kind: 'prepared-character', schemaVersion: 1, characterId,
    dossierRevision: 1, dossierHash: 'd'.repeat(64), continuity, identityVersion: 1,
    identity: { value: { selfReference: 'Yo', selfConcept: 'Identidad sintética.', values: [], dispositions: ['observador'], contradictions: [] }, provenance },
    voice: { value: { kind: 'spoken', recipe: 'Voz textual sintética.' }, provenance },
    antecedents: { value: [], provenance },
    goals: { value: [{ kind: 'durable', goalId: `goal-${characterId}`, ownerCharacterId: characterId,
      desiredOutcome: 'Comprender una intervención.', priority: 0.7, reviewConditions: [], status: 'active', evidenceRefs: [] }], provenance },
    relationships: { value: [], provenance },
    capabilities: { value: [
      { capabilityId: 'speech', kind: 'speech', description: 'Habla.' },
      { capabilityId: 'movement', kind: 'movement', description: 'Se desplaza.' },
      { capabilityId: 'gesture', kind: 'gesture', description: 'Usa gestos.' },
    ], provenance },
    inventory: { value: [], provenance },
    initialExperience: { value: { kind: 'none' }, provenance },
    unknownPolicy: { value: { defaultTreatment: 'do-not-infer-or-assert', fields: [] }, provenance },
  });
}

function worldFixture() {
  const characters = [
    { characterId: actorId, entityId, name: 'Personaje de prueba', x: 2 },
    { characterId: secondActorId, entityId: secondEntityId, name: 'Segundo personaje sintético', x: 3 },
  ];
  return WorldSnapshotSchema.parse({
    schemaVersion: 1, runId, revision: 0, seq: 0,
    clock: { instant: 1_234_567_890_000, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Fixture' } },
    places: [{ id: 'sala', name: 'Sala', description: 'Lugar sintético.', width: 10, height: 10, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: channelId, label: 'Voz', enabled: true, maxRange: 8, scope: 'addressed', placeIds: ['sala'] }],
    entities: characters.map((character) => ({
      kind: 'character', entityId: character.entityId, characterId: character.characterId,
      trueDisplayName: character.name, species: 'human',
      presentation: { kind: 'ordinary', label: 'Persona' }, placeId: 'sala', position: { x: character.x, y: 2 },
      collisionRadius: 0.25, blocksMovement: false, presence: { kind: 'present', sceneId },
      preparation: { kind: 'prepared', continuityId: continuityFixture().continuityId, identityVersion: 1 },
      capabilities: ['move', 'observe', 'speak', 'gesture', 'wait', 'rest'], availability: { kind: 'available' },
      routine: { kind: 'always' }, mind: { goals: [], beliefs: [], relationships: [], recognizedCharacterIds: [], experiences: [] },
    })),
    inventory: [], scenes: [{ id: sceneId, label: 'Escena sintética', lifecycle: { kind: 'open', startedAt: 1_234_567_890_000 }, participantIds: [actorId, secondActorId], placeIds: ['sala'] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: { observeMs: 0, speechMs: 100, gestureMs: 100, takeMs: 100, offerMs: 100,
      acceptOfferMs: 100, maxWaitMs: 1_000, maxRestMs: 10_000, offerValidityMs: 1_000, interactionRange: 2 },
  });
}

function configured<T>(value: T) {
  return { kind: 'configured', value, evidence: { kind: 'operator-choice', operatorId: 'test-operator', recordedAt } };
}

function readyConfiguration() {
  const preparedCharacters = [preparedFixture(actorId), preparedFixture(secondActorId)];
  const world = worldFixture();
  const roster: ProductionRoster = {
    eligibleCharacterIds: [actorId, secondActorId], preparedCharacters, activeCharacterIds: [actorId, secondActorId],
  };
  const draft = createEmptyRunConfigurationDraft({ runId, revision: 1 });
  const parsed = RunConfigurationDraftSchema.parse({
    ...draft,
    name: configured('Representación sintética de prueba'),
    fictionalAt: configured(world.clock.instant),
    continuity: configured(continuityFixture()),
    roster: configured(roster),
    humanParticipants: configured([{
      identity: { participantId: 'interlocutor-prueba', displayName: 'Interlocutor', identityMarkdown: 'Identidad sintética.', lifeStoryMarkdown: 'Historia sintética.' },
      presence: { kind: 'inScene', sceneId, placeId: 'sala', position: { x: 0.5, y: 1 }, channelId },
    }]),
    worldSnapshot: configured(world),
    dramaticLine: configured({ purpose: 'Probar la coordinación durable.', question: { kind: 'absent' }, conflict: { kind: 'not-formulated' } }),
    circadianPolicy: configured({ kind: 'manual-only' }),
    spanishVariety: configured(SpanishVarietyForActingSchema.parse({ kind: 'proposed', label: 'Español de prueba', source: 'editorial-proposal' })),
    narrationMode: configured({ kind: 'disabled' }),
    budget: configured({ maxPiCallsPerRun: 20, maxPiCallsPerPulse: 4, maxConcurrentPiRequests: 2, maxWallTimeMs: 60_000 }),
    audio: configured(ProductionAudioSchema.parse({ mode: { kind: 'disabled' }, speakerSlots: [], narratorSlot: { kind: 'absent' }, soundEffectSlots: [] })),
  });
  const validation = validateRunConfiguration({ draft: parsed });
  if (validation.kind !== 'ready') throw new Error(`Fixture ready inválida: ${JSON.stringify(validation)}`);
  return validation.configuration;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error('Fixture no serializable');
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`).join(',')}}`;
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-coordinator-pulse-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  const configuration = readyConfiguration();
  const preparedContexts = configuration.roster.preparedCharacters.map((prepared) => ({
    actorId: prepared.characterId,
    continuityId: prepared.continuity.continuityId,
    continuityRevision: prepared.continuity.revision,
    continuityContentHash: prepared.continuity.contentHash,
    identityVersion: prepared.identityVersion,
    preparedContextHash: HashSchema.parse(createHash('sha256').update(canonicalJson(prepared)).digest('hex')),
  }));
  journal.registerWorldRun({
    initialSnapshot: configuration.worldSnapshot,
    configurationRevision: configuration.configRevision,
    configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: preparedContexts },
    lifecycle: 'running',
  });
  return {
    directory, path, journal, configuration,
    close() { journal.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

async function deliverCause(journal: ReturnType<typeof openJournal>, input: {
  text?: string;
  recipients?: readonly z.infer<typeof CharacterIdSchema>[];
  deliverTo?: readonly z.infer<typeof CharacterIdSchema>[];
} = {}) {
  const snapshot = journal.loadWorld({ runId });
  assert.ok(snapshot);
  const result = journal.commitHumanIntervention({
    runId, participantId: 'interlocutor-prueba', expectedRevision: snapshot.revision, idempotencyKey: randomUUID(),
    request: { kind: 'speech', recipientCharacterIds: [...(input.recipients ?? [actorId])], channelId,
      content: { kind: 'speech', text: input.text ?? 'Intervención sintética.' } },
  });
  assert.equal(result.kind, 'stored');
  assert.equal(result.resolution.kind, 'applied');
  for (const recipientId of input.deliverTo ?? input.recipients ?? [actorId]) await deliverActor(journal, recipientId);
}

async function deliverActor(journal: ReturnType<typeof openJournal>, recipientId: z.infer<typeof CharacterIdSchema>) {
  const delivered = await createDeliverWorldWorker({ journal, runId, actorId: recipientId }).drain();
  assert.equal(delivered.kind, 'completed');
}

function blockedWorker(journal: ReturnType<typeof openJournal>, claims: z.infer<typeof ActorTurnJobClaimSchema>[]) {
  return {
    async run(rawClaim: unknown): Promise<ActorTurnWorkerResult> {
      const claim = ActorTurnJobClaimSchema.parse(rawClaim);
      claims.push(claim);
      const claimed = journal.claimActorTurnJob(claim);
      assert.equal(claimed.kind, 'claimed');
      const execution = ActorJobExecutionSchema.parse({
        runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
        generation: claimed.job.generation, pulseId: claimed.job.pulseId,
        lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken },
      });
      journal.failActorTurnJob({ execution, code: 'job-inactive' });
      return { kind: 'blocked', code: 'job-inactive', execution };
    },
  };
}

test('el coordinador no crea pulsos sin causa ni despacha mientras la corrida está pausada', async () => {
  const fixture = createFixture();
  try {
    const claims: z.infer<typeof ActorTurnJobClaimSchema>[] = [];
    const supervisor = createCoordinatorPulseSupervisor({ journal: fixture.journal, ownerToken: randomUUID(), actorWorker: blockedWorker(fixture.journal, claims) });
    assert.equal(supervisor.recover(), 0);
    supervisor.schedule({ runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000199') });
    await supervisor.waitForIdle();
    assert.equal(claims.length, 0);
    await deliverCause(fixture.journal);
    const worldBeforePause = fixture.journal.loadWorld({ runId });
    assert.ok(worldBeforePause);
    assert.equal(fixture.journal.setWorldLifecycle({ runId, expectedWorldRevision: worldBeforePause.revision, expectedConfigRevision: fixture.configuration.configRevision, target: 'paused' }), 'updated');
    assert.equal(supervisor.recover(), 0);
    await supervisor.waitForIdle();
    assert.equal(claims.length, 0);
    const worldBeforeResume = fixture.journal.loadWorld({ runId });
    assert.ok(worldBeforeResume);
    assert.equal(fixture.journal.setWorldLifecycle({ runId, expectedWorldRevision: worldBeforeResume.revision, expectedConfigRevision: fixture.configuration.configRevision, target: 'running' }), 'updated');
    assert.equal(supervisor.recover(), 1);
    await supervisor.waitForIdle();
    assert.equal(claims.length, 1);
    await supervisor.close();
  } finally { fixture.close(); }
});

test('un pulso durable se recupera tras reiniciar el host con su identidad estable y un claim nuevo', async () => {
  const fixture = createFixture();
  let reopened: ReturnType<typeof openJournal> | undefined;
  try {
    await deliverCause(fixture.journal);
    const started = fixture.journal.beginCoordinatorPulse({ runId });
    assert.equal(started.kind, 'started');
    if (started.kind !== 'started') assert.fail('No se creó el pulso de la causa durable');
    const job = started.jobs[0];
    assert.ok(job);
    const oldOwner = randomUUID();
    const oldClaim = randomUUID();
    assert.equal(fixture.journal.claimActorTurnJob({ runId, actorId, jobId: job.jobId, generation: job.generation, ownerToken: oldOwner, claimToken: oldClaim }).kind, 'claimed');
    fixture.journal.close();

    reopened = openJournal({ path: fixture.path });
    const newOwner = randomUUID();
    reopened.recoverAbandonedActorTurnJobClaims({ ownerToken: newOwner });
    const recoveredJobs = reopened.listActorTurnJobsForPulse({ runId, pulseId: started.pulse.pulseId });
    assert.equal(recoveredJobs[0]?.state, 'queued');
    assert.equal(recoveredJobs[0]?.jobId, job.jobId);
    assert.equal(recoveredJobs[0]?.generation, job.generation);
    assert.equal(recoveredJobs[0]?.pulseId, job.pulseId);

    const claims: z.infer<typeof ActorTurnJobClaimSchema>[] = [];
    const supervisor = createCoordinatorPulseSupervisor({ journal: reopened, ownerToken: newOwner, actorWorker: blockedWorker(reopened, claims) });
    assert.equal(supervisor.recover(), 1);
    await supervisor.waitForIdle();
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.jobId, job.jobId);
    assert.equal(claims[0]?.generation, job.generation);
    assert.notEqual(claims[0]?.claimToken, oldClaim);
    assert.equal(reopened.readCoordinatorPulse({ runId, pulseId: job.pulseId })?.state, 'blocked');
    await supervisor.close();
  } finally {
    try { reopened?.close(); } catch { /* The fixture cleanup owns the temp directory. */ }
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('una entrega nueva durante el pulso despierta al coordinador sin duplicar workers ni autoreintentar bloqueados', async () => {
  const fixture = createFixture();
  try {
    await deliverCause(fixture.journal, { recipients: [actorId, secondActorId], deliverTo: [actorId] });
    const claims: z.infer<typeof ActorTurnJobClaimSchema>[] = [];
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let releaseResolve: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let calls = 0;
    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    let observedPulseId: z.infer<typeof PulseIdSchema> | undefined;
    const observedPulseIds: z.infer<typeof PulseIdSchema>[] = [];
    const worker = {
      async run(rawClaim: unknown): Promise<ActorTurnWorkerResult> {
        calls += 1;
        activeWorkers += 1;
        maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
        const claim = ActorTurnJobClaimSchema.parse(rawClaim);
        claims.push(claim);
        const claimed = fixture.journal.claimActorTurnJob(claim);
        assert.equal(claimed.kind, 'claimed');
        if (claimed.kind !== 'claimed') throw new Error('El claim de prueba falló');
        observedPulseId = claimed.job.pulseId;
        observedPulseIds.push(claimed.job.pulseId);
        enteredResolve?.();
        await release;
        const execution = ActorJobExecutionSchema.parse({
          runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
          generation: claimed.job.generation, pulseId: claimed.job.pulseId,
          lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken },
        });
        fixture.journal.failActorTurnJob({ execution, code: 'job-inactive' });
        activeWorkers -= 1;
        return { kind: 'blocked', code: 'job-inactive', execution };
      },
    };
    const supervisor = createCoordinatorPulseSupervisor({ journal: fixture.journal, ownerToken: randomUUID(), actorWorker: worker,
      onOutcome() { throw new Error('Un observador no puede alterar el estado durable.'); } });
    supervisor.schedule({ runId });
    await entered;
    await deliverActor(fixture.journal, secondActorId);
    supervisor.schedule({ runId });
    supervisor.schedule({ runId });
    assert.equal(calls, 1);
    releaseResolve?.();
    await supervisor.waitForIdle();
    assert.equal(calls, 2);
    assert.equal(maxActiveWorkers, 1, 'el mismo run procesa los actores en serie');
    assert.equal(new Set(claims.map((claim) => claim.claimToken)).size, 2);
    assert.deepEqual(new Set(claims.map((claim) => claim.actorId)), new Set([actorId, secondActorId]));
    assert.equal(new Set(claims.map((claim) => claim.jobId)).size, 2);
    assert.ok(claims.every((claim) => claim.runId === runId));
    assert.equal(new Set(observedPulseIds).size, 1, 'la entrega tardía se incorpora al pulso durable ya abierto');
    assert.ok(observedPulseId);
    assert.equal(fixture.journal.readCoordinatorPulse({ runId, pulseId: observedPulseId })?.state, 'blocked');
    assert.equal(supervisor.recover(), 1);
    await supervisor.waitForIdle();
    assert.equal(calls, 2, 'los jobs bloqueados no se vuelven a ejecutar automáticamente');
    await supervisor.close();
  } finally { fixture.close(); }
});

test('cancelRun aborta y espera sólo el worker activo de esa corrida', async () => {
  const fixture = createFixture();
  try {
    await deliverCause(fixture.journal);
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let observedAbort = false;
    let activePulseId: z.infer<typeof PulseIdSchema> | undefined;
    const worker = {
      async run(rawClaim: unknown, options: { signal?: AbortSignal }): Promise<ActorTurnWorkerResult> {
        const claim = ActorTurnJobClaimSchema.parse(rawClaim);
        const claimed = fixture.journal.claimActorTurnJob(claim);
        assert.equal(claimed.kind, 'claimed');
        if (claimed.kind !== 'claimed') throw new Error('El claim de prueba falló');
        activePulseId = claimed.job.pulseId;
        const execution = ActorJobExecutionSchema.parse({
          runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
          generation: claimed.job.generation, pulseId: claimed.job.pulseId,
          lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken },
        });
        enteredResolve?.();
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true }));
        fixture.journal.failActorTurnJob({ execution, code: 'cancelled' });
        return { kind: 'blocked', code: 'cancelled', execution };
      },
    };
    const supervisor = createCoordinatorPulseSupervisor({ journal: fixture.journal, ownerToken: randomUUID(), actorWorker: worker });
    supervisor.schedule({ runId });
    await entered;
    assert.equal(await supervisor.cancelRun({ runId }), true);
    assert.equal(observedAbort, true);
    await supervisor.waitForIdle();
    assert.ok(activePulseId);
    assert.equal(fixture.journal.listActorTurnJobsForPulse({ runId, pulseId: activePulseId })[0]?.failureCode, 'cancelled');
    assert.equal(await supervisor.cancelRun({ runId }), false);
    await supervisor.close();
  } finally { fixture.close(); }
});

test('close aborta y espera al worker activo antes de devolver', async () => {
  const fixture = createFixture();
  try {
    await deliverCause(fixture.journal);
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let observedAbort = false;
    const worker = {
      async run(rawClaim: unknown, options: { signal?: AbortSignal }): Promise<ActorTurnWorkerResult> {
        const claim = ActorTurnJobClaimSchema.parse(rawClaim);
        const claimed = fixture.journal.claimActorTurnJob(claim);
        assert.equal(claimed.kind, 'claimed');
        if (claimed.kind !== 'claimed') throw new Error('El claim de prueba falló');
        enteredResolve?.();
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true }));
        return { kind: 'unclaimed', reason: 'busy' };
      },
    };
    const supervisor = createCoordinatorPulseSupervisor({ journal: fixture.journal, ownerToken: randomUUID(), actorWorker: worker });
    supervisor.recover();
    await entered;
    let closeResolved = false;
    const closing = supervisor.close().then(() => { closeResolved = true; });
    await closing;
    assert.equal(observedAbort, true);
    assert.equal(closeResolved, true);
  } finally { fixture.close(); }
});
