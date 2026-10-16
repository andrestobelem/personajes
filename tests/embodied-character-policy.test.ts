import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {createLocalHttpServer} from '../src/server/http.ts';
import {SessionCreatedSchema} from '../src/domain/http.ts';
import {openJournal} from '../src/adapters/journal.ts';
import {canonicalJson,sha256CanonicalJson} from '../src/domain/canonical-json.ts';
import {RunConfigurationDraftSchema,createEmptyRunConfigurationDraft} from '../src/domain/production.ts';
import {RunDraftPatchSchema} from '../src/domain/world-journal.ts';
import {validateRunConfiguration,ReadyRunConfigurationSchema} from '../src/application/production-preflight.ts';
import {draftFixture} from './fixtures/continuista.ts';

function withoutBiography(){
  const original=draftFixture();assert.equal(original.roster.kind,'configured');if(original.roster.kind!=='configured')throw new Error('fixture roster');
  return RunConfigurationDraftSchema.parse({...original,roster:{...original.roster,value:{...original.roster.value,preparedCharacters:original.roster.value.preparedCharacters.map(actor=>{
    const {lifeHistory:_history,desires:_desires,...identity}=actor.identity.value;
    return {...actor,identity:{...actor.identity,value:identity}};
  })}}});
}
function withBiography(draft:ReturnType<typeof withoutBiography>){
  assert.equal(draft.roster.kind,'configured');if(draft.roster.kind!=='configured')throw new Error('fixture roster');
  return RunConfigurationDraftSchema.parse({...draft,roster:{...draft.roster,value:{...draft.roster.value,preparedCharacters:draft.roster.value.preparedCharacters.map(actor=>({...actor,
    identity:{...actor.identity,value:{...actor.identity.value,lifeHistory:{kind:'curated-life-history',narrative:'Historia de vida sintética, escrita expresamente para comprobar la preparación. No acredita canon ni recuerdos de una función.',antecedentIds:actor.antecedents.value.map(value=>value.antecedentId),unknowns:[],contradictions:[]},
      desires:[{desireId:'comprender-situacion',description:'Comprender la situación de prueba.',stakes:'Decidir con información suficiente.',tension:'Quiere actuar aunque reconoce que sabe poco.',goalIds:actor.goals.value.map(goal=>goal.goalId)}]}}}))}}});
}
function patch(draft:ReturnType<typeof withoutBiography>){
  const {kind:_kind,schemaVersion:_schema,runId:_run,revision:_revision,...fields}=draft;return RunDraftPatchSchema.parse(fields);
}

test('Ready legacy conserva bytes exactos; embodied exige historia y deseos sin rellenar identidades',()=>{
  const legacy=withoutBiography(),before=canonicalJson(legacy),legacyResult=validateRunConfiguration({draft:legacy});
  assert.equal(legacyResult.kind,'ready');if(legacyResult.kind!=='ready')throw new Error('legacy fixture');
  assert.equal(legacyResult.configuration.characterDefinitionPolicy,undefined);
  assert.equal(canonicalJson(ReadyRunConfigurationSchema.parse(legacyResult.configuration)),canonicalJson(legacyResult.configuration));
  const strict=RunConfigurationDraftSchema.parse({...legacy,characterDefinitionPolicy:{kind:'embodied-v1'}});
  const rejected=validateRunConfiguration({draft:strict});assert.equal(rejected.kind,'invalid');
  assert.match(JSON.stringify(rejected),/historia de vida curada/);assert.equal(canonicalJson(legacy),before);
  const rich=withBiography(strict),accepted=validateRunConfiguration({draft:rich});assert.equal(accepted.kind,'ready');
  if(accepted.kind!=='ready')throw new Error('rich fixture');
  assert.deepEqual(accepted.configuration.characterDefinitionPolicy,{kind:'embodied-v1'});
  assert.equal(accepted.configuration.roster.preparedCharacters[0]?.initialExperience.value.kind,'none');
});

test('journal sella política en toda preparación nueva, conserva historia y no permite quitarla mediante PATCH',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-embodied-policy-')),journal=openJournal({path:join(directory,'journal.sqlite')});
  try{
    const created=journal.createRunConfigurationDraft({principalId:'test-operator',idempotencyKey:randomUUID()});assert.equal(created.kind,'created');if(created.kind!=='created')throw new Error('draft');
    assert.deepEqual(created.draft.characterDefinitionPolicy,{kind:'embodied-v1'});
    const initialHash=sha256CanonicalJson(created.draft);
    const stored=journal.updateRunConfigurationDraft({principalId:'test-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:0,patch:patch(withoutBiography())});assert.equal(stored.kind,'stored');if(stored.kind!=='stored')throw new Error('draft');
    assert.deepEqual(stored.draft.characterDefinitionPolicy,{kind:'embodied-v1'});
    const rejected=journal.validateRunConfigurationDraft({principalId:'test-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:stored.draft.revision});assert.equal(rejected.kind,'invalid');
    assert.throws(()=>journal.updateRunConfigurationDraft({principalId:'test-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:stored.draft.revision,patch:{characterDefinitionPolicy:null}}));
    assert.equal(sha256CanonicalJson(journal.readRunConfigurationDraft({runId:created.draft.runId,revision:0})),initialHash);
    assert.deepEqual(journal.readRunConfigurationDraft({runId:created.draft.runId})?.characterDefinitionPolicy,{kind:'embodied-v1'});
    assert.equal(journal.loadWorld({runId:created.draft.runId}),undefined);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('legacy sin WorldRun opta explícitamente por embodied sin retcon ni perder consumo de preparación',()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-legacy-optin-')),path=join(directory,'journal.sqlite');let journal=openJournal({path});
  try{
    const draft=createEmptyRunConfigurationDraft({runId:randomUUID(),revision:0}),recordedAt='2026-10-16T12:00:00Z',payload={draft,principalId:'historical-operator',recordedAt};
    const db=new DatabaseSync(path);try{
      db.prepare('INSERT INTO run_configuration_drafts VALUES(?,?,?,?)').run(draft.runId,0,recordedAt,recordedAt);
      db.prepare('INSERT INTO run_configuration_draft_history VALUES(?,?,?,?,?,?)').run(draft.runId,0,payload.principalId,recordedAt,canonicalJson(payload),sha256CanonicalJson(payload));
    }finally{db.close();}
    journal.configureRun({runId:draft.runId,maxCalls:10});const pulseId=randomUUID();journal.configurePulse({runId:draft.runId,pulseId,maxCalls:5});
    const request={runId:draft.runId,pulseId,jobId:randomUUID(),generation:0,requestSeq:0};journal.reserveRequest(request);journal.transitionReservation({jobId:request.jobId,generation:0,requestSeq:0,target:'dispatched'});journal.transitionReservation({jobId:request.jobId,generation:0,requestSeq:0,target:'completed'});
    const opted=journal.updateRunConfigurationDraft({principalId:'operator-now',idempotencyKey:randomUUID(),runId:draft.runId,expectedRevision:0,patch:{characterDefinitionPolicy:{kind:'embodied-v1'}}});assert.equal(opted.kind,'stored');
    assert.deepEqual(journal.readRunConfigurationDraft({runId:draft.runId})?.characterDefinitionPolicy,{kind:'embodied-v1'});
    assert.equal(journal.readRunConfigurationDraft({runId:draft.runId,revision:0})?.characterDefinitionPolicy,undefined);
    const inspect=new DatabaseSync(path);try{assert.equal(inspect.prepare('SELECT consumed FROM run_budgets WHERE run_id=?').get(draft.runId)?.consumed,1);}finally{inspect.close();}
    journal.close();journal=openJournal({path});assert.deepEqual(journal.readRunConfigurationDraft({runId:draft.runId})?.characterDefinitionPolicy,{kind:'embodied-v1'});
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});


test('PUT HTTP directo y patch journal no pueden borrar biografía o gaps curados antes de persistir',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'personajes-biography-http-')),journal=openJournal({path:join(directory,'journal.sqlite')});
  const catalog=await loadCatalog({repositoryRoot:process.cwd()}),server=createLocalHttpServer({catalog,runConfigurationDrafts:journal,shellHtml:'<html><head></head><body></body></html>'});
  try{
    const rich=withBiography(withoutBiography());assert.equal(rich.roster.kind,'configured');if(rich.roster.kind!=='configured')throw new Error('roster');
    const prepared=rich.roster.value.preparedCharacters.map(actor=>({...actor,identity:{...actor.identity,value:{...actor.identity.value,lifeHistory:{...actor.identity.value.lifeHistory,unknowns:['Nacimiento no documentado en esta prueba.'],contradictions:['Tensión sintética que sigue abierta.']}}}}));
    const current=RunConfigurationDraftSchema.parse({...rich,roster:{...rich.roster,value:{...rich.roster.value,preparedCharacters:prepared}}});
    const created=journal.createRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),patch:patch(current)});assert.equal(created.kind,'created');if(created.kind!=='created')throw new Error('draft');
    const stored=created.draft;assert.equal(stored.roster.kind,'configured');if(stored.roster.kind!=='configured')throw new Error('stored roster');
    const roster=stored.roster.value,first=roster.preparedCharacters[0];assert.ok(first&&first.identity.value.lifeHistory);
    const {lifeHistory:_history,desires:_desires,...legacyIdentity}=first.identity.value;
    const candidates=[{...first,identity:{...first.identity,value:legacyIdentity}},
      {...first,identity:{...first.identity,value:{...first.identity.value,lifeHistory:{...first.identity.value.lifeHistory,unknowns:[]}}}},
      {...first,identity:{...first.identity,value:{...first.identity.value,lifeHistory:{...first.identity.value.lifeHistory,contradictions:[]}}}}];
    const before=canonicalJson(journal.readRunConfigurationDraftHistory({runId:stored.runId}));
    for(const actor of candidates)assert.throws(()=>journal.updateRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),runId:stored.runId,expectedRevision:stored.revision,patch:{roster:{...stored.roster,value:{...roster,preparedCharacters:[actor,...roster.preparedCharacters.slice(1)]}}}}),/CHARACTER_BIOGRAPHY_/);
    const {origin}=await server.listen(),security={Origin:origin,'Content-Type':'application/json'};
    const html=await(await fetch(origin+'/',{headers:security})).text(),bootNonce=html.match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);
    const sessionResponse=await fetch(origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})}),session=SessionCreatedSchema.parse(await sessionResponse.json());
    const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
    for(const actor of candidates){
      const response:Response=await fetch(`${origin}/api/v1/runs/${stored.runId}/configuration`,{method:'PUT',headers:{...security,Cookie:cookie,'X-CSRF-Token':session.csrfToken,'Idempotency-Key':randomUUID(),'If-Match':`"run-config:${stored.runId}:c${stored.revision}"`},body:JSON.stringify({configuration:{...stored,roster:{...stored.roster,value:{...roster,preparedCharacters:[actor,...roster.preparedCharacters.slice(1)]}}}})});
      assert.equal(response.status,409,await response.clone().text());assert.match(await response.text(),/CHARACTER_BIOGRAPHY_/);
    }
    assert.equal(canonicalJson(journal.readRunConfigurationDraftHistory({runId:stored.runId})),before);
    assert.deepEqual(journal.readRunConfigurationDraft({runId:stored.runId}),stored);
    assert.equal(journal.loadWorld({runId:stored.runId}),undefined);
  }finally{await server.close();journal.close();rmSync(directory,{recursive:true,force:true});}
});
