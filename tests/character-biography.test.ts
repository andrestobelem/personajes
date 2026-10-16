import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {CuratedIdentitySchema,PreparedCharacterSchema,PreparationDraftSchema} from '../src/domain/preparation.ts';
import {CuratedLifeHistorySchema,CuratedCharacterDesiresSchema,assertCharacterBiographyPreserved,hasEmbodiedCharacterDefinition} from '../src/domain/character-biography.ts';
import {compilePrivateActorPromptWithSegments,prepareCharacter} from '../src/application/prepare-character.ts';
import {createActorWorldProjectionPort} from '../src/application/actor-world-projection.ts';
import {freezeCatalogDossierSource} from '../src/application/dossier-source-repository.ts';
import {parseDossierMarkdown} from '../src/domain/catalog.ts';
import {hashDossierMarkdown} from '../src/adapters/catalog.ts';
import {configuratorValueHash,validateConfiguratorProposal} from '../src/application/configurator-context.ts';
import {sha256CanonicalJson} from '../src/domain/canonical-json.ts';
import {setup,actorId,draftFixture} from './fixtures/continuista.ts';
import {configuratorEvolutionFixture} from './fixtures/configurator-evolution.ts';

function richCharacter(){
  const draft=draftFixture();assert.ok(draft.roster.kind==='configured');const before=draft.roster.value.preparedCharacters[0];assert.ok(before);const goal=before.goals.value[0];assert.ok(goal);
  const identity=CuratedIdentitySchema.parse({...before.identity.value,lifeHistory:{kind:'curated-life-history',narrative:'  # Mi historia admitida\n\nDesde mi formación elegida procuro escuchar antes de actuar.\n',antecedentIds:['formacion-admitida'],unknowns:['No consta la infancia.'],contradictions:['La fuente no resuelve dos versiones.']},desires:[{desireId:'ser-comprendido',description:'Deseo que entiendan mi intención.',stakes:'Me importa mi pertenencia.',tension:'Escuchar exige tolerar la duda.',goalIds:[goal.goalId]}]});
  return PreparedCharacterSchema.parse({...before,identity:{...before.identity,value:identity},antecedents:{...before.antecedents,value:[{antecedentId:'formacion-admitida',kind:'biography',statement:'Formación elegida para esta puesta; adaptación explícita, no canon descubierto.',applicability:{kind:'unconditional'},provenance:before.antecedents.provenance}]}});
}

test('biografía encarnada conserva Markdown exacto, requiere deseos y valida límites UTF8 y referencias propias',()=>{
  const prepared=richCharacter();assert.ok(hasEmbodiedCharacterDefinition(prepared.identity.value));assert.ok(prepared.identity.value.lifeHistory?.narrative.startsWith('  #'));assert.ok(prepared.identity.value.lifeHistory?.narrative.endsWith('\n'));
  const {lifeHistory:_history,desires:_desires,...legacy}=prepared.identity.value;assert.ok(CuratedIdentitySchema.safeParse(legacy).success,'legacy remains readable without fabricated biography');
  assert.equal(sha256CanonicalJson(CuratedIdentitySchema.parse(legacy)),sha256CanonicalJson(legacy),'reading legacy identity adds no fields or changes its seal');
  assert.equal(CuratedIdentitySchema.safeParse({...legacy,lifeHistory:prepared.identity.value.lifeHistory}).success,false);
  assert.equal(CuratedCharacterDesiresSchema.safeParse([]).success,false);
  const history=prepared.identity.value.lifeHistory;assert.ok(history);
  assert.equal(CuratedLifeHistorySchema.safeParse({...history,narrative:'é'.repeat(65537)}).success,false);assert.equal(CuratedLifeHistorySchema.safeParse({...history,narrative:'é'.repeat(65536)}).success,true);
  assert.equal(CuratedLifeHistorySchema.safeParse({...history,narrative:' \n\t'}).success,false);
  assert.equal(PreparedCharacterSchema.safeParse({...prepared,identity:{...prepared.identity,value:{...prepared.identity.value,lifeHistory:{...history,antecedentIds:['antecedente-ajeno']}}}}).success,false);
  const desire=prepared.identity.value.desires?.[0];assert.ok(desire);
  assert.equal(PreparedCharacterSchema.safeParse({...prepared,identity:{...prepared.identity,value:{...prepared.identity.value,desires:[{...desire,goalIds:['goal-ajeno']}]}}}).success,false);
  assert.equal(CuratedCharacterDesiresSchema.safeParse([desire,desire]).success,false);
  const conditional={...prepared,continuity:{...prepared.continuity,milestones:[{milestoneId:'futuro',label:'Hito posterior no ocurrido',status:'notReached',sourceRefs:[]}]},antecedents:{...prepared.antecedents,value:prepared.antecedents.value.map(antecedent=>({...antecedent,kind:'milestone',applicability:{kind:'milestone-state',milestoneId:'futuro',requires:'reached'}}))}};
  const future=PreparedCharacterSchema.safeParse(conditional);assert.equal(future.success,false);if(!future.success)assert.ok(future.error.issues.some(issue=>issue.path.includes('applicability')),'life-history antecedent cannot come from an unadmitted future milestone');
});

test('preparar conserva biografía como curación con procedencia; no admite metas o antecedentes sin enlaces reales',()=>{
  const prepared=richCharacter(),markdown='# Expediente sintético\n\nRESEARCH_PRIVATE_NOT_ACTOR_CONTEXT';
  const source=freezeCatalogDossierSource(parseDossierMarkdown({characterId:prepared.characterId,displayName:'Actor sintético',markdown,contentHash:hashDossierMarkdown(markdown)}));
  const rebased=PreparedCharacterSchema.parse({...JSON.parse(JSON.stringify(prepared).replaceAll(prepared.dossierHash,source.contentHash).replaceAll('"dossierRevision":1',`"dossierRevision":${source.revision}`)),dossierSource:source});
  const sections={identity:{kind:'declared',value:rebased.identity},voice:{kind:'declared',value:rebased.voice},antecedents:{kind:'declared',value:rebased.antecedents},goals:{kind:'declared',value:rebased.goals},relationships:{kind:'declared',value:rebased.relationships},capabilities:{kind:'declared',value:rebased.capabilities},inventory:{kind:'declared',value:rebased.inventory},initialExperience:{kind:'declared',value:rebased.initialExperience},unknownPolicy:{kind:'declared',value:rebased.unknownPolicy}};
  const draft=PreparationDraftSchema.parse({kind:'preparation-draft',schemaVersion:1,characterId:rebased.characterId,dossierRevision:rebased.dossierRevision,dossierHash:rebased.dossierHash,dossierSource:source,continuity:rebased.continuity,identityVersion:rebased.identityVersion,...sections});
  const result=prepareCharacter({draft,dossier:source.frozenDossier});assert.equal(result.kind,'prepared',JSON.stringify(result));if(result.kind!=='prepared')assert.fail();assert.deepEqual(result.character.identity.value,rebased.identity.value);
  const identity=rebased.identity.value,desire=identity.desires?.[0];assert.ok(desire);
  const invalid=prepareCharacter({draft:{...draft,identity:{kind:'declared',value:{...rebased.identity,value:{...identity,desires:[{...desire,goalIds:['inventado']}]}}}},dossier:source.frozenDossier});assert.equal(invalid.kind,'invalid');
});

test('prompt real de actor reúne biografía, deseos, goals y memoria propia sin investigación ni interioridad ajena',async()=>{
  const f=await setup();try{
    const rich=richCharacter(),markdown='# Investigación privada\n\nRESEARCH_PRIVATE_NOT_ACTOR_CONTEXT',source=freezeCatalogDossierSource(parseDossierMarkdown({characterId:actorId,displayName:'Actor sintético',markdown,contentHash:hashDossierMarkdown(markdown)}));
    const prepared=PreparedCharacterSchema.parse({...JSON.parse(JSON.stringify(rich).replaceAll(rich.dossierHash,source.contentHash).replaceAll('"dossierRevision":1',`"dossierRevision":${source.revision}`)),dossierSource:source}),snapshot=f.journal.loadWorld({runId:f.configuration.runId});assert.ok(snapshot);
    const history=prepared.identity.value.lifeHistory;assert.ok(history);
    prepared.identity.value.lifeHistory={...history,unknowns:[...history.unknowns,'CURATOR_ONLY_LATER_REVELATION_NOT_KNOWN'],contradictions:[...history.contradictions,'CURATOR_ONLY_FUTURE_CORPUS_CONTRADICTION']};
    const experiences=f.journal.readExperiences({runId:snapshot.runId,actorId,throughWorldSeq:snapshot.seq});assert.ok(experiences.length>0);
    const projection=createActorWorldProjectionPort({host:{async loadActorWorldCut(input){return f.journal.loadActorWorldCut(input);},async compareAndSwapActorKnowledge(input){return f.journal.compareAndSwapActorKnowledge(input);}},ids:f.ids});
    const result=await compilePrivateActorPromptWithSegments({prepared,runId:snapshot.runId,worldRevision:snapshot.revision,throughWorldSeq:snapshot.seq,fictionalAt:snapshot.clock.instant,spanishVariety:f.configuration.spanishVariety,experiences,actorWorldProjectionPort:projection});
    assert.match(result.diegeticContextMarkdown,/Mi historia admitida/);assert.match(result.diegeticContextMarkdown,/ser-comprendido|ser-comprendido/);assert.match(result.diegeticContextMarkdown,/Escuchar exige tolerar la duda/);assert.match(result.diegeticContextMarkdown,/formacion-admitida/);assert.match(result.diegeticContextMarkdown,/preparedGoals/);assert.ok(result.diegeticContextMarkdown.includes(experiences[0]?.content??assert.fail()));
    assert.doesNotMatch(result.compilation.text,/SECRET_OTHER_PREPARATION|SECRET_PRIVATE_OTHER_MEMORY|SECRET_PRIVATE_PLACE|RESEARCH_PRIVATE_NOT_ACTOR_CONTEXT|CURATOR_ONLY_LATER_REVELATION_NOT_KNOWN|CURATOR_ONLY_FUTURE_CORPUS_CONTRADICTION|frozenDossier|fullArchiveHash/);
    assert.ok(prepared.identity.value.lifeHistory.unknowns.includes('CURATOR_ONLY_LATER_REVELATION_NOT_KNOWN'));
    assert.ok(prepared.identity.value.lifeHistory.contradictions.includes('CURATOR_ONLY_FUTURE_CORPUS_CONTRADICTION'));
    const foreign={...experiences[0],experienceId:randomUUID(),actorId:'oculto-prueba'};
    await assert.rejects(compilePrivateActorPromptWithSegments({prepared,runId:snapshot.runId,worldRevision:snapshot.revision,throughWorldSeq:snapshot.seq,fictionalAt:snapshot.clock.instant,spanishVariety:f.configuration.spanishVariety,experiences:[foreign],actorWorldProjectionPort:projection}),/otro personaje/);
  }finally{f.close();}
});

test('evolución de identidad preserva biografía explícita y sus vacíos; no permite regresar silenciosamente a legacy',async()=>{
  const f=await configuratorEvolutionFixture();try{
    assert.ok(f.context.preparedCharacter&&f.context.scope.kind==='evolution'&&f.proposal.kind==='identity-promotion-proposal');
    const rich=richCharacter(),previous=PreparedCharacterSchema.parse({...f.context.preparedCharacter,identity:{...f.context.preparedCharacter.identity,value:{...f.context.preparedCharacter.identity.value,lifeHistory:{...rich.identity.value.lifeHistory,antecedentIds:[]},desires:rich.identity.value.desires}}});
    const context={...f.context,preparedCharacter:previous,scope:{...f.context.scope,anchor:{...f.context.scope.anchor,preparedContextHash:configuratorValueHash(previous)}}};
    const {lifeHistory:_oldHistory,desires:_oldDesires,...legacyIdentity}=f.proposal.identity;
    assert.throws(()=>validateConfiguratorProposal({context,proposal:{...f.proposal,identity:legacyIdentity}}),/BIOGRAPHY_REMOVAL_FORBIDDEN/);
    const good={...f.proposal,identity:{...previous.identity.value,selfConcept:'Revisión futura explícita.'}};assert.doesNotThrow(()=>validateConfiguratorProposal({context,proposal:good}));
    const history=previous.identity.value.lifeHistory;assert.ok(history);
    assert.throws(()=>assertCharacterBiographyPreserved({previous:previous.identity.value,next:{...previous.identity.value,lifeHistory:{...history,narrative:'Otra narración',unknowns:[],contradictions:[]}}}),/GAPS_REMOVAL_FORBIDDEN/);
  }finally{f.close();}
});
