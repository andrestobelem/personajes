import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { loadCatalog,readDossier,exportDossier } from '../src/adapters/catalog.ts';
import { openLocalHost } from '../src/application/local-host.ts';
import { createExchangeRuntime } from '../src/application/exchange-runtime.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';

test('real HTTP exchange composes session/CSRF, dossier roundtrip and unavailable backup barrier',async()=>{
 const root=mkdtempSync(join(tmpdir(),'personajes-exchange-real-http-'));const host=openLocalHost({privateDataRoot:root});
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const runtime=await createExchangeRuntime({host,catalog});
 const server=createLocalHttpServer({catalog,shellHtml:'<!doctype html><html><head></head><body>Personajes</body></html>',operatorExtensions:[runtime.routes]});
 try {
  const {origin}=await server.listen(0);const security={'Origin':origin,'Sec-Fetch-Site':'same-origin'};
  const unauth=await fetch(origin+'/api/v1/imports/'+randomUUID());assert.equal(unauth.status,401);
  const html=await (await fetch(origin+'/',{headers:security})).text();const nonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]{43})"/)?.[1];assert.ok(nonce);
  const sessionResponse=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...security,'Content-Type':'application/json'},body:JSON.stringify({bootNonce:nonce})});
  assert.equal(sessionResponse.status,200);const session=SessionCreatedSchema.parse(await sessionResponse.json());const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const headers={...security,'Cookie':cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  const original=await readDossier({catalog,characterId:'maxwell-smart'});const archive=exportDossier(original);
  const body={kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(archive).toString('base64')};
  const noCsrf=await fetch(origin+'/api/v1/imports',{method:'POST',headers:{...security,'Cookie':cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});assert.equal(noCsrf.status,403);
  const created=await fetch(origin+'/api/v1/imports',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)});assert.equal(created.status,201);
  const imported=z.object({importId:z.string()}).parse(await created.json());const etag=created.headers.get('etag');assert.ok(etag);
  const preview=await fetch(origin+`/api/v1/imports/${imported.importId}/preview`,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:'{}'});assert.equal(preview.status,200);
  const p=z.object({previewToken:z.string(),diffHash:z.string()}).parse(await preview.json());
  const applied=await fetch(origin+`/api/v1/imports/${imported.importId}/apply`,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':etag},body:JSON.stringify({previewToken:p.previewToken,confirmDiffHash:p.diffHash})});assert.equal(applied.status,201,await applied.clone().text());
  const exp=await fetch(origin+'/api/v1/exports',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({kind:'dossier',characterId:original.characterId})});assert.equal(exp.status,201);
  const exported=z.object({exportId:z.string()}).parse(await exp.json());const download=await fetch(origin+`/api/v1/exports/${exported.exportId}/download`,{headers:{...security,'Cookie':cookie}});assert.equal(download.status,200);assert.equal(await download.text(),archive);
  const backup=await fetch(origin+'/api/v1/backups/'+randomUUID(),{method:'PUT',headers:{...headers,'Idempotency-Key':randomUUID(),'If-None-Match':'*'},body:JSON.stringify({scope:{kind:'all'}})});assert.equal(backup.status,202);
  const job=z.object({state:z.string(),safeCode:z.string()}).parse(await backup.json());assert.equal(job.state,'failed');assert.equal(job.safeCode,'BACKUP_QUIESCE_UNAVAILABLE');
 }finally{await server.close();runtime.close();host.close();rmSync(root,{recursive:true,force:true});}
});
