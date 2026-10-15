import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { loadCatalog, readDossier, exportDossier } from '../src/adapters/catalog.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createHostRequestBarrier } from '../src/application/host-request-barrier.ts';
import { createProductionHost, type ProductionHost } from '../src/server/production-host.ts';
import { createLocalHttpServer, type LocalHttpServer } from '../src/server/http.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { BackupJobSchema, RestorePreviewSchema } from '../src/domain/backup.ts';
import { BackupExportViewSchema, BackupImportViewSchema, backupImportEtag, backupRegistrationEtag } from '../src/domain/backup-transfer.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { ForkJobViewSchema, forkSourceEtag } from '../src/domain/fork-http.ts';
import { RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { validateFrozenDossierSource, readPreparedDossierSource } from '../src/application/dossier-source-repository.ts';
import { compilePrivateActorPrompt } from '../src/application/prepare-character.ts';
import { createActorWorldProjectionPort } from '../src/application/actor-world-projection.ts';
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

// Synthetic documentary data, admitted through the real exchange + journal boundary.
async function seedSource(f: Awaited<ReturnType<typeof hostFixture>>) {
 const {kind,schemaVersion,runId,revision,...patch}=RunConfigurationDraftSchema.parse(JSON.parse(JSON.stringify(draftFixture()).replaceAll('personaje-prueba','maxwell-smart')));void kind;void schemaVersion;void runId;void revision;
 assert.ok(patch.roster.kind==='configured');const actor=patch.roster.value.preparedCharacters[0];assert.ok(actor);
 const original=await readDossier({catalog:await loadCatalog({repositoryRoot:process.cwd()}),characterId:actor.characterId});
 const dossier={...original,aliases:[...original.aliases,'PORTABLE_DOCUMENTARY_SECRET_NOT_ACTOR'],performers:['PORTABLE_PERFORMER_NOT_ACTOR']};
 const exchange=f.production.exchange.dossiers;
  const imported=exchange.quarantine('origin-owner',randomUUID(),{kind:'dossier',fileName:'synthetic.json',contentBase64:Buffer.from(exportDossier(dossier)).toString('base64')});
  const preview=exchange.preview('origin-owner',imported.importId);const applied=exchange.apply('origin-owner',{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash});
  const saved=exchange.readAdaptation({principalId:'origin-owner',adaptationId:applied.adaptationId});
  const source=validateFrozenDossierSource({kind:'saved-adaptation',characterId:saved.characterId,revision:saved.revision,contentHash:saved.contentHash,fullArchiveHash:saved.archiveHash,importedArchiveHash:saved.importedArchiveHash,importId:saved.importId,adaptationId:saved.adaptationId,frozenDossier:saved.adaptation.importedDossier});
  const section=<T extends {provenance:{dossierRevision:number;dossierHash:string}}>(value:T)=>({...value,provenance:{...value.provenance,dossierRevision:source.revision,dossierHash:source.contentHash}});
  const prepared=PreparedCharacterSchema.parse({...actor,dossierSource:source,dossierRevision:source.revision,dossierHash:source.contentHash,
   identity:section(actor.identity),voice:section(actor.voice),antecedents:{...section(actor.antecedents),value:actor.antecedents.value.map(section)},goals:section(actor.goals),relationships:section(actor.relationships),capabilities:section(actor.capabilities),inventory:section(actor.inventory),initialExperience:section(actor.initialExperience),unknownPolicy:section(actor.unknownPolicy)});
  patch.roster.value={...patch.roster.value,preparedCharacters:[prepared]};
  const created=f.production.host.journal.createRunConfigurationDraft({principalId:'origin-owner',idempotencyKey:randomUUID(),patch});assert.ok(created.kind==='created');
  const ready=f.production.host.journal.validateRunConfigurationDraft({principalId:'origin-owner',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:0});assert.ok(ready.kind==='ready');
  const world=f.production.host.journal.loadWorld({runId:ready.runId});assert.ok(world);
  return {source,world};
}

async function waitFork(f:Awaited<ReturnType<typeof hostFixture>>,initial:unknown){
 let job=ForkJobViewSchema.parse(initial);const deadline=Date.now()+30_000;
 while(job.state==='staging'){assert.ok(Date.now()<deadline,JSON.stringify(job));await new Promise<void>(done=>setTimeout(done,10));job=ForkJobViewSchema.parse(await(await f.request(`/api/v1/forks/${job.operationId}`)).json());}
 assert.equal(job.state,'ready',JSON.stringify(job));return job;
}

test('admitted adaptation survives published historical fork and full archive foreign-host restore without source catalogue or import authority', {timeout:120_000,skip:binaryPath===undefined?'ICM real no configurado':false}, async()=>{
 const a=await hostFixture();const b=await hostFixture();
 try{
  const seeded=await seedSource(a);const cut={runId:seeded.world.runId,commitIndex:0,worldRevision:seeded.world.revision,worldSeq:seeded.world.seq};
  // The live parent advances after the selected cut; the fork must read history.
  a.production.host.journal.setWorldLifecycle({runId:cut.runId,expectedWorldRevision:cut.worldRevision,expectedConfigRevision:0,target:'running'});
  assert.equal(a.production.host.journal.applyCircumstanceCommand({runId:cut.runId,principalId:'origin-owner',idempotencyKey:randomUUID(),operationId:randomUUID(),expectedWorldRevision:cut.worldRevision,expectedDirectionRevision:0,payload:{kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:'sala',level:'dim'}}}).kind,'stored');
  assert.ok((a.production.host.journal.loadWorld({runId:cut.runId})?.revision??0)>cut.worldRevision);
  const {runId:_run,...bodyCut}=cut;void _run;
  const response=await a.request(`/api/v1/runs/${cut.runId}/forks`,{operationId:randomUUID(),...bodyCut,name:'Historical source test',reason:'Verify exact admitted research snapshot.'},{'If-Match':forkSourceEtag(cut)});
  assert.equal(response.status,202,await response.clone().text());const local=await waitFork(a,await response.json());
  const localConfiguration=ReadyRunConfigurationSchema.parse(a.production.host.journal.readWorldConfiguration({runId:local.targetRunId}));
  assert.deepEqual(localConfiguration.roster.preparedCharacters[0]?.dossierSource,seeded.source);
  assert.equal(localConfiguration.worldSnapshot.places[0]?.lighting,'normal');
  assert.equal(a.production.host.journal.loadWorld({runId:cut.runId})?.places[0]?.lighting,'dim');
  const backup=await a.backup();const exported=await a.request('/api/v1/backup-exports',{backupId:backup.manifest.backupId});assert.equal(exported.status,202,await exported.clone().text());
  let exp=BackupExportViewSchema.parse(await exported.json());const deadline=Date.now()+30_000;
  while(exp.state==='queued'||exp.state==='running'){assert.ok(Date.now()<deadline);await new Promise<void>(done=>setTimeout(done,10));exp=BackupExportViewSchema.parse(await(await a.request(`/api/v1/backup-exports/${exp.exportId}`)).json());}
  assert.ok(exp.state==='succeeded');const download=await a.request(`/api/v1/backup-exports/${exp.exportId}/download`);assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());assert.equal(digest(bytes),exp.sha256);
  await a.close();assert.equal(existsSync(a.root),false);
  const begun=await b.request('/api/v1/backup-imports',{fileName:'source.pba',bytes:bytes.length});assert.equal(begun.status,201,await begun.clone().text());let imported=BackupImportViewSchema.parse(await begun.json());
  for(let offset=0;offset<bytes.length;){const part=bytes.subarray(offset,Math.min(offset+1024*1024,bytes.length));const stored=await b.request(`/api/v1/backup-imports/${imported.importId}/parts`,{offset,contentBase64:part.toString('base64'),sha256:digest(part)},{'If-Match':backupImportEtag(imported)},'PUT');assert.equal(stored.status,200,await stored.clone().text());imported=BackupImportViewSchema.parse(await stored.json());offset+=part.length;}
  const finalized=await b.request(`/api/v1/backup-imports/${imported.importId}/finalize`,{},{'If-Match':backupImportEtag(imported)});assert.equal(finalized.status,202,await finalized.clone().text());await b.production.transfers.waitForIdle();
  imported=BackupImportViewSchema.parse(await(await b.request(`/api/v1/backup-imports/${imported.importId}`)).json());assert.ok(imported.state==='registered');const registration=imported.registration;
  const frozen=b.production.transfers.readRegisteredSource({principalId:'local-operator',registrationId:registration.registrationId,runId:local.targetRunId});assert.deepEqual(frozen.configuration.roster.preparedCharacters[0]?.dossierSource,seeded.source);
  await b.restart();const base=`/api/v1/backup-registrations/${registration.registrationId}`;
  const previewResponse=await b.request(base+'/restore-preview',{mode:'fork',sourceRunId:local.targetRunId,name:'Restored portable source',reason:'Independent foreign host.'});assert.equal(previewResponse.status,200,await previewResponse.clone().text());const preview=RestorePreviewSchema.parse(await previewResponse.json());assert.deepEqual(preview.blockers,[]);
  const confirmed=await b.request(base+'/restore',{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash},{'If-Match':backupRegistrationEtag(registration)});assert.equal(confirmed.status,202,await confirmed.clone().text());const target=await waitFork(b,await confirmed.json());
  const configuration=ReadyRunConfigurationSchema.parse(b.production.host.journal.readWorldConfiguration({runId:target.targetRunId}));const actor=configuration.roster.preparedCharacters[0];assert.ok(actor);assert.deepEqual(readPreparedDossierSource(actor),{kind:'found',source:seeded.source});
  assert.equal(configuration.worldSnapshot.places[0]?.lighting,'normal');
  // Foreign IDs are provenance only: they have no matching adaptation row on this host.
  assert.throws(()=>b.production.exchange.dossiers.readSavedAdaptation({principalId:'local-operator',importId:seeded.source.kind==='saved-adaptation'?seeded.source.importId:randomUUID()}),/NOT_FOUND/);
  const world=b.production.host.journal.loadWorld({runId:target.targetRunId});assert.ok(world);
  const port=createActorWorldProjectionPort({host:{loadActorWorldCut:async request=>b.production.host.journal.loadActorWorldCut(request),compareAndSwapActorKnowledge:async request=>b.production.host.journal.compareAndSwapActorKnowledge(request)},ids:{eventId:randomUUID,perceptionId:randomUUID,experienceId:randomUUID,offerId:randomUUID,entityHandle:randomUUID,placeHandle:randomUUID,channelHandle:randomUUID,offerHandle:randomUUID}});
  const prompt=await compilePrivateActorPrompt({prepared:actor,runId:world.runId,worldRevision:world.revision,throughWorldSeq:world.seq,fictionalAt:world.clock.instant,spanishVariety:configuration.spanishVariety,experiences:[],actorWorldProjectionPort:port});
  assert.doesNotMatch(prompt.text,/PORTABLE_DOCUMENTARY_SECRET|PORTABLE_PERFORMER|frozenDossier|dossierSource/);
  const memory=new DatabaseSync(join(b.root,'runs',target.targetRunId,'actors',actor.characterId,'memory.sqlite'),{readOnly:true});try{assert.equal(memory.prepare('SELECT count(*) n FROM memories').get()?.n,0);}finally{memory.close();}
  const preserved=b.production.transfers.resolveRegistration({principalId:'local-operator',registrationId:registration.registrationId});for(const file of preserved.manifest.files)assert.equal(digest(readFileSync(join(preserved.bundleRoot,file.path))),file.sha256);
 }finally{await a.close();await b.close();}
});
