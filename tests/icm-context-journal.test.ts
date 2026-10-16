import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../src/adapters/journal.ts';
import { createIcmContextPacket, createIcmWorkspaceSnapshot, hashIcmMarkdown } from '../src/domain/icm-workspace.ts';
import { canonicalJson } from '../src/domain/canonical-json.ts';
import { auditIcmContextHistory } from '../src/application/icm-context-history-audit.ts';
import { actorId, runId, setup } from './fixtures/continuista.ts';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function actorWorkspace() {
  const markdown = 'Contrato privado congelado para el actor de prueba.\n';
  const audiences = [
    { role: 'actor' as const, actorId },
    { role: 'continuista' as const },
    { role: 'director' as const },
    { role: 'configurator' as const },
  ];
  return createIcmWorkspaceSnapshot({ sources: audiences.map((audience, index) => ({
    sourceId: index === 0 ? 'actor.personaje-prueba.context' : `role.${audience.role}`,
    audience, revision: 1,
    sourceHash: hashIcmMarkdown(index === 0 ? markdown : `Contrato ${audience.role}.`),
    sections: [{ sectionId: 'process', markdown: index === 0 ? markdown : `Contrato ${audience.role}.` }],
  })) });
}

async function claimIcmActor() {
  const fixture = await setup(undefined, undefined, undefined, { icmWorkspace: actorWorkspace() });
  const claimed = fixture.journal.claimActorTurnJob(fixture.claim);
  assert.equal(claimed.kind, 'claimed');
  if (claimed.kind !== 'claimed') assert.fail('No se obtuvo un lease actoral para probar ICM.');
  const execution = { runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
    generation: claimed.job.generation, pulseId: claimed.job.pulseId,
    lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken } };
  return { fixture, binding: { kind: 'actor' as const, execution } };
}

test('el journal sella el paquete ICM antes del uso, distingue el hash semántico del checksum y conserva bytes al reabrir', async () => {
  const { fixture, binding } = await claimIcmActor();
  let journalClosed = false;
  let reopened: ReturnType<typeof openJournal> | undefined;
  try {
    const first = fixture.journal.ensureIcmContextPacket({ binding,
      hostPolicyMarkdown: 'Política confiable del host.', diegeticContextMarkdown: 'Contexto de esta escena.' });
    const replay = fixture.journal.ensureIcmContextPacket({ binding,
      hostPolicyMarkdown: 'Una política distinta no reemplaza el paquete ya sellado.', diegeticContextMarkdown: 'Otro corte.' });
    assert.deepEqual(replay, first, 'el mismo binding conserva el primer paquete sellado');

    const db = new DatabaseSync(join(fixture.directory, 'journal.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT packet_json,packet_hash,receipt_json,receipt_hash FROM icm_context_packets').get() as {
        packet_json: string; packet_hash: string; receipt_json: string; receipt_hash: string;
      } | undefined;
      assert.ok(row);
      assert.equal(row.packet_json, canonicalJson(first.packet));
      assert.equal(row.packet_hash, sha256(row.packet_json), 'el checksum cubre el JSON almacenado completo');
      assert.notEqual(row.packet_hash, first.packetHash, 'el checksum persistido no se confunde con el sello semántico');
      assert.equal(first.packet.packetHash, first.packetHash, 'el receipt autoritativo transporta el sello semántico');
      assert.equal(row.receipt_json, canonicalJson({ kind: 'icm-context-packet-receipt', scope: first.scope,
        workspaceSnapshotHash: first.packet.workspaceSnapshotHash, packetHash: first.packetHash,
        preparedContextHash: first.preparedContextHash }));
      assert.equal(row.receipt_hash, sha256(row.receipt_json));
      assert.equal(auditIcmContextHistory({ database: db, readSource: request => fixture.journal.readForkSource(request) }), 1,
        'la auditoría histórica valida un paquete poblado sin depender del lease');
    } finally { db.close(); }

    fixture.journal.close(); journalClosed = true;
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    assert.deepEqual(reopened.readIcmContextPacket(binding), first, 'la reapertura devuelve el mismo packet y receipt');

    const writer = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      assert.throws(() => writer.prepare(`UPDATE icm_context_packets SET packet_json='{}'`).run(), /ICM_CONTEXT_PACKET_IMMUTABLE/);
    } finally { writer.close(); }

    reopened.close(); reopened = undefined;
    const tamper = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      tamper.exec('DROP TRIGGER icm_context_packets_no_update');
      tamper.prepare('UPDATE icm_context_packets SET packet_json=?').run(rowText(first.packet));
    } finally { tamper.close(); }
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    assert.throws(() => reopened!.readIcmContextPacket(binding), /ICM_CONTEXT_PACKET_BINDING_CORRUPT|ZodError|El hash no corresponde/,
      'una alteración de bytes se detecta aunque se haya retirado la protección SQL');
  } finally {
    reopened?.close();
    if (!journalClosed) fixture.close();
    else rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('auditoría histórica rechaza contrato adulterado aunque packet, receipt y checksums sean autoconsistentes', async () => {
  const { fixture, binding } = await claimIcmActor();
  try {
    const original = fixture.journal.ensureIcmContextPacket({ binding,
      hostPolicyMarkdown: 'Política fija.', diegeticContextMarkdown: 'Contexto autorizado.' });
    const { kind, schemaVersion, packetHash, ...body } = original.packet;
    void kind; void schemaVersion; void packetHash;
    const changed = createIcmContextPacket({ ...body, roleContractMarkdown: 'CONTRATO AJENO AL SNAPSHOT' });
    const receipt = { kind: 'icm-context-packet-receipt', scope: original.scope,
      workspaceSnapshotHash: changed.workspaceSnapshotHash, packetHash: changed.packetHash,
      preparedContextHash: original.preparedContextHash };
    const db = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      db.exec('DROP TRIGGER icm_context_packets_no_update');
      db.prepare('UPDATE icm_context_packets SET packet_json=?,packet_hash=?,receipt_json=?,receipt_hash=?')
        .run(canonicalJson(changed), sha256(canonicalJson(changed)), canonicalJson(receipt), sha256(canonicalJson(receipt)));
      assert.throws(() => auditIcmContextHistory({ database: db, readSource: request => fixture.journal.readForkSource(request) }),
        /ICM_CONTEXT_BINDING_MISMATCH/);
    } finally { db.close(); }
  } finally { fixture.close(); }
});

function rowText(packet: unknown) {
  const value = JSON.parse(canonicalJson(packet)) as Record<string, unknown>;
  value.diegeticContextMarkdown = 'CONTEXTO ALTERADO DESPUÉS DE SELLAR';
  return canonicalJson(value);
}

test('el guard de pulso se aplica a ICM, mientras una ejecución legacy conserva su lease sin exigir pulso ICM', async () => {
  const icm = await claimIcmActor();
  try {
    const db = new DatabaseSync(join(icm.fixture.directory, 'journal.sqlite'));
    try { db.prepare("UPDATE coordinator_pulses SET state='blocked' WHERE run_id=? AND pulse_id=?")
      .run(runId, icm.binding.execution.pulseId); } finally { db.close(); }
    assert.throws(() => icm.fixture.journal.readIcmContextBinding(icm.binding), /ICM_CONTEXT_ACTOR_PULSE_INACTIVE/);
  } finally { icm.fixture.close(); }

  const legacy = await setup();
  try {
    const claimed = legacy.journal.claimActorTurnJob(legacy.claim);
    assert.equal(claimed.kind, 'claimed');
    if (claimed.kind !== 'claimed') assert.fail('No se obtuvo lease legacy.');
    const execution = { runId: claimed.job.runId, actorId: claimed.job.actorId, jobId: claimed.job.jobId,
      generation: claimed.job.generation, pulseId: claimed.job.pulseId,
      lease: { ownerToken: claimed.ownerToken, claimToken: claimed.claimToken } };
    assert.deepEqual(legacy.journal.readIcmContextBinding({ kind: 'actor', execution }), { kind: 'legacy-without-icm' });
    const wrongLease = { kind: 'actor' as const, execution: { ...execution,
      lease: { ...execution.lease, claimToken: randomUUID() } } };
    assert.throws(() => legacy.journal.readIcmContextBinding(wrongLease), /ICM_CONTEXT_ACTOR_CLAIM_INACTIVE/,
      'la ruta legacy tampoco acepta un lease ajeno');
  } finally { legacy.close(); }
});

test('un paquete ausente bloquea la reserva y no se regenera después de que el trabajo empezó', async () => {
  const { fixture, binding } = await claimIcmActor();
  let originalJournalOpen = true;
  let reopened: ReturnType<typeof openJournal> | undefined;
  try {
    const prepared = fixture.configuration.roster.preparedCharacters.find((item) => item.characterId === binding.execution.actorId);
    assert.ok(prepared);
    fixture.journal.registerActorPiSession({ runId: binding.execution.runId, actorId: binding.execution.actorId,
      sessionId: 'icm-started-packet-guard', sessionPath: join(fixture.directory, 'icm-started-packet-guard.jsonl'),
      preparedContextHash: sha256(canonicalJson(prepared)), profile: fixture.journal.readActorJobInferenceProfile(binding.execution),
      execution: binding.execution });
    assert.throws(() => fixture.journal.reserveActorJobRequest({
      execution: binding.execution, clockEpochId: fixture.runtime.clockEpochId,
    }), /ICM_CONTEXT_PACKET_REQUIRED_BEFORE_START/,
    'una request no puede comenzar antes de que exista el paquete sellado');

    fixture.journal.ensureIcmContextPacket({ binding,
      hostPolicyMarkdown: 'Política confiable del host.', diegeticContextMarkdown: 'Contexto de la escena.' });
    const reservation = fixture.journal.reserveActorJobRequest({
      execution: binding.execution, clockEpochId: fixture.runtime.clockEpochId,
    });
    assert.equal(reservation.kind, 'reserved');
    if (reservation.kind !== 'reserved') assert.fail('No se obtuvo la reserva de prueba.');

    fixture.journal.close(); originalJournalOpen = false;
    const deletePacket = new DatabaseSync(join(fixture.directory, 'journal.sqlite'));
    try {
      deletePacket.exec('DROP TRIGGER icm_context_packets_no_delete');
      deletePacket.prepare('DELETE FROM icm_context_packets WHERE job_id=? AND generation=?')
        .run(binding.execution.jobId, binding.execution.generation);
    } finally { deletePacket.close(); }

    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    const bindingInput = { kind: 'actor' as const, execution: binding.execution };
    assert.throws(() => reopened!.ensureIcmContextPacket({ binding: bindingInput,
      hostPolicyMarkdown: 'No se debe volver a compilar.', diegeticContextMarkdown: 'No se debe cambiar el corte.' }),
    /ICM_CONTEXT_PACKET_MISSING_FOR_STARTED_JOB/,
    'la reserva durable demuestra que el job ya empezó aunque se haya perdido el paquete');
    assert.throws(() => reopened!.transitionActorJobReservation({ execution: binding.execution,
      requestSeq: reservation.requestSeq, target: 'dispatched',
      wallTime: { clockEpochId: fixture.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } }),
    /ICM_CONTEXT_PACKET_MISSING_FOR_STARTED_JOB/,
    'la ruta de transporte también falla cerrada antes de enviar la request');
  } finally {
    reopened?.close();
    if (originalJournalOpen) fixture.close();
    else rmSync(fixture.directory, { recursive: true, force: true });
  }
});
