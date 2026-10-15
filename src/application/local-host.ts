import { join } from 'node:path';
import { acquireHostOwnership, type HostDirectoryOperation } from '../adapters/host-ownership.ts';
import { openJournal } from '../adapters/journal.ts';

/** The host acquires exclusive ownership before opening any durable writer. */
export function openLocalHost(input: { privateDataRoot: string; directoryOperation?: HostDirectoryOperation | undefined }) {
  const ownership = acquireHostOwnership({ privateDataRoot: input.privateDataRoot, directoryOperation: input.directoryOperation });
  let journal: ReturnType<typeof openJournal> | undefined;
  try {
    journal = openJournal({ path: join(ownership.privateDataRoot, 'world.sqlite') });
    // The ownership lock excludes any prior host. Recover abandoned ICM
    // projection claims before exposing the journal to workers.
    journal.recoverAbandonedMemoryProjectionClaims();
    // Delivery claims are likewise safe to retry only after the old host has exited.
    journal.recoverAbandonedWorldDeliveryClaims();
    // Model-time spans from a prior process remain uncertain; its monotonic
    // clock cannot be used to invent a duration or refund dispatched work.
    journal.recoverAbandonedModelTimeRequests({ ownerToken: ownership.ownerToken });
    // Actor-turn claims are reset only after acquiring exclusive host ownership.
    journal.recoverAbandonedActorTurnJobClaims({ ownerToken: ownership.ownerToken });
    // Administrative claims share ownership, but keep their own sessions and reservations.
    journal.recoverAbandonedContinuistaClaims({ ownerToken: ownership.ownerToken });
    journal.recoverAbandonedAdministrativeJobs({ ownerToken: ownership.ownerToken });
  } catch (error) {
    try { journal?.close(); } finally { ownership.release(input.directoryOperation ? { directoryOperation: input.directoryOperation } : undefined); }
    throw error;
  }
  const openedJournal = journal;
  let closed = false;
  let journalClosed = false;
  return Object.freeze({
    privateDataRoot: ownership.privateDataRoot,
    ownerToken: ownership.ownerToken,
    journal: openedJournal,
    close(options?: { directoryOperation: HostDirectoryOperation }): void {
      if (closed) return;
      // Callers must await cancellation/settlement of workers before closing the host.
      if (!journalClosed) { journal.close(); journalClosed = true; }
      ownership.release(options);
      closed = true;
    },
  });
}
