import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRunControlTransition, RunControlCommandSchema, RunLifecycleViewSchema, WorldLifecycleSchema } from '../src/domain/run-lifecycle.ts';

test('el lifecycle valida cada comando y devuelve la transición o pulso acotado esperado', () => {
  const accepted = [
    ['ready', { kind: 'start' }, { kind: 'transition', from: 'ready', to: 'running' }],
    ['running', { kind: 'pause' }, { kind: 'transition', from: 'running', to: 'paused' }],
    ['paused', { kind: 'resume' }, { kind: 'transition', from: 'paused', to: 'running' }],
    ['stopped', { kind: 'resume' }, { kind: 'transition', from: 'stopped', to: 'running' }],
    ['paused', { kind: 'step' }, { kind: 'singlePulse', lifecycle: 'paused' }],
    ['running', { kind: 'stop' }, { kind: 'transition', from: 'running', to: 'stopped' }],
    ['paused', { kind: 'stop' }, { kind: 'transition', from: 'paused', to: 'stopped' }],
    ['running', { kind: 'close' }, { kind: 'transition', from: 'running', to: 'closed' }],
    ['paused', { kind: 'close' }, { kind: 'transition', from: 'paused', to: 'closed' }],
    ['stopped', { kind: 'close' }, { kind: 'transition', from: 'stopped', to: 'closed' }],
  ] as const;
  for (const [lifecycle, command, expected] of accepted) {
    assert.deepEqual(resolveRunControlTransition(WorldLifecycleSchema.parse(lifecycle), RunControlCommandSchema.parse(command)), expected);
  }
});

test('start, pause, step, stop y close no admiten transiciones repetidas o fuera de orden', () => {
  for (const [lifecycle, command] of [
    ['draft', { kind: 'start' }], ['running', { kind: 'start' }], ['ready', { kind: 'pause' }],
    ['running', { kind: 'step' }], ['ready', { kind: 'step' }], ['ready', { kind: 'stop' }],
    ['closed', { kind: 'resume' }], ['closed', { kind: 'close' }], ['draft', { kind: 'close' }],
  ] as const) {
    const parsedLifecycle = WorldLifecycleSchema.parse(lifecycle);
    const parsedCommand = RunControlCommandSchema.parse(command);
    assert.deepEqual(resolveRunControlTransition(parsedLifecycle, parsedCommand), {
      kind: 'invalid', code: 'INVALID_LIFECYCLE', lifecycle: parsedLifecycle, command: parsedCommand.kind,
    });
  }
});

test('la vista distingue estados sin cierre y exige timestamp sólo al cerrar', () => {
  assert.deepEqual(RunLifecycleViewSchema.parse({ kind: 'paused', revision: 3 }), { kind: 'paused', revision: 3 });
  assert.equal(RunLifecycleViewSchema.safeParse({ kind: 'closed', revision: 4 }).success, false);
  assert.equal(RunLifecycleViewSchema.safeParse({ kind: 'running', revision: 4, closedAt: '2026-10-14T00:00:00Z' }).success, false);
});
