import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createIcmWorkspaceSnapshot, hashIcmMarkdown } from '../../src/domain/icm-workspace.ts';
import { actorId, setup } from './continuista.ts';

export async function icmInspectionFixture(withIcm = true) {
  const audiences = [{ role: 'actor' as const, actorId }, ...(['continuista', 'director', 'configurator'] as const).map(role => ({ role }))];
  const workspace = createIcmWorkspaceSnapshot({ sources: audiences.map(audience => ({ sourceId: `synthetic.${audience.role}`, audience, revision: 0,
    sourceHash: hashIcmMarkdown(audience.role), sections: [{ sectionId: 'process', markdown: `PRIVATE_MARKDOWN_${audience.role}` }] })) });
  const f = await setup(undefined, undefined, undefined, withIcm ? { icmWorkspace: workspace } : {});
  const path = join(f.directory, 'journal.sqlite');
  const runId = f.configuration.runId;
  function mutate(work: (db: DatabaseSync) => void) { const db = new DatabaseSync(path); try { work(db); } finally { db.close(); } }
  function read(filters = {}, offset = 0, limit = 25) { return f.journal.readIcmContextPacketInspection({ runId, filters, offset, limit }); }
  async function packets() {
    const claim = f.journal.claimActorTurnJob(f.claim); assert.equal(claim.kind, 'claimed'); if (claim.kind !== 'claimed') assert.fail('No actor claim');
    const execution = { runId, actorId, jobId: claim.job.jobId, generation: claim.job.generation, pulseId: claim.job.pulseId,
      lease: { ownerToken: claim.ownerToken, claimToken: claim.claimToken } };
    const actor = f.journal.ensureIcmContextPacket({ binding: { kind: 'actor', execution }, hostPolicyMarkdown: 'PRIVATE_HOST_POLICY', diegeticContextMarkdown: 'PRIVATE_DIEGETIC_CONTEXT' });
    f.journal.failActorTurnJob({ execution, code: 'execution-failed' });
    const director = f.journal.beginDirectorJob({ runId, pulseId: claim.job.pulseId, ownerToken: randomUUID(), claimToken: randomUUID() });
    assert.ok('execution' in director, JSON.stringify(director));
    const administrative = f.journal.ensureIcmContextPacket({ binding: { kind: 'administrative', execution: director.execution }, hostPolicyMarkdown: 'PRIVATE_DIRECTOR_POLICY', diegeticContextMarkdown: 'PRIVATE_DIRECTOR_CONTEXT' });
    return { actor, administrative };
  }
  return { ...f, runId, path, actorId, read, mutate, packets };
}
