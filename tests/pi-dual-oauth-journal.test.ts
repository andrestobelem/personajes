import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openJournal } from '../src/adapters/journal.ts';

test('OAuth v40 preserva bytes y replay Codex v39, y serializa ambos proveedores',()=>{
 const directory=mkdtempSync(join(tmpdir(),'dual-oauth-'));const path=join(directory,'journal.sqlite');let journal=openJournal({path});
 try{
  const request={principalId:'operator',idempotencyKey:randomUUID(),kind:'login'};
  const old=journal.createPiOAuthJob(request);if(old.kind!=='created')assert.fail('Sin job');journal.close();
  const legacy=new DatabaseSync(path);let original:unknown;let originalHistory:unknown;let originalOperations:unknown;
  try{
   original=legacy.prepare('SELECT * FROM pi_oauth_jobs').get();originalHistory=legacy.prepare('SELECT * FROM pi_oauth_job_history').all();originalOperations=legacy.prepare('SELECT * FROM pi_oauth_job_operations').all();
   legacy.exec(`PRAGMA foreign_keys=OFF;BEGIN;CREATE TABLE old_jobs AS SELECT * FROM pi_oauth_jobs;DROP TABLE pi_oauth_jobs;
    CREATE TABLE pi_oauth_jobs(job_id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider='openai-codex'),kind TEXT NOT NULL,principal_id TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,safe_code TEXT,owner_token TEXT,claim_token TEXT,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL);
    INSERT INTO pi_oauth_jobs SELECT * FROM old_jobs;DROP TABLE old_jobs;CREATE UNIQUE INDEX pi_oauth_one_running ON pi_oauth_jobs(provider) WHERE state IN('running','cancel-requested');DELETE FROM schema_version WHERE version=40;COMMIT;`);
  }finally{legacy.close();}
  journal=openJournal({path});
  const inspect=new DatabaseSync(path);try{assert.deepEqual(inspect.prepare('SELECT * FROM pi_oauth_jobs').get(),original);assert.deepEqual(inspect.prepare('SELECT * FROM pi_oauth_job_history').all(),originalHistory);assert.deepEqual(inspect.prepare('SELECT * FROM pi_oauth_job_operations').all(),originalOperations);assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(),[]);}finally{inspect.close();}
  assert.deepEqual(journal.readPiOAuthJob({jobId:old.job.jobId}),old.job);
  assert.deepEqual(journal.listPiOAuthJobs({principalId:request.principalId}),[old.job]);
  assert.deepEqual(journal.readPiOAuthJobHistory({jobId:old.job.jobId}),[old.job]);
  const replay=journal.createPiOAuthJob({...request,provider:'openai-codex'});assert.equal(replay.kind,'existing');if(replay.kind==='existing')assert.deepEqual(replay.job,old.job);
  assert.equal(journal.createPiOAuthJob({...request,provider:'anthropic'}).kind,'idempotencyConflict');
  const anthropic=journal.createPiOAuthJob({...request,idempotencyKey:randomUUID(),provider:'anthropic'});if(anthropic.kind!=='created')assert.fail('Sin Anthropic');
  assert.equal(anthropic.job.provider,'anthropic');
  const lease={ownerToken:randomUUID(),claimToken:randomUUID()};
  assert.equal(journal.claimPiOAuthJob({jobId:old.job.jobId,expectedRevision:0,...lease}).kind,'claimed');
  assert.equal(journal.claimPiOAuthJob({jobId:anthropic.job.jobId,expectedRevision:0,ownerToken:randomUUID(),claimToken:randomUUID()}).kind,'busy');
  assert.equal(journal.completePiOAuthJob({jobId:old.job.jobId,expectedRevision:1,lease,outcome:'succeeded'}).kind,'updated');
  assert.equal(journal.claimPiOAuthJob({jobId:anthropic.job.jobId,expectedRevision:0,...lease}).kind,'claimed');
  journal.close();journal=openJournal({path});assert.equal(journal.readPiOAuthJob({jobId:anthropic.job.jobId})?.provider,'anthropic');
  assert.deepEqual(journal.readPiOAuthJobHistory({jobId:anthropic.job.jobId}).map(job=>job.provider),['anthropic','anthropic']);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
