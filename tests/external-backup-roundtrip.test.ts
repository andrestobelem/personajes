import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createIcmMemoryAdapter } from '../src/adapters/icm.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createProductionHost, type ProductionHost } from '../src/server/production-host.ts';
import { createLocalHttpServer, type LocalHttpServer } from '../src/server/http.ts';
import { createProjectMemoryWorker } from '../src/application/project-memory.ts';
import { freezeExperience } from '../src/application/experience-envelope.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { BackupJobSchema, RestorePreviewSchema } from '../src/domain/backup.ts';
import { BackupExportViewSchema, BackupImportViewSchema, backupImportEtag, backupRegistrationEtag } from '../src/domain/backup-transfer.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { ForkJobViewSchema, forkSourceEtag } from '../src/domain/fork-http.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { WorldSnapshotSchema } from '../src/domain/world-schema.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { VoiceArtifactSchema } from '../src/domain/voice.ts';
import { draftFixture } from './fixtures/continuista.ts';

const binaryPath = process.env.PERSONAJES_ICM_TEST_BINARY;
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function hostFixture() {
  assert.ok(binaryPath);
  const directory = mkdtempSync(join(tmpdir(), 'personajes-external-roundtrip-')); const root = join(directory, 'host');
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  let production: ProductionHost; let server: LocalHttpServer; let origin = ''; let headers: Record<string,string> = {}; let closed = false;
  async function open() {
    assert.ok(binaryPath);
    const admissionBarrier = createHostRequestBarrier();
    production = await createProductionHost({ host: openLocalHost({ privateDataRoot: root }), catalog, admissionBarrier, icmBinaryPath: binaryPath });
    server = createLocalHttpServer({ catalog, shellHtml: '<html><head></head><body>Test</body></html>', ...production.httpOptions });
    origin = (await server.listen(0)).origin;
    const security = { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' };
    const html = await (await fetch(origin + '/', { headers: security })).text();
    const bootNonce = html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1]; assert.ok(bootNonce);
    const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: security, body: JSON.stringify({ bootNonce }) });
    assert.equal(response.status, 200); const session = SessionCreatedSchema.parse(await response.json());
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    headers = { ...security, Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
  }
  await open();
  async function request(path: string, body?: unknown, extra: Record<string,string> = {}, method = 'POST') {
    return await fetch(origin + path, { method: body === undefined ? 'GET' : method, headers: { ...headers, ...(body === undefined ? {} : { 'Idempotency-Key': randomUUID() }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function backup(id: string = randomUUID()) {
    const response = await request(`/api/v1/backups/${id}`, { scope: { kind: 'all' } }, { 'If-None-Match': '*' }, 'PUT');
    assert.equal(response.status, 202, await response.clone().text()); const job = BackupJobSchema.parse(await response.json()); assert.equal(job.state, 'succeeded', job.safeCode ?? '');
    return production.exchange.backups.verify(id);
  }
  return { directory, root, request, backup, get production() { return production; }, get origin() { return origin; },
    async restart() { await server.close(); await production.close(); await open(); },
    async close() { if (closed) return; closed = true; await server.close(); await production.close(); rmSync(directory, { recursive: true, force: true }); rmSync(root + '-auth', { recursive: true, force: true }); } };
}

async function seed(f: Awaited<ReturnType<typeof hostFixture>>) {
  assert.ok(binaryPath);
  const { kind, schemaVersion, runId, revision, ...patch } = draftFixture(); void kind; void schemaVersion; void runId; void revision;
  assert.ok(patch.roster.kind === 'configured' && patch.worldSnapshot.kind === 'configured');
  const first = patch.roster.value.preparedCharacters[0]; assert.ok(first);
  const second = PreparedCharacterSchema.parse({ ...first, characterId: 'segundo-prueba', goals: { ...first.goals,
    value: first.goals.value.map(goal => ({ ...goal, ownerCharacterId: 'segundo-prueba' })) } });
  patch.roster.value = { ...patch.roster.value, preparedCharacters: [first, second], eligibleCharacterIds: [first.characterId, second.characterId], activeCharacterIds: [first.characterId, second.characterId] };
  const base = WorldSnapshotSchema.parse(patch.worldSnapshot.value); const entity = base.entities.find(item => item.kind === 'character'); assert.ok(entity?.kind === 'character');
  patch.worldSnapshot.value = WorldSnapshotSchema.parse({ ...base,
    entities: [...base.entities, { ...entity, entityId: randomUUID(), characterId: second.characterId, position: { x: 3, y: 2 }, trueDisplayName: 'Segundo sintético' }],
    scenes: base.scenes.map(scene => ({ ...scene, participantIds: [first.characterId, second.characterId] })) });
  const draft = f.production.host.journal.createRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), patch }); assert.ok(draft.kind === 'created');
  const ready = f.production.host.journal.validateRunConfigurationDraft({ principalId: 'local-operator', idempotencyKey: randomUUID(), runId: draft.draft.runId, expectedRevision: 0 }); assert.ok(ready.kind === 'ready');
  const configuration = ReadyRunConfigurationSchema.parse(f.production.host.journal.readWorldConfiguration({ runId: ready.runId }));
  let world = f.production.host.journal.loadWorld({ runId: ready.runId }); assert.ok(world);
  f.production.host.journal.setWorldLifecycle({ runId: world.runId, expectedWorldRevision: world.revision, expectedConfigRevision: 0, target: 'running' });
  const sessionPaths: string[] = []; const sourceMemoryIds = new Map<string, unknown>();
  for (const actor of configuration.roster.preparedCharacters) {
    f.production.host.journal.recordExperience(freezeExperience({ schemaVersion: 1, experienceId: randomUUID(), runId: world.runId, actorId: actor.characterId,
      kind: 'belief', content: `Recuerdo privado de ${actor.characterId}: no vi la clave.`, sourceRefs: [], fictitiousAt: world.clock.instant,
      receivedAt: world.clock.instant, worldSeq: world.seq, confidence: 0.5, revision: 0, predecessor: { kind: 'initial' }, basedOn: [] }));
    const memory = await createIcmMemoryAdapter({ privateDataRoot: f.root, runId: world.runId, actorId: actor.characterId, binaryPath, ledger: { findReceipt: request => f.production.host.journal.findReceipt(request) } });
    await memory.initialize(); assert.equal((await createProjectMemoryWorker({ journal: f.production.host.journal, projector: memory.projector, runId: world.runId, actorId: actor.characterId }).drain({ maxItems: 10 })).kind, 'completed');
    const memoryDb = new DatabaseSync(join(f.root, 'runs', world.runId, 'actors', actor.characterId, 'memory.sqlite'), { readOnly: true });
    try { const stored = memoryDb.prepare('SELECT id FROM memories').all(); assert.equal(stored.length, 1); sourceMemoryIds.set(actor.characterId, stored[0]?.id); } finally { memoryDb.close(); }
    const actorRoot = join(f.root, 'runs', world.runId, 'actors', actor.characterId); const cwd = join(actorRoot, 'cwd'); mkdirSync(cwd, { recursive: true });
    const session = SessionManager.create(cwd, join(actorRoot, 'sessions'));
    session.appendMessage({ role: 'user', content: 'Registro sintético, sin inferencia.', timestamp: Date.now() });
    session.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const sessionPath = session.getSessionFile(); assert.ok(sessionPath && existsSync(sessionPath)); sessionPaths.push(sessionPath);
    f.production.host.journal.registerActorPiSession({ runId: world.runId, actorId: actor.characterId, sessionId: session.getSessionId(), sessionPath, preparedContextHash: hashContinuistaValue(actor), profile: DEFAULT_INFERENCE_PROFILE });
  }
  assert.equal(f.production.host.journal.applyCircumstanceCommand({ runId: world.runId, principalId: 'local-operator', operationId: randomUUID(), idempotencyKey: randomUUID(), expectedWorldRevision: world.revision, expectedDirectionRevision: 0,
    payload: { kind: 'changeCircumstance', scope: { kind: 'run' }, operation: { kind: 'setLighting', placeId: 'sala', level: 'dim' } } }).kind, 'stored');
  world = f.production.host.journal.loadWorld({ runId: world.runId }); assert.ok(world);
  // Explicit fixture media: 34 MiB total, three valid metadata records. No TTS
  // provider produced these bytes; no audio quality claim is made.
  const db = new DatabaseSync(join(f.root, 'world.sqlite'));
  try {
    for (const [index, size] of [12, 12, 10].entries()) {
      const artifactId = randomUUID(); const bytes = Buffer.alloc(size * 1024 * 1024, index + 17); const hash = digest(bytes);
      const artifact = VoiceArtifactSchema.parse({ artifactId, operationId: randomUUID(), kind: 'preview', state: 'available', sourceId: 'synthetic-roundtrip-fixture', text: '', textHash: digest(''), textRevision: 0, configRevision: 0,
        modelId: 'synthetic-no-provider', bindingId: null, mediaType: 'audio/pcm', byteLength: bytes.length, hash, providerAudioHash: hash, providerOutputFormat: null, durationSeconds: null, subtitles: { kind: 'unverified', text: '' } });
      const data = JSON.stringify(artifact); db.prepare('INSERT INTO voice_entities(kind,id,data,data_hash) VALUES(?,?,?,?)').run('artifact', artifactId, data, digest(JSON.stringify({ kind: 'artifact', id: artifactId, data })));
      mkdirSync(join(f.root, 'media'), { recursive: true }); writeFileSync(join(f.root, 'media', `${artifactId}.bin`), bytes, { mode: 0o600 });
    }
  } finally { db.close(); }
  return { world, actors: configuration.roster.preparedCharacters.map(actor => actor.characterId), sessionPaths, sourceMemoryIds };
}

test('archivo externo >32 MiB entre hosts distintos con UUID backup colisionado conserva todos los bytes y publica fork aislado', { timeout: 120_000, skip: binaryPath === undefined ? 'ICM real no configurado' : false }, async () => {
  const a = await hostFixture(); const b = await hostFixture(); const download = join(b.directory, 'download.pba');
  try {
    const seeded = await seed(a);
    const localForkId = randomUUID();
    const forkResponse = await a.request(`/api/v1/runs/${seeded.world.runId}/forks`, { operationId: localForkId, commitIndex: 1,
      worldRevision: seeded.world.revision, worldSeq: seeded.world.seq, name: 'Derivación local de prueba', reason: 'Incluir metadatos auténticos de fork en el archivo.' },
      { 'If-Match': forkSourceEtag({ runId: seeded.world.runId, commitIndex: 1, worldRevision: seeded.world.revision, worldSeq: seeded.world.seq }) });
    assert.equal(forkResponse.status, 202, await forkResponse.clone().text());
    let localFork = ForkJobViewSchema.parse(await forkResponse.json());
    const localDeadline = Date.now() + 30_000;
    while (localFork.state === 'staging') { assert.ok(Date.now() < localDeadline); await new Promise<void>(done => setTimeout(done, 10)); localFork = ForkJobViewSchema.parse(await (await a.request(`/api/v1/forks/${localForkId}`)).json()); }
    assert.ok(localFork.state === 'ready', JSON.stringify(localFork));
    const original = await a.backup();
    assert.ok(original.manifest.files.some(file => file.path === `forks/${localForkId}/package.json`));
    assert.ok(original.manifest.files.some(file => file.path === `runs/${localFork.targetRunId}/fork-owner.json`));
    const manifestBytes = readFileSync(join(original.bundleRoot, 'manifest.json')); const expectedManifest = original.manifest;
    const exported = await a.request('/api/v1/backup-exports', { backupId: original.manifest.backupId }); assert.equal(exported.status, 202, await exported.clone().text());
    let exp = BackupExportViewSchema.parse(await exported.json()); const deadline = Date.now() + 30_000;
    while (exp.state === 'queued' || exp.state === 'running') { assert.ok(Date.now() < deadline); await new Promise<void>(done => setTimeout(done, 10)); const response = await a.request(`/api/v1/backup-exports/${exp.exportId}`); exp = BackupExportViewSchema.parse(await response.json()); }
    assert.ok(exp.state === 'succeeded', JSON.stringify(exp)); assert.ok(exp.bytes > 32 * 1024 * 1024);
    const response = await a.request(`/api/v1/backup-exports/${exp.exportId}/download`); assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), String(exp.bytes)); assert.ok(response.body);
    const fd = openSync(download, 'wx', 0o600); let length = 0; const archiveHash = createHash('sha256');
    try { for await (const bytes of response.body) { writeSync(fd, bytes); length += bytes.length; archiveHash.update(bytes); } } finally { closeSync(fd); }
    assert.equal(length, exp.bytes); assert.equal(archiveHash.digest('hex'), exp.sha256);
    const collision = await b.backup(original.manifest.backupId); assert.notEqual(collision.manifest.lineageId, original.manifest.lineageId);
    const localManifest = readFileSync(join(collision.bundleRoot, 'manifest.json'));
    // The archive and manifest are now the only source. The source host is gone.
    await a.close(); assert.equal(existsSync(a.root), false);
    const beginKey = randomUUID(); const beginBody = { fileName: 'download.pba', bytes: length };
    const begun = await b.request('/api/v1/backup-imports', beginBody, { 'Idempotency-Key': beginKey }); assert.equal(begun.status, 201, await begun.clone().text());
    let imported = BackupImportViewSchema.parse(await begun.json()); const importId = imported.importId;
    const file = openSync(download, 'r');
    try {
      for (let offset = 0; offset < length;) {
        const bytes = Buffer.alloc(Math.min(1024 * 1024, length - offset)); assert.equal(readSync(file, bytes, 0, bytes.length, offset), bytes.length);
        const body = { offset, contentBase64: bytes.toString('base64'), sha256: digest(bytes) }; const key = randomUUID(); const etag = backupImportEtag(imported);
        const part = await b.request(`/api/v1/backup-imports/${importId}/parts`, body, { 'Idempotency-Key': key, 'If-Match': etag }, 'PUT');
        assert.equal(part.status, 200, await part.clone().text()); imported = BackupImportViewSchema.parse(await part.json());
        if (offset === 0) { const replay = await b.request(`/api/v1/backup-imports/${importId}/parts`, body, { 'Idempotency-Key': key, 'If-Match': etag }, 'PUT'); assert.deepEqual(await replay.json(), imported); }
        offset += bytes.length;
      }
    } finally { closeSync(file); }
    const finalizeKey = randomUUID(); const finalizeEtag = backupImportEtag(imported);
    const finalized = await b.request(`/api/v1/backup-imports/${importId}/finalize`, {}, { 'Idempotency-Key': finalizeKey, 'If-Match': finalizeEtag }); assert.equal(finalized.status, 202, await finalized.clone().text());
    await b.production.transfers.waitForIdle();
    imported = BackupImportViewSchema.parse(await (await b.request(`/api/v1/backup-imports/${importId}`)).json()); assert.ok(imported.state === 'registered', JSON.stringify(imported));
    const registration = imported.registration;
    assert.equal(registration.sourceBackupId, collision.manifest.backupId); assert.equal(registration.sourceLineageId, expectedManifest.lineageId);
    const admitted = b.production.transfers.resolveRegistration({ principalId: 'local-operator', registrationId: registration.registrationId });
    assert.deepEqual(admitted.manifest, expectedManifest); assert.deepEqual(readFileSync(join(admitted.bundleRoot, 'manifest.json')), manifestBytes);
    for (const entry of expectedManifest.files) { const path = join(admitted.bundleRoot, entry.path); assert.equal(statSync(path).size, entry.bytes); assert.equal(digest(readFileSync(path)), entry.sha256, entry.path); }
    assert.deepEqual(readFileSync(join(collision.bundleRoot, 'manifest.json')), localManifest); b.production.exchange.backups.verify(collision.manifest.backupId);
    const frozen = b.production.transfers.readRegisteredSource({ principalId: 'local-operator', registrationId: registration.registrationId, runId: seeded.world.runId });
    assert.equal(frozen.cuts.length, 2); for (const actor of seeded.actors) assert.equal(frozen.cuts.find(cut => cut.actorId === actor)?.experiences.length, 1);
    assert.equal(frozen.backup.externalRegistration?.registrationId, registration.registrationId);
    assert.equal(frozen.backup.externalRegistration?.originAssurance, 'operator-upload-unverified-origin');
    const frozenHash = hashContinuistaValue(frozen);
    await b.restart();
    assert.equal(hashContinuistaValue(b.production.transfers.readRegisteredSource({ principalId: 'local-operator', registrationId: registration.registrationId, runId: seeded.world.runId })), frozenHash);
    const finalizeReplay = await b.request(`/api/v1/backup-imports/${importId}/finalize`, {}, { 'Idempotency-Key': finalizeKey, 'If-Match': finalizeEtag }); assert.equal(finalizeReplay.status, 202); await b.production.transfers.waitForIdle();
    assert.deepEqual((BackupImportViewSchema.parse(await (await b.request(`/api/v1/backup-imports/${importId}`)).json())), imported);
    const externalPath = `/api/v1/backup-registrations/${registration.registrationId}`;
    const refused = await b.request(externalPath + '/restore-preview', { mode: 'recover' }); assert.equal(refused.status, 409); assert.match(await refused.text(), /RESTORE_EXTERNAL_RECOVER_UNAVAILABLE/);
    const selection = { mode: 'fork', sourceRunId: seeded.world.runId, name: 'Nueva representación extranjera', reason: 'Transferencia sintética entre dos hosts.' };
    const previewResponse = await b.request(externalPath + '/restore-preview', selection); assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
    const preview = RestorePreviewSchema.parse(await previewResponse.json()); assert.deepEqual(preview.blockers, []);
    const confirm = { previewToken: preview.previewToken, confirmDiffHash: preview.diffHash };
    const forgedLocal = await b.request(`/api/v1/backups/${registration.sourceBackupId}/restore`, confirm, { 'If-Match': '"backup:' + registration.sourceBackupId + ':r1"' }); assert.equal(forgedLocal.status, 409); assert.match(await forgedLocal.text(), /RESTORE_PREVIEW_TARGET_MISMATCH/);
    const key = randomUUID(); const confirmed = await b.request(externalPath + '/restore', confirm, { 'Idempotency-Key': key, 'If-Match': backupRegistrationEtag(registration) }); assert.equal(confirmed.status, 202, await confirmed.clone().text());
    const confirmedBody = await confirmed.clone().text(); const confirmedEtag = confirmed.headers.get('etag'); const confirmedLocation = confirmed.headers.get('location');
    let job = ForkJobViewSchema.parse(await confirmed.json()); const location = `/api/v1/forks/${job.operationId}`; const forkDeadline = Date.now() + 30_000;
    while (job.state === 'staging') { assert.ok(Date.now() < forkDeadline, JSON.stringify(job)); await new Promise<void>(done => setTimeout(done, 10)); const read = await b.request(location); assert.equal(read.status, 200); job = ForkJobViewSchema.parse(await read.json()); }
    assert.ok(job.state === 'ready', JSON.stringify(job)); assert.notEqual(job.targetRunId, seeded.world.runId);
    assert.equal(job.backupOrigin?.externalRegistration?.registrationId, registration.registrationId);
    assert.equal(b.production.host.journal.readWorldLifecycle({ runId: job.targetRunId })?.lifecycle, 'ready');
    for (const actor of seeded.actors) {
      assert.equal(b.production.host.journal.loadActorPiSession({ runId: job.targetRunId, actorId: actor }), undefined);
      const memories = b.production.host.journal.readExperiences({ runId: job.targetRunId, actorId: actor, throughWorldSeq: seeded.world.seq }); assert.equal(memories.length, 1); assert.equal(memories[0]?.forkOrigin?.sourceRunId, seeded.world.runId);
      const database = new DatabaseSync(join(b.root, 'runs', job.targetRunId, 'actors', actor, 'memory.sqlite'), { readOnly: true });
      try { const rows = database.prepare('SELECT id FROM memories').all(); assert.equal(rows.length, 1); assert.notEqual(rows[0]?.id, seeded.sourceMemoryIds.get(actor)); } finally { database.close(); }
    }
    const duplicate = await b.request(externalPath + '/restore', confirm, { 'Idempotency-Key': key, 'If-Match': backupRegistrationEtag(registration) }); assert.equal(duplicate.status, 202); assert.equal(ForkJobViewSchema.parse(await duplicate.json()).operationId, job.operationId);
    const intact = b.production.transfers.resolveRegistration({ principalId: 'local-operator', registrationId: registration.registrationId });
    for (const entry of expectedManifest.files) assert.equal(digest(readFileSync(join(intact.bundleRoot, entry.path))), entry.sha256, 'El fork conserva intacto el archivo fuente: ' + entry.path);
    assert.deepEqual(readFileSync(join(collision.bundleRoot, 'manifest.json')), localManifest);
    const db = new DatabaseSync(join(b.root, 'world.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT count(*) n FROM world_runs').get()?.n, 1); assert.equal(db.prepare('SELECT count(*) n FROM fork_jobs').get()?.n, 1); } finally { db.close(); }
    // Completed effects are recovered from their authenticated HTTP receipt,
    // even when the imported source later becomes unreadable. A new request
    // must still prove the source, and a reused key cannot select another intent.
    const importedManifestPath = join(intact.bundleRoot, 'manifest.json');
    const originalManifestBytes = readFileSync(importedManifestPath);
    const damaged = Buffer.from(originalManifestBytes); damaged[0] = 33;
    writeFileSync(importedManifestPath, damaged);
    try {
      assert.throws(() => b.production.transfers.getRegistration({ principalId: 'local-operator', registrationId: registration.registrationId }), /BACKUP_TRANSFER_MANIFEST_CHANGED/);
      const replayAfterDamage = await b.request(externalPath + '/restore', confirm, { 'Idempotency-Key': key, 'If-Match': backupRegistrationEtag(registration) });
      assert.equal(replayAfterDamage.status, 202, await replayAfterDamage.clone().text());
      assert.equal(await replayAfterDamage.text(), confirmedBody);
      assert.equal(replayAfterDamage.headers.get('etag'), confirmedEtag); assert.equal(replayAfterDamage.headers.get('location'), confirmedLocation);
      const freshAfterDamage = await b.request(externalPath + '/restore', confirm, { 'If-Match': backupRegistrationEtag(registration) });
      assert.equal(freshAfterDamage.status, 409); assert.match(await freshAfterDamage.text(), /BACKUP_TRANSFER_MANIFEST_CHANGED/);
      const anotherBody = await b.request(externalPath + '/restore', { ...confirm, previewToken: randomUUID() }, { 'Idempotency-Key': key, 'If-Match': backupRegistrationEtag(registration) });
      assert.equal(anotherBody.status, 409); assert.match(await anotherBody.text(), /EXCHANGE_IDEMPOTENCY_REUSE/);
      const anotherRegistration = await b.request(`/api/v1/backup-registrations/${randomUUID()}/restore`, confirm, { 'Idempotency-Key': key, 'If-Match': backupRegistrationEtag(registration) });
      assert.equal(anotherRegistration.status, 409); assert.match(await anotherRegistration.text(), /EXCHANGE_IDEMPOTENCY_REUSE/);
      const unchanged = ForkJobViewSchema.parse(await (await b.request(location)).json()); assert.deepEqual(unchanged, job);
      const counts = new DatabaseSync(join(b.root, 'world.sqlite'), { readOnly: true });
      try { assert.equal(counts.prepare('SELECT count(*) n FROM fork_jobs').get()?.n, 1); assert.equal(counts.prepare('SELECT count(*) n FROM world_runs').get()?.n, 1); }
      finally { counts.close(); }
    } finally { writeFileSync(importedManifestPath, originalManifestBytes); }
    assert.deepEqual(b.production.transfers.resolveRegistration({ principalId: 'local-operator', registrationId: registration.registrationId }).manifest, expectedManifest);
    assert.equal((await b.request('/api/v1/backup-registrations/' + randomUUID())).status, 404);
  } finally { await a.close(); await b.close(); }
});
