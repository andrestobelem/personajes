import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog,readDossier,exportDossier } from '../src/adapters/catalog.ts';
import { openBackupService } from '../src/application/backup-service.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { createExchangeRoutes } from '../src/server/exchange-routes.ts';
import type { OperatorRequest } from '../src/server/operator-extension.ts';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';

test('exchange routes enforce preview target, ETag and durable replay; backup denies absent global fence',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const dossier=await readDossier({catalog,characterId:'maxwell-smart'});
 const root=mkdtempSync(join(tmpdir(),'personajes-exchange-http-'));const journalPath=join(root,'world.sqlite');
 const dossiers=openDossierExchange({journalPath,getDossier:()=>dossier});const backups=openBackupService({privateDataRoot:root});
 const routes=createExchangeRoutes({journalPath,dossiers,backups});
 function write(path:string[],body:unknown,ifMatch:string|null=null,operationId=randomUUID()):Extract<OperatorRequest,{kind:'write'}>{return {kind:'write',method:'POST',path,body,query:new URLSearchParams(),principalId:'operator',mode:{kind:'observer'},ifMatch,ifNoneMatch:null,idempotencyKey:operationId};}
 try {
  const imported=await routes.handle(write(['imports'],{kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(exportDossier(dossier)).toString('base64')}));assert.equal(imported.kind,'json');if(imported.kind!=='json')return;
  const id=z.object({importId:z.string()}).parse(imported.body).importId;
  const preview=await routes.handle(write(['imports',id,'preview'],{}));assert.equal(preview.kind,'json');if(preview.kind!=='json')return;
  const body=z.object({previewToken:z.string(),diffHash:z.string()}).parse(preview.body);const apply={previewToken:body.previewToken,confirmDiffHash:body.diffHash};
  const missing=await routes.handle(write(['imports',id,'apply'],apply));assert.equal(missing.kind,'problem');if(missing.kind==='problem')assert.equal(missing.status,412);
  const op=randomUUID();const request=write(['imports',id,'apply'],apply,`"import:${id}:r0"`,op);
  const applied=await routes.handle(request);assert.equal(applied.kind,'json');assert.deepEqual(await routes.handle(request),applied);
  const corruptor=new DatabaseSync(journalPath);
  try{corruptor.prepare('UPDATE exchange_http_operations SET response_json=? WHERE principal_id=? AND operation_id=?').run(JSON.stringify({kind:'json',status:200,body:{private:'injected'},headers:{}}),'operator',op);}finally{corruptor.close();}
  const tampered=await routes.handle(request);assert.equal(tampered.kind,'problem');if(tampered.kind==='problem')assert.equal(tampered.error.code,'EXCHANGE_METADATA_TAMPERED');
  const wrong=await routes.handle(write(['imports',randomUUID(),'apply'],apply,`"import:${id}:r0"`));assert.equal(wrong.kind,'problem');
  const backupId=randomUUID();const denied=await routes.handle({...write(['backups',backupId],{scope:{kind:'all'}}),method:'PUT',ifNoneMatch:'*'});
  assert.equal(denied.kind,'problem');if(denied.kind==='problem'){assert.equal(denied.status,503);assert.equal(denied.error.code,'BACKUP_QUIESCE_UNAVAILABLE');}
 }finally{routes.close();backups.close();dossiers.close();rmSync(root,{recursive:true,force:true});}
});
