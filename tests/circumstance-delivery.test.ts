import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { createDeliverWorldWorker } from '../src/application/deliver-world.ts';
import { createRunObservationApplication } from '../src/application/run-observation.ts';
import { ReadyRunConfigurationSchema, validateRunConfiguration } from '../src/application/production-preflight.ts';
import { ConfirmedEventPageSchema, ConversationPageSchema } from '../src/domain/run-observation.ts';
import { canonical, draftFixture, actorId } from './fixtures/continuista.ts';

test('una circunstancia confirmada se entrega como percepción sin autor y se observa sin convertirse en conversación', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-circumstance-delivery-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  try {
    const ready = validateRunConfiguration({ draft: draftFixture() });
    if (ready.kind !== 'ready') assert.fail('La fixture debe quedar Ready');
    const configuration = ReadyRunConfigurationSchema.parse({ ...ready.configuration,
      worldSnapshot: { ...ready.configuration.worldSnapshot, circumstanceCatalog: {
        revision: 1, provenance: { authoredBy: 'PRIVATE_OPERATOR', recordedAt: '2026-10-15T00:00:00Z', sourceRefs: ['PRIVATE_SOURCE'] },
        objectTemplates: [], environmentConditions: [{ id: 'rain', label: 'Lluvia', states: [
          { id: 'heard', modality: 'auditory', description: 'Se escucha la lluvia contra el techo.' },
          { id: 'unselected', modality: 'visual', description: 'PRIVATE_UNSELECTED_STATE' },
        ] }],
      } } });
    const snapshot = configuration.worldSnapshot;
    const runId = snapshot.runId;
    const prepared = configuration.roster.preparedCharacters[0];
    assert.ok(prepared);
    journal.registerWorldRun({ initialSnapshot: snapshot, configurationRevision: configuration.configRevision,
      configuration, lifecycle: 'paused', continuityFence: { kind: 'prepared-contexts', atWorldSeq: snapshot.seq,
        contexts: [{ actorId, continuityId: prepared.continuity.continuityId,
          continuityRevision: prepared.continuity.revision, continuityContentHash: prepared.continuity.contentHash,
          identityVersion: prepared.identityVersion,
          preparedContextHash: createHash('sha256').update(canonical(prepared)).digest('hex') }] } });
    const command = { runId, principalId: 'operator-secret-principal', idempotencyKey: randomUUID(), operationId: randomUUID(),
      expectedWorldRevision: snapshot.revision, expectedDirectionRevision: 0,
      payload: { kind: 'changeCircumstance', scope: { kind: 'scene', sceneId: snapshot.activeSceneId },
        operation: { kind: 'setLighting', placeId: 'sala', level: 'dark' } } };
    const result = journal.applyCircumstanceCommand(command);
    assert.equal(result.kind, 'stored');
    if (result.kind !== 'stored') assert.fail('Expected stored circumstance');
    assert.equal(result.receipt.effect.kind, 'applied');
    if (result.receipt.effect.kind !== 'applied') assert.fail('Expected applied circumstance');
    assert.deepEqual(result.receipt.effect.recipientActorIds, [actorId]);
    assert.equal(journal.readExperiences({ runId, actorId, throughWorldSeq: result.receipt.worldSeq }).length, 0);
    const worker = createDeliverWorldWorker({ journal, runId, actorId });
    assert.deepEqual(await worker.drain(), { kind: 'completed', delivered: 1, limitReached: false });
    const experiences = journal.readExperiences({ runId, actorId, throughWorldSeq: result.receipt.worldSeq });
    assert.equal(experiences.length, 1);
    const experience = experiences[0];
    assert.ok(experience?.kind === 'perception');
    assert.equal(experience.content, 'La iluminación de Sala cambia a oscuridad.');
    assert.deepEqual(experience.sourceRefs, []);
    assert.equal(experience.fictitiousAt, snapshot.clock.instant);
    assert.equal(experience.receivedAt, snapshot.clock.instant);
    assert.equal(experience.eventId, result.receipt.effect.eventIds[0]);
    assert.doesNotMatch(JSON.stringify(experience), /operator-secret-principal|speaker|sourceEntityId|operationId|reason|motivation/);
    const application = createRunObservationApplication({ journal });
    const observed = application.readEvents({ runId, limit: 100 });
    if (observed.kind !== 'found') assert.fail(observed.kind);
    const events = ConfirmedEventPageSchema.parse(observed.value);
    assert.equal(events.items.length, 1);
    assert.equal(events.items[0]?.eventType, 'circumstanceChanged');
    assert.equal(events.items[0]?.speaker, null);
    assert.equal(events.items[0]?.summary, 'Cambió la iluminación de Sala.');
    const conversations = application.readConversations({ runId, limit: 100 });
    if (conversations.kind !== 'found') assert.fail(conversations.kind);
    assert.deepEqual(ConversationPageSchema.parse(conversations.value).items, []);
    assert.deepEqual(await worker.drain(), { kind: 'completed', delivered: 0, limitReached: false });
    assert.equal(journal.applyCircumstanceCommand(command).kind, 'existing');
    journal.close();
    journal = openJournal({ path });
    assert.equal(journal.applyCircumstanceCommand(command).kind, 'existing');
    assert.deepEqual(await createDeliverWorldWorker({ journal, runId, actorId }).drain(),
      { kind: 'completed', delivered: 0, limitReached: false });
    assert.deepEqual(journal.readExperiences({ runId, actorId, throughWorldSeq: result.receipt.worldSeq }), experiences);
    assert.equal(journal.loadWorld({ runId })?.clock.instant, snapshot.clock.instant);
    const observer = createRunObservationApplication({ journal });
    const beforeEnvironment = observer.readStage({ runId });
    if (beforeEnvironment.kind !== 'found') assert.fail(beforeEnvironment.kind);
    assert.equal(beforeEnvironment.value.places[0]?.environment, undefined);
    const environment = journal.applyCircumstanceCommand({ ...command, idempotencyKey: randomUUID(), operationId: randomUUID(),
      expectedWorldRevision: result.receipt.worldRevision, expectedDirectionRevision: result.receipt.directionRevision,
      payload: { ...command.payload, operation: { kind: 'setEnvironment', placeId: 'sala', conditionId: 'rain', stateId: 'heard' } } });
    if (environment.kind !== 'stored') assert.fail(environment.kind);
    const current = observer.readStage({ runId });
    if (current.kind !== 'found') assert.fail(current.kind);
    assert.deepEqual(current.value.places[0]?.environment, [
      { label: 'Lluvia', modality: 'auditory', detail: 'Se escucha la lluvia contra el techo.' },
    ]);
    assert.doesNotMatch(JSON.stringify(current.value), /PRIVATE_|unselected|conditionId|stateId|provenance/);
    const historical = observer.readStage({ runId, atCommitIndex: result.receipt.commitIndex });
    if (historical.kind !== 'found') assert.fail(historical.kind);
    assert.equal(historical.value.places[0]?.environment, undefined);
    assert.equal(historical.value.worldSeq, result.receipt.worldSeq);
    assert.equal(current.value.worldSeq, environment.receipt.worldSeq);
  } finally {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
