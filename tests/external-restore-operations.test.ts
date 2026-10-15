import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { exchangeIntegrity } from '../src/adapters/exchange-integrity.ts';
import { openExternalRestoreOperations } from '../src/server/external-restore-operations.ts';
import { operatorJson, OperatorResponseSchema, type OperatorRequest } from '../src/server/operator-extension.ts';

type WriteRequest = Extract<OperatorRequest, { kind: 'write' }>;
function request(): WriteRequest {
 return { kind: 'write', method: 'POST', path: ['api', 'v1', 'restore-preview'], query: new URLSearchParams(), principalId: 'operator-a', mode: { kind: 'observer' }, ifMatch: null, ifNoneMatch: null, idempotencyKey: randomUUID(), body: { backupId: randomUUID(), mode: 'recover', metadata: { a: 1, b: 2 } } };
}
async function fixture() {
 const directory = await mkdtemp(join(tmpdir(), 'personajes-restore-ops-')); const journalPath = join(directory, 'world.sqlite'); const db = new DatabaseSync(journalPath);
 db.exec("CREATE TABLE exchange_http_operations(principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT,operation_kind TEXT NOT NULL DEFAULT 'unclassified',PRIMARY KEY(principal_id,operation_id));CREATE TABLE effects(principal TEXT NOT NULL,operation TEXT NOT NULL,detail TEXT NOT NULL)");
 exchangeIntegrity(db).migrate('exchange_http_operations');
 return { journalPath, db, effect: (r: WriteRequest, detail = 'accepted') => db.prepare('INSERT INTO effects VALUES(?,?,?)').run(r.principalId, r.idempotencyKey, detail), count: () => db.prepare('SELECT COUNT(*) AS count FROM effects').get()?.count,
  cleanup: async () => { db.close(); await rm(directory, { recursive: true, force: true }); } };
}
function barrier() { let release: () => void = () => { throw new Error('barrier not initialized'); }; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('dos requests simultáneos ejecutan un solo efecto durable y reciben el OperatorResponse completo idéntico', async () => {
 const f = await fixture(); const operations = openExternalRestoreOperations(f); const r = request(); const admitted = barrier(); const blocked = barrier(); let calls = 0;
 const expected = operatorJson({ previewToken: randomUUID(), blockers: [], nested: { snapshot: 7 } }, 202, { ETag: '"r7"', Location: '/api/v1/restore/previews/accepted' });
 try {
  const first = operations.execute(r, async () => { calls++; admitted.release(); await blocked.promise; f.effect(r); return expected; }); await admitted.promise;
  const second = operations.execute({ ...r, body: structuredClone(r.body) }, async () => { calls++; throw new Error('duplicate side effect'); });
  assert.equal(calls, 1); assert.equal(f.count(), 0); assert.throws(() => operations.close(), /RESTORE_OPERATIONS_ACTIVE/);
  // A refused close must not close the live SQLite handle behind the pending dispatch.
  assert.equal(f.db.prepare('SELECT response_json FROM exchange_http_operations').get()?.response_json, null);
  blocked.release(); const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, expected); assert.deepEqual(b, expected); assert.equal(calls, 1); assert.equal(f.count(), 1);
  const stored = f.db.prepare('SELECT response_json FROM exchange_http_operations').get()?.response_json; assert.equal(stored, JSON.stringify(expected));
 } finally { blocked.release(); operations.close(); await f.cleanup(); }
});

test('reusar clave con otro body, ruta o método falla durante dispatch pendiente sin afectar el original', async () => {
 const f = await fixture(); const operations = openExternalRestoreOperations(f); const r = request(); const admitted = barrier(); const blocked = barrier(); let rejectedEffects = 0;
 try {
  const first = operations.execute(r, async () => { admitted.release(); await blocked.promise; f.effect(r); return operatorJson({ accepted: true }); }); await admitted.promise;
  for (const changed of [{ ...r, body: { mode: 'fork' } }, { ...r, path: ['api', 'v1', 'restore'] }, { ...r, method: 'PUT' } satisfies WriteRequest]) {
   await assert.rejects(operations.execute(changed, async () => { rejectedEffects++; return operatorJson({ accepted: false }); }), /EXCHANGE_IDEMPOTENCY_REUSE/);
  }
  assert.equal(rejectedEffects, 0); assert.equal(f.count(), 0); blocked.release(); await first; assert.equal(f.count(), 1);
  const otherPrincipal = { ...r, principalId: 'operator-b' }; await operations.execute(otherPrincipal, async () => { f.effect(otherPrincipal); return operatorJson({ separatePrincipal: true }); });
  assert.equal(f.count(), 2); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM exchange_http_operations').get()?.n, 2);
 } finally { blocked.release(); operations.close(); await f.cleanup(); }
});

test('replay durable después de reinicio conserva respuesta original aunque contexto y dispatcher cambiaron', async () => {
 const f = await fixture(); const r = request(); let operations = openExternalRestoreOperations(f); let effects = 0;
 try {
  const expected = operatorJson({ previewToken: randomUUID(), expiresAt: 123, differences: ['old context'] }, 201, { ETag: '"initial"', Location: '/api/v1/restore/preview-1' });
  const response = await operations.execute(r, async () => { f.effect(r); effects++; return expected; }); assert.deepEqual(response, expected); operations.close();
  f.db.exec("UPDATE effects SET detail='context changed after receipt'"); operations = openExternalRestoreOperations(f);
  const replay = await operations.execute(r, async () => { effects++; throw new Error('context no longer accepts preview'); });
  assert.deepEqual(replay, expected); assert.equal(effects, 1); assert.equal(f.count(), 1);
  await assert.rejects(operations.execute({ ...r, body: { changed: true } }, async () => { throw new Error('must not dispatch'); }), /EXCHANGE_IDEMPOTENCY_REUSE/);
 } finally { operations.close(); await f.cleanup(); }
});

test('un proceso muerto con intención NULL sellada admite sólo el mismo intento al reiniciar', { timeout: 10000 }, async () => {
 const f = await fixture(); const r = request(); let operations: ReturnType<typeof openExternalRestoreOperations> | undefined;
 const moduleUrl = new URL('../src/server/external-restore-operations.ts', import.meta.url).href;
 const script = `import {openExternalRestoreOperations} from ${JSON.stringify(moduleUrl)};const operations=openExternalRestoreOperations({journalPath:${JSON.stringify(f.journalPath)}});const request=${JSON.stringify(r)};request.query=new URLSearchParams();operations.execute(request,async()=>{process.stdout.write('ADMITTED\\n');return await new Promise(()=>{});});setInterval(()=>{},1000);`;
 const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
 try {
  const admitted = await Promise.race([once(child.stdout, 'data').then(([chunk]) => String(chunk)), once(child, 'exit').then(() => { throw new Error('child exited before dispatch'); })]); assert.match(admitted, /ADMITTED/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  assert.equal(f.db.prepare('SELECT response_json FROM exchange_http_operations').get()?.response_json, null); exchangeIntegrity(f.db).verify('exchange_http_operations', 'principal_id=? AND operation_id=?', [r.principalId, r.idempotencyKey]);
  operations = openExternalRestoreOperations(f); let calls = 0;
  await assert.rejects(operations.execute({ ...r, path: ['api', 'v1', 'restore'] }, async () => { calls++; return operatorJson({ wrong: true }); }), /EXCHANGE_IDEMPOTENCY_REUSE/); assert.equal(calls, 0);
  const expected = operatorJson({ recovered: true }, 202); assert.deepEqual(await operations.execute(r, async () => { calls++; f.effect(r, 'recovered same admitted intent'); return expected; }), expected);
  assert.equal(calls, 1); assert.equal(f.count(), 1); assert.deepEqual(await operations.execute(r, async () => { throw new Error('receipt must replay'); }), expected);
 } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } operations?.close(); await f.cleanup(); }
});

test('sello corrupto del recibo o intención pendiente falla antes de dispatch y conserva evidencia', async () => {
 const f = await fixture(); const r = request(); const operations = openExternalRestoreOperations(f);
 try {
  await operations.execute(r, async () => { f.effect(r); return operatorJson({ accepted: true }); });
  f.db.prepare('UPDATE exchange_http_operations SET response_json=?').run(JSON.stringify(operatorJson({ forged: true })));
  let dispatches = 0; const dispatch = async () => { dispatches++; f.effect(r, 'forbidden'); return operatorJson({ wrong: true }); };
  await assert.rejects(operations.execute(r, dispatch), /EXCHANGE_METADATA_TAMPERED/); assert.equal(dispatches, 0); assert.equal(f.count(), 1);
  f.db.exec('UPDATE exchange_http_operations SET response_json=NULL');
  await assert.rejects(operations.execute(r, dispatch), /EXCHANGE_METADATA_TAMPERED/); assert.equal(dispatches, 0); assert.equal(f.count(), 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM exchange_http_operations').get()?.n, 1);
 } finally { operations.close(); await f.cleanup(); }
});

test('throw posterior al efecto conserva intención sellada y sólo el mismo dispatch idempotente recupera receipt', async () => {
 const f = await fixture(); const r = request(); let operations = openExternalRestoreOperations(f); const expected = operatorJson({ operationId: randomUUID(), state: 'queued' }, 202, { Location: '/api/v1/restore/operations/recovered' }); let calls = 0;
 try {
  await assert.rejects(operations.execute(r, async () => { calls++; f.effect(r, JSON.stringify(expected)); throw new Error('AFTER_DURABLE_EFFECT'); }), /AFTER_DURABLE_EFFECT/);
  const pending = f.db.prepare('SELECT * FROM exchange_http_operations').get(); assert.ok(pending); assert.equal(pending.response_json, null); exchangeIntegrity(f.db).verify('exchange_http_operations', 'principal_id=? AND operation_id=?', [r.principalId, r.idempotencyKey]);
  operations.close(); operations = openExternalRestoreOperations(f);
  await assert.rejects(operations.execute({ ...r, body: { backupId: randomUUID(), mode: 'fork' } }, async () => { f.effect(r, 'WRONG_SECOND_INTENT'); return expected; }), /EXCHANGE_IDEMPOTENCY_REUSE/);
  const resumed = await operations.execute(r, async () => {
   calls++; const saved = f.db.prepare('SELECT detail FROM effects WHERE principal=? AND operation=?').get(r.principalId, r.idempotencyKey); assert.equal(typeof saved?.detail, 'string');
   // The real port's durable effect is already admitted. Resuming reads its receipt,
   // rather than repeating the operation that committed before the exception.
   return OperatorResponseSchema.parse(JSON.parse(String(saved?.detail)));
  });
  assert.deepEqual(resumed, expected); assert.equal(calls, 2); assert.equal(f.count(), 1);
  assert.deepEqual(await operations.execute(r, async () => { throw new Error('must replay completed receipt'); }), expected);
 } finally { operations.close(); await f.cleanup(); }
});

for (const fault of ['response-update', 'response-seal']) {
 test(`fallo SQLite ${fault} revierte receipt completo y permite recuperar sólo la intención NULL sellada`, async () => {
  const f = await fixture(); const r = request(); const operations = openExternalRestoreOperations(f); const expected = operatorJson({ recovered: true, operationId: randomUUID() }, 202); let originalPending: ReturnType<ReturnType<DatabaseSync['prepare']>['get']>; let calls = 0;
  const event = fault === 'response-update' ? 'response_json' : 'integrity_hash';
  f.db.exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE OF ${event} ON exchange_http_operations WHEN NEW.response_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'CONTROLLED_RECEIPT_FAILURE');END`);
  try {
   await assert.rejects(operations.execute(r, async () => { calls++; originalPending = f.db.prepare('SELECT * FROM exchange_http_operations').get(); f.effect(r, JSON.stringify(expected)); return expected; }), /CONTROLLED_RECEIPT_FAILURE/);
   assert.ok(originalPending); assert.deepEqual(f.db.prepare('SELECT * FROM exchange_http_operations').get(), originalPending); assert.equal(originalPending.response_json, null);
   exchangeIntegrity(f.db).verify('exchange_http_operations', 'principal_id=? AND operation_id=?', [r.principalId, r.idempotencyKey]);
   await assert.rejects(operations.execute({ ...r, body: { changed: true } }, async () => { f.effect(r, 'wrong new intent'); return expected; }), /EXCHANGE_IDEMPOTENCY_REUSE/);
   f.db.exec('DROP TRIGGER fail_receipt');
   const resumed = await operations.execute(r, async () => { calls++; const saved = f.db.prepare('SELECT detail FROM effects WHERE principal=? AND operation=?').get(r.principalId, r.idempotencyKey); assert.ok(saved); return OperatorResponseSchema.parse(JSON.parse(String(saved.detail))); });
   assert.deepEqual(resumed, expected); assert.equal(calls, 2); assert.equal(f.count(), 1);
   exchangeIntegrity(f.db).verify('exchange_http_operations', 'principal_id=? AND operation_id=?', [r.principalId, r.idempotencyKey]);
   assert.deepEqual(await operations.execute(r, async () => { throw new Error('receipt must be immutable'); }), expected);
  } finally { operations.close(); await f.cleanup(); }
 });
}

test('fallo al sellar admisión inicial revierte INSERT sin dejar intención sin sello ni ejecutar efecto', async () => {
 const f = await fixture(); const r = request(); const operations = openExternalRestoreOperations(f); let calls = 0;
 f.db.exec("CREATE TRIGGER fail_admission BEFORE UPDATE OF integrity_hash ON exchange_http_operations WHEN NEW.response_json IS NULL BEGIN SELECT RAISE(ABORT,'CONTROLLED_ADMISSION_SEAL_FAILURE');END");
 try {
  await assert.rejects(operations.execute(r, async () => { calls++; f.effect(r); return operatorJson({ admitted: true }); }), /CONTROLLED_ADMISSION_SEAL_FAILURE/);
  assert.equal(calls, 0); assert.equal(f.count(), 0); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM exchange_http_operations').get()?.n, 0);
  f.db.exec('DROP TRIGGER fail_admission'); await operations.execute(r, async () => { calls++; f.effect(r); return operatorJson({ admitted: true }); }); assert.equal(calls, 1); assert.equal(f.count(), 1);
 } finally { operations.close(); await f.cleanup(); }
});
