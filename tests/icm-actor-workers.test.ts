import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { setup, deterministicFactory, responseFor, actorId, runId } from './fixtures/continuista.ts';
import { createActorTurnWorker } from '../src/application/actor-turn-worker.ts';
import { createContinuistaPiWorker } from '../src/application/continuista-pi-worker.ts';
import { validateContinuistaReviewContext } from '../src/application/continuista-review-context.ts';
import { createIcmWorkspaceSnapshot, verifyIcmContextPacket } from '../src/domain/icm-workspace.ts';
import { WorldSeqSchema } from '../src/domain/values.ts';
import type { CreatePiSessionInput, PiPromptInput } from '../src/adapters/pi.ts';
import { openJournal } from '../src/adapters/journal.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function workspace(actorMarkdown: string) {
  return createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'actor.personaje-prueba.context', audience: { role: 'actor', actorId }, revision: 2, sourceHash: hash(actorMarkdown), sections: [{ sectionId: 'process', markdown: actorMarkdown }] },
    { sourceId: 'actor.oculto-prueba.context', audience: { role: 'actor', actorId: 'oculto-prueba' }, revision: 9, sourceHash: hash('other-file'), sections: [{ sectionId: 'process', markdown: 'HIDDEN_OTHER_ACTOR_CONTRACT' }] },
    ...['continuista', 'director', 'configurator'].map(role => ({ sourceId: `role.${role}`, audience: { role }, revision: 1, sourceHash: hash(role), sections: [{ sectionId: 'process', markdown: `${role.toUpperCase()}_OWN_FROZEN: contrato sintético.` }] })),
  ] });
}

test('Actor y Continuista reciben contratos ICM privados durables antes de sesión, request y checkpoint', async () => {
  const sourceDirectory = mkdtempSync(join(tmpdir(), 'personajes-icm-source-'));
  const sourcePath = join(sourceDirectory, 'source.md');
  writeFileSync(sourcePath, 'ACTOR_OWN_FROZEN: elegí una táctica propia.\n');
  const snapshot = workspace(readFileSync(sourcePath, 'utf8'));
  const fixture = await setup(undefined, undefined, undefined, { icmWorkspace: snapshot });
  let reopened: ReturnType<typeof openJournal> | undefined;
  let originalClosed = false;
  try {
    writeFileSync(sourcePath, 'FUENTE_VIVA_MUTADA_NO_USAR');
    unlinkSync(sourcePath);
    let binding: unknown;
    const packets: unknown[] = [];
    const packetHashes: string[] = [];
    const journal = { ...fixture.journal,
      readIcmContextBinding(value: unknown) { binding = value; return fixture.journal.readIcmContextBinding(value); },
    };
    const actor = deterministicFactory(fixture, { beforePrompt() {
      const receipt = fixture.journal.readIcmContextPacket(packets[0]);
      assert.ok(receipt); assert.equal(receipt.packetHash, packetHashes[0]);
    } });
    let actorPreparedHash = '';
    let actorSystemPrompt = '';
    const admin = createContinuistaPiWorker({ journal, runtime: fixture.runtime, ids: fixture.ids, ownerToken: fixture.claim.ownerToken,
      async sessionFactory(input: CreatePiSessionInput) {
        const receipt = fixture.journal.readIcmContextPacket(binding); assert.ok(receipt);
        assert.equal(receipt.packet.scope.audience.role, 'continuista');
        assert.match(input.systemPrompt, /CONTINUISTA_OWN_FROZEN/);
        assert.doesNotMatch(input.systemPrompt, /ACTOR_OWN_FROZEN|HIDDEN_OTHER_ACTOR_CONTRACT|DIRECTOR_OWN_FROZEN|CONFIGURATOR_OWN_FROZEN/);
        packets.push(binding); packetHashes.push(receipt.packetHash);
        const checkpoint = { sessionId: randomUUID(), sessionPath: join(fixture.directory, `${randomUUID()}.jsonl`), candidateLeafId: null };
        const context = validateContinuistaReviewContext({ kind: 'continuista-review-context', schemaVersion: 1, ...z.record(z.string(), z.unknown()).parse(JSON.parse(receipt.packet.diegeticContextMarkdown)) });
        return { identity: input.identity, activeToolNames: input.tools.map(tool => tool.name), checkpoint: () => checkpoint, subscribe: () => () => undefined, async abortAndDispose() {},
          async prompt(prompt: PiPromptInput) {
            assert.ok(fixture.journal.readIcmContextPacket(packets[1]));
            assert.doesNotThrow(() => JSON.stringify(context));
            assert.equal(prompt.text.includes('submit_continuista_review'), true);
            const port = input.requestPort; const purpose = input.identity;
            await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'job-base', baseScope: prompt.scope }, snapshot: checkpoint });
            const reservation = await port.reserveNextRequest({ purpose, scope: prompt.scope, clockEpochId: input.runtime.clockEpochId });
            assert.equal(reservation.kind, 'reserved'); if (reservation.kind !== 'reserved') throw new Error('Reserva sintética ausente');
            const reference = { scope: prompt.scope, requestSeq: reservation.requestSeq };
            await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'request-input', baseScope: prompt.scope, request: reference }, snapshot: { ...checkpoint, candidateLeafId: 'icm-admin-input' } });
            await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'dispatched', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
            const tool = input.tools[0]; assert.ok(tool);
            await Reflect.apply(tool.execute, tool, ['icm-review-fixture', responseFor(context)]);
            await port.transitionReservation({ purpose, scope: prompt.scope, requestSeq: reservation.requestSeq, target: 'completed', wallTime: { clockEpochId: input.runtime.clockEpochId, monotonicNs: process.hrtime.bigint().toString() } });
            await port.recordCheckpointCandidate({ identity: purpose, purpose: { kind: 'terminal-candidate', baseScope: prompt.scope, outcome: 'completed', lastRequest: reference }, snapshot: { ...checkpoint, candidateLeafId: 'icm-admin-terminal' } });
            return { kind: 'pi-terminal-candidate' as const, candidateId: null, outcome: 'completed' as const, candidateLeafId: 'icm-admin-terminal' };
          },
        };
      },
    });
    const worker = createActorTurnWorker({ journal, runtime: fixture.runtime, ids: fixture.ids, continuista: admin,
      memoryForActor: () => ({ async recall() { return { source: 'ranked-recall', throughWorldSeq: WorldSeqSchema.parse(0), experiences: [], rejectedCount: 0 }; } }),
      async sessionFactory(input) {
        const receipt = fixture.journal.readIcmContextPacket(binding); assert.ok(receipt);
        assert.equal(receipt.packet.scope.audience.role, 'actor');
        assert.match(input.systemPrompt, /ACTOR_OWN_FROZEN/);
        assert.doesNotMatch(input.systemPrompt, /HIDDEN_OTHER_ACTOR_CONTRACT|CONTINUISTA_OWN_FROZEN|DIRECTOR_OWN_FROZEN|CONFIGURATOR_OWN_FROZEN|SECRET_OTHER_PREPARATION|SECRET_PRIVATE_PLACE|SECRET_PRIVATE_OTHER_MEMORY|FUENTE_VIVA_MUTADA/);
        assert.ok('preparedContextHash' in receipt.packet);
        assert.equal(input.preparedContextHash, receipt.packet.preparedContextHash);
        assert.notEqual(input.preparedContextHash, receipt.packetHash);
        assert.ok(input.preparedContextHash);
        actorPreparedHash = input.preparedContextHash; actorSystemPrompt = input.systemPrompt;
        packets.push(binding); packetHashes.push(receipt.packetHash);
        return actor.factory(input);
      },
    });
    const result = await worker.run(fixture.claim);
    assert.equal(result.kind, 'committed');
    assert.equal(packets.length, 2);
    assert.notEqual(packetHashes[0], packetHashes[1]);
    assert.equal(actor.prompts.length, 1);
    const replay = await worker.run(fixture.claim);
    assert.equal(replay.kind, 'recovered');
    assert.equal(actor.prompts.length, 1);
    assert.equal(packets.length, 2);
    assert.equal(fixture.journal.loadActorPiSession({ runId, actorId })?.preparedContextHash, actorPreparedHash);
    assert.match(actorSystemPrompt, /Mensaje sintético para activar la prueba/);
    fixture.journal.close(); originalClosed = true;
    reopened = openJournal({ path: join(fixture.directory, 'journal.sqlite') });
    // Historical inspection is read-only SQL: execution APIs require an active lease.
    const inspection = new DatabaseSync(join(fixture.directory, 'journal.sqlite'), { readOnly: true });
    try {
      const persisted = inspection.prepare('SELECT packet_json FROM icm_context_packets ORDER BY created_at, rowid').all();
      assert.equal(persisted.length, 2);
      const durablePacketHashes: string[] = [];
      for (const row of persisted) {
        assert.equal(typeof row.packet_json, 'string');
        const packet = verifyIcmContextPacket(JSON.parse(String(row.packet_json)));
        durablePacketHashes.push(packet.packetHash);
      }
      assert.deepEqual(durablePacketHashes, packetHashes);
    } finally { inspection.close(); }
  } finally { reopened?.close(); if (originalClosed) rmSync(fixture.directory, { recursive: true, force: true }); else fixture.close(); rmSync(sourceDirectory, { recursive: true, force: true }); }
});
