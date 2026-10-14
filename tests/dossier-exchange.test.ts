import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { exportDossier,loadCatalog,readDossier } from '../src/adapters/catalog.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';

test('dossier quarantine preview apply preserves original and durable roundtrip across restart',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});
 const original=await readDossier({catalog,characterId:'maxwell-smart'});
 const root=mkdtempSync(join(tmpdir(),'personajes-exchange-'));const path=join(root,'world.sqlite');
 const options={journalPath:path,getDossier:()=>original};let service=openDossierExchange(options);
 try {
  const operationId=randomUUID();const archive=exportDossier(original);const request={kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(archive).toString('base64')};
  const imported=service.quarantine('operator',operationId,request);
  assert.equal(imported.state,'quarantined');assert.deepEqual(service.quarantine('operator',operationId,request),imported);
  assert.throws(()=>service.quarantine('operator',operationId,{...request,fileName:'other.json'}),/IDEMPOTENCY_REUSE/);
  assert.throws(()=>service.get('stranger',imported.importId),/NOT_FOUND/);
  const p=service.preview('operator',imported.importId);assert.deepEqual(p.before,original);assert.deepEqual(p.after,original);
  assert.throws(()=>service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:'0'.repeat(64)}),/DIFF_CONFIRMATION/);
  const applied=service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:p.diffHash});
  assert.equal(applied.importedDossier.revision,original.revision+1);assert.equal(applied.importedDossier.markdown,original.markdown);
  assert.equal(original.adaptations.length,0);assert.equal(service.get('operator',imported.importId).state,'applied');
  service.close();service=openDossierExchange(options);
  assert.deepEqual(service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:p.diffHash}),applied);
  const exp=service.exportArchive('operator',randomUUID(),original.characterId);const downloaded=service.download('operator',exp.exportId);
  assert.equal(downloaded.bytes.toString(),archive);assert.equal(downloaded.sha256,exp.sha256);
  assert.throws(()=>service.download('stranger',exp.exportId),/NOT_FOUND/);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

test('dossier import rejects traversal, invalid hashes/base64, stale target and expired diff',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const original=await readDossier({catalog,characterId:'maxwell-smart'});
 const root=mkdtempSync(join(tmpdir(),'personajes-exchange-'));let current=original,time=1000;
 const service=openDossierExchange({journalPath:join(root,'world.sqlite'),getDossier:()=>current,now:()=>time});
 try {
  const request={kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(exportDossier(original)).toString('base64')};
  assert.throws(()=>service.quarantine('operator',randomUUID(),{...request,fileName:'../auth.json'}));
  assert.throws(()=>service.quarantine('operator',randomUUID(),{...request,contentBase64:'%%%'}),/BASE64/);
  const archive=JSON.parse(exportDossier(original));archive.dossier.contentHash='0'.repeat(64);
  assert.throws(()=>service.quarantine('operator',randomUUID(),{...request,contentBase64:Buffer.from(JSON.stringify(archive)).toString('base64')}),/hash/);
  const imported=service.quarantine('operator',randomUUID(),request);const p=service.preview('operator',imported.importId);
  current={...original,revision:original.revision+1};assert.throws(()=>service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/TARGET_DIVERGED/);
  current={...original,aliases:[...original.aliases,'same-Markdown-but-new-alias']};assert.throws(()=>service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/TARGET_DIVERGED/);
  current=original;time=400000;assert.throws(()=>service.apply('operator',{previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/EXPIRED/);
  assert.equal(service.get('operator',imported.importId).state,'quarantined');
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

test('dossier metadata corruption and principal transplant fail closed independently of Markdown hash',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const original=await readDossier({catalog,characterId:'maxwell-smart'});
 const root=mkdtempSync(join(tmpdir(),'personajes-exchange-tamper-'));const journalPath=join(root,'world.sqlite');const service=openDossierExchange({journalPath,getDossier:()=>original});const db=new DatabaseSync(journalPath);
 try {
  const request={kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(exportDossier(original)).toString('base64')};
  const first=service.quarantine('operator',randomUUID(),request);
  const archive=JSON.parse(exportDossier(original));archive.dossier.aliases.push('changed-metadata');
  db.prepare('UPDATE exchange_dossier_imports SET archive_json=? WHERE import_id=?').run(JSON.stringify(archive),first.importId);
  assert.throws(()=>service.preview('operator',first.importId),/METADATA_TAMPERED/);
  const second=service.quarantine('operator',randomUUID(),request);const p=service.preview('operator',second.importId);
  db.prepare('UPDATE exchange_dossier_previews SET principal_id=? WHERE token=?').run('stranger',p.previewToken);
  assert.throws(()=>service.apply('stranger',{previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/METADATA_TAMPERED/);
  const exported=service.exportArchive('operator',randomUUID(),original.characterId);
  db.prepare('UPDATE exchange_dossier_exports SET principal_id=? WHERE export_id=?').run('stranger',exported.exportId);
  assert.throws(()=>service.download('stranger',exported.exportId),/METADATA_TAMPERED/);
  const third=service.quarantine('operator',randomUUID(),request);const fresh=service.preview('operator',third.importId);service.apply('operator',{previewToken:fresh.previewToken,confirmDiffHash:fresh.diffHash});
  db.prepare('UPDATE exchange_dossier_adaptations SET adaptation_json=? WHERE import_id=?').run('{}',third.importId);
  assert.throws(()=>service.apply('operator',{previewToken:fresh.previewToken,confirmDiffHash:fresh.diffHash}),/METADATA_TAMPERED/);
 }finally{db.close();service.close();rmSync(root,{recursive:true,force:true});}
});
