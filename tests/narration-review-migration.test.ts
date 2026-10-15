import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { openJournal } from '../src/adapters/journal.ts';
import { createNarratorPiWorker } from '../src/application/narrator-pi-worker.ts';
import { controlledNarratorSessionFactory } from './fixtures/narrator-session.ts';
import { fixture, fixtureReviewer } from './fixtures/narrator-run.ts';
import { canonicalDirectorValue } from '../src/application/director-context.ts';

test('v27 publication migrates without reinference; frozen legacy hash rejects altered receipt with recalculated hash', async () => {
  const f=await fixture();
  let reopened:ReturnType<typeof openJournal>|undefined;
  try {
    const worker=createNarratorPiWorker({journal:f.journal,runtime:f.runtime,ownerToken:randomUUID(),reviewer:fixtureReviewer(f),
      sessionFactory:controlledNarratorSessionFactory({root:f.directory,physicalSessions:true})});
    const result=await worker.run({runId:f.runId,pulseId:f.pulseId});
    assert.equal(result.kind,'published');
    if(result.kind!=='published'||result.receipt.kind!=='published')throw new Error('fixture lacks publication');
    const lookup={jobId:result.receipt.publication.scope.jobId,generation:result.receipt.publication.scope.generation};
    f.journal.close();
    const db=new DatabaseSync(join(f.directory,'journal.sqlite'));
    try {db.exec(`PRAGMA foreign_keys=OFF;
      DROP TABLE legacy_narration_publications;DROP TABLE narration_review_receipts;DROP TABLE narration_review_candidates;
      DELETE FROM administrative_checkpoint_integrity WHERE checkpoint_hash IN(
        SELECT checkpoint_hash FROM administrative_checkpoints WHERE job_id IN(SELECT job_id FROM administrative_jobs WHERE role='narration-reviewer'));
      DELETE FROM administrative_checkpoints WHERE job_id IN(SELECT job_id FROM administrative_jobs WHERE role='narration-reviewer');
      DELETE FROM administrative_sessions WHERE job_id IN(SELECT job_id FROM administrative_jobs WHERE role='narration-reviewer');
      DELETE FROM administrative_jobs WHERE role='narration-reviewer';
      DROP TABLE IF EXISTS actor_activation_invitation_jobs;DROP TABLE IF EXISTS actor_activation_invitations;DROP TABLE IF EXISTS actor_activation_causes; DROP TABLE IF EXISTS routine_clock_advances;
      DROP TABLE circumstance_operations;
      DROP TABLE IF EXISTS actor_state_cuts; DROP TABLE IF EXISTS actor_state_cut_batches; DROP TABLE IF EXISTS fork_projection_receipts; DROP TABLE IF EXISTS fork_job_history; DROP TABLE IF EXISTS fork_dramatic_seeds; DROP TABLE IF EXISTS fork_job_retries; DROP TABLE IF EXISTS fork_backup_sources; DROP TABLE IF EXISTS fork_jobs; DELETE FROM schema_version WHERE version IN(28,29,30,31,32,33,34,35,36,37);`);}
    finally {db.close();}
    reopened=openJournal({path:join(f.directory,'journal.sqlite')});
    assert.deepEqual(reopened.readNarrationReceipt(lookup),result.receipt);
    reopened.close();reopened=undefined;
    const alteredDb=new DatabaseSync(join(f.directory,'journal.sqlite'));
    try {
      const payload=canonicalDirectorValue({...result.receipt,publication:{...result.receipt.publication,publishedAt:result.receipt.publication.publishedAt+1}});
      alteredDb.prepare('UPDATE narration_receipts SET payload_json=?,payload_hash=?,accepted_at=accepted_at+1 WHERE job_id=? AND generation=?')
        .run(payload,createHash('sha256').update(payload).digest('hex'),lookup.jobId,lookup.generation);
    }finally {alteredDb.close();}
    reopened=openJournal({path:join(f.directory,'journal.sqlite')});
    assert.throws(()=>reopened?.readNarrationReceipt(lookup),/legacy alterada/);
  }finally {reopened?.close();rmSync(f.directory,{recursive:true,force:true});}
});

test('publication pages honor exact revision/seq fences, tuple cursors, bounds and verified receipt integrity', async () => {
  const f=await fixture();
  try {
    const worker=createNarratorPiWorker({journal:f.journal,runtime:f.runtime,ownerToken:randomUUID(),reviewer:fixtureReviewer(f),
      sessionFactory:controlledNarratorSessionFactory({root:f.directory,physicalSessions:true})});
    const result=await worker.run({runId:f.runId,pulseId:f.pulseId});
    if(result.kind!=='published'||result.receipt.kind!=='published')throw new Error('fixture lacks reviewed publication');
    const publication=result.receipt.publication;const scope=publication.scope;
    const request={runId:f.runId,throughWorldSeq:scope.throughWorldSeq,throughWorldRevision:scope.worldRevision,limit:1};
    const page=f.journal.readNarrationPublicationPage(request);
    assert.equal(page?.items.length,1);assert.equal(page?.hasMore,false);
    assert.deepEqual(page?.items[0]?.publication,publication);
    assert.deepEqual(f.journal.readNarrationPublication({runId:f.runId,publicationId:publication.publicationId}),publication);
    assert.equal(f.journal.readNarrationPublication({runId:randomUUID(),publicationId:publication.publicationId}),undefined);
    assert.equal(f.journal.readNarrationPublication({runId:f.runId,publicationId:randomUUID()}),undefined);
    assert.equal(f.journal.readNarrationPublicationPage({...request,afterPublishedAt:publication.publishedAt,afterPublicationId:publication.publicationId})?.items.length,0);
    assert.throws(()=>f.journal.readNarrationPublicationPage({...request,limit:101}));
    assert.throws(()=>f.journal.readNarrationPublicationPage({...request,afterPublishedAt:publication.publishedAt}));
    assert.throws(()=>f.journal.readNarrationPublicationPage({...request,throughWorldRevision:scope.worldRevision+1}),/no confirmado/);
    const inspect=new DatabaseSync(join(f.directory,'journal.sqlite'));
    const initial=(()=>{try {const row=inspect.prepare('SELECT initial_snapshot_json FROM world_runs WHERE run_id=?').get(f.runId);return WorldSnapshotSchema.parse(JSON.parse(String(row?.initial_snapshot_json)));}finally{inspect.close();}})();
    assert.equal(f.journal.readNarrationPublicationPage({...request,throughWorldSeq:initial.seq,throughWorldRevision:initial.revision})?.items.length,0);
    assert.equal(f.journal.readNarrationPublicationPage({...request,runId:randomUUID()}),undefined);
    const db=new DatabaseSync(join(f.directory,'journal.sqlite'));
    try {db.prepare('UPDATE narration_receipts SET payload_hash=? WHERE job_id=?').run('0'.repeat(64),scope.jobId);}finally{db.close();}
    assert.throws(()=>f.journal.readNarrationPublicationPage(request),/alterado/);
    assert.throws(()=>f.journal.readNarrationPublication({runId:f.runId,publicationId:publication.publicationId}),/alterado/);
  }finally{f.close();}
});

test('review acceptance rejects rewritten SDK input bytes even when valid IDs and ancestry survive', async () => {
  const f=await fixture();
  try {
    const reviewer=fixtureReviewer(f,()=>{
      const sessions=join(f.directory,'runs',f.runId,'roles','continuista','sessions');
      const filename=readdirSync(sessions).find(name=>name.endsWith('.jsonl'));assert.ok(filename);
      const path=join(sessions,filename);
      // Preserve schema, IDs and parent links while altering a confirmed request prefix.
      const bytes=readFileSync(path,'utf8');assert.ok(bytes.includes('narration-review-context'));
      writeFileSync(path,bytes.replace('narration-review-context','narration-review-context-tampered'));
    });
    const worker=createNarratorPiWorker({journal:f.journal,runtime:f.runtime,ownerToken:randomUUID(),reviewer,
      sessionFactory:controlledNarratorSessionFactory({root:f.directory,physicalSessions:true})});
    const before=f.journal.loadWorld({runId:f.runId});assert.ok(before);
    const result=await worker.run({runId:f.runId,pulseId:f.pulseId});
    assert.equal(result.kind,'blocked');
    assert.deepEqual(f.journal.readNarrationPublications({runId:f.runId,throughWorldSeq:before.seq}),[]);
    assert.deepEqual(f.journal.loadWorld({runId:f.runId}),before);
    assert.equal(f.journal.readRunModelTimeBudget({runId:f.runId})?.runCallsUsed,6);
  }finally{f.close();}
});
