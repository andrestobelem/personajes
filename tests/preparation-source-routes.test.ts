import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
import {DossierSourceSchema} from '../src/domain/dossier-source.ts';
import {validateFrozenDossierSource} from '../src/application/dossier-source-repository.ts';

async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'personajes-adaptation-http-'));const journalPath=join(directory,'world.sqlite');const catalog=await loadCatalog({repositoryRoot:process.cwd()});
 const max=await readDossier({catalog,characterId:'maxwell-smart'});const otherEntry=catalog.manifest.characters.find(entry=>entry.characterId!==max.characterId);assert.ok(otherEntry);const other=await readDossier({catalog,characterId:otherEntry.characterId});const sources=new Map([[max.characterId,max],[other.characterId,other]]);let catalogCalls=0,catalogAvailable=true;
 const dossiers=openDossierExchange({journalPath,getDossier(id){catalogCalls++;if(!catalogAvailable)throw new Error('CATALOG_MUST_NOT_BE_READ');const original=[...sources.values()].find(dossier=>dossier.characterId===id);if(original===undefined)throw new Error('DOSSIER_NOT_FOUND');return original;}});const backups=openBackupService({privateDataRoot:directory});const routes=createExchangeRoutes({journalPath,dossiers,backups,readCatalogDossier(id){catalogCalls++;if(!catalogAvailable)throw new Error('CATALOG_UNAVAILABLE');const dossier=[...sources.values()].find(value=>value.characterId===id);if(!dossier)throw new Error('DOSSIER_NOT_FOUND');return dossier;}});
 function save(principalId:string,characterId:string,fileName:string){const dossier=[...sources.values()].find(value=>value.characterId===characterId);assert.ok(dossier);const imported=dossiers.quarantine(principalId,randomUUID(),{kind:'dossier',fileName,contentBase64:Buffer.from(exportDossier(dossier)).toString('base64')});const preview=dossiers.preview(principalId,imported.importId);const adaptation=dossiers.apply(principalId,{importId:imported.importId,previewToken:preview.previewToken,confirmDiffHash:preview.diffHash});return dossiers.readAdaptation({principalId,adaptationId:adaptation.adaptationId});}
 const owned=[save('local-operator',max.characterId,'max-a.json'),save('local-operator',max.characterId,'max-b.json'),save('local-operator',max.characterId,'max-c.json')];const foreign=save('another-operator',max.characterId,'foreign.json');const otherActor=save('local-operator',other.characterId,'99.json');
 const server=createLocalHttpServer({catalog,shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[routes]});const {origin}=await server.listen();const security={Origin:origin,'Content-Type':'application/json'};
 const html=await(await fetch(origin+'/',{headers:security})).text();const bootNonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);const response=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const headers={...security,Cookie:cookie};
 const observer=new DatabaseSync(journalPath,{readOnly:true});
 return {directory,journalPath,dossiers,routes,origin,headers,owned,foreign,otherActor,observer,get catalogCalls(){return catalogCalls;},disableCatalog(){catalogAvailable=false;},async close(){observer.close();await server.close();routes.close();backups.close();dossiers.close();rmSync(directory,{recursive:true,force:true});}};
}


test('preparation sources return exact frozen catalog and owned adaptations without writes or catalog substitution',async()=>{
 const f=await fixture();try{
  const stored=f.owned[0];assert.ok(stored);const base=f.origin+'/api/v1/preparation-sources/';
  assert.equal((await fetch(base+'catalog/'+stored.characterId)).status,401);
  const version=f.observer.prepare('PRAGMA data_version').get()?.data_version;
  const originalResponse=await fetch(base+'catalog/'+stored.characterId,{headers:f.headers});assert.equal(originalResponse.status,200);
  const original=validateFrozenDossierSource(await originalResponse.json());assert.equal(original.kind,'catalog-original');assert.equal(original.characterId,stored.characterId);
  assert.equal(originalResponse.headers.get('etag'),`"preparation-source:${original.fullArchiveHash}"`);
  f.disableCatalog();const before=f.catalogCalls;
  const response=await fetch(base+'adaptations/'+stored.adaptationId,{headers:f.headers});assert.equal(response.status,200,await response.clone().text());
  const source=DossierSourceSchema.parse(await response.json());assert.equal(source.kind,'saved-adaptation');assert.deepEqual(validateFrozenDossierSource(source),source);
  if(source.kind!=='saved-adaptation')throw new Error('Expected adaptation');
  assert.equal(source.importId,stored.importId);assert.equal(source.adaptationId,stored.adaptationId);assert.equal(source.fullArchiveHash,stored.archiveHash);assert.equal(source.importedArchiveHash,stored.importedArchiveHash);assert.deepEqual(source.frozenDossier,stored.adaptation.importedDossier);
  assert.equal(response.headers.get('etag'),`"preparation-source:${stored.archiveHash}"`);
  const foreign=await fetch(base+'adaptations/'+f.foreign.adaptationId,{headers:f.headers});const missing=await fetch(base+'adaptations/'+randomUUID(),{headers:f.headers});assert.equal(foreign.status,404);assert.equal(missing.status,404);assert.deepEqual(ApiProblemSchema.parse(await foreign.json()).error,ApiProblemSchema.parse(await missing.json()).error);
  assert.equal(f.catalogCalls,before);assert.equal(f.observer.prepare('PRAGMA data_version').get()?.data_version,version);assert.equal(f.observer.prepare('SELECT COUNT(*) n FROM exchange_http_operations').get()?.n,0);
 }finally{await f.close();}
});

test('preparation source endpoints reject malformed selection, queries and damaged saved archives',async()=>{
 const f=await fixture();try{
  const stored=f.owned[0];assert.ok(stored);const base=f.origin+'/api/v1/preparation-sources';
  for(const path of ['', '/catalog','/catalog/invalid!','/catalog/'+stored.characterId+'/extra','/adaptations/not-uuid','/latest/'+stored.adaptationId,'/adaptations/'+stored.adaptationId+'?principalId=another-operator','/catalog/'+stored.characterId+'?unused=1&unused=2']){
   const response=await fetch(base+path,{headers:f.headers});assert.equal(response.status,422,path);assert.equal(ApiProblemSchema.parse(await response.json()).error.code,'PREPARATION_SOURCE_REQUEST_INVALID');
  }
  const writer=new DatabaseSync(f.journalPath);writer.prepare('UPDATE exchange_dossier_adaptations SET adaptation_json=? WHERE import_id=?').run('{}',stored.importId);writer.close();f.disableCatalog();const before=f.catalogCalls;
  const damaged=await fetch(base+'/adaptations/'+stored.adaptationId,{headers:f.headers});assert.equal(damaged.status,409);assert.equal(ApiProblemSchema.parse(await damaged.json()).error.code,'EXCHANGE_METADATA_TAMPERED');assert.equal(f.catalogCalls,before);
 }finally{await f.close();}
});
