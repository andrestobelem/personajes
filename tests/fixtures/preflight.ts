import { randomUUID } from 'node:crypto';
import type { openJournal } from '../../src/adapters/journal.ts';
import { ReadyRunConfigurationSchema } from '../../src/application/production-preflight.ts';
import { draftFixture } from './continuista.ts';

/** Synthetic preparation only: no actor jobs, sessions, experiences or fictional events. */
export function createCleanReadyPreflightFixture(input: {
  journal: ReturnType<typeof openJournal>;
  principalId?: string;
}) {
  const principalId = input.principalId ?? 'local-operator';
  const { kind: _kind, schemaVersion: _schemaVersion, runId: _runId, revision: _revision, ...patch } = draftFixture();
  const created = input.journal.createRunConfigurationDraft({ principalId, idempotencyKey: randomUUID(), patch });
  if (created.kind !== 'created') throw new Error('Synthetic preflight draft could not be created.');
  const promoted = input.journal.validateRunConfigurationDraft({
    principalId, idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: created.draft.revision,
  });
  if (promoted.kind !== 'ready') throw new Error('Synthetic preflight fixture could not be promoted to Ready.');
  const configuration = ReadyRunConfigurationSchema.parse(input.journal.readWorldConfiguration({ runId: created.draft.runId }));
  return { runId: configuration.runId, configuration, draft: created.draft };
}
