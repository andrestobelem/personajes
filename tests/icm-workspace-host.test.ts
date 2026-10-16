import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createIcmWorkspaceReader, ICM_WORKSPACE_ACTOR_SLUGS } from '../src/adapters/icm-workspace.ts';
import { createIcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { RunDraftMutationResultSchema } from '../src/domain/world-journal.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createProductionHost } from '../src/server/production-host.ts';

test('every catalogued actor and model role has complete readable contracts in the actual repository', () => {
  const reader = createIcmWorkspaceReader({ workspaceRoot: process.cwd() });
  const audiences = [
    ...ICM_WORKSPACE_ACTOR_SLUGS.map(actorId => ({ role: 'actor', actorId })),
    ...['continuista', 'director', 'configurator', 'narrator', 'narration-reviewer'].map(role => ({ role })),
  ];
  const groups = audiences.map(audience => {
    const sources = reader.listSources(audience);
    assert.ok(sources.length > 0);
    return { audience, sourceIds: sources.map(source => source.sourceId),
      sectionIdsBySource: Object.fromEntries(sources.map(source => [source.sourceId, source.sectionIds])) };
  });
  const preview = reader.previewMany({ groups });
  assert.equal(preview.snapshot.sources.length, 61);
  assert.deepEqual(reader.admitFrozenSnapshot(preview.snapshot, {
    expectedWorkspaceRevision: preview.workspaceRevision, expectedSnapshotHash: preview.snapshot.snapshotHash,
  }), preview.snapshot);
});

test('production composition admits actual workspace Markdown and rejects rehashed client content without inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-host-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const production = await createProductionHost({ host: openLocalHost({ privateDataRoot: directory }),
    catalog, admissionBarrier: createHostRequestBarrier() });
  try {
    const reader = createIcmWorkspaceReader({ workspaceRoot: catalog.repositoryRoot });
    const preview = reader.preview({ audience: { role: 'configurator' }, sourceIds: ['role.configurator'],
      sectionIdsBySource: { 'role.configurator': ['process', 'cierre'] } });
    const configured = (value: unknown) => ({ kind: 'configured', value,
      evidence: { kind: 'operator-choice', operatorId: 'test-operator', recordedAt: '2026-10-15T12:00:00Z' } });
    const created = RunDraftMutationResultSchema.parse(production.host.journal.createRunConfigurationDraft({
      principalId: 'test-operator', idempotencyKey: randomUUID(), patch: { icmWorkspace: configured(preview.snapshot) },
    }));
    if (created.kind !== 'created') assert.fail('Expected admitted draft');
    assert.deepEqual(created.draft.icmWorkspace?.kind === 'configured' ? created.draft.icmWorkspace.value : null, preview.snapshot);
    const forged = createIcmWorkspaceSnapshot({ sources: preview.snapshot.sources.map(source => ({ ...source,
      sections: source.sections.map(section => ({ sectionId: section.sectionId, markdown: 'Client injected contract with valid checksum.\n' })),
    })) });
    assert.throws(() => production.host.journal.createRunConfigurationDraft({ principalId: 'test-operator',
      idempotencyKey: randomUUID(), patch: { icmWorkspace: configured(forged) } }), /SOURCE_DRIFT/);
    assert.equal(production.host.journal.listRunConfigurationDrafts({ limit: 25, offset: 0 }).length, 1);
    const database = new DatabaseSync(join(directory, 'world.sqlite'), { readOnly: true });
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_runs').get()?.n, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM request_reservations').get()?.n, 0);
    } finally { database.close(); }
  } finally {
    await production.close(); rmSync(directory, { recursive: true, force: true });
    rmSync(directory + '-auth', { recursive: true, force: true });
  }
});
