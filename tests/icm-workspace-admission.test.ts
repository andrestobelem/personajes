import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { openJournal } from '../src/adapters/journal.ts';
import { createIcmWorkspaceSnapshot, type IcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { RunDraftMutationResultSchema } from '../src/domain/world-journal.ts';
import { createPreparationSourceAdmission } from '../src/application/preparation-source-admission.ts';
import { canonicalJson } from '../src/domain/canonical-json.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';

function source(markdown = 'Contrato real seleccionado.\n') {
  return createIcmWorkspaceSnapshot({ sources: [{ sourceId: 'role.director', audience: { role: 'director' },
    revision: 0, sourceHash: createHash('sha256').update(markdown).digest('hex'),
    sections: [{ sectionId: 'process', markdown }],
  }] });
}

test('ICM admission requires host provenance, replays before reading sources, and preserves frozen bytes after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-source-'));
  const path = join(directory, 'world.sqlite');
  let journal = openJournal({ path });
  let checks = 0;
  const golden = source();
  let available = true;
  const admission = () => createPreparationSourceAdmission({
    readCatalogDossier() { throw new Error('Not used'); },
    adaptations: { readSavedAdaptation() { throw new Error('Not used'); } },
    admitIcmWorkspace(snapshot: IcmWorkspaceSnapshot) {
      checks += 1;
      if (!available || snapshot.snapshotHash !== golden.snapshotHash) throw new Error('ICM_WORKSPACE_SOURCE_CHANGED');
    },
  });
  try {
    const request = { principalId: 'operator', idempotencyKey: randomUUID(), patch: {
      icmWorkspace: { kind: 'configured', value: golden,
        evidence: { kind: 'operator-choice', operatorId: 'untrusted-client', recordedAt: '2026-10-15T12:00:00.000Z' } },
    } };
    assert.throws(() => journal.createRunConfigurationDraft(request), /ADMISSION_UNAVAILABLE/);
    assert.equal(journal.listRunConfigurationDrafts({ limit: 25, offset: 0 }).length, 0);
    journal.setPreparationSourceAdmission(admission());
    const forged = { ...request, idempotencyKey: randomUUID(), patch: { icmWorkspace: { ...request.patch.icmWorkspace, value: source('Checksum válido, origen falso.') } } };
    assert.throws(() => journal.createRunConfigurationDraft(forged), /SOURCE_CHANGED/);
    assert.equal(journal.listRunConfigurationDrafts({ limit: 25, offset: 0 }).length, 0);
    const created = RunDraftMutationResultSchema.parse(journal.createRunConfigurationDraft(request));
    if (created.kind !== 'created') assert.fail('Expected created draft');
    assert.equal(checks, 2);
    available = false;
    assert.deepEqual(journal.createRunConfigurationDraft(request), { ...created, kind: 'existing' });
    assert.equal(checks, 2);
    journal.close();
    journal = openJournal({ path });
    journal.setPreparationSourceAdmission(admission());
    const update = { principalId: 'operator', idempotencyKey: randomUUID(), runId: created.draft.runId,
      expectedRevision: 0, patch: { icmWorkspace: created.draft.icmWorkspace } };
    const saved = RunDraftMutationResultSchema.parse(journal.updateRunConfigurationDraft(update));
    if (saved.kind !== 'stored') assert.fail('Expected unchanged frozen source to remain admitted');
    assert.deepEqual(saved.draft.icmWorkspace, created.draft.icmWorkspace);
    assert.equal(checks, 2);
    assert.throws(() => journal.updateRunConfigurationDraft({ ...update, idempotencyKey: randomUUID(), expectedRevision: 1,
      patch: { icmWorkspace: { kind: 'empty' } } }), /REMOVAL_FORBIDDEN/);
    assert.throws(() => journal.updateRunConfigurationDraft({ ...update, idempotencyKey: randomUUID(), expectedRevision: 1,
      patch: forged.patch }), /SOURCE_CHANGED/);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a configured workspace cannot bypass the resolver through the generic preparation admission', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-unconfigured-'));
  const journal = openJournal({ path: join(directory, 'world.sqlite') });
  try {
    journal.setPreparationSourceAdmission(createPreparationSourceAdmission({
      readCatalogDossier() { throw new Error('Not used'); },
      adaptations: { readSavedAdaptation() { throw new Error('Not used'); } },
    }));
    assert.throws(() => journal.createRunConfigurationDraft({ principalId: 'operator', idempotencyKey: randomUUID(), patch: {
      icmWorkspace: { kind: 'configured', value: source(),
        evidence: { kind: 'operator-choice', operatorId: 'operator', recordedAt: '2026-10-15T12:00:00.000Z' } },
    } }), /ICM_WORKSPACE_ADMISSION_UNAVAILABLE/);
    assert.equal(journal.listRunConfigurationDrafts({ limit: 25, offset: 0 }).length, 0);
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('journal read verifies frozen hashes even when the outer history checksum was recomputed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-corrupt-read-'));
  const path = join(directory, 'world.sqlite');
  const journal = openJournal({ path });
  try {
    journal.setPreparationSourceAdmission(createPreparationSourceAdmission({
      readCatalogDossier() { throw new Error('Not used'); }, adaptations: { readSavedAdaptation() { throw new Error('Not used'); } },
      admitIcmWorkspace(snapshot) { assert.deepEqual(snapshot, source()); },
    }));
    const created = RunDraftMutationResultSchema.parse(journal.createRunConfigurationDraft({ principalId: 'operator',
      idempotencyKey: randomUUID(), patch: { icmWorkspace: { kind: 'configured', value: source(),
        evidence: { kind: 'operator-choice', operatorId: 'operator', recordedAt: '2026-10-15T12:00:00Z' } } } }));
    if (created.kind !== 'created') assert.fail('Expected draft');
    const database = new DatabaseSync(path);
    try {
      const row = z.object({ payload_json: z.string() }).parse(database.prepare('SELECT payload_json FROM run_configuration_draft_history WHERE run_id=?').get(created.draft.runId));
      const payload = z.strictObject({ draft: RunConfigurationDraftSchema, principalId: z.string(), recordedAt: z.string() }).parse(JSON.parse(row.payload_json));
      const workspace = payload.draft.icmWorkspace;
      if (workspace?.kind !== 'configured') assert.fail('Expected snapshot');
      const json = canonicalJson({ ...payload, draft: { ...payload.draft, icmWorkspace: { ...workspace,
        value: { ...workspace.value, snapshotHash: '0'.repeat(64) } } } });
      database.prepare('UPDATE run_configuration_draft_history SET payload_json=?,payload_hash=? WHERE run_id=?')
        .run(json, createHash('sha256').update(json).digest('hex'), created.draft.runId);
    } finally { database.close(); }
    assert.throws(() => journal.readRunConfigurationDraft({ runId: created.draft.runId }));
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});
