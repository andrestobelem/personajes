import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { exportDossier, hashDossierMarkdown, importDossier } from '../src/adapters/catalog.ts';
import { DossierSchema, parseDossierMarkdown } from '../src/domain/catalog.ts';
import { DossierSourceSchema, DossierSourceReferenceSchema, type DossierSource } from '../src/domain/dossier-source.ts';
import { PreparedCharacterSchema, PreparationDraftSchema } from '../src/domain/preparation.ts';
import { ContinuistaContextPayloadSchema } from '../src/domain/continuista-review.ts';
import { compilePrivateActorPrompt, createEmptyPreparationDraft } from '../src/application/prepare-character.ts';
import { createActorWorldProjectionPort } from '../src/application/actor-world-projection.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { draftFixture, setup } from './fixtures/continuista.ts';

function readyFixture(){const result=validateRunConfiguration({draft:draftFixture()});assert.equal(result.kind,'ready');if(result.kind!=='ready')assert.fail();return result.configuration;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function catalogSource(characterId:string='personaje-prueba'){
 const markdown='# Expediente de prueba\n\nDOCUMENTARY_FROZEN_SENTINEL_NEVER_ACTOR\n';
 const frozenDossier=parseDossierMarkdown({characterId,displayName:'Expediente documental',markdown,contentHash:hashDossierMarkdown(markdown),aliases:['METADATA_FROZEN_SENTINEL_NEVER_ACTOR'],performers:['PERFORMER_FROZEN_SENTINEL_NEVER_ACTOR']});
 return DossierSourceSchema.parse({kind:'catalog-original',characterId:frozenDossier.characterId,revision:frozenDossier.revision,contentHash:frozenDossier.contentHash,fullArchiveHash:hash(exportDossier(frozenDossier)),frozenDossier});
}
function adaptationSource(){
 const original=catalogSource();const received=exportDossier(original.frozenDossier);const imported=importDossier(received);const frozenDossier=imported.importedDossier;
 return DossierSourceSchema.parse({kind:'saved-adaptation',characterId:frozenDossier.characterId,revision:frozenDossier.revision,contentHash:frozenDossier.contentHash,fullArchiveHash:hash(exportDossier(frozenDossier)),importedArchiveHash:hash(received),importId:randomUUID(),adaptationId:imported.adaptationId,frozenDossier});
}
function preparedSource(source:DossierSource){
 const original=readyFixture().roster.preparedCharacters[0];assert.ok(original);
 const section=<T extends {provenance:{dossierRevision:number;dossierHash:string}}>(value:T)=>({...value,provenance:{...value.provenance,dossierRevision:source.revision,dossierHash:source.contentHash}});
 return PreparedCharacterSchema.parse({...original,characterId:source.characterId,dossierRevision:source.revision,dossierHash:source.contentHash,dossierSource:source,
  identity:section(original.identity),voice:section(original.voice),antecedents:{...section(original.antecedents),value:original.antecedents.value.map(section)},goals:section(original.goals),relationships:section(original.relationships),capabilities:section(original.capabilities),inventory:section(original.inventory),initialExperience:section(original.initialExperience),unknownPolicy:section(original.unknownPolicy)});
}

test('fuente catálogo fija snapshot autocontenido completo; referencia no acepta JSON documental ni owner/path',()=>{
 const source=catalogSource();assert.equal(source.fullArchiveHash,hash(exportDossier(source.frozenDossier)));assert.equal(source.contentHash,hashDossierMarkdown(source.frozenDossier.markdown));
 const reference={kind:source.kind,characterId:source.characterId,revision:source.revision,contentHash:source.contentHash,fullArchiveHash:source.fullArchiveHash};assert.deepEqual(DossierSourceReferenceSchema.parse(reference),reference);
 for(const extra of [{frozenDossier:source.frozenDossier},{owner:'untrusted'},{path:'/private/source'}])assert.equal(DossierSourceReferenceSchema.safeParse({...reference,...extra}).success,false);
});

test('adaptación conserva IDs reales, hash recibido y hash materializado distintos aunque Markdown sea idéntico',()=>{
 const source=adaptationSource();assert.equal(source.kind,'saved-adaptation');if(source.kind!=='saved-adaptation')assert.fail();assert.notEqual(source.importId,source.adaptationId);assert.notEqual(source.importedArchiveHash,source.fullArchiveHash);assert.equal(source.frozenDossier.adaptations.at(-1)?.adaptationId,source.adaptationId);assert.equal(source.fullArchiveHash,hash(exportDossier(source.frozenDossier)));
 const metadataChanged=DossierSchema.parse({...source.frozenDossier,aliases:[...source.frozenDossier.aliases,'Additional metadata']});assert.equal(metadataChanged.contentHash,source.contentHash);assert.notEqual(hash(exportDossier(metadataChanged)),source.fullArchiveHash);
 assert.equal(DossierSourceSchema.safeParse({...source,adaptationId:randomUUID()}).success,false);assert.equal(DossierSourceSchema.safeParse({...source,importId:undefined}).success,false);assert.equal(DossierSourceSchema.safeParse({...source,importedArchiveHash:undefined}).success,false);
});

test('fuente y preparación rechazan personaje, revisión y Markdown divergentes sin ocultar ausencia legacy',()=>{
 const source=catalogSource();const prepared=preparedSource(source);const draft=createEmptyPreparationDraft({characterId:source.characterId,dossierRevision:source.revision,dossierHash:source.contentHash,continuity:prepared.continuity,identityVersion:prepared.identityVersion});assert.deepEqual(PreparationDraftSchema.parse({...draft,dossierSource:source}).dossierSource,source);
 for(const changes of [{characterId:'another-character'},{revision:source.revision+1},{contentHash:'f'.repeat(64)}])assert.equal(DossierSourceSchema.safeParse({...source,...changes}).success,false);
 for(const changes of [{characterId:'another-character'},{revision:source.revision+1},{contentHash:'f'.repeat(64)}]){
  const changedSource=DossierSourceSchema.parse({...source,...changes,frozenDossier:{...source.frozenDossier,...changes}});
  assert.equal(PreparedCharacterSchema.safeParse({...prepared,dossierSource:changedSource}).success,false);assert.equal(PreparationDraftSchema.safeParse({...draft,dossierSource:changedSource}).success,false);
 }
 const legacy=readyFixture().roster.preparedCharacters[0];assert.ok(legacy);assert.equal('dossierSource' in PreparedCharacterSchema.parse(legacy),false);assert.equal('dossierSource' in PreparationDraftSchema.parse(draft),false);assert.equal(PreparedCharacterSchema.safeParse({...legacy,dossierSource:null}).success,false);assert.equal(PreparedCharacterSchema.safeParse({...legacy,dossierSource:{kind:'legacy'}}).success,false);
});

test('schema es estructural: hash completo sólo se acredita mediante verificador host, sin traer crypto a dominio',()=>{
 const source=catalogSource();const wrong=DossierSourceSchema.parse({...source,fullArchiveHash:'f'.repeat(64)});assert.notEqual(wrong.fullArchiveHash,hash(exportDossier(wrong.frozenDossier)));
 // Parsing a shape alone is intentionally not a successful source validation.
 assert.equal(PreparedCharacterSchema.parse({...preparedSource(source),dossierSource:wrong}).dossierSource?.fullArchiveHash,wrong.fullArchiveHash);
});

test('prompt actoral excluye expediente congelado y su metadata; frontera del Continuista también es cerrada',async()=>{
 const f=await setup();try{
  const actor=f.configuration.roster.preparedCharacters[0];assert.ok(actor);const source=catalogSource(actor.characterId);const prepared=preparedSource(source);const world=f.journal.loadWorld({runId:f.configuration.runId});assert.ok(world);
  const port=createActorWorldProjectionPort({host:{loadActorWorldCut:async request=>f.journal.loadActorWorldCut(request),compareAndSwapActorKnowledge:async request=>f.journal.compareAndSwapActorKnowledge(request)},ids:f.ids});
  const compiled=await compilePrivateActorPrompt({prepared,runId:world.runId,worldRevision:world.revision,throughWorldSeq:world.seq,fictionalAt:world.clock.instant,spanishVariety:f.configuration.spanishVariety,experiences:[],actorWorldProjectionPort:port});
  assert.match(compiled.text,/selfConcept/);assert.doesNotMatch(compiled.text,/DOCUMENTARY_FROZEN_SENTINEL|METADATA_FROZEN_SENTINEL|PERFORMER_FROZEN_SENTINEL|frozenDossier|dossierSource|fullArchiveHash/);
  const review={identity:prepared.identity.value,voice:prepared.voice.value,antecedents:prepared.antecedents.value.map(({kind,statement})=>({kind,statement})),capabilities:prepared.capabilities.value.map(({kind,description})=>({kind,description})),initialExperiences:[],unknownPolicy:prepared.unknownPolicy.value};
  assert.equal(ContinuistaContextPayloadSchema.shape.preparation.safeParse(review).success,true);assert.equal(ContinuistaContextPayloadSchema.shape.preparation.safeParse({...review,dossierSource:source}).success,false);
 }finally{f.close();}
});
