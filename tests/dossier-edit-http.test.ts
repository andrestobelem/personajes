import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {loadCatalog,readDossier} from '../src/adapters/catalog.ts';
import {openDossierExchange} from '../src/application/dossier-exchange.ts';
import {freezeCatalogDossierSource} from '../src/application/dossier-source-repository.ts';
import {openBackupService} from '../src/application/backup-service.ts';
import {createExchangeRoutes} from '../src/server/exchange-routes.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {DossierImportPreviewSchema} from '../src/domain/dossier-exchange.ts';
import {SessionCreatedSchema} from '../src/domain/http.ts';
import {exchangeIntegrity} from '../src/adapters/exchange-integrity.ts';

test('editor real HTTP enforces authority and confirmation, durably replays before source lookup after restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-editor-http-'));const journalPath=join(directory,'world.sqlite');const catalog=await loadCatalog({repositoryRoot:process.cwd()});let original=await readDossier({catalog,characterId:'maxwell-smart'});
 const dossiers=openDossierExchange({journalPath,getDossier:()=>original});const backups=openBackupService({privateDataRoot:directory});let routes=createExchangeRoutes({journalPath,dossiers,backups});
 const server=createLocalHttpServer({catalog,shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[{name:'proxy',matches:r=>routes.matches(r),handle:r=>routes.handle(r)}]});const {origin}=await server.listen();
 try{
  const security={Origin:origin,'Content-Type':'application/json'};const html=await(await fetch(origin+'/',{headers:security})).text();const bootNonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);const session=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});const cookie=session.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const sessionData=SessionCreatedSchema.parse(await session.json());const headers={...security,Cookie:cookie,'X-CSRF-Token':sessionData.csrfToken};const source=freezeCatalogDossierSource(original);const {frozenDossier:_f,...reference}=source;void _f;
  const fields={displayName:original.displayName,aliases:['HTTP'],performers:original.performers,markdown:original.markdown,sourceRefs:original.sourceRefs,unknowns:original.unknowns,contradictions:original.contradictions,avatarRef:original.avatarRef,voiceRecipe:original.voiceRecipe};const body={source:reference,fields,reason:'HTTP review'};
  const post=(path:string,data:unknown,key=randomUUID(),extra:Record<string,string>={})=>fetch(origin+'/api/v1/'+path,{method:'POST',headers:{...headers,'Idempotency-Key':key,...extra},body:JSON.stringify(data)});
  assert.equal((await fetch(origin+'/api/v1/dossier-edits/preview',{method:'POST',headers:security,body:JSON.stringify(body)})).status,401);
  assert.equal((await post('dossier-edits/preview',body,randomUUID(),{Origin:'https://foreign.invalid'})).status,403);
  const previewKey=randomUUID();const response=await post('dossier-edits/preview',body,previewKey);assert.equal(response.status,201,await response.clone().text());const p=DossierImportPreviewSchema.parse(await response.json());
  const applyBody={importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash};assert.equal((await post('dossier-edits/apply',applyBody)).status,412);
  const applyKey=randomUUID();const applied=await post('dossier-edits/apply',applyBody,applyKey,{'If-Match':response.headers.get('etag')??''});assert.equal(applied.status,201,await applied.clone().text());const saved:unknown=await applied.json();
  original={...original,aliases:['changed-current']};assert.deepEqual(await(await post('dossier-edits/preview',body,previewKey)).json(),p);assert.deepEqual(await(await post('dossier-edits/apply',applyBody,applyKey)).json(),saved);
  // Simulate effect committed but HTTP response persistence interrupted; only sealed intent survives.
  const db=new DatabaseSync(journalPath);db.prepare('UPDATE exchange_http_operations SET response_json=NULL WHERE principal_id=? AND operation_id=?').run('local-operator',applyKey);exchangeIntegrity(db).seal('exchange_http_operations','principal_id=? AND operation_id=?',['local-operator',applyKey]);db.close();routes.close();routes=createExchangeRoutes({journalPath,dossiers,backups});
  const replay=await post('dossier-edits/apply',applyBody,applyKey);assert.equal(replay.status,201,await replay.clone().text());assert.deepEqual(await replay.json(),saved);assert.equal((await post('dossier-edits/preview',{...body,reason:'changed'},previewKey)).status,409);
  assert.equal((await post('dossier-edits/preview/extra',body)).status,404);assert.equal((await post('dossier-edits/preview?principalId=foreign',body)).status,409);
 }finally{await server.close();routes.close();backups.close();dossiers.close();rmSync(directory,{recursive:true,force:true});}
});
