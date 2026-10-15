import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportDossier, importDossier, loadCatalog, hashDossierMarkdown } from '../src/adapters/catalog.ts';
import { PiRuntime } from '../src/adapters/pi.ts';
import { createIdentityPromotionApplication } from '../src/application/identity-promotion-application.ts';
import { createProductionPreflightHost } from '../src/application/production-preflight-host.ts';
import { createPiAuthFingerprint } from '../src/application/pi-auth-fingerprint.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { validateRunConfiguration, ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { configuratorValueHash } from '../src/application/configurator-context.ts';
import { parseDossierMarkdown } from '../src/domain/catalog.ts';
import { DossierSourceSchema } from '../src/domain/dossier-source.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { identityPromotionContextEtag } from '../src/domain/identity-promotion-http.ts';
import type { IdentityPromotionAuthority } from '../src/server/identity-promotion-routes.ts';
import { draftFixture } from './fixtures/continuista.ts';
import { controlledConfiguratorSessionFactory, configuratorSessionStats } from './fixtures/configurator-session.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'identity-frozen-source-'));
  const host = openLocalHost({ privateDataRoot: directory });
  const ready = validateRunConfiguration({ draft: draftFixture() });
  assert.equal(ready.kind, 'ready'); if (ready.kind !== 'ready') assert.fail();
  const originalActor = ready.configuration.roster.preparedCharacters[0]; assert.ok(originalActor);
  const markdown = '# Synthetic adaptation dossier\n';
  const received = exportDossier(parseDossierMarkdown({ characterId: originalActor.characterId, displayName: 'Adaptación privada sintética', markdown, contentHash: hashDossierMarkdown(markdown), aliases: ['FROZEN_ADAPTATION_METADATA'] }));
  const imported = importDossier(received); const dossier = imported.importedDossier;
  const source = DossierSourceSchema.parse({ kind: 'saved-adaptation', characterId: dossier.characterId, revision: dossier.revision, contentHash: dossier.contentHash, fullArchiveHash: hash(exportDossier(dossier)), importedArchiveHash: hash(received), importId: randomUUID(), adaptationId: imported.adaptationId, frozenDossier: dossier });
  const section = <T extends { provenance: { dossierRevision: number; dossierHash: string } }>(value: T) => ({ ...value, provenance: { ...value.provenance, dossierRevision: dossier.revision, dossierHash: dossier.contentHash } });
  const actor = PreparedCharacterSchema.parse({ ...originalActor, dossierRevision: dossier.revision, dossierHash: dossier.contentHash, dossierSource: source, identity: section(originalActor.identity), voice: section(originalActor.voice), antecedents: section(originalActor.antecedents), goals: section(originalActor.goals), relationships: section(originalActor.relationships), capabilities: section(originalActor.capabilities), inventory: section(originalActor.inventory), initialExperience: section(originalActor.initialExperience), unknownPolicy: section(originalActor.unknownPolicy) });
  const configuration = ReadyRunConfigurationSchema.parse({ ...ready.configuration, roster: { ...ready.configuration.roster, preparedCharacters: [actor] }, preparedActorFences: ready.configuration.preparedActorFences.map(fence => ({ ...fence, dossierRevision: dossier.revision, dossierHash: dossier.contentHash })) });
  const world = configuration.worldSnapshot; const runId = configuration.runId;
  host.journal.registerWorldRun({ initialSnapshot: world, configurationRevision: configuration.configRevision, configuration, continuityFence: { kind: 'prepared-contexts', atWorldSeq: world.seq, contexts: [{ actorId: actor.characterId, continuityId: actor.continuity.continuityId, continuityRevision: actor.continuity.revision, continuityContentHash: actor.continuity.contentHash, identityVersion: actor.identityVersion, preparedContextHash: configuratorValueHash(actor) }] }, lifecycle: 'paused' });
  const loaded = await loadCatalog({ repositoryRoot: process.cwd() });
  const catalog = { ...loaded, manifest: { ...loaded.manifest, characters: [] } };
  const runtime = await PiRuntime.create({ privateDataRoot: directory }); const stats = configuratorSessionStats();
  const app = createIdentityPromotionApplication({ host, runtime, catalog, sessionFactory: controlledConfiguratorSessionFactory({ root: directory, stats }) });
  const authority: IdentityPromotionAuthority = { principalId: 'synthetic-operator', mode: { kind: 'director', runId, scope: { kind: 'run' } }, inspectionRunIds: [runId] };
  function request() { const context = app.context({ runId, authority }); return { runId, authority, idempotencyKey: randomUUID(), ifMatch: identityPromotionContextEtag(context), body: { actorId: actor.characterId, expectedLifecycleRevision: context.lifecycleRevision, expectedCommitIndex: context.commitIndex, expectedWorldRevision: context.worldRevision, expectedWorldSeq: context.worldSeq, expectedConfigurationRevision: context.configurationRevision } }; }
  return { host, app, actor, configuration, dossier, stats, request, directory, runtime, catalog, async close() { await app.close(); host.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('Configurator uses frozen adaptation with complete metadata even without any current catalog entry', async () => {
  const f = await fixture(); try {
    const started = await f.app.start(f.request()); await f.app.waitForIdle();
    const review = f.app.readReview({ jobId: started.jobId, authority: f.request().authority });
    assert.deepEqual(review.context.source, f.dossier);
    assert.deepEqual(review.context.target.aliases, ['FROZEN_ADAPTATION_METADATA']);
    assert.equal(review.context.sourceFullHash, hash(exportDossier(f.dossier)));
    // The real controlled SDK fixture requires a lived belief to submit a proposal.
    // This initial cut has none; source selection is verified before that terminal failure.
    assert.equal(review.job.state, 'failed'); assert.equal(f.stats.sessions, 1);
    assert.deepEqual(f.stats.contexts[0]?.source, f.dossier);
  } finally { await f.close(); }
});

test('Configurator rejects a present frozen source with invalid full hash before inference or catalog fallback', async () => {
  const f = await fixture(); const read = f.host.journal.readWorldConfiguration;
  try {
    f.host.journal.readWorldConfiguration = request => { const configuration = read(request); if (configuration === undefined) return configuration; return { ...f.configuration, roster: { ...f.configuration.roster, preparedCharacters: [{ ...f.actor, dossierSource: { ...f.actor.dossierSource, fullArchiveHash: 'f'.repeat(64) } }] } }; };
    await assert.rejects(f.app.start(f.request()), /DOSSIER_SOURCE_HASH_MISMATCH/);
    assert.equal(f.stats.sessions, 0); assert.equal(f.app.list({ runId: f.configuration.runId, authority: f.request().authority }).items.length, 0);
  } finally { f.host.journal.readWorldConfiguration = read; await f.close(); }
});


test('preflight verifies frozen adaptation cryptography without catalog lookup, mutation or session creation', async () => {
  const f = await fixture(); try {
    const files = () => readdirSync(f.directory, { recursive: true }).map(String).sort();
    const beforeConfiguration = f.host.journal.readWorldConfiguration({ runId: f.configuration.runId });
    const authentication = createPiAuthFingerprint({ privateDataRoot: f.directory, environment: {} });
    const beforeFiles = files();
    const preflight = createProductionPreflightHost({ journal: f.host.journal, catalog: f.catalog, piRuntime: f.runtime, authentication });
    const request = { runId: f.configuration.runId, characterIds: [f.actor.characterId] };
    const result = await preflight.loadPreparedActorContexts(request);
    assert.deepEqual(result, { kind: 'loaded', runId: f.configuration.runId, actors: [f.actor] });
    const invalid = createProductionPreflightHost({ journal: { ...f.host.journal, readWorldConfiguration() { return { ...f.configuration, roster: { ...f.configuration.roster, preparedCharacters: [{ ...f.actor, dossierSource: { ...f.actor.dossierSource, fullArchiveHash: 'f'.repeat(64) } }] } }; } }, catalog: f.catalog, piRuntime: f.runtime, authentication });
    assert.deepEqual(await invalid.loadPreparedActorContexts(request), { kind: 'unavailable', code: 'prepared-context-unavailable' });
    assert.deepEqual(f.host.journal.readWorldConfiguration({ runId: f.configuration.runId }), beforeConfiguration);
    assert.deepEqual(files(), beforeFiles); assert.equal(f.stats.sessions, 0);
  } finally { await f.close(); }
});
