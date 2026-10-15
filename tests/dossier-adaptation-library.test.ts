import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { exportDossier,loadCatalog,readDossier } from '../src/adapters/catalog.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { exchangeIntegrity } from '../src/adapters/exchange-integrity.ts';
import type { Dossier } from '../src/domain/catalog.ts';

async function fixture(){
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const original=await readDossier({catalog,characterId:'maxwell-smart'});
 const root=mkdtempSync(join(tmpdir(),'personajes-adaptation-library-'));const journalPath=join(root,'world.sqlite');let catalogReads=0;
 const options={journalPath,getDossier(){catalogReads++;return original;}};let service=openDossierExchange(options);
 return {original,journalPath,get service(){return service;},get catalogReads(){return catalogReads;},reload(){service.close();service=openDossierExchange(options);},save(principalId:string,dossier:Dossier=original){const imported=service.quarantine(principalId,randomUUID(),{kind:'dossier',fileName:'max.json',contentBase64:Buffer.from(exportDossier(dossier)).toString('base64')});const preview=service.preview(principalId,imported.importId);const adaptation=service.apply(principalId,{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash});return {imported,adaptation};},close(){service.close();rmSync(root,{recursive:true,force:true});}};
}

test('saved adaptations reload with stable scoped pagination, exact IDs and complete archive hashes without catalog reads',async()=>{
 const f=await fixture();try{
  const first=f.save('operator');const second=f.save('operator',{...f.original,aliases:[...f.original.aliases,'metadata variant']});f.save('foreign');
  const quarantined=f.service.quarantine('operator',randomUUID(),{kind:'dossier',fileName:'pending.json',contentBase64:Buffer.from(exportDossier(f.original)).toString('base64')});
  const reads=f.catalogReads;const before=f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:100});assert.equal(before.adaptations.length,2);
  const a=f.service.readAdaptation({principalId:'operator',adaptationId:first.adaptation.adaptationId});const b=f.service.readSavedAdaptation({principalId:'operator',importId:second.imported.importId});
  assert.equal(a.importedArchiveHash,createHash('sha256').update(exportDossier(f.original)).digest('hex'));assert.notEqual(a.importedArchiveHash,a.archiveHash);
  assert.equal(a.importId,first.imported.importId);assert.notEqual(a.adaptationId,a.importId);assert.equal(a.contentHash,b.contentHash);assert.notEqual(a.archiveHash,b.archiveHash);assert.equal(a.archiveHash,createHash('sha256').update(exportDossier(a.adaptation.importedDossier)).digest('hex'));
  assert.throws(()=>f.service.readAdaptation({principalId:'foreign',adaptationId:a.adaptationId}),/NOT_FOUND/);assert.throws(()=>f.service.readSavedAdaptation({principalId:'foreign',importId:a.importId}),/NOT_FOUND/);assert.throws(()=>f.service.readSavedAdaptation({principalId:'operator',importId:quarantined.importId}),/NOT_FOUND/);
  const page=f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:1});assert.ok(page.nextCursor);const cursor=page.nextCursor;
  assert.throws(()=>f.service.listAdaptations({principalId:'foreign',characterId:f.original.characterId,limit:1,cursor}),/CURSOR_SCOPE/);assert.throws(()=>f.service.listAdaptations({principalId:'operator',characterId:'agent-99',limit:1,cursor}),/CURSOR_SCOPE/);
  assert.equal(f.catalogReads,reads);f.reload();assert.deepEqual(f.service.readSavedAdaptation({principalId:'operator',importId:a.importId}),a);f.save('operator');
  const next=f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:1,cursor});assert.equal(next.nextCursor,null);assert.deepEqual([...page.adaptations,...next.adaptations],before.adaptations);
  assert.equal(f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:100}).adaptations.length,3);
  const db=new DatabaseSync(f.journalPath);try{const total=db.prepare('PRAGMA data_version').get()?.data_version;f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:1});f.service.readSavedAdaptation({principalId:'operator',importId:a.importId});assert.equal(db.prepare('PRAGMA data_version').get()?.data_version,total);}finally{db.close();}
 }finally{f.close();}
});

test('adaptation library verifies both sealed records, rejects transplantation and never repairs damaged metadata',async()=>{
 const f=await fixture();const db=new DatabaseSync(f.journalPath);try{
  const a=f.save('operator');const stored=db.prepare('SELECT adaptation_json FROM exchange_dossier_adaptations WHERE import_id=?').get(a.imported.importId);assert.ok(stored);
  db.prepare('UPDATE exchange_dossier_adaptations SET principal_id=? WHERE import_id=?').run('foreign',a.imported.importId);
  assert.throws(()=>f.service.listAdaptations({principalId:'foreign',characterId:f.original.characterId,limit:10}),/METADATA_TAMPERED/);assert.throws(()=>f.service.readSavedAdaptation({principalId:'foreign',importId:a.imported.importId}),/METADATA_TAMPERED/);
  const b=f.save('operator');db.prepare('UPDATE exchange_dossier_imports SET view_json=? WHERE import_id=?').run('{}',b.imported.importId);
  assert.throws(()=>f.service.readAdaptation({principalId:'operator',adaptationId:b.adaptation.adaptationId}),/METADATA_TAMPERED/);
  const c=f.save('unaffected');db.prepare('UPDATE exchange_dossier_adaptations SET adaptation_json=? WHERE import_id=?').run('{}',b.imported.importId);
  assert.equal(f.service.listAdaptations({principalId:'unaffected',characterId:f.original.characterId,limit:10}).adaptations[0]?.adaptationId,c.adaptation.adaptationId);
  assert.throws(()=>f.service.listAdaptations({principalId:'operator',characterId:f.original.characterId,limit:10}),/METADATA_TAMPERED/);
  const divergent=f.save('lineage');const changed={...divergent.adaptation,importedDossier:{...divergent.adaptation.importedDossier,aliases:[...divergent.adaptation.importedDossier.aliases,'unrelated-metadata']}};db.prepare('UPDATE exchange_dossier_adaptations SET adaptation_json=? WHERE import_id=?').run(JSON.stringify(changed),divergent.imported.importId);exchangeIntegrity(db).seal('exchange_dossier_adaptations','import_id=?',[divergent.imported.importId]);
  assert.throws(()=>f.service.readSavedAdaptation({principalId:'lineage',importId:divergent.imported.importId}),/LINEAGE_INVALID/);
 }finally{db.close();f.close();}
});
