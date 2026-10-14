import type { openJournal } from '../adapters/journal.ts';
import { WorldAttemptCommitSchema } from '../domain/world-journal.ts';

type WorldCommitPort = Pick<ReturnType<typeof openJournal>, 'commitWorldAttempt'>;

/** Commits a previously registered host proposal; no model or ICM work runs in this operation. */
export function commitWorldAttempt(input: { journal: WorldCommitPort; request: unknown }) {
  const request = WorldAttemptCommitSchema.parse(input.request);
  return input.journal.commitWorldAttempt(request);
}
