import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { exportDossier, hashDossierMarkdown } from '../src/adapters/catalog.ts';
import { parseDossierMarkdown } from '../src/domain/catalog.ts';
import { PreparedCharacterSchema } from '../src/domain/preparation.ts';
import { RunDraftMutationResultSchema } from '../src/domain/world-journal.ts';
import { openDossierExchange } from '../src/application/dossier-exchange.ts';
import { createPreparationSourceAdmission } from '../src/application/preparation-source-admission.ts';
import { freezeCatalogDossierSource, validateFrozenDossierSource } from '../src/application/dossier-source-repository.ts';
import type { DossierSource } from '../src/domain/dossier-source.ts';
import { draftFixture } from './fixtures/continuista.ts';

function fixture() {
 const directory=mkdtempSync(join(tmpdir(),'personajes-admission-'));const path=join(directory,'world.sqlite');
 const journal=openJournal({path});const draft=draftFixture();assert.equal(draft.roster.kind,'configured');if(draft.roster.kind!=='configured')assert.fail();
 const roster=draft.roster;const actor=roster.value.preparedCharacters[0];assert.ok(actor);
 const markdown='# Expediente sintético de admisión\n';
 let dossier=parseDossierMarkdown({characterId:actor.characterId,displayName:'Personaje sintético',markdown,contentHash:hashDossierMarkdown(markdown)});
 const exchange=openDossierExchange({journalPath:path,getDossier:()=>dossier});
 journal.setPreparationSourceAdmission(createPreparationSourceAdmission({readCatalogDossier:()=>dossier,adaptations:exchange}));
 const prepared=(source:DossierSource)=>{
  const section=<T extends {provenance:{dossierRevision:number;dossierHash:string}}>(value:T)=>({...value,provenance:{...value.provenance,dossierRevision:source.revision,dossierHash:source.contentHash}});
  return PreparedCharacterSchema.parse({...actor,dossierRevision:source.revision,dossierHash:source.contentHash,dossierSource:source,
   identity:section(actor.identity),voice:section(actor.voice),antecedents:{...section(actor.antecedents),value:actor.antecedents.value.map(section)},goals:section(actor.goals),relationships:section(actor.relationships),capabilities:section(actor.capabilities),inventory:section(actor.inventory),initialExperience:section(actor.initialExperience),unknownPolicy:section(actor.unknownPolicy)});
 };
 const patch=(actors:ReturnType<typeof prepared>[])=>({roster:{...roster,value:{...roster.value,preparedCharacters:actors}}});
 const create=(source:DossierSource,principalId='owner',idempotencyKey=randomUUID())=>{
  const request={principalId,idempotencyKey,patch:patch([prepared(source)])};
  return {request,result:RunDraftMutationResultSchema.parse(journal.createRunConfigurationDraft(request))};
 };
 return {journal,exchange,prepared,patch,create,get dossier(){return dossier;},changeCatalog(){dossier={...dossier,aliases:['Metadata cambiada']};},close(){exchange.close();journal.close();rmSync(directory,{recursive:true,force:true});}};
}

test('journal admits host source, preserves exact source after catalogue changes, and replays before resolution',()=>{
 const f=fixture();try{
  const source=freezeCatalogDossierSource(f.dossier);const {request,result}=f.create(source);assert.equal(result.kind,'created');if(result.kind!=='created')assert.fail();
  f.changeCatalog();assert.deepEqual(f.journal.createRunConfigurationDraft(request),{...result,kind:'existing'});
  assert.throws(()=>f.create(source),/SELECTION_CHANGED/);
  const update={principalId:'owner',idempotencyKey:randomUUID(),runId:result.draft.runId,expectedRevision:0,patch:f.patch([f.prepared(source)])};
  const saved=RunDraftMutationResultSchema.parse(f.journal.updateRunConfigurationDraft(update));assert.equal(saved.kind,'stored');
  assert.deepEqual(f.journal.updateRunConfigurationDraft(update),{...saved,kind:'existing'});
  const {dossierSource,...legacy}=f.prepared(source);void dossierSource;
  assert.throws(()=>f.journal.updateRunConfigurationDraft({...update,idempotencyKey:randomUUID(),expectedRevision:1,patch:f.patch([legacy])}),/REMOVAL_FORBIDDEN/);
  const retired=f.patch([]);retired.roster.value.activeCharacterIds=[];
  assert.equal(RunDraftMutationResultSchema.parse(f.journal.updateRunConfigurationDraft({...update,idempotencyKey:randomUUID(),expectedRevision:1,patch:retired})).kind,'stored');
 }finally{f.close();}
});

test('journal rejects self-consistent forged catalogue source and foreign adaptation without writes',()=>{
 const f=fixture();try{
  const forged=freezeCatalogDossierSource({...f.dossier,aliases:['Forged but checksum valid']});assert.throws(()=>f.create(forged),/SELECTION_CHANGED/);
  assert.equal(f.journal.listRunConfigurationDrafts({limit:25,offset:0}).length,0);
  const imported=f.exchange.quarantine('owner',randomUUID(),{kind:'dossier',fileName:'synthetic.json',contentBase64:Buffer.from(exportDossier(f.dossier)).toString('base64')});
  const preview=f.exchange.preview('owner',imported.importId);const applied=f.exchange.apply('owner',{previewToken:preview.previewToken,confirmDiffHash:preview.diffHash});
  const saved=f.exchange.readAdaptation({principalId:'owner',adaptationId:applied.adaptationId});
  const source=validateFrozenDossierSource({kind:'saved-adaptation',characterId:saved.characterId,revision:saved.revision,contentHash:saved.contentHash,fullArchiveHash:saved.archiveHash,importedArchiveHash:saved.importedArchiveHash,importId:saved.importId,adaptationId:saved.adaptationId,frozenDossier:saved.adaptation.importedDossier});
  assert.throws(()=>f.create(source,'foreign'),/NOT_FOUND/);assert.equal(f.create(source).result.kind,'created');
 }finally{f.close();}
});

test('legacy absence remains byte-shape compatible while source-bound writes require configured admission',()=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-admission-legacy-'));const journal=openJournal({path:join(directory,'world.sqlite')});
 try{
  const draft=draftFixture();assert.equal(draft.roster.kind,'configured');if(draft.roster.kind!=='configured')assert.fail();
  const legacy=RunDraftMutationResultSchema.parse(journal.createRunConfigurationDraft({principalId:'owner',idempotencyKey:randomUUID(),patch:{roster:draft.roster}}));assert.equal(legacy.kind,'created');if(legacy.kind!=='created')assert.fail();
  assert.equal(legacy.draft.roster.kind,'configured');if(legacy.draft.roster.kind!=='configured')assert.fail();
  for(const actor of legacy.draft.roster.value.preparedCharacters)assert.equal('dossierSource' in actor,false);
  const f=fixture();try{
   const source=freezeCatalogDossierSource(f.dossier);
   assert.throws(()=>journal.createRunConfigurationDraft({principalId:'owner',idempotencyKey:randomUUID(),patch:f.patch([f.prepared(source)])}),/ADMISSION_UNAVAILABLE/);
  }finally{f.close();}
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
