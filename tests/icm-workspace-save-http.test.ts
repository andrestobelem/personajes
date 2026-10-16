import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createIcmWorkspaceSnapshot } from '../src/domain/icm-workspace.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import { ApiProblemSchema, RunConfigurationDraftMutationReceiptSchema, SessionCreatedSchema } from '../src/domain/http.ts';
import { IcmWorkspacePreviewResponseSchema } from '../src/domain/icm-workspace-selection.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createProductionHost } from '../src/server/production-host.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { draftFixture } from './fixtures/continuista.ts';

test('operator previews and saves admitted Markdown through production HTTP; forged bytes and removal fail safely', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-icm-save-http-'));
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const production = await createProductionHost({ host: openLocalHost({ privateDataRoot: directory }), catalog,
    admissionBarrier: createHostRequestBarrier() });
  const server = createLocalHttpServer({ catalog, shellHtml: '<html><head></head><body>Test</body></html>', ...production.httpOptions });
  try {
    const { origin } = await server.listen(0);
    const security = { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' };
    const html = await (await fetch(origin + '/', { headers: security })).text();
    const bootNonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1]; assert.ok(bootNonce);
    const login = await fetch(origin + '/api/v1/session', { method: 'POST', headers: security, body: JSON.stringify({ bootNonce }) });
    const session = SessionCreatedSchema.parse(await login.json());
    const cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const headers = { ...security, Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
    const previewResponse = await fetch(origin + '/api/v1/icm-workspace/preview', { method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ groups: [{
        audience: { role: 'configurator' }, sourceIds: ['role.configurator'],
        sectionIdsBySource: { 'role.configurator': ['process', 'cierre'] },
      }] }) });
    assert.equal(previewResponse.status, 200);
    const preview = IcmWorkspacePreviewResponseSchema.parse(await previewResponse.json());
    const configuration = { ...createEmptyRunConfigurationDraft({ runId: randomUUID(), revision: 0 }),
      icmWorkspace: { kind: 'configured', value: preview.snapshot,
        evidence: { kind: 'operator-choice', operatorId: 'client', recordedAt: '2026-10-15T12:00:00Z' } } };
    const create = async (value: unknown) => fetch(origin + '/api/v1/runs', { method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-None-Match': '*' }, body: JSON.stringify({ configuration: value }) });
    const saved = await create(configuration); assert.equal(saved.status, 201, await saved.clone().text());
    const receipt = RunConfigurationDraftMutationReceiptSchema.parse(await saved.json());
    const etag = saved.headers.get('etag'); assert.ok(etag);
    assert.deepEqual(receipt.configuration.icmWorkspace?.kind === 'configured' ? receipt.configuration.icmWorkspace.value : null, preview.snapshot);
    const forged = createIcmWorkspaceSnapshot({ sources: preview.snapshot.sources.map(source => ({ ...source,
      sections: source.sections.map(section => ({ sectionId: section.sectionId, markdown: 'Texto ajeno con checksum válido.' })),
    })) });
    const rejected = await create({ ...configuration, icmWorkspace: { ...configuration.icmWorkspace, value: forged } });
    assert.equal(rejected.status, 409); assert.equal(ApiProblemSchema.parse(await rejected.json()).error.code, 'ICM_WORKSPACE_SELECTION_CHANGED');
    const damaged = await create({ ...configuration, icmWorkspace: { ...configuration.icmWorkspace,
      value: { ...preview.snapshot, snapshotHash: '0'.repeat(64) } } });
    assert.equal(damaged.status, 422);
    const removal = await fetch(origin + `/api/v1/runs/${receipt.configuration.runId}/configuration`, { method: 'PUT',
      headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': etag },
      body: JSON.stringify({ configuration: { ...receipt.configuration, icmWorkspace: { kind: 'empty' } } }) });
    assert.equal(removal.status, 409); assert.equal(ApiProblemSchema.parse(await removal.json()).error.code, 'ICM_WORKSPACE_SELECTION_CHANGED');
    assert.equal(production.host.journal.listRunConfigurationDrafts({ limit: 25, offset: 0 }).length, 1);

    // An old client omitting ICM cannot create a new legacy preparation.
    const legacy = draftFixture();
    assert.equal(validateRunConfiguration({ draft: legacy }).kind, 'ready');
    assert.equal(Object.hasOwn(legacy, 'icmWorkspace'), false);
    const pendingResponse = await create({ ...legacy, revision: 0 });
    assert.equal(pendingResponse.status, 201, await pendingResponse.clone().text());
    const pending = RunConfigurationDraftMutationReceiptSchema.parse(await pendingResponse.json()).configuration;
    assert.deepEqual(pending.icmWorkspace, { kind: 'empty' });
    const report = validateRunConfiguration({ draft: pending });
    assert.equal(report.kind, 'incomplete');
    assert.ok(report.issues.some(issue => issue.field === 'icmWorkspace' && issue.code === 'draft-field-empty'));
    const pendingEtag = pendingResponse.headers.get('etag'); assert.ok(pendingEtag);
    const { icmWorkspace: omitted, ...olderClientBody } = pending; void omitted;
    const replacement = await fetch(origin + `/api/v1/runs/${pending.runId}/configuration`, { method: 'PUT',
      headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': pendingEtag },
      body: JSON.stringify({ configuration: olderClientBody }) });
    assert.equal(replacement.status, 200, await replacement.clone().text());
    assert.deepEqual(RunConfigurationDraftMutationReceiptSchema.parse(await replacement.json()).configuration.icmWorkspace, { kind: 'empty' },
      'omitir ICM al reemplazar conserva el requisito durable');
    assert.deepEqual(production.host.journal.readRunConfigurationDraft({ runId: pending.runId })?.icmWorkspace, { kind: 'empty' });
  } finally {
    await server.close(); await production.close(); rmSync(directory, { recursive: true, force: true });
    rmSync(directory + '-auth', { recursive: true, force: true });
  }
});
