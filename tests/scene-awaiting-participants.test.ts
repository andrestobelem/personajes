import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { worldPreparationIssues } from '../src/web/world-preparation.ts';
import { draftFixture } from './fixtures/continuista.ts';

function withoutParticipants() {
  const draft = draftFixture();
  assert.equal(draft.worldSnapshot.kind, 'configured');
  if (draft.worldSnapshot.kind !== 'configured') assert.fail('Sin Escenario');
  const world = draft.worldSnapshot.value;
  const scenes = (world.scenes ?? []).map(({ participantIds: _omitted, ...scene }) => scene);
  return RunConfigurationDraftSchema.parse({ ...draft, worldSnapshot: { ...draft.worldSnapshot, value: { ...world, scenes } } });
}

test('a scene awaiting its first prepared actor reports an actionable pending issue instead of a raw missing array', () => {
  const draft = withoutParticipants();
  const result = validateRunConfiguration({ draft });
  assert.equal(result.kind, 'invalid');
  if (result.kind !== 'invalid') return;
  const pending = result.issues.filter((issue) => issue.code === 'scene-has-no-participant');
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.field, 'worldSnapshot.scenes.0.participantIds');
  assert.match(pending[0]?.detail ?? '', /todavía no tiene participantes/);
  assert.ok(result.issues.every((issue) => !issue.detail.includes('expected array')));
  const editorIssues = worldPreparationIssues(draft);
  assert.equal(editorIssues.length, 1);
  assert.match(editorIssues[0] ?? '', /Prepará un actor y colocalo/);
});

test('the candidate keeps its scene untouched; no participant is invented', () => {
  const draft = withoutParticipants();
  validateRunConfiguration({ draft });
  worldPreparationIssues(draft);
  if (draft.worldSnapshot.kind !== 'configured') assert.fail('Sin Escenario');
  assert.ok((draft.worldSnapshot.value.scenes ?? []).every((scene) => scene.participantIds === undefined));
});
