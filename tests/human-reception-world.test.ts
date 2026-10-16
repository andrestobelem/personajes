import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { worldFixture, actorId } from './fixtures/continuista.ts';
import { buildActorWorldView, emptyActorKnowledge, hashCommunicationContent, resolveWorldAttempt, WorldSnapshotSchema, type WorldIdSource, type WorldSnapshot } from '../src/domain/world.ts';

function ids(): WorldIdSource {
  return { eventId: randomUUID, perceptionId: randomUUID, experienceId: randomUUID, offerId: randomUUID, entityHandle: randomUUID, placeHandle: randomUUID, channelHandle: randomUUID, offerHandle: randomUUID };
}
const participantId = 'visitante';
function fixture(options: { remote?: boolean; broadcast?: boolean; nonverbal?: boolean; far?: boolean } = {}) {
  const base = worldFixture(options.nonverbal === undefined ? {} : { nonverbal: options.nonverbal });
  const channel = base.channels[0]; assert.ok(channel);
  return WorldSnapshotSchema.parse({ ...base, channels: [{ ...channel, scope: options.broadcast ? 'broadcast' : 'addressed' }], humanParticipants: [{ participantId, label: 'Nombre no percibido', presence: { kind: options.remote ? 'remote' : 'inScene', ...(options.remote ? {} : { sceneId: base.activeSceneId }), placeId: 'sala', position: { x: options.far ? 9 : 3, y: 2 }, channelId: channel.id } }] });
}
function view(snapshot: WorldSnapshot, perceptions: unknown[] = []) {
  return buildActorWorldView({ snapshot, actorId, knowledge: emptyActorKnowledge({ runId: snapshot.runId, actorId }), pendingPerceptions: perceptions, ids: ids() });
}
function communicate(snapshot: WorldSnapshot, built: ReturnType<typeof view>, audienceHandles: string[], content: unknown = { kind: 'speech', text: 'Recibido.' }, revision: number = snapshot.revision) {
  const channel = built.view.channels[0]; assert.ok(channel);
  return resolveWorldAttempt({ snapshot, actorKnowledge: built.knowledge, attempt: { kind: 'communicate', attemptId: randomUUID(), runId: snapshot.runId, actorId, expectedRevision: revision, channelHandle: channel.handle, audienceHandles, content }, approvalReceipt: { kind: 'approved', proposalId: randomUUID(), version: 1, runId: snapshot.runId, actorId, stateRevision: snapshot.revision, exactContentHash: hashCommunicationContent(content) }, ids: ids() });
}
function testimony(snapshot: WorldSnapshot) {
  return { kind: 'testimony', id: randomUUID(), runId: snapshot.runId, recipientCharacterId: actorId, eventId: randomUUID(), sourceParticipantId: participantId, speakerDisplayName: 'Visitante declarado', channelId: snapshot.channels[0]?.id, content: { kind: 'speech', text: 'Hola.' }, fictitiousAt: snapshot.clock.instant };
}

test('humanos visibles reciben handles opacos sin nombre privado y recepción durable sin percepciones ICM humanas', () => {
  const snapshot = fixture(); const built = view(snapshot);
  const human = built.view.humanParticipants?.[0]; assert.ok(human);
  assert.equal(human.label, 'Persona sin nombre percibido');
  assert.doesNotMatch(JSON.stringify(built.view), /Nombre no percibido|"participantId"|"sourceParticipantId"/);
  const result = communicate(snapshot, built, [human.handle]);
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  const event = result.events[0]; assert.equal(event?.kind, 'communicated');
  if (event?.kind !== 'communicated') return;
  assert.deepEqual(event.requestedHumanAudience, [participantId]); assert.deepEqual(event.effectiveHumanAudience, [participantId]);
  assert.deepEqual(event.effectiveAudience, []); assert.deepEqual(result.perceptions, []);
});

test('testimonio efectivamente recibido habilita responder a remoto sin exponer IDs ni certificar identidad', () => {
  const snapshot = fixture({ remote: true });
  assert.deepEqual(view(snapshot).view.humanParticipants, []);
  const built = view(snapshot, [testimony(snapshot)]);
  const item = built.view.inbox[0]; assert.equal(item?.kind, 'testimony');
  if (item?.kind !== 'testimony') return;
  assert.ok(item.speakerHandle); assert.equal(built.view.humanParticipants?.[0]?.label, 'Visitante declarado');
  assert.doesNotMatch(JSON.stringify(built.view), /Nombre no percibido|"participantId"/);
  const result = communicate(snapshot, built, [item.speakerHandle]); assert.equal(result.kind, 'applied');
});

test('broadcast alcanza humano remoto explícito aún desconocido; fuera de alcance emite sin recepción', () => {
  for (const far of [false, true]) {
    const snapshot = fixture({ remote: true, broadcast: true, far }); const built = view(snapshot);
    assert.deepEqual(built.view.humanParticipants, []);
    const result = communicate(snapshot, built, []); assert.equal(result.kind, 'applied');
    if (result.kind !== 'applied') continue;
    const event = result.events[0]; assert.equal(event?.kind, 'communicated');
    if (event?.kind !== 'communicated') continue;
    assert.deepEqual(event.effectiveHumanAudience, far ? [] : [participantId]);
  }
});

test('corte stale bloquea antes de resolver y el gesto respeta modalidad del canal', () => {
  const snapshot = fixture({ nonverbal: true }); const built = view(snapshot); const human = built.view.humanParticipants?.[0]; assert.ok(human);
  const ok = communicate(snapshot, built, [human.handle], { kind: 'gesture', gesture: { kind: 'wave' } }); assert.equal(ok.kind, 'applied');
  const stale = communicate(snapshot, built, [human.handle], { kind: 'gesture', gesture: { kind: 'wave' } }, snapshot.revision - 1); assert.equal(stale.kind, 'stale');
  const wrong = communicate(snapshot, built, [human.handle], { kind: 'gesture', gesture: { kind: 'bark' } }); assert.equal(wrong.kind, 'notApplied');
});

test('snapshots y eventos históricos no reciben campos humanos por defecto', () => {
  const snapshot = worldFixture(); assert.equal(Object.hasOwn(WorldSnapshotSchema.parse(snapshot), 'humanParticipants'), false);
  const built = view(snapshot); const channel = snapshot.channels[0]; assert.ok(channel);
  const broadcast = WorldSnapshotSchema.parse({ ...snapshot, channels: [{ ...channel, scope: 'broadcast' }] });
  const result = communicate(broadcast, view(broadcast), []); assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  const event = result.events[0]; assert.ok(event);
  assert.equal(Object.hasOwn(event, 'effectiveHumanAudience'), false);
  assert.equal(Object.hasOwn(built.view, 'humanParticipants'), false);
});

test('audiencia mixta resuelve personajes y humanos sin confundir handles ni duplicados', () => {
  const base = fixture(); const actor = base.entities.find((entity) => entity.kind === 'character'); assert.ok(actor?.kind === 'character');
  const snapshot = WorldSnapshotSchema.parse({ ...base, entities: [...base.entities, { ...actor, entityId: randomUUID(), characterId: 'otro-personaje', position: { x: 2.5, y: 2 } }], scenes: base.scenes.map((scene) => ({ ...scene, participantIds: [...scene.participantIds, 'otro-personaje'] })) });
  const built = view(snapshot); const human = built.view.humanParticipants?.[0]; assert.ok(human);
  const other = built.knowledge.bindings.find((binding) => binding.kind === 'entity' && binding.entityId !== actor.entityId); assert.ok(other);
  const result = communicate(snapshot, built, [other.handle, human.handle]); assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  const event = result.events[0]; assert.ok(event?.kind === 'communicated');
  assert.deepEqual(event.effectiveAudience, ['otro-personaje']); assert.deepEqual(event.effectiveHumanAudience, [participantId]);
  assert.equal(result.perceptions.length, 1); assert.equal(result.perceptions[0]?.recipientCharacterId, 'otro-personaje');
  const duplicate = communicate(snapshot, built, [human.handle, human.handle]); assert.equal(duplicate.kind, 'notApplied');
});

test('presencia en otra escena y canal ajeno no reciben aunque el handle sea conocido', () => {
  const base = fixture(); const built = view(base); const human = built.view.humanParticipants?.[0]; assert.ok(human);
  const source = base.humanParticipants?.[0]; assert.ok(source?.presence.kind === 'inScene');
  const otherSceneId = randomUUID();
  const elsewhere = WorldSnapshotSchema.parse({ ...base, scenes: [...base.scenes, { ...base.scenes[0], id: otherSceneId }], humanParticipants: [{ ...source, presence: { ...source.presence, sceneId: otherSceneId } }] });
  const result = communicate(elsewhere, built, [human.handle]); assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') return;
  const event = result.events[0]; assert.ok(event?.kind === 'communicated'); assert.deepEqual(event.effectiveHumanAudience, []);
  const otherChannelId = randomUUID(); const channel = base.channels[0]; assert.ok(channel);
  const channelChanged = WorldSnapshotSchema.parse({ ...base, channels: [...base.channels, { ...channel, id: otherChannelId }], humanParticipants: [{ ...source, presence: { ...source.presence, channelId: otherChannelId } }] });
  const wrong = communicate(channelChanged, built, [human.handle]); assert.equal(wrong.kind, 'applied');
  if (wrong.kind !== 'applied') return;
  const wrongEvent = wrong.events[0]; assert.ok(wrongEvent?.kind === 'communicated'); assert.deepEqual(wrongEvent.effectiveHumanAudience, []);
});

test('conocimiento humano persiste al consumir testimonio y no se genera desde testimonio de otro actor', () => {
  const snapshot = fixture({ remote: true }); const perception = testimony(snapshot);
  const built = view(snapshot, [perception]);
  const next = buildActorWorldView({ snapshot, actorId, knowledge: built.knowledge, pendingPerceptions: [], ids: ids() });
  assert.equal(next.view.humanParticipants?.[0]?.handle, built.view.humanParticipants?.[0]?.handle);
  assert.equal(next.view.humanParticipants?.[0]?.label, 'Visitante declarado');
  const foreign = view(snapshot, [{ ...perception, recipientCharacterId: 'otro-personaje' }]); assert.deepEqual(foreign.view.humanParticipants, []);
});

test('perfil humano de habla recibe gesto visual situado en otro canal; remoto conserva su enlace exclusivo', () => {
  for (const remote of [false, true]) {
    for (const broadcast of [false, true]) {
      const base = fixture({ remote });
      const speech = base.channels[0]; assert.ok(speech);
      const gesture = { kind: 'gesture', id: randomUUID(), label: 'Gestos visuales', enabled: true, modality: 'visual', maxRange: 4, scope: broadcast ? 'broadcast' : 'addressed', placeIds: ['sala'] };
      const snapshot = WorldSnapshotSchema.parse({ ...base, channels: [speech, gesture] });
      const built = view(snapshot, remote ? [testimony(snapshot)] : []);
      const human = built.view.humanParticipants?.[0]; assert.ok(human);
      const gestureChannel = built.view.channels.find((channel) => channel.kind === 'gesture'); assert.ok(gestureChannel);
      assert.equal(human.channels.includes(gestureChannel.handle), !remote);
      const content = { kind: 'gesture', gesture: { kind: 'wave' } };
      const result = resolveWorldAttempt({ snapshot, actorKnowledge: built.knowledge,
        attempt: { kind: 'communicate', attemptId: randomUUID(), runId: snapshot.runId, actorId, expectedRevision: snapshot.revision, channelHandle: gestureChannel.handle, audienceHandles: broadcast ? [] : [human.handle], content },
        approvalReceipt: { kind: 'approved', proposalId: randomUUID(), version: 1, runId: snapshot.runId, actorId, stateRevision: snapshot.revision, exactContentHash: hashCommunicationContent(content) }, ids: ids() });
      assert.equal(result.kind, 'applied'); if (result.kind !== 'applied') continue;
      const event = result.events[0]; assert.ok(event?.kind === 'communicated');
      assert.deepEqual(event.effectiveHumanAudience, remote ? [] : [participantId]);
      assert.deepEqual(result.perceptions, []);
    }
  }
});

test('gesto visual hacia humano con perfil habla respeta oscuridad, rango y canal habilitado', () => {
  const base = fixture(); const speech = base.channels[0]; assert.ok(speech);
  const visualChannelId = randomUUID();
  const initial = WorldSnapshotSchema.parse({ ...base, channels: [speech, { kind: 'gesture', id: visualChannelId, label: 'Gestos', enabled: true, modality: 'visual', maxRange: 4, scope: 'addressed', placeIds: ['sala'] }] });
  const built = view(initial); const human = built.view.humanParticipants?.[0]; assert.ok(human);
  const channel = built.view.channels.find((item) => item.kind === 'gesture'); assert.ok(channel);
  for (const restriction of ['dark', 'range', 'disabled']) {
    const snapshot = WorldSnapshotSchema.parse({ ...initial,
      places: initial.places.map((place) => restriction === 'dark' ? { ...place, lighting: 'dark' } : place),
      channels: initial.channels.map((item) => item.id === visualChannelId ? { ...item, ...(restriction === 'disabled' ? { enabled: false } : {}), ...(restriction === 'range' ? { maxRange: 0.1 } : {}) } : item),
    });
    const content = { kind: 'gesture', gesture: { kind: 'wave' } };
    const result = resolveWorldAttempt({ snapshot, actorKnowledge: built.knowledge,
      attempt: { kind: 'communicate', attemptId: randomUUID(), runId: snapshot.runId, actorId, expectedRevision: snapshot.revision, channelHandle: channel.handle, audienceHandles: [human.handle], content },
      approvalReceipt: { kind: 'approved', proposalId: randomUUID(), version: 1, runId: snapshot.runId, actorId, stateRevision: snapshot.revision, exactContentHash: hashCommunicationContent(content) }, ids: ids() });
    if (restriction === 'disabled') { assert.equal(result.kind, 'notApplied'); continue; }
    assert.equal(result.kind, 'applied'); if (result.kind !== 'applied') continue;
    const event = result.events[0]; assert.ok(event?.kind === 'communicated'); assert.deepEqual(event.effectiveHumanAudience, []);
  }
});
