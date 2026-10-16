import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { PiRuntime, type CreatePiSessionInput, type PiSessionHandle } from '../src/adapters/pi.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { ContinuistaCriterionSchema } from '../src/domain/world-journal.ts';
import { GoalIdSchema, WorldSnapshotSchema } from '../src/domain/world.ts';
import { CharacterIdSchema } from '../src/domain/values.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import { PreparedCharacterSchema, type PreparedCharacter } from '../src/domain/preparation.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { recordSyntheticPassedPreflight } from './fixtures/preflight.ts';
import { createSyntheticActorSession } from './fixtures/pi-session.ts';

function deterministicWorker(journal: ReturnType<typeof openJournal>, runtime: PiRuntime) {
  const ids = { eventId: randomUUID, perceptionId: randomUUID, experienceId: randomUUID,
    offerId: randomUUID, entityHandle: randomUUID, placeHandle: randomUUID, channelHandle: randomUUID, offerHandle: randomUUID };
  const framesByActor = new Map<string, ReturnType<typeof createSyntheticActorSession>>();
  return createActorTurnWorker({
    journal, runtime, ids,
    memoryForActor() { return { async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }; },
    continuista: { async review({ proposal }) { return {
      kind: 'continuista', proposalId: proposal.proposalId, version: proposal.version, runId: proposal.runId,
      actorId: proposal.actorId, stateRevision: proposal.baseRevision, exactContentHash: proposal.exactContentHash,
      ...(proposal.nextInitiative === undefined ? {} : { nextInitiative: proposal.nextInitiative }),
      verdict: 'allow', complete: true, criterionCodes: ContinuistaCriterionSchema.options, evidenceRefs: ['synthetic-worker-test'],
    }; } },
    sessionFactory: async (input: CreatePiSessionInput): Promise<PiSessionHandle> => {
      if (input.identity.kind !== 'actor') throw new Error('La fixture sólo permite actores.');
      const actorId = input.identity.characterId;
      let frames = framesByActor.get(actorId);
      if (frames === undefined) {
        frames = createSyntheticActorSession({ runtime: input.runtime, runId: input.runId, actorId });
        framesByActor.set(actorId, frames);
      }
      const snapshot = { ...frames.snapshot, candidateLeafId: input.checkpoint.kind === 'leaf'
        ? input.checkpoint.committedLeafId : frames.snapshot.candidateLeafId };
      if (input.checkpoint.kind === 'leaf') assert.equal(snapshot.sessionPath, input.checkpoint.sessionPath);
      return {
        identity: input.identity, activeToolNames: input.tools.map((tool) => tool.name),
        checkpoint: () => snapshot,
        subscribe: () => () => undefined,
        async abortAndDispose() { /* No hay transporte real que cerrar. */ },
        async prompt(prompt) {
          const port = input.requestPort;
          const purpose = input.identity;
          assert.equal((await port.checkEligibility({ purpose, scope: prompt.scope })).kind, 'active');
          await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot });
          const reservation = await port.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: input.runtime.clockEpochId });
          assert.equal(reservation.kind, 'reserved');
          if (reservation.kind !== 'reserved') throw new Error('Fixture sin reserva sintética.');
          const base = journal.loadActorPiSession({ runId: input.runId, actorId });
          assert.ok(base);
          const turnId = randomUUID(), candidateId = randomUUID();
          const inputLeaf = frames.appendInput(prompt.text);
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'request-input', baseScope: prompt.scope, request: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
            snapshot: { ...snapshot, candidateLeafId: inputLeaf } });
          await port.recordActorPiCandidate?.({ kind: 'request-input', candidateId: randomUUID(), turnId,
            runId: input.runId, actorId, scope: prompt.scope, lease: prompt.lease, base, requestSeq: reservation.requestSeq,
            candidateLeafId: inputLeaf, inputCut: prompt.inputCut });
          const wallTime = () => ({ clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() });
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: wallTime() });
          const tool = input.tools.find((candidate) => candidate.name === 'propose_action');
          assert.ok(tool);
          await Reflect.apply(tool.execute, tool, ['synthetic-tool', {
            nextInitiative: 'yield', action: { kind: 'wait', durationMs: 1 },
          }]);
          await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'completed', wallTime: wallTime() });
          const leaf = frames.appendTerminal();
          await port.recordCheckpointCandidate({ identity: purpose,
            purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest: { scope: prompt.scope, requestSeq: reservation.requestSeq } },
            snapshot: { ...snapshot, candidateLeafId: leaf } });
          await port.recordActorPiCandidate?.({ kind: 'terminal-candidate', candidateId, turnId,
            runId: input.runId, actorId, scope: prompt.scope, lease: prompt.lease, base,
            outcome: 'completed', lastRequestSeq: reservation.requestSeq, candidateLeafId: leaf, inputCut: prompt.inputCut });
          return { kind: 'pi-terminal-candidate', candidateId, outcome: 'completed', candidateLeafId: leaf };
        },
      };
    },
  });
}

test('retry explícito de meta sin inbox aparta la causa humana drenada y conserva su testimonio', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-activation-retry-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  const principalId = 'activation-retry-test';
  const idempotencyKey = () => randomUUID();
  try {
    const initialDraft = draftFixture({ humanParticipants: [{
      identity: {
        participantId: 'visitante-prueba', displayName: 'Visitante',
        identityMarkdown: 'Identidad ficticia propia.', lifeStoryMarkdown: 'Historia sintética para la prueba.',
      },
      presence: {
        kind: 'inScene', sceneId: '00000000-0000-4000-8000-000000000102', placeId: 'sala',
        position: { x: 1, y: 2 }, channelId: '00000000-0000-4000-8000-000000000104',
      },
    }] });
    const worldField = initialDraft.worldSnapshot;
    if (worldField.kind !== 'configured') assert.fail('La fixture no tiene Escenario configurado.');
    assert.ok(worldField.value.entities);
    assert.ok(worldField.value.scenes);
    const rosterField = initialDraft.roster;
    if (rosterField.kind !== 'configured') assert.fail('La fixture no tiene elenco configurado.');
    const maxPrepared = rosterField.value.preparedCharacters[0];
    assert.ok(maxPrepared);
    const robotId = CharacterIdSchema.parse('hymie-prueba');
    const robotPrepared = PreparedCharacterSchema.parse({ ...maxPrepared, characterId: robotId,
      goals: { ...maxPrepared.goals, value: maxPrepared.goals.value.map((goal) => ({ ...goal, ownerCharacterId: robotId })) } }) as PreparedCharacter;
    const goalId = GoalIdSchema.parse(randomUUID());
    const baseCharacter = worldField.value.entities.find((entity) => entity.kind === 'character');
    assert.ok(baseCharacter?.kind === 'character');
    const sceneId = worldField.value.activeSceneId;
    assert.ok(sceneId);
    const worldSnapshot = WorldSnapshotSchema.parse({
      ...worldField.value,
      entities: [
        ...worldField.value.entities.map((entity) => entity.kind === 'character'
          ? { ...entity, mind: { ...entity.mind, goals: [{ kind: 'durable', id: goalId,
            description: 'Perseguir una meta inicial propia.', priority: 0.7, state: 'active', revision: 0, history: [] }] } }
          : entity),
        { ...baseCharacter, entityId: randomUUID(), characterId: robotId, trueDisplayName: 'Hymie de prueba',
          position: { x: 3, y: 2 }, mind: { ...baseCharacter.mind, goals: [] } },
      ],
      scenes: worldField.value.scenes.map((scene) => scene.id === sceneId
        ? { ...scene, participantIds: [...(scene.participantIds ?? []), robotId] }
        : scene),
    });
    const preparedDraft = RunConfigurationDraftSchema.parse({
      ...initialDraft,
      roster: { ...rosterField, value: { ...rosterField.value,
        eligibleCharacterIds: [...rosterField.value.eligibleCharacterIds, robotId],
        activeCharacterIds: [...rosterField.value.activeCharacterIds, robotId],
        preparedCharacters: [...rosterField.value.preparedCharacters, robotPrepared],
      } },
      worldSnapshot: { ...worldField, value: worldSnapshot },
    });
    const { kind: _kind, schemaVersion: _schemaVersion, runId: _runId, revision: _revision, ...patch } = preparedDraft;
    const created = journal.createRunConfigurationDraft({ principalId, idempotencyKey: idempotencyKey(), patch });
    assert.equal(created.kind, 'created');
    if (created.kind !== 'created') assert.fail('No se creó el borrador sintético.');
    const promoted = journal.validateRunConfigurationDraft({ principalId, idempotencyKey: idempotencyKey(),
      runId: created.draft.runId, expectedRevision: created.draft.revision });
    assert.equal(promoted.kind, 'ready');
    if (promoted.kind !== 'ready') assert.fail('No se preparó la representación sintética.');

    const readState = () => {
      const state = journal.readWorldLifecycle({ runId: created.draft.runId });
      assert.ok(state);
      return state;
    };
    const applyLifecycle = (command: unknown, preflightJobId: string) => {
      const state = readState();
      return journal.applyRunLifecycleCommand({ principalId, idempotencyKey: idempotencyKey(), runId: created.draft.runId,
        expectedLifecycleRevision: state.lifecycleRevision, expectedConfigRevision: state.configRevision,
        expectedWorldRevision: state.worldRevision,
        command, preflightJobId });
    };
    const initialState = readState();
    const startPreflight = recordSyntheticPassedPreflight({ journal, runId: created.draft.runId });
    const started = applyLifecycle({ kind: 'start' }, startPreflight);
    assert.equal(started.kind, 'updated');
    const firstPulse = journal.beginCoordinatorPulse({ runId: created.draft.runId });
    assert.equal(firstPulse.kind, 'started');
    if (firstPulse.kind !== 'started') assert.fail('No inició la activación inicial.');
    assert.equal(firstPulse.jobs.length, 1);
    const maxActorId = maxPrepared.characterId;
    const maxJob = firstPulse.jobs.find((job) => job.actorId === maxActorId);
    assert.ok(maxJob);
    assert.deepEqual(maxJob.perceptionIds, [], 'una meta activa no se fabrica como percepción');
    const ownerToken = randomUUID(), claimToken = randomUUID();
    const claimed = journal.claimActorTurnJob({ runId: created.draft.runId, actorId: maxJob.actorId,
      jobId: maxJob.jobId, generation: maxJob.generation, ownerToken, claimToken });
    assert.equal(claimed.kind, 'claimed');
    const failed = journal.failActorTurnJob({ execution: { runId: created.draft.runId, actorId: maxJob.actorId,
      jobId: maxJob.jobId, generation: maxJob.generation, pulseId: firstPulse.pulse.pulseId,
      lease: { ownerToken, claimToken } }, code: 'execution-failed' });
    assert.equal(failed.kind, 'blocked');
    const runtime = await PiRuntime.create({ privateDataRoot: directory });
    const worker = deterministicWorker(journal, runtime);
    assert.equal(journal.closeCoordinatorPulse({ runId: created.draft.runId, pulseId: firstPulse.pulse.pulseId }).state, 'blocked');

    const snapshot = journal.loadWorld({ runId: created.draft.runId });
    assert.ok(snapshot);
    const human = journal.commitHumanIntervention({ runId: created.draft.runId, participantId: 'visitante-prueba',
      expectedRevision: snapshot.revision, idempotencyKey: idempotencyKey(), request: { kind: 'speech',
        recipientCharacterIds: [maxActorId, robotId], channelId: '00000000-0000-4000-8000-000000000104',
        content: { kind: 'speech', text: 'El testimonio debe esperar a que se recupere la meta.' } } });
    assert.equal(human.kind, 'stored');
    if (human.kind !== 'stored') assert.fail('No se guardó la intervención sintética.');
    assert.equal(human.resolution.kind, 'applied');
    assert.equal((await createDeliverWorldWorker({ journal, runId: created.draft.runId, actorId: maxActorId }).drain()).kind, 'completed');
    assert.equal((await createDeliverWorldWorker({ journal, runId: created.draft.runId, actorId: robotId }).drain()).kind, 'completed');
    const humanPulse = journal.beginCoordinatorPulse({ runId: created.draft.runId });
    assert.equal(humanPulse.kind, 'started');
    if (humanPulse.kind !== 'started') assert.fail('No se inició la causa humana con el job elegible de Hymie.');
    assert.equal(humanPulse.pulse.cause.kind, 'humanIntervention');
    assert.equal(humanPulse.jobs.length, 1);
    assert.equal(humanPulse.jobs[0]?.actorId, robotId);
    const hymieResponse = await worker.run({ runId: created.draft.runId, actorId: robotId,
      jobId: humanPulse.jobs[0]!.jobId, generation: humanPulse.jobs[0]!.generation,
      ownerToken: randomUUID(), claimToken: randomUUID() });
    assert.equal(hymieResponse.kind, 'committed');
    assert.equal(journal.closeCoordinatorPulse({ runId: created.draft.runId, pulseId: humanPulse.pulse.pulseId }).state,
      'running', 'el testimonio que espera Max mantiene abierta la causa humana');
    const perception = journal.readQueuedActorTurnIntents({ runId: created.draft.runId, actorId: maxActorId, limit: 10 })[0];
    assert.ok(perception);
    const laterPulseId = humanPulse.pulse.pulseId;

    assert.equal(journal.setWorldLifecycle({ runId: created.draft.runId, expectedWorldRevision: readState().worldRevision,
      expectedConfigRevision: readState().configRevision, target: 'paused' }), 'updated');
    const retryPreflight = recordSyntheticPassedPreflight({ journal, runId: created.draft.runId });
    const resumed = applyLifecycle({ kind: 'resume', retryBlockedActors: true }, retryPreflight);
    assert.equal(resumed.kind, 'updated');

    const inspect = new DatabaseSync(path);
    try {
      assert.equal(inspect.prepare('SELECT state FROM actor_turn_jobs WHERE run_id=? AND job_id=? AND generation=1')
        .get(created.draft.runId, maxJob.jobId)?.state, 'queued');
      const queuedIntent = inspect.prepare(`SELECT perception_id,state FROM actor_turn_intents WHERE run_id=? AND actor_id=? AND perception_id=?`)
        .get(created.draft.runId, maxActorId, perception.perceptionId);
      assert.ok(queuedIntent);
      assert.equal(Reflect.get(queuedIntent, 'perception_id'), perception.perceptionId);
      assert.equal(Reflect.get(queuedIntent, 'state'), 'queued');
      assert.equal(inspect.prepare('SELECT count(*) AS count FROM actor_turn_job_inputs WHERE perception_id=?')
        .get(perception.perceptionId)?.count, 0, 'el retry de meta no absorbe el testimonio posterior');
      const parkedPulse = inspect.prepare('SELECT state,parked_for_pulse_id FROM coordinator_pulses WHERE run_id=? AND pulse_id=?')
        .get(created.draft.runId, laterPulseId);
      assert.ok(parkedPulse);
      assert.equal(Reflect.get(parkedPulse, 'state'), 'blocked');
      assert.equal(Reflect.get(parkedPulse, 'parked_for_pulse_id'), firstPulse.pulse.pulseId);
      const invitation = inspect.prepare('SELECT state FROM actor_activation_invitations WHERE activation_id=?')
        .get(firstPulse.pulse.cause.kind === 'actorActivation' ? firstPulse.pulse.cause.id : '');
      assert.ok(invitation);
      assert.equal(Reflect.get(invitation, 'state'), 'assigned');
      assert.equal(inspect.prepare('SELECT count(*) AS count FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=?')
        .get(created.draft.runId, maxActorId, maxJob.jobId)?.count, 2);
      const quota = inspect.prepare('SELECT max_calls,consumed FROM pulses WHERE pulse_id=?').get(firstPulse.pulse.pulseId);
      assert.ok(quota);
      assert.equal(Reflect.get(quota, 'max_calls'), 4);
      assert.equal(Reflect.get(quota, 'consumed'), 0, 'el retry no inventa consumo para la convocatoria sin llamadas');
      const laterQuota = inspect.prepare('SELECT consumed FROM pulses WHERE pulse_id=?').get(laterPulseId);
      assert.ok(laterQuota);
      assert.equal(Reflect.get(laterQuota, 'consumed'), 1, 'el parking conserva la cuota de la respuesta aceptada de Hymie');
    } finally { inspect.close(); }

    const activationAfterRetry = journal.readCoordinatorPulse({ runId: created.draft.runId, pulseId: firstPulse.pulse.pulseId });
    assert.ok(activationAfterRetry);
    const maxRetryJob = activationAfterRetry.jobs.find((job) => job.actorId === maxActorId && job.jobId === maxJob.jobId);
    assert.equal(maxRetryJob?.generation, 1);
    assert.equal(maxRetryJob?.state, 'queued');
    assert.deepEqual(maxRetryJob?.perceptionIds, []);
    const maxRetry = await worker.run({ runId: created.draft.runId, actorId: maxActorId, jobId: maxJob.jobId,
      generation: 1, ownerToken: randomUUID(), claimToken: randomUUID() });
    assert.equal(maxRetry.kind, 'committed');
    assert.equal(journal.closeCoordinatorPulse({ runId: created.draft.runId, pulseId: firstPulse.pulse.pulseId }).state, 'completed');
    const acceptedInvitation = new DatabaseSync(path);
    try {
      assert.equal(acceptedInvitation.prepare('SELECT state FROM actor_activation_invitations WHERE activation_id=?')
        .get(firstPulse.pulse.cause.kind === 'actorActivation' ? firstPulse.pulse.cause.id : '')?.state, 'consumed');
      assert.equal(acceptedInvitation.prepare('SELECT state FROM actor_turn_jobs WHERE run_id=? AND actor_id=? AND job_id=? AND generation=0')
        .get(created.draft.runId, maxActorId, maxJob.jobId)?.state, 'blocked', 'la generación anterior sigue consultable como intento bloqueado');
    } finally { acceptedInvitation.close(); }

    const resumedHumanCause = journal.beginCoordinatorPulse({ runId: created.draft.runId });
    assert.equal(resumedHumanCause.kind, 'existing');
    if (resumedHumanCause.kind !== 'existing') assert.fail('La causa humana aparcada no se reanudó.');
    assert.equal(resumedHumanCause.pulse.pulseId, laterPulseId, 'se conserva el mismo pulso de la causa humana');
    assert.equal(resumedHumanCause.pulse.state, 'running');
    const maxHumanJob = resumedHumanCause.jobs.find((job) => job.actorId === maxActorId);
    const hymieHumanJob = resumedHumanCause.jobs.find((job) => job.actorId === robotId);
    assert.ok(maxHumanJob);
    assert.deepEqual(maxHumanJob.perceptionIds, [perception.perceptionId]);
    assert.equal(hymieHumanJob?.state, 'accepted');
    const afterHumanResume = new DatabaseSync(path);
    try {
      assert.equal(afterHumanResume.prepare('SELECT count(*) AS count FROM actor_turn_jobs WHERE run_id=? AND pulse_id=? AND actor_id=?')
        .get(created.draft.runId, laterPulseId, robotId)?.count, 1, 'Hymie no vuelve a recibir el mismo testimonio');
      assert.equal(afterHumanResume.prepare('SELECT state FROM actor_turn_intents WHERE perception_id=?')
        .get(perception.perceptionId)?.state, 'queued', 'la intención conserva su estado de origen mientras el inbox registra la asignación');
      assert.equal(afterHumanResume.prepare('SELECT state FROM actor_turn_job_inputs WHERE perception_id=?')
        .get(perception.perceptionId)?.state, 'assigned');
    } finally { afterHumanResume.close(); }
    const finalHumanTurn = await worker.run({ runId: created.draft.runId, actorId: maxActorId,
      jobId: maxHumanJob.jobId, generation: maxHumanJob.generation, ownerToken: randomUUID(), claimToken: randomUUID() });
    assert.equal(finalHumanTurn.kind, 'committed');
    assert.equal(journal.closeCoordinatorPulse({ runId: created.draft.runId, pulseId: laterPulseId }).state, 'completed');
    const completedCause = new DatabaseSync(path);
    try {
      assert.equal(completedCause.prepare('SELECT parked_for_pulse_id FROM coordinator_pulses WHERE run_id=? AND pulse_id=?')
        .get(created.draft.runId, laterPulseId)?.parked_for_pulse_id, null);
      assert.equal(completedCause.prepare('SELECT state FROM actor_turn_job_inputs WHERE perception_id=?')
        .get(perception.perceptionId)?.state, 'consumed');
    } finally { completedCause.close(); }
    const reopened = openJournal({ path });
    try {
      const historical = reopened.claimActorTurnJob({ runId: created.draft.runId, actorId: maxActorId,
        jobId: maxJob.jobId, generation: 0, ownerToken: randomUUID(), claimToken: randomUUID() });
      assert.equal(historical.kind, 'blocked', 'la generación histórica sigue legible tras consumir su invitación y reabrir v42');
      assert.equal(reopened.readCoordinatorPulse({ runId: created.draft.runId, pulseId: laterPulseId })?.state, 'completed');
    } finally { reopened.close(); }
    assert.equal(journal.readWorldLifecycle({ runId: created.draft.runId })?.lifecycle, 'running');
    assert.ok(initialState.lifecycleRevision < readState().lifecycleRevision);
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
