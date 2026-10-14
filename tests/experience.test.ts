import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeExperience, readPrivateExperience } from '../src/application/experience-envelope.ts';
import { CharacterIdSchema, RunIdSchema, WorldSeqSchema } from '../src/domain/values.ts';

const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000001');
const actorId = CharacterIdSchema.parse('maxwell-smart');
const base = {
  schemaVersion: 1,
  experienceId: '00000000-0000-4000-8000-000000000002',
  runId, actorId, kind: 'belief', content: 'No vi al sospechoso.',
  sourceRefs: [], fictitiousAt: 0, receivedAt: 0, worldSeq: 3,
  confidence: 0.4, revision: 0, predecessor: { kind: 'initial' }, basedOn: [],
};

test('el mismo contenido conserva dos identidades de experiencia', () => {
  const first = freezeExperience(base);
  const second = freezeExperience({ ...base, experienceId: '00000000-0000-4000-8000-000000000003' });
  assert.notEqual(first.payloadHash, second.payloadHash);
  assert.equal(freezeExperience({ ...base }).canonicalPayload, first.canonicalPayload);
  assert.equal(first.envelope.content, 'No vi al sospechoso.');
});

test('memoria privada rechaza dueño, futuro y contenido alterado', () => {
  const frozen = freezeExperience(base);
  const request = {
    summary: frozen.canonicalPayload, actorId, runId,
    throughWorldSeq: WorldSeqSchema.parse(3), expectedPayloadHash: frozen.payloadHash,
  };
  assert.equal(readPrivateExperience(request).kind, 'belief');
  assert.throws(() => readPrivateExperience({ ...request, actorId: CharacterIdSchema.parse('agente-99') }));
  assert.throws(() => readPrivateExperience({ ...request, throughWorldSeq: WorldSeqSchema.parse(2) }));
  const changed = freezeExperience({ ...base, content: 'Vi al sospechoso.' });
  assert.throws(() => readPrivateExperience({ ...request, summary: changed.canonicalPayload }));
});

test('fronteras rechazan privilegios, confianza inválida y truncamiento', () => {
  assert.throws(() => freezeExperience({ ...base, authority: 'director' }));
  assert.throws(() => freezeExperience({ ...base, confidence: NaN }));
  assert.throws(() => freezeExperience({ ...base, confidence: 1.1 }));
  assert.throws(() => freezeExperience({ ...base, content: 'á'.repeat(33_000) }));
});
