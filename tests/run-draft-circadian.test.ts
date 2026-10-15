import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { applyCircadianPolicyForm, circadianPolicyForm } from '../src/web/circadian-policy-form.ts';
import { RunDraftEditor } from '../src/web/RunDraftEditor.tsx';

const empty = () => createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 });

test('una preparación vacía puede elegir automático y cambiar a manual o pendiente sin mutar el original', () => {
  const draft = empty();
  const automatic = applyCircadianPolicyForm({ draft, mode: 'advance-while-running', maxAdvanceMs: '86400000' });
  assert.deepEqual(circadianPolicyForm(automatic), { mode: 'advance-while-running', maxAdvanceMs: '86400000' });
  assert.equal(draft.circadianPolicy.kind, 'empty');
  const manual = applyCircadianPolicyForm({ draft: automatic, mode: 'manual-only', maxAdvanceMs: 'bad' });
  assert.deepEqual(circadianPolicyForm(manual), { mode: 'manual-only', maxAdvanceMs: '' });
  const pending = applyCircadianPolicyForm({ draft: manual, mode: '', maxAdvanceMs: 'bad' });
  assert.equal(pending.circadianPolicy.kind, 'empty');
});

test('el límite automático distingue cero explícito de vacío e impide fracciones, negativos y enteros inseguros', () => {
  for (const maxAdvanceMs of ['', ' ', '-1', '0.5', '1e3', 'Infinity', '9007199254740992']) {
    assert.throws(() => applyCircadianPolicyForm({ draft: empty(), mode: 'advance-while-running', maxAdvanceMs }));
  }
  for (const maxAdvanceMs of ['0', '9007199254740991']) {
    const draft = applyCircadianPolicyForm({ draft: empty(), mode: 'advance-while-running', maxAdvanceMs });
    assert.equal(circadianPolicyForm(draft).maxAdvanceMs, maxAdvanceMs);
  }
  assert.throws(() => applyCircadianPolicyForm({ draft: empty(), mode: 'unknown', maxAdvanceMs: '1000' }));
});

test('el editor ofrece automático desde cero, conserva el límite exacto y respeta el bloqueo de una puesta activa', () => {
  const props = { draft: empty(), catalog: [], saving: false, onSave() {}, onValidate() {}, onDirty() {} };
  const before = JSON.stringify(props.draft);
  const initial = renderToStaticMarkup(React.createElement(RunDraftEditor, props));
  assert.match(initial, /option value="advance-while-running">Avance automático hacia rutinas/);
  assert.doesNotMatch(initial, /Máximo avance por salto · milisegundos<input/);
  assert.equal(JSON.stringify(props.draft), before);
  const automatic = applyCircadianPolicyForm({ draft: props.draft, mode: 'advance-while-running', maxAdvanceMs: '9007199254740991' });
  const html = renderToStaticMarkup(React.createElement(RunDraftEditor, { ...props, draft: automatic, readOnly: true, lifecycle: 'running' }));
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /Máximo avance por salto · milisegundos<input[^>]*value="9007199254740991"/);
  assert.match(html, /repetición diaria y el ciclo de día y noche todavía no están implementados/);
});
