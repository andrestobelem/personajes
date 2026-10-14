import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { projectHumanInteractionContext } from '../src/domain/interaction.ts';
import { setup } from './fixtures/continuista.ts';

test('contexto humano no ofrece destinatarios cuando la identidad permanece en otra escena', async () => {
  const fixture = await setup();
  try {
    const profile = fixture.configuration.humanParticipants[0];
    assert.ok(profile?.presence.kind === 'inScene');
    const context = projectHumanInteractionContext({
      snapshot: fixture.configuration.worldSnapshot,
      profile: { ...profile, presence: { ...profile.presence, sceneId: randomUUID() } },
    });
    assert.equal(context, undefined);
  } finally { fixture.close(); }
});

test('contexto humano público excluye memoria, identidad encubierta e historia del interlocutor', async () => {
  const fixture = await setup();
  try {
    const profile = fixture.configuration.humanParticipants[0];
    assert.ok(profile);
    const context = projectHumanInteractionContext({ snapshot: fixture.configuration.worldSnapshot, profile });
    assert.ok(context);
    const text = JSON.stringify(context);
    assert.doesNotMatch(text, /SECRET_|identityMarkdown|lifeStoryMarkdown|experiences|trueDisplayName/);
    assert.deepEqual(context.recipients.map(item => item.characterId), ['personaje-prueba']);
  } finally { fixture.close(); }
});
