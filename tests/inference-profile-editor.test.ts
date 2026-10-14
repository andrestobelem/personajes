import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { CLAUDE_INFERENCE_PROFILE, SelectableInferenceProfileSchema } from '../src/domain/inference-profile.ts';
import { InferenceProfileEditor } from '../src/web/InferenceProfileEditor.tsx';
import { changeDraftField, describeDraftSection, reconcileDraft } from '../src/web/draft-form.ts';
import { RevisionSchema } from '../src/domain/values.ts';

test('model selection survives reconciliation and legacy drafts remain unspecified', () => {
  const draft = createEmptyRunConfigurationDraft({ runId: 'eeeeeeee-1111-4111-8111-111111111111', revision: 0 });
  const chosen = changeDraftField({ draft, field: 'inferenceProfile', value: CLAUDE_INFERENCE_PROFILE });
  const remote = RunConfigurationDraftSchema.parse({ ...draft, revision: RevisionSchema.parse(1) });
  const reconciled = reconcileDraft({ local: chosen, remote, keepLocal: ['inferenceProfile'] });
  assert.deepEqual(reconciled.inferenceProfile, chosen.inferenceProfile);
  assert.match(describeDraftSection(reconciled, 'inferenceProfile'), /claude-opus-5-5 · medium/);
  const { inferenceProfile: omitted, ...historical } = draft;
  assert.ok(omitted);
  const parsed = RunConfigurationDraftSchema.parse(historical);
  assert.equal(parsed.inferenceProfile, undefined);
  assert.ok(!JSON.stringify(parsed).includes('inferenceProfile'));
  assert.ok(!SelectableInferenceProfileSchema.safeParse({ ...CLAUDE_INFERENCE_PROFILE, provider: 'openai-codex' }).success);
  const html = renderToStaticMarkup(React.createElement(InferenceProfileEditor, { draft: chosen, onChange: () => {} }));
  assert.match(html, /selected=""[^>]*>Claude Opus 5.5 · medio/);
  assert.match(html, /login de OpenAI no habilita Claude/);
  const legacyHtml = renderToStaticMarkup(React.createElement(InferenceProfileEditor, { draft: parsed, onChange: () => {} }));
  assert.match(legacyHtml, /selected=""[^>]*>Elegir un perfil/);
});
