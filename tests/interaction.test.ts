import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HumanInterventionRequestSchema, HumanParticipantProfileSchema,
} from '../src/domain/interaction.ts';
import { SessionModeSchema } from '../src/domain/http.ts';
import { HumanParticipantIdSchema } from '../src/domain/values.ts';

const request = {
  kind: 'speech',
  recipientCharacterIds: ['maxwell-smart'],
  channelId: '00000000-0000-4000-8000-000000000001',
  content: { kind: 'speech', text: '¿Me escuchás, Max?' },
} as const;

test('la intervención humana valida contenido, canal y destinatarios configurables', () => {
  assert.deepEqual(HumanInterventionRequestSchema.parse(request), request);
  assert.equal(HumanInterventionRequestSchema.safeParse({
    ...request, recipientCharacterIds: Array.from({ length: 100 }, (_, index) => `actor-${index}`),
  }).success, true);
});

test('la intervención permite audiencia vacía para broadcast y rechaza duplicados o exceso', () => {
  assert.equal(HumanInterventionRequestSchema.safeParse({ ...request, recipientCharacterIds: [] }).success, true);
  for (const recipientCharacterIds of [['maxwell-smart', 'maxwell-smart'], Array.from({ length: 101 }, (_, index) => `actor-${index}`)]) {
    assert.equal(HumanInterventionRequestSchema.safeParse({ ...request, recipientCharacterIds }).success, false);
  }
});

test('la intervención no admite autoridad ni identidad de emisor desde el cliente', () => {
  for (const extra of [
    { speakerId: 'maxwell-smart' }, { participantId: 'player' }, { origin: 'human' },
    { received: true }, { authority: 'director' },
  ]) {
    assert.equal(HumanInterventionRequestSchema.safeParse({ ...request, ...extra }).success, false);
  }
});

test('el texto de intervención se limita por bytes UTF-8 y excluye NUL', () => {
  assert.equal(HumanInterventionRequestSchema.safeParse({
    ...request, content: { kind: 'speech', text: 'á'.repeat(8_192) },
  }).success, true);
  assert.equal(HumanInterventionRequestSchema.safeParse({
    ...request, content: { kind: 'speech', text: 'á'.repeat(8_193) },
  }).success, false);
  assert.equal(HumanInterventionRequestSchema.safeParse({
    ...request, content: { kind: 'speech', text: 'hola\0' },
  }).success, false);
  assert.equal(HumanInterventionRequestSchema.safeParse({
    ...request, content: { kind: 'gesture', gesture: { kind: 'nod' } },
  }).success, false);
});

test('el perfil diegético humano tiene identidad propia y presencia configurada', () => {
  const profile = {
    identity: {
      participantId: 'andres-personaje',
      displayName: 'Andrés',
      identityMarkdown: 'Agente de enlace recién llegado a CONTROL.',
      lifeStoryMarkdown: 'Creció en Buenos Aires y fue reclutado por su capacidad para escuchar.',
    },
    presence: {
      kind: 'inScene',
      sceneId: '00000000-0000-4000-8000-000000000002',
      placeId: 'control',
      position: { x: 24, y: 16 },
      channelId: '00000000-0000-4000-8000-000000000001',
    },
  } as const;

  assert.deepEqual(HumanParticipantProfileSchema.parse(profile), profile);
  assert.equal(HumanParticipantIdSchema.safeParse('Andrés').success, false);
  assert.deepEqual(SessionModeSchema.parse({
    kind: 'interlocutor',
    runId: '00000000-0000-4000-8000-000000000003',
    participantId: 'andres-personaje',
  }), {
    kind: 'interlocutor',
    runId: '00000000-0000-4000-8000-000000000003',
    participantId: 'andres-personaje',
  });
});

test('el perfil rechaza datos de autoridad y límites de identidad excedidos', () => {
  const profile = {
    identity: {
      participantId: 'andres-personaje', displayName: 'Andrés',
      identityMarkdown: 'Agente de enlace.', lifeStoryMarkdown: 'Se trasladó a CONTROL para colaborar con los agentes.',
    },
    presence: {
      kind: 'remote', placeId: 'control', position: { x: 0, y: 0 },
      channelId: '00000000-0000-4000-8000-000000000001',
    },
  } as const;

  assert.equal(HumanParticipantProfileSchema.safeParse({ ...profile, authority: 'director' }).success, false);
  assert.equal(HumanParticipantProfileSchema.safeParse({
    ...profile, identity: { ...profile.identity, identityMarkdown: 'a'.repeat(32_769) },
  }).success, false);
  assert.equal(HumanParticipantProfileSchema.safeParse({
    ...profile, identity: { ...profile.identity, lifeStoryMarkdown: 'historia\0inválida' },
  }).success, false);
  assert.equal(HumanParticipantProfileSchema.safeParse({
    ...profile, presence: { ...profile.presence, channelId: 'missing-channel' },
  }).success, false);
});
