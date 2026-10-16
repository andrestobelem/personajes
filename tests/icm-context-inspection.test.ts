import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { inspectIcmContextPackets } from '../src/application/icm-context-inspection.ts';
import { IcmContextInspectionPageSchema } from '../src/domain/icm-context-inspection.ts';
import { icmInspectionFixture } from './fixtures/icm-inspection.ts';

test('journal inspecciona paquetes actor y Director reales sin lease activo ni textos privados; pagina, filtra y sobrevive reinicio', async () => {
  const f = await icmInspectionFixture(); let closed = false;
  try {
    const { actor, administrative } = await f.packets();
    const page = f.read(); assert.ok(page); assert.equal(page.configuration.kind, 'configured'); assert.equal(page.total, 2);
    assert.deepEqual(page.items.map(item => item.kind), ['verified', 'verified']);
    const selected = f.read({ role: 'actor', actorId: f.actorId, jobId: actor.scope.jobId }); assert.ok(selected);
    assert.equal(selected.total, 1); const item = selected.items[0]; assert.ok(item?.kind === 'verified');
    assert.equal(item.packetHash, actor.packetHash); assert.equal(item.preparedContextHash, actor.preparedContextHash);
    assert.equal(item.scope.cut.kind, 'world-cut'); assert.equal(item.compilerVersion, 'icm-markdown-v1');
    assert.equal(f.read({ role: 'director', jobId: administrative.scope.jobId })?.total, 1);
    assert.equal(f.read({}, 0, 1)?.hasMore, true); assert.equal(f.read({}, 1, 1)?.hasMore, false);
    assert.equal(f.read({ jobId: randomUUID() })?.items.length, 0);
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|SECRET_|hostPolicyMarkdown|diegeticContextMarkdown|roleContractMarkdown|sessionPath/);
    const db = new DatabaseSync(f.path, { readOnly: true });
    try {
      let sourceReads = 0;
      const projected = inspectIcmContextPackets({ database: db, request: { runId: f.runId }, readSource(request) { sourceReads++; return f.journal.readForkSource(request); } });
      assert.deepEqual(projected, page); assert.equal(sourceReads, 1, 'same head/actor/Director cut is read once per bounded page');
      assert.equal(db.prepare('SELECT count(*) n FROM request_reservations').get()?.n, 0);
    } finally { db.close(); }
    f.journal.close(); closed = true; const reopened = openJournal({ path: f.path });
    try { assert.deepEqual(reopened.readIcmContextPacketInspection({ runId: f.runId }), page); } finally { reopened.close(); }
  } finally { if (!closed) f.close(); else { const { rmSync } = await import('node:fs'); rmSync(f.directory, { recursive: true, force: true }); } }
});

test('ausencia de paquetes no inventa legacy y los errores de colección no dejan una transacción abierta', async () => {
  for (const withIcm of [false, true]) {
    const f = await icmInspectionFixture(withIcm);
    try {
      const page = f.read(); assert.ok(page); assert.equal(page.items.length, 0);
      assert.equal(page.configuration.kind, withIcm ? 'configured' : 'legacy-without-icm');
      assert.throws(() => f.journal.readIcmContextPacketInspection({ runId: f.runId, limit: 101 }));
      assert.ok(f.read(), 'invalid request rolls back readonly transaction');
      assert.equal(f.journal.readIcmContextPacketInspection({ runId: randomUUID() }), undefined);
    } finally { f.close(); }
  }
});

for (const mutation of ['packet-json', 'metadata'] as const) {
  test(`fila corrupta ${mutation} no oculta el paquete válido ni expone valores crudos`, async () => {
    const f = await icmInspectionFixture();
    try {
      const { actor } = await f.packets();
      f.mutate(db => {
        db.exec('DROP TRIGGER icm_context_packets_no_update');
        if (mutation === 'packet-json') db.prepare('UPDATE icm_context_packets SET packet_json=? WHERE job_id=?').run('{"secret":"RAW_PRIVATE"}', actor.scope.jobId);
        else { db.exec('PRAGMA ignore_check_constraints=ON'); db.prepare('UPDATE icm_context_packets SET role=? WHERE job_id=?').run('RAW_PRIVATE_UNKNOWN_ROLE', actor.scope.jobId); }
      });
      const page = f.read(); assert.ok(page); assert.equal(page.total, 2);
      assert.equal(page.items.filter(item => item.kind === 'verified').length, 1);
      const corrupt = page.items.find(item => item.kind === 'corrupt'); assert.ok(corrupt);
      if (mutation === 'metadata') assert.equal(corrupt.identity, undefined);
      assert.doesNotMatch(JSON.stringify(page), /RAW_PRIVATE|PRIVATE_MARKDOWN|PRIVATE_DIEGETIC_CONTEXT/);
      IcmContextInspectionPageSchema.parse(page);
    } finally { f.close(); }
  });
}

for (const broken of ['missing', 'hash'] as const) {
  test(`corte histórico ${broken} se informa corrupto y nunca se reemplaza por la configuración actual`, async () => {
    const f = await icmInspectionFixture();
    try {
      const { actor } = await f.packets(); assert.equal(actor.scope.cut.kind, 'world-cut'); if (actor.scope.cut.kind !== 'world-cut') assert.fail('No world cut');
      const commit = actor.scope.cut.commitIndex;
      f.mutate(db => {
        if (broken === 'missing') { db.exec('PRAGMA foreign_keys=OFF'); db.prepare('DELETE FROM world_commits WHERE run_id=? AND commit_index=?').run(f.runId, commit); }
        else db.prepare('UPDATE world_commits SET snapshot_hash=? WHERE run_id=? AND commit_index=?').run('0'.repeat(64), f.runId, commit);
      });
      const page = f.read(); assert.ok(page); assert.equal(page.configuration.kind, 'unavailable');
      assert.equal(page.items.length, 2); assert.ok(page.items.every(item => item.kind === 'corrupt'));
    } finally { f.close(); }
  });
}
