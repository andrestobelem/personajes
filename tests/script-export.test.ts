import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createScriptExportService, collectScript } from '../src/application/script-export.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { sha256CanonicalJson } from '../src/domain/canonical-json.ts';
import { ScriptExportReceiptSchema } from '../src/domain/script-export.ts';
import { EpisodeIdSchema, type DramaticStructureCommand } from '../src/domain/dramatic-structure.ts';
import { SceneIdSchema, PlaceIdSchema } from '../src/domain/world-schema.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { createScriptExportRoutes } from '../src/server/script-export-routes.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { fountainDialogue } from '../src/application/render-fountain.ts';
import { setup, actorId } from './fixtures/continuista.ts';
import { fixture as narratorFixture, fixtureReviewer } from './fixtures/narrator-run.ts';
import { createNarratorPiWorker } from '../src/application/narrator-pi-worker.ts';
import { controlledNarratorSessionFactory } from './fixtures/narrator-session.ts';

async function fixture() {
  const base = await setup(); const journal = openJournal({ path: join(base.directory, 'export-world.sqlite') });
  const configuration = ReadyRunConfigurationSchema.parse({ ...base.configuration,
    worldSnapshot: { ...base.configuration.worldSnapshot, places: [...base.configuration.worldSnapshot.places, { id: 'pasillo-publico', name: 'Pasillo público', description: 'Pasillo de prueba', width: 8, height: 8, lighting: 'normal' }] },
    humanParticipants: base.configuration.humanParticipants.map(profile => ({ ...profile, presence: { kind: 'remote', placeId: 'sala', position: { x: 1, y: 2 }, channelId: profile.presence.channelId } })) });
  const prepared = configuration.roster.preparedCharacters.find(actor => actor.characterId === actorId); assert.ok(prepared);
  const runId = configuration.runId;
  journal.registerWorldRun({ initialSnapshot: configuration.worldSnapshot, configurationRevision: configuration.configRevision, configuration,
    continuityFence: { kind: 'prepared-contexts', atWorldSeq: configuration.worldSnapshot.seq, contexts: [{ actorId, identityVersion: prepared.identityVersion, preparedContextHash: sha256CanonicalJson(prepared), continuityId: prepared.continuity.continuityId, continuityRevision: prepared.continuity.revision, continuityContentHash: prepared.continuity.contentHash }] }, lifecycle: 'running' });
  const service = createScriptExportService({ journal, repositoryRoot: base.directory, privateDataRoot: base.directory });
  function say(text: string) { const world = journal.loadWorld({ runId }); assert.ok(world); const human = configuration.humanParticipants[0]; assert.ok(human);
    const result = journal.commitHumanIntervention({ runId, participantId: human.identity.participantId, expectedRevision: world.revision, idempotencyKey: randomUUID(), request: { kind: 'speech', recipientCharacterIds: [actorId], channelId: human.presence.channelId, content: { kind: 'speech', text } } });
    assert.ok('resolution' in result && result.resolution.kind === 'applied', JSON.stringify(result)); }
  function structure(command: DramaticStructureCommand) { const world = journal.loadWorld({ runId }), state = journal.readDramaticStructure({ runId }); assert.ok(world && state);
    const result = journal.applyDramaticStructureCommand({ runId, principalId: 'local-operator', operationId: randomUUID(), idempotencyKey: randomUUID(), expectedWorldRevision: world.revision, expectedStructureRevision: state.structureRevision, command }); assert.equal(result.kind, 'stored', JSON.stringify(result)); }
  const cut = () => { const value = journal.readInspectorWorldCut({ runId }); assert.ok(value); return value.commitIndex; };
  return { ...base, journal, service, configuration, runId, say, structure, cut, close() { journal.close(); base.close(); } };
}

test('Fountain real recorre más de100 emisiones, conserva todas escenas y palabras sin inventar acciones ni filtrar privados; replay/reinicio no duplican', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 105; i++) f.say(`Línea pública ${i}: digo que abrí la caja; no demuestra una acción.`);
    const firstScene = f.configuration.worldSnapshot.activeSceneId; assert.ok(firstScene);
    f.structure({ kind: 'closeScene', sceneId: firstScene, reason: 'PRIVATE_DIRECTION_REASON' });
    const episodeId = EpisodeIdSchema.parse(randomUUID()); f.structure({ kind: 'openEpisode', episodeId, title: 'Segundo tramo confirmado' });
    const sceneId = SceneIdSchema.parse(randomUUID()); f.structure({ kind: 'openScene', scene: { id: sceneId, label: 'Segunda escena', participantIds: [actorId], placeIds: [PlaceIdSchema.parse('sala'), PlaceIdSchema.parse('pasillo-publico')] } });
    f.say('Última réplica de la segunda escena.');
    f.structure({ kind: 'closeScene', sceneId, reason: 'PRIVATE_CLOSURE_REASON' }); f.structure({ kind: 'closeEpisode', episodeId, consequenceEventIds: [], openLines: [] });
    const commitIndex = f.cut(), request = { runId: f.runId, commitIndex, idempotencyKey: randomUUID() };
    const before = f.journal.loadWorld({ runId: f.runId }), budget = f.journal.readRunModelTimeBudget({ runId: f.runId });
    const receipt = f.service.export(request, 'local-operator'); assert.equal(receipt.communicationCount, 106);
    const text = readFileSync(join(f.directory, receipt.relativePath), 'utf8');
    assert.match(text, /^Title:/); assert.match(text, /@VISITANTE/); assert.match(text, /Línea pública 0:/); assert.match(text, /Línea pública 104:/); assert.match(text, /Última réplica/);
    assert.match(text, /\.SEGUNDA ESCENA - SALA DE PRUEBA \/ PASILLO PÚBLICO|\.SEGUNDA ESCENA - SALA \/ PASILLO PÚBLICO/);
    assert.doesNotMatch(text.split('.SEGUNDA ESCENA')[0] ?? '', /PASILLO PÚBLICO/);
    assert.match(text, /Cierre de episodio/); assert.doesNotMatch(text, /SECRET_|PRIVATE_|pensamiento|sessionPath|@DIRECTOR/);
    assert.doesNotMatch(text, /!.*abrió la caja/); assert.deepEqual(f.service.export(request, 'local-operator'), receipt);
    const restarted = createScriptExportService({ journal: f.journal, repositoryRoot: f.directory, privateDataRoot: f.directory }); assert.deepEqual(restarted.export(request, 'local-operator'), receipt);
    assert.equal(readdirSync(join(f.directory, 'docs', 'output')).filter(name => name.endsWith('.fountain')).length, 1);
    assert.deepEqual(f.journal.loadWorld({ runId: f.runId }), before); assert.deepEqual(f.journal.readRunModelTimeBudget({ runId: f.runId }), budget);
    assert.throws(() => f.service.export({ ...request, commitIndex: 0 }, 'local-operator'), /IDEMPOTENCY_CONFLICT/);
    const future = f.service.export({ runId: f.runId, commitIndex: 0, idempotencyKey: randomUUID() }, 'local-operator');
    assert.equal(future.communicationCount, 0); assert.doesNotMatch(readFileSync(join(f.directory, future.relativePath), 'utf8'), /Línea pública/);
  } finally { f.close(); }
});

test('literal Fountain no oculta habla con notas/boneyard ni convierte contenido en escenas o parentéticos', () => {
  const script = fountainDialogue('Agente 99', '[[nota]] /* texto */\n# sección\n@OTRO\n(acción falsa)\n\nFin *literal*');
  assert.match(script, /^@AGENTE 99\n/); assert.doesNotMatch(script, /\[\[|\/\*|^#|^@OTRO|^\(acción/m);
  assert.ok(script.includes('\\[\\[nota\\]\\]')); assert.ok(script.includes('\n  \n'));
});

test('guion incluye sólo narración pública realmente aceptada; leer/exportar no genera inferencias adicionales', async () => {
  const f = await narratorFixture(); const stats = { requests: 0, disposed: 0 };
  try {
    const worker = createNarratorPiWorker({ journal: f.journal, runtime: f.runtime, ownerToken: randomUUID(), reviewer: fixtureReviewer(f), sessionFactory: controlledNarratorSessionFactory({ root: f.directory, physicalSessions: true, stats }) });
    const published = await worker.run({ runId: f.runId, pulseId: f.pulseId }); assert.equal(published.kind, 'published'); if (published.kind !== 'published' || published.receipt.kind !== 'published') assert.fail('No publication');
    const cut = f.journal.readInspectorWorldCut({ runId: f.runId }); assert.ok(cut); const requests = stats.requests;
    const script = collectScript({ journal: f.journal, runId: f.runId, commitIndex: cut.commitIndex, capturedAt: Date.now() });
    assert.equal(script.narrationCount, 1); assert.match(script.text, /@NARRADOR \(V\.O\.\)/); assert.ok(script.text.includes(published.receipt.publication.text)); assert.equal(stats.requests, requests);
    const beforePublication = collectScript({ journal: f.journal, runId: f.runId, commitIndex: cut.commitIndex, capturedAt: published.receipt.publication.publishedAt - 1 }); assert.equal(beforePublication.narrationCount, 0);
  } finally { f.close(); }
});

test('rutas fijas rechazan symlinks y archivos modificados sin sobrescribir resultados ajenos', async () => {
  const f = await fixture();
  try {
    f.say('Réplica guardada.'); const request = { runId: f.runId, commitIndex: f.cut(), idempotencyKey: randomUUID() };
    const receipt = f.service.export(request, 'local-operator'); const path = join(f.directory, receipt.relativePath); writeFileSync(path, 'ARCHIVO AJENO');
    assert.throws(() => f.service.export(request, 'local-operator'), /OUTPUT_CHANGED/); assert.equal(readFileSync(path, 'utf8'), 'ARCHIVO AJENO');
    assert.throws(() => f.service.download({ runId: f.runId, filename: '../../secret' }));
  } finally { f.close(); }
  const other = await fixture();
  try { mkdirSync(join(other.directory, 'elsewhere')); mkdirSync(join(other.directory, 'docs')); symlinkSync(join(other.directory, 'elsewhere'), join(other.directory, 'docs', 'output'));
    assert.throws(() => other.service.export({ runId: other.runId, commitIndex: other.cut(), idempotencyKey: randomUUID() }, 'local-operator'), /UNSAFE_DIRECTORY/); assert.deepEqual(readdirSync(join(other.directory, 'elsewhere')), []);
  } finally { other.close(); }
});

test('HTTP export requiere sesión/CSRF/clave, guarda y descarga bytes íntegros; respuesta perdida recupera mismo recibo', async () => {
  const f = await fixture(); f.say('Guion descargable confirmado.');
  const server = createLocalHttpServer({ catalog: await loadCatalog({ repositoryRoot: process.cwd() }), shellHtml: '<html><head></head><body></body></html>', operatorExtensions: [createScriptExportRoutes(f.service)] });
  try {
    const { origin } = await server.listen(); const path = `${origin}/api/v1/runs/${f.runId}/script-exports`;
    assert.equal((await fetch(path, { method: 'POST', headers: { Origin: origin } })).status, 401);
    const shell = await (await fetch(origin + '/')).text(); const nonce = shell.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]; assert.ok(nonce);
    const login = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) }); const session = SessionCreatedSchema.parse(await login.json()); const cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
    const body = JSON.stringify({ commitIndex: f.cut() }); assert.equal((await fetch(path, { method: 'POST', headers, body })).status, 403);
    const authenticated = { ...headers, 'X-CSRF-Token': session.csrfToken }; const response = await fetch(path, { method: 'POST', headers: authenticated, body }); assert.equal(response.status, 201);
    const receipt = ScriptExportReceiptSchema.parse(await response.json());
    const replay = await fetch(path, { method: 'POST', headers: authenticated, body }); assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), receipt);
    const download = await fetch(`${path}/${receipt.filename}`, { headers: { Origin: origin, Cookie: cookie } }); assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition') ?? '', /attachment;.*\.fountain/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), readFileSync(join(f.directory, receipt.relativePath)));
    assert.equal((await fetch(path, { method: 'POST', headers: { ...authenticated, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ commitIndex: f.cut(), path: '../injected' }) })).status, 422);
    assert.equal((await fetch(path, { method: 'POST', headers: authenticated, body: JSON.stringify({ commitIndex: 0 }) })).status, 409);
  } finally { await server.close(); f.close(); }
});
