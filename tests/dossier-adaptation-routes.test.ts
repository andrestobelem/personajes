import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {loadCatalog,readDossier,exportDossier} from '../src/adapters/catalog.ts';
import {openDossierExchange} from '../src/application/dossier-exchange.ts';
import {openBackupService} from '../src/application/backup-service.ts';
import {createExchangeRoutes} from '../src/server/exchange-routes.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {SessionCreatedSchema,ApiProblemSchema} from '../src/domain/http.ts';
import {DossierAdaptationReadSchema,DossierAdaptationPageSchema} from '../src/domain/dossier-exchange.ts';
import {exchangeIntegrity} from '../src/adapters/exchange-integrity.ts';

async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'personajes-adaptation-http-'));const journalPath=join(directory,'world.sqlite');const catalog=await loadCatalog({repositoryRoot:process.cwd()});
 const max=await readDossier({catalog,characterId:'maxwell-smart'});const otherEntry=catalog.manifest.characters.find(entry=>entry.characterId!==max.characterId);assert.ok(otherEntry);const other=await readDossier({catalog,characterId:otherEntry.characterId});const sources=new Map([[max.characterId,max],[other.characterId,other]]);let catalogCalls=0,catalogAvailable=true;
 const dossiers=openDossierExchange({journalPath,getDossier(id){catalogCalls++;if(!catalogAvailable)throw new Error('CATALOG_MUST_NOT_BE_READ');const original=[...sources.values()].find(dossier=>dossier.characterId===id);if(original===undefined)throw new Error('DOSSIER_NOT_FOUND');return original;}});const backups=openBackupService({privateDataRoot:directory});const routes=createExchangeRoutes({journalPath,dossiers,backups});
 function save(principalId:string,characterId:string,fileName:string){const dossier=[...sources.values()].find(value=>value.characterId===characterId);assert.ok(dossier);const imported=dossiers.quarantine(principalId,randomUUID(),{kind:'dossier',fileName,contentBase64:Buffer.from(exportDossier(dossier)).toString('base64')});const preview=dossiers.preview(principalId,imported.importId);const adaptation=dossiers.apply(principalId,{importId:imported.importId,previewToken:preview.previewToken,confirmDiffHash:preview.diffHash});return dossiers.readAdaptation({principalId,adaptationId:adaptation.adaptationId});}
 const owned=[save('local-operator',max.characterId,'max-a.json'),save('local-operator',max.characterId,'max-b.json'),save('local-operator',max.characterId,'max-c.json')];const foreign=save('another-operator',max.characterId,'foreign.json');const otherActor=save('local-operator',other.characterId,'99.json');
 const server=createLocalHttpServer({catalog,shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[routes]});const {origin}=await server.listen();const security={Origin:origin,'Content-Type':'application/json'};
 const html=await(await fetch(origin+'/',{headers:security})).text();const bootNonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);const response=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const headers={...security,Cookie:cookie};
 const observer=new DatabaseSync(journalPath,{readOnly:true});
 return {directory,journalPath,dossiers,routes,origin,headers,owned,foreign,otherActor,observer,get catalogCalls(){return catalogCalls;},disableCatalog(){catalogAvailable=false;},async close(){observer.close();await server.close();routes.close();backups.close();dossiers.close();rmSync(directory,{recursive:true,force:true});}};
}

test('adaptation reads are principal-scoped, exact and readonly without catalog fallback',async()=>{
 const f=await fixture();try{
  f.disableCatalog();const calls=f.catalogCalls;const version=f.observer.prepare('PRAGMA data_version').get()?.data_version;
  const stored=f.owned[0];assert.ok(stored);const url=`${f.origin}/api/v1/dossier-adaptations/${stored.adaptationId}`;
  assert.equal((await fetch(url)).status,401);const read=await fetch(url,{headers:f.headers});assert.equal(read.status,200,await read.clone().text());const materialized=DossierAdaptationReadSchema.parse(await read.json());assert.deepEqual(materialized,stored);assert.equal(read.headers.get('etag'),`"dossier-adaptation:${stored.adaptationId}:${stored.archiveHash}"`);
  assert.equal(materialized.archiveHash,createHash('sha256').update(exportDossier(materialized.adaptation.importedDossier)).digest('hex'));
  const missing=await fetch(`${f.origin}/api/v1/dossier-adaptations/${randomUUID()}`,{headers:f.headers});const foreign=await fetch(`${f.origin}/api/v1/dossier-adaptations/${f.foreign.adaptationId}`,{headers:f.headers});assert.equal(missing.status,404);assert.equal(foreign.status,404);assert.deepEqual(ApiProblemSchema.parse(await missing.json()).error,ApiProblemSchema.parse(await foreign.json()).error);
  const seen:string[]=[];let cursor:string|null=null;
  do{const pageResponse:Response=await fetch(`${f.origin}/api/v1/dossier-adaptations?characterId=${stored.characterId}&limit=1${cursor===null?'':'&cursor='+encodeURIComponent(cursor)}`,{headers:f.headers});assert.equal(pageResponse.status,200,await pageResponse.clone().text());const page=DossierAdaptationPageSchema.parse(await pageResponse.json());assert.equal(page.adaptations.length,1);seen.push(...page.adaptations.map(item=>item.adaptationId));cursor=page.nextCursor;}while(cursor!==null);
  assert.deepEqual(seen.toSorted(),f.owned.map(value=>value.adaptationId).toSorted());assert.equal(new Set(seen).size,3);assert.equal(seen.includes(f.foreign.adaptationId),false);assert.equal(seen.includes(f.otherActor.adaptationId),false);
  assert.equal(f.catalogCalls,calls);assert.equal(f.observer.prepare('PRAGMA data_version').get()?.data_version,version,'GET must not change any database page');assert.equal(f.observer.prepare('SELECT COUNT(*) n FROM exchange_http_operations').get()?.n,0,'reads do not reserve mutation receipts');
 }finally{await f.close();}
});

test('adaptation HTTP rejects malformed UUID, limit, cursor, duplicate or injected query authority without reading foreign data',async()=>{
 const f=await fixture();try{
  f.disableCatalog();const before=f.catalogCalls;const base=`${f.origin}/api/v1/dossier-adaptations`;const character=f.owned[0]?.characterId;assert.ok(character);
  for(const path of ['/not-a-uuid','?characterId='+character+'&limit=0','?characterId='+character+'&limit=101','?characterId='+character+'&limit=1e2','?characterId='+character+'&cursor=not-valid-json','?characterId='+character+'&cursor='+('a'.repeat(4001)),'?characterId='+character+'&characterId=agent-99','?characterId='+character+'&principalId=another-operator','?characterId='+character+'&__proto__=polluted','?limit=1']){const response=await fetch(base+path,{headers:f.headers});assert.equal(response.status,422,path);assert.equal(ApiProblemSchema.parse(await response.json()).error.code,'ADAPTATION_REQUEST_INVALID');}
  const first=await fetch(base+'?characterId='+character+'&limit=1',{headers:f.headers});const page=DossierAdaptationPageSchema.parse(await first.json());assert.ok(page.nextCursor);
  const wrongScope=await fetch(base+'?characterId='+f.otherActor.characterId+'&cursor='+encodeURIComponent(page.nextCursor),{headers:f.headers});assert.equal(wrongScope.status,422);
  const unexpectedReadQuery=await fetch(base+'/'+f.owned[0]?.adaptationId+'?characterId='+character,{headers:f.headers});assert.equal(unexpectedReadQuery.status,422);
  assert.equal(f.catalogCalls,before);assert.equal(f.observer.prepare('SELECT COUNT(*) n FROM exchange_http_operations').get()?.n,0);
 }finally{await f.close();}
});

test('adaptation HTTP fails closed on a damaged saved envelope rather than substituting a catalog dossier',async()=>{
 const f=await fixture();try{
  const stored=f.owned[0];assert.ok(stored);const writer=new DatabaseSync(f.journalPath);writer.prepare('UPDATE exchange_dossier_adaptations SET adaptation_json=? WHERE import_id=?').run('{}',stored.importId);writer.close();f.disableCatalog();const calls=f.catalogCalls;
  const response=await fetch(`${f.origin}/api/v1/dossier-adaptations/${stored.adaptationId}`,{headers:f.headers});assert.equal(response.status,409);assert.equal(ApiProblemSchema.parse(await response.json()).error.code,'EXCHANGE_METADATA_TAMPERED');assert.equal(f.catalogCalls,calls);
  // The reader must never reseal or repair damaged data on GET.
  assert.throws(()=>exchangeIntegrity(f.observer).verify('exchange_dossier_adaptations','import_id=?',[stored.importId]),/EXCHANGE_METADATA_TAMPERED/);
 }finally{await f.close();}
});
