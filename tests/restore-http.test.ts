import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test,type TestContext} from 'node:test';
import {loadCatalog,readDossier} from '../src/adapters/catalog.ts';
import {exchangeIntegrity} from '../src/adapters/exchange-integrity.ts';
import {openLocalHost} from '../src/application/local-host.ts';
import {createForkRuntime} from '../src/application/fork-runtime.ts';
import {createForkApplication} from '../src/application/fork-application.ts';
import {createBackupForkRestorePort} from '../src/application/backup-fork-restore.ts';
import {ForkJobViewSchema} from '../src/domain/fork-http.ts';
import {openBackupService} from '../src/application/backup-service.ts';
import {openDossierExchange} from '../src/application/dossier-exchange.ts';
import {createExchangeRoutes} from '../src/server/exchange-routes.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {SessionCreatedSchema} from '../src/domain/http.ts';
import {BackupJobSchema,RestorePreviewSchema} from '../src/domain/backup.ts';
import {BackupSourcesSchema} from '../src/domain/backup-http.ts';
import {draftFixture} from './fixtures/continuista.ts';

const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
async function setup(t:TestContext,withForkRuntime=false){
 const root=mkdtempSync(join(tmpdir(),'personajes-restore-http-'));const host=openLocalHost({privateDataRoot:root});
 const {kind,schemaVersion,runId,revision,...patch}=draftFixture();const created=host.journal.createRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),patch});assert.ok(created.kind==='created');
 const ready=host.journal.validateRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:0});assert.ok(ready.kind==='ready');
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const dossier=await readDossier({catalog,characterId:'maxwell-smart'});const journalPath=join(host.privateDataRoot,'world.sqlite');
 const dossiers=openDossierExchange({journalPath,getDossier:()=>dossier});
 // This isolated fixture has no workers or additional mutable artifacts.
 const runtime=withForkRuntime&&binaryPath!==undefined?createForkRuntime({host,binaryPath}):undefined;
 const backups=openBackupService({privateDataRoot:host.privateDataRoot,quiesce:{async acquire(){return {artifacts:[],release(){}};}}});
 backups.setRestorePort(createBackupForkRestorePort({host,...(runtime===undefined?{}:{runtime})}));
 const routes=createExchangeRoutes({journalPath,dossiers,backups});const server=createLocalHttpServer({catalog,shellHtml:'<!doctype html><html><head></head><body></body></html>',operatorExtensions:[routes],forks:createForkApplication({journal:host.journal,...(runtime===undefined?{}:{runtime})})});const {origin}=await server.listen();
 t.after(async()=>{await server.close();routes.close();await backups.waitForRestores();await runtime?.close();backups.close();dossiers.close();host.close();rmSync(root,{recursive:true,force:true});});
 const security={Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
 const shell=await fetch(origin+'/',{headers:security});const nonce=(await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(nonce);
 const sessionResponse=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce:nonce})});const session=SessionCreatedSchema.parse(await sessionResponse.json());const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const headers={...security,Cookie:cookie,'X-CSRF-Token':session.csrfToken};const backupId=randomUUID();
 const backupResponse=await fetch(`${origin}/api/v1/backups/${backupId}`,{method:'PUT',headers:{...headers,'Idempotency-Key':randomUUID(),'If-None-Match':'*'},body:JSON.stringify({scope:{kind:'all'}})});assert.equal(backupResponse.status,202);const job=BackupJobSchema.parse(await backupResponse.json());assert.equal(job.state,'succeeded');
 const etag=backupResponse.headers.get('etag');assert.ok(etag);
 const selection={mode:'fork',sourceRunId:ready.runId,name:'Desde el respaldo',reason:'Explorar consecuencias preservando el origen.'};
 const post=(action:string,body:unknown,key=randomUUID(),extra:Record<string,string>={})=>fetch(`${origin}/api/v1/backups/${backupId}/${action}`,{method:'POST',headers:{...headers,'Idempotency-Key':key,'If-Match':etag,...extra},body:JSON.stringify(body)});
 function interruptResponse(key:string){const db=new DatabaseSync(journalPath);try{db.prepare('UPDATE exchange_http_operations SET response_json=NULL WHERE principal_id=? AND operation_id=?').run('local-operator',key);exchangeIntegrity(db).seal('exchange_http_operations','principal_id=? AND operation_id=?',['local-operator',key]);}finally{db.close();}}
 return {root,host,runtime,backups,server,origin,headers,backupId,etag,selection,post,interruptResponse};
}

test('restore HTTP lists verified cuts without private artifacts and enforces session, CSRF, strict selection and confirmation',async(t)=>{
 const f=await setup(t);const url=`${f.origin}/api/v1/backups/${f.backupId}/sources`;
 assert.equal((await fetch(url)).status,401);const read=await fetch(url,{headers:f.headers});assert.equal(read.status,200);const sources=BackupSourcesSchema.parse(await read.json());assert.equal(sources.sources.length,1);assert.equal(sources.sources[0]?.runId,f.selection.sourceRunId);assert.equal('bundleRoot' in sources,false);assert.equal('files' in sources,false);
 assert.equal((await f.post('restore-preview',f.selection,randomUUID(),{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await f.post('restore-preview',f.selection,randomUUID(),{Cookie:''})).status,401);
 for(const field of ['principalId','operationId','bundleRoot','intent','package','receipts','artifacts'])assert.equal((await f.post('restore-preview',{...f.selection,[field]:'untrusted'})).status,409,field);
 assert.equal((await f.post('restore-preview',{mode:'fork'})).status,409);
 const previewResponse=await f.post('restore-preview',f.selection);assert.equal(previewResponse.status,200);const preview=RestorePreviewSchema.parse(await previewResponse.json());assert.equal(preview.sourceRunId,f.selection.sourceRunId);assert.ok(preview.operationId);assert.equal('intent' in preview,false);assert.equal('principalId' in preview,false);
 const apply={previewToken:preview.previewToken,confirmDiffHash:preview.diffHash};
 assert.equal((await f.post('restore',apply,randomUUID(),{'If-Match':'*'})).status,412);
 assert.equal((await f.post('restore',{...apply,principalId:'forged'})).status,409);
 assert.equal((await f.post('restore',{...apply,confirmDiffHash:'0'.repeat(64)})).status,409);
 assert.equal((await f.post('restore',apply)).status,503,'runtime absent remains an explicit dependency failure');
 const foreign=f.backups.preview({backupId:f.backupId,principalId:'another-operator',...f.selection});assert.equal((await f.post('restore',{previewToken:foreign.previewToken,confirmDiffHash:foreign.diffHash})).status,404);
 writeFileSync(join(f.host.privateDataRoot,'backups',f.backupId,'manifest.json'),'{}');assert.equal((await fetch(url,{headers:f.headers})).status,409,'sources are verified, not read from untrusted manifest metadata');
});

test('restore-preview recovers a missing HTTP receipt with the same durable token and operation',async(t)=>{
 const f=await setup(t);const key=randomUUID();const response=await f.post('restore-preview',f.selection,key);assert.equal(response.status,200);const first=RestorePreviewSchema.parse(await response.json());
 f.interruptResponse(key);const resumed=await f.post('restore-preview',f.selection,key);assert.equal(resumed.status,200);assert.deepEqual(await resumed.json(),first);
 const changed=await f.post('restore-preview',{...f.selection,name:'Otra selección'},key);assert.equal(changed.status,409);
 const recover=await f.post('restore-preview',{mode:'recover'});assert.equal(recover.status,200);const blocked=RestorePreviewSchema.parse(await recover.json());assert.ok(blocked.blockers.includes('RESTORE_OFFLINE_OWNERSHIP_UNAVAILABLE'));
 assert.equal((await f.post('restore',{previewToken:blocked.previewToken,confirmDiffHash:blocked.diffHash})).status,503);
 const exportKey=randomUUID();const exportRequest=()=>fetch(f.origin+'/api/v1/exports',{method:'POST',headers:{...f.headers,'Idempotency-Key':exportKey},body:JSON.stringify({kind:'dossier',characterId:'maxwell-smart'})});
 assert.equal((await exportRequest()).status,201);f.interruptResponse(exportKey);const interrupted=await exportRequest();assert.equal(interrupted.status,409);assert.match(await interrupted.text(),/EXCHANGE_OPERATION_INTERRUPTED/,'resume is restricted to restore intents');
});


test('restore HTTP forks a verified backup through real ICM after the live source diverges and resumes an interrupted response', {skip:binaryPath===undefined?'ICM real no configurado':false},async(t)=>{
 const f=await setup(t,true);assert.ok(f.runtime);
 const parent=f.host.journal.loadWorld({runId:f.selection.sourceRunId});assert.ok(parent);const place=parent.places[0];assert.ok(place);
 f.host.journal.setWorldLifecycle({runId:parent.runId,expectedWorldRevision:parent.revision,expectedConfigRevision:0,target:'running'});
 const changed=f.host.journal.applyCircumstanceCommand({runId:parent.runId,principalId:'local-operator',idempotencyKey:randomUUID(),operationId:randomUUID(),expectedWorldRevision:parent.revision,expectedDirectionRevision:0,payload:{kind:'changeCircumstance',scope:{kind:'run'},operation:{kind:'setLighting',placeId:place.id,level:place.lighting==='dim'?'normal':'dim'}}});assert.equal(changed.kind,'stored');
 const live=f.host.journal.loadWorld({runId:parent.runId});assert.ok(live);assert.ok(live.revision>parent.revision);assert.ok(live.seq>parent.seq);
 const previewResponse=await f.post('restore-preview',f.selection);assert.equal(previewResponse.status,200,await previewResponse.clone().text());const preview=RestorePreviewSchema.parse(await previewResponse.json());assert.deepEqual(preview.blockers,[]);assert.ok(preview.operationId);
 const key=randomUUID();const apply={previewToken:preview.previewToken,confirmDiffHash:preview.diffHash};const accepted=await f.post('restore',apply,key);assert.equal(accepted.status,202,await accepted.clone().text());const staging=ForkJobViewSchema.parse(await accepted.json());assert.equal(staging.operationId,preview.operationId);assert.equal(staging.state,'staging');assert.equal(staging.source.worldRevision,parent.revision);assert.equal(staging.source.worldSeq,parent.seq);assert.equal(accepted.headers.get('location'),`/api/v1/forks/${staging.operationId}`);assert.equal(accepted.headers.get('etag'),`"fork:${staging.operationId}:r${staging.revision}"`);
 await f.runtime.waitForIdle();const read=await fetch(`${f.origin}/api/v1/forks/${staging.operationId}`,{headers:f.headers});assert.equal(read.status,200);const ready=ForkJobViewSchema.parse(await read.json());assert.equal(ready.state,'ready');assert.equal(ready.targetRunId,staging.targetRunId);
 const target=f.host.journal.loadWorld({runId:ready.targetRunId});assert.ok(target);assert.equal(target.seq,parent.seq);assert.equal(target.places[0]?.lighting,parent.places[0]?.lighting);assert.deepEqual(f.host.journal.loadWorld({runId:parent.runId}),live);
 f.interruptResponse(key);const recovered=await f.post('restore',apply,key);assert.equal(recovered.status,202,await recovered.clone().text());assert.deepEqual(ForkJobViewSchema.parse(await recovered.json()),ready);
 const replay=await f.post('restore',apply,key);assert.equal(replay.status,202);assert.deepEqual(await replay.json(),ready);
 const crossResource=await fetch(`${f.origin}/api/v1/backups/${randomUUID()}/restore`,{method:'POST',headers:{...f.headers,'Idempotency-Key':randomUUID(),'If-Match':f.etag},body:JSON.stringify(apply)});assert.equal(crossResource.status,404);
 const db=new DatabaseSync(join(f.host.privateDataRoot,'world.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM world_runs').get()?.n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM fork_jobs').get()?.n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM actor_pi_sessions').get()?.n,0);}finally{db.close();}
 f.backups.verify(f.backupId);
});
