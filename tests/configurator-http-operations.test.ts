import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { openConfiguratorHttpOperations } from '../src/adapters/configurator-http-operations.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'configurator-http-ops-'));
  const journalPath = join(directory, 'world.sqlite'); const journal = openJournal({ path: journalPath });
  const ops = openConfiguratorHttpOperations({ journalPath }); const db = new DatabaseSync(journalPath);
  const request = { principalId: 'operator', idempotencyKey: randomUUID(), kind: 'approve', request: { jobId: randomUUID(), proposalHash: 'a'.repeat(64) } };
  return { ops, db, request, journalPath, close: async () => { ops.close(); db.close(); journal.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('simultaneous Configurator HTTP mutations share one effect and replay exact results before consulting changed resources', async () => {
  const f = await fixture(); let release: () => void = () => {}; const barrier = new Promise<void>(resolve => { release = resolve; }); let count = 0;
  try {
    const one = f.ops.execute(f.request, async () => { count++; await barrier; return { jobId: f.request.request.jobId, state: 'accepted', revision: 3 }; });
    const two = f.ops.execute(f.request, async () => { throw new Error('duplicate'); });
    await assert.rejects(f.ops.execute({ ...f.request, request: { ...f.request.request, proposalHash: 'b'.repeat(64) } }, async () => null), /IDEMPOTENCY_REUSE/);
    assert.throws(() => f.ops.close(), /OPERATIONS_ACTIVE/); release();
    const [a, b] = await Promise.all([one, two]); assert.deepEqual(a, b); assert.equal(count, 1);
    assert.deepEqual(await f.ops.execute(f.request, async () => { throw new Error('resource deleted'); }), a);
  } finally { release(); await f.close(); }
});
test('a post-effect exception preserves the intent across reopen, rejects another payload and admits only the same recovery', async () => {
  const f = await fixture(); let recovered: ReturnType<typeof openConfiguratorHttpOperations> | undefined;
  try {
    f.db.exec('CREATE TABLE test_effects(id TEXT PRIMARY KEY)');
    await assert.rejects(f.ops.execute(f.request, async () => { f.db.prepare('INSERT INTO test_effects VALUES(?)').run(f.request.idempotencyKey); throw new Error('after effect'); }), /after effect/);
    recovered = openConfiguratorHttpOperations({ journalPath: f.journalPath });
    await assert.rejects(recovered.execute({ ...f.request, kind: 'reject' }, async () => null), /IDEMPOTENCY_REUSE/);
    const result = await recovered.execute(f.request, async () => ({ recovered: f.db.prepare('SELECT COUNT(*) n FROM test_effects').get()?.n }));
    assert.deepEqual(result, { recovered: 1 });
    f.db.exec("UPDATE configurator_http_operations SET result_json='{}'");
    await assert.rejects(recovered.execute(f.request, async () => { throw new Error('must not run'); }), /RECEIPT_CORRUPT/);
  } finally { recovered?.close(); await f.close(); }
});
test('a SQL failure while storing the receipt leaves a sealed NULL intent and the effect cannot be rebound', async () => {
  const f = await fixture(); let effects = 0;
  try {
    f.db.exec("CREATE TRIGGER test_receipt_failure BEFORE UPDATE ON configurator_http_operations BEGIN SELECT RAISE(ABORT,'RECEIPT_FAILURE');END");
    await assert.rejects(f.ops.execute(f.request, async () => { effects++; return { accepted: true }; }), /RECEIPT_FAILURE/);
    assert.equal(f.db.prepare('SELECT result_json FROM configurator_http_operations').get()?.result_json, null);
    await assert.rejects(f.ops.execute({ ...f.request, request: {} }, async () => null), /IDEMPOTENCY_REUSE/);
    f.db.exec('DROP TRIGGER test_receipt_failure');
    assert.deepEqual(await f.ops.execute(f.request, async () => ({ recoveredExistingEffect: effects })), { recoveredExistingEffect: 1 });
    assert.equal(effects, 1);
  } finally { await f.close(); }
});
