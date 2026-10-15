import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {loadCatalog,readDossier,exportDossier} from '../src/adapters/catalog.ts';
import {openDossierExchange} from '../src/application/dossier-exchange.ts';
import {freezeCatalogDossierSource,validateFrozenDossierSource} from '../src/application/dossier-source-repository.ts';
import {DossierEditableFieldsSchema} from '../src/domain/dossier-edit.ts';

const fieldsOf=(d: import('../src/domain/catalog.ts').Dossier)=>({displayName:d.displayName,aliases:d.aliases,performers:d.performers,markdown:d.markdown,sourceRefs:d.sourceRefs,unknowns:d.unknowns,contradictions:d.contradictions,avatarRef:d.avatarRef,voiceRecipe:d.voiceRecipe});

test('editor normalizes every field, attributes immutable provenance, replays after restart and admits saved parent',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});let original=await readDossier({catalog,characterId:'maxwell-smart'});const untouched=exportDossier(original);
 const root=mkdtempSync(join(tmpdir(),'personajes-edit-'));const options={journalPath:join(root,'world.sqlite'),getDossier:()=>original,now:()=>1000000};let service=openDossierExchange(options);
 try{
  const source=freezeCatalogDossierSource(original);const {frozenDossier:_d,...reference}=source;void _d;
  const fields=DossierEditableFieldsSchema.parse({...fieldsOf(original),displayName:'Max adaptado',aliases:['Alias'],performers:['Intérprete'],markdown:'# Max\n\n## Sección desconocida\nInformación\n',sourceRefs:[{id:'new',kind:'adaptation',reference:'editor',scope:'alternate',uncertainty:'proposal'}],unknowns:['x'],contradictions:['y'],avatarRef:{kind:'unbound'},voiceRecipe:{kind:'reviewed',recipe:'voz',sourceRefs:['new']}});
  const request={source:reference,fields,reason:'Adaptación completa'};const operation=randomUUID();const p=service.editPreview('owner',operation,request);
  assert.deepEqual(p.before,original);assert.equal(p.after.markdown,fields.markdown);assert.equal(p.after.contentHash,createHash('sha256').update(fields.markdown).digest('hex'));assert.ok(p.after.unknownSections.length>0);assert.equal(p.after.revision,original.revision);assert.equal(exportDossier(original),untouched);
  const entry=p.after.adaptations.at(-1);assert.equal(entry?.editorial?.authorPrincipalId,'owner');assert.equal(entry?.editorial?.parentArchiveHash,source.fullArchiveHash);assert.equal(entry?.createdAt,new Date(1000000).toISOString());
  assert.throws(()=>service.apply('foreign',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/NOT_FOUND/);
  assert.throws(()=>service.apply('owner',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:'0'.repeat(64)}),/CONFIRMATION/);
  service.close();service=openDossierExchange(options);original={...original,aliases:['changed-current']};assert.deepEqual(service.editPreview('owner',operation,request),p);assert.throws(()=>service.editPreview('owner',operation,{...request,reason:'changed'}),/IDEMPOTENCY/);assert.throws(()=>service.apply('owner',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/SELECTION_CHANGED/);
  original=p.before;const saved=service.apply('owner',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash});assert.equal(saved.importedDossier.revision,p.before.revision+1);assert.equal(saved.importedDossier.adaptations.length,p.before.adaptations.length+2);
  const read=service.readSavedAdaptation({principalId:'owner',importId:p.importId});const frozen=validateFrozenDossierSource({kind:'saved-adaptation',characterId:read.characterId,revision:read.revision,contentHash:read.contentHash,fullArchiveHash:read.archiveHash,importId:read.importId,adaptationId:read.adaptationId,importedArchiveHash:read.importedArchiveHash,frozenDossier:read.adaptation.importedDossier});
  assert.equal(frozen.kind,'saved-adaptation');if(frozen.kind!=='saved-adaptation')throw new Error('expected adaptation');const {frozenDossier:_f,importedArchiveHash:_h,...nextReference}=frozen;void _f;void _h;
  const next=service.editPreview('owner',randomUUID(),{source:nextReference,fields:DossierEditableFieldsSchema.parse({...fieldsOf(saved.importedDossier),aliases:['second']}),reason:'Segunda'});assert.equal(next.before.adaptations.length,saved.importedDossier.adaptations.length);assert.equal(next.after.adaptations.at(-1)?.editorial?.parentArchiveHash,read.archiveHash);
  original={...original,aliases:['later-current']};assert.deepEqual(service.apply('owner',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),saved);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});


test('editor rejects client provenance, duplicate or dangling evidence, invalid avatar and expired confirmation',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const original=await readDossier({catalog,characterId:'maxwell-smart'});const root=mkdtempSync(join(tmpdir(),'personajes-edit-expiry-'));let now=1000;const service=openDossierExchange({journalPath:join(root,'world.sqlite'),getDossier:()=>original,now:()=>now});
 try{const {frozenDossier:_f,...source}=freezeCatalogDossierSource(original);void _f;const fields=fieldsOf(original);const request={source,fields,reason:'evidence'};
 assert.throws(()=>service.editPreview('owner',randomUUID(),{...request,authorPrincipalId:'forged'}));
 const ref={id:'duplicate',kind:'adaptation',reference:'x',scope:'x',uncertainty:'x'};
 assert.throws(()=>service.editPreview('owner',randomUUID(),{...request,fields:{...fields,sourceRefs:[ref,ref]}}),/DUPLICATED/);
 assert.throws(()=>service.editPreview('owner',randomUUID(),{...request,fields:{...fields,voiceRecipe:{kind:'reviewed',recipe:'x',sourceRefs:['missing']}}}),/MISSING/);
 assert.throws(()=>service.editPreview('owner',randomUUID(),{...request,fields:{...fields,avatarRef:{kind:'catalog-reference',slug:'agent-99'}}}),/AVATAR/);
 const p=service.editPreview('owner',randomUUID(),request);now+=300001;assert.throws(()=>service.apply('owner',{importId:p.importId,previewToken:p.previewToken,confirmDiffHash:p.diffHash}),/EXPIRED/);assert.equal(service.listAdaptations({principalId:'owner',characterId:original.characterId,limit:100}).adaptations.length,0);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});


test('editor apply replay verifies both immutable records and fails closed after imported archive corruption',async()=>{
 const catalog=await loadCatalog({repositoryRoot:process.cwd()});const original=await readDossier({catalog,characterId:'maxwell-smart'});const root=mkdtempSync(join(tmpdir(),'personajes-edit-replay-integrity-'));const journalPath=join(root,'world.sqlite');let catalogAvailable=true;const service=openDossierExchange({journalPath,getDossier:()=>{if(!catalogAvailable)throw new Error('CATALOG_NOT_ALLOWED');return original;}});
 try{const {frozenDossier:_f,...source}=freezeCatalogDossierSource(original);void _f;const preview=service.editPreview('owner',randomUUID(),{source,fields:fieldsOf(original),reason:'review'});const request={importId:preview.importId,previewToken:preview.previewToken,confirmDiffHash:preview.diffHash};const saved=service.apply('owner',request);catalogAvailable=false;assert.deepEqual(service.apply('owner',request),saved);
 const db=new DatabaseSync(journalPath);try{const before=db.prepare('SELECT COUNT(*) n FROM exchange_dossier_adaptations').get()?.n;db.prepare('UPDATE exchange_dossier_imports SET archive_json=? WHERE import_id=?').run('{}',preview.importId);assert.throws(()=>service.apply('owner',request),/EXCHANGE_METADATA_TAMPERED/);assert.equal(db.prepare('SELECT COUNT(*) n FROM exchange_dossier_adaptations').get()?.n,before);assert.equal(db.prepare('SELECT archive_json FROM exchange_dossier_imports WHERE import_id=?').get(preview.importId)?.archive_json,'{}');}finally{db.close();}
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});
