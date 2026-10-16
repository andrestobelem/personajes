import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {DossierSchema,parseDossierMarkdown} from '../src/domain/catalog.ts';
import {hashDossierMarkdown} from '../src/adapters/catalog.ts';
import {freezeCatalogDossierSource} from '../src/application/dossier-source-repository.ts';
import {PreparationConfiguratorProposalSchema} from '../src/domain/preparation-configurator.ts';
import {PreparedCharacterSchema,type PreparedCharacter} from '../src/domain/preparation.ts';
import {draftFixture} from './fixtures/continuista.ts';
import {createEmptyRunConfigurationDraft,RunConfigurationDraftSchema} from '../src/domain/production.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {compilePreparationConfiguratorContext} from '../src/application/preparation-configurator-context.ts';
import {createPreparationConfiguratorProposalTool} from '../src/application/preparation-configurator-tools.ts';

function fixture(){
  const evidence={kind:'operator-choice',operatorId:'test',recordedAt:'2026-10-16T12:00:00Z'};
  const draft=RunConfigurationDraftSchema.parse({...createEmptyRunConfigurationDraft({runId:randomUUID(),revision:0}),budget:{kind:'configured',evidence,value:{maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:30000}},icmWorkspace:{kind:'configured',evidence,value:createIcmWorkspaceSnapshot({sources:[{sourceId:'role.configurator',audience:{role:'configurator'},revision:0,sourceHash:sha256Utf8('contract'),sections:[{sectionId:'process',markdown:'Proponer preparación.'}]}]})}});
  const context=compilePreparationConfiguratorContext({request:{kind:'preparation-configurator-request',schemaVersion:1,runId:draft.runId,draftRevision:draft.revision,draftHash:sha256CanonicalJson(draft),jobId:randomUUID(),generation:0,instructions:'Proponer fecha sin confirmar.',actorSources:[],documentIds:[]},admittedDraft:draft,admittedActorSources:[],admittedDocuments:[]});
  const proposal={kind:'preparation-configurator-proposal',schemaVersion:1,contextHash:context.contextHash,settings:[],actors:[],placements:[],openQuestions:['¿Qué fecha se elegirá?']};
  return {context,proposal,draft};
}

test('única tool de preparación valida contexto y conserva un candidato inmutable sin aplicar el borrador',async()=>{
  const f=fixture(),before=sha256CanonicalJson(f.draft),tool=createPreparationConfiguratorProposalTool({context:f.context,checkEligibility:()=>({kind:'active'})});
  assert.equal(tool.tool.name,'submit_preparation_proposal');assert.equal(tool.readCandidate(),undefined);
  await tool.tool.execute('call',f.proposal);const candidate=tool.readCandidate();assert.ok(candidate);assert.equal(candidate.contextHash,f.context.contextHash);assert.equal(candidate.proposalHash,sha256CanonicalJson(f.proposal));
  await tool.tool.execute('replay',structuredClone(f.proposal));assert.deepEqual(tool.readCandidate(),candidate);
  await assert.rejects(tool.tool.execute('different',{...f.proposal,openQuestions:['Otra fecha']}),/CANDIDATE_CONFLICT/);
  assert.equal(sha256CanonicalJson(f.draft),before);assert.deepEqual(tool.readCandidate(),candidate);
  candidate.proposal.openQuestions.push('Mutación externa');assert.deepEqual(tool.readCandidate()?.proposal.openQuestions,f.proposal.openQuestions);
});

test('cancela antes/después de eligibility, rechaza contexto ajeno y no permite autoridad generada por modelo',async()=>{
  const f=fixture(),controller=new AbortController();let checks=0;
  const tool=createPreparationConfiguratorProposalTool({context:f.context,signal:controller.signal,checkEligibility:()=>{checks++;controller.abort();return {kind:'active'};}});
  await assert.rejects(tool.tool.execute('wrong',{...f.proposal,contextHash:'0'.repeat(64)}),/CONTEXT_MISMATCH/);assert.equal(checks,0);
  await assert.rejects(tool.tool.execute('authority',{...f.proposal,consent:true}));assert.equal(checks,0);
  await assert.rejects(tool.tool.execute('aborted',f.proposal),/CANCELLED/);assert.equal(checks,1);assert.equal(tool.readCandidate(),undefined);
  await assert.rejects(tool.tool.execute('again',f.proposal),/CANCELLED/);assert.equal(checks,1);
  const inactive=createPreparationConfiguratorProposalTool({context:f.context,checkEligibility:()=>({kind:'inactive',reason:'stale draft'})});
  await assert.rejects(inactive.tool.execute('inactive',f.proposal),/INACTIVE/);assert.equal(inactive.readCandidate(),undefined);
});


function actorFixture(existing?:PreparedCharacter){
  const base=fixture(),characterId=existing?.characterId??'personaje-prueba',markdown='# Expediente sintético de contradicciones\nFuente de prueba.';
  const documentary='PRIVATE-DOSSIER-CONTRADICTION-CONTENT';
  const source=freezeCatalogDossierSource(DossierSchema.parse({...parseDossierMarkdown({characterId,displayName:'Actor de prueba',markdown,contentHash:hashDossierMarkdown(markdown)}),contradictions:[documentary]}));
  const evidence={kind:'operator-choice',operatorId:'test',recordedAt:'2026-10-16T12:00:00Z'};
  const draft=RunConfigurationDraftSchema.parse({...base.draft,roster:{kind:'configured',evidence,value:{eligibleCharacterIds:[characterId],activeCharacterIds:[characterId],preparedCharacters:existing===undefined?[]:[existing]}}});
  const context=compilePreparationConfiguratorContext({request:{...base.context.request,draftHash:sha256CanonicalJson(draft),actorSources:[{kind:source.kind,characterId:source.characterId,revision:source.revision,contentHash:source.contentHash,fullArchiveHash:source.fullArchiveHash}]},admittedDraft:draft,admittedActorSources:[source],admittedDocuments:[]});
  const proposal=PreparationConfiguratorProposalSchema.parse({...base.proposal,contextHash:context.contextHash,actors:[{characterId,sourceFullHash:source.fullArchiveHash,sections:[],unknowns:source.frozenDossier.unknowns,contradictions:[documentary,...(existing?.identity.value.contradictions??[])],contradictionTreatments:[]}]});
  return {context,proposal,documentary};
}

test('primera preparación explica treatments documentales incorrectos y acepta [] sin divulgar contradicciones privadas',async()=>{
  const f=actorFixture(),actor=f.proposal.actors[0];assert.ok(actor);
  const tool=createPreparationConfiguratorProposalTool({context:f.context,checkEligibility:()=>({kind:'active'})});
  assert.match(JSON.stringify(tool.tool.parameters),/PREVIAMENTE curadas/);
  assert.match(JSON.stringify(tool.tool.parameters),/Usar \[\] si no existe identidad curada previa/);
  const wrong={...f.proposal,actors:[{...actor,contradictionTreatments:[{contradiction:f.documentary,reason:'Confunde contradicción documental con eliminación de identidad previa.',sourceRefs:[]}]}]};
  await assert.rejects(tool.tool.execute('wrong-documentary-treatment',wrong),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/IDENTITY_CONTRADICTION_TREATMENT_REQUIRED/);
    assert.match(error.message,/Si no hay identidad curada previa/);assert.match(error.message,/contradictionTreatments: \[\]/);
    assert.match(error.message,/actors\[\]\.contradictions/);assert.doesNotMatch(error.message,/PRIVATE-DOSSIER/);return true;
  });
  assert.equal(tool.readCandidate(),undefined);
  await tool.tool.execute('corrected-empty-treatments',f.proposal);
  const accepted=tool.readCandidate();assert.ok(accepted);assert.deepEqual(accepted.proposal.actors[0]?.contradictionTreatments,[]);
  assert.deepEqual(accepted.proposal.actors[0]?.contradictions,[f.documentary]);
});

test('feedback no relaja el tratamiento obligatorio de una contradicción curada que se elimina',async()=>{
  const draft=draftFixture();assert.ok(draft.roster.kind==='configured');const existing=draft.roster.value.preparedCharacters[0];assert.ok(existing);
  const previous=PreparedCharacterSchema.parse({...existing,identity:{...existing.identity,value:{...existing.identity.value,contradictions:['PRIVATE-CURATED-CONTRADICTION-CONTENT']}}});
  const f=actorFixture(previous),actor=f.proposal.actors[0];assert.ok(actor);assert.ok(previous.identity.value.lifeHistory);
  const identity={...previous.identity.value,contradictions:[],lifeHistory:{...previous.identity.value.lifeHistory,contradictions:[...previous.identity.value.lifeHistory.contradictions,...actor.contradictions]}};
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:[{...actor,sections:[{section:'identity',value:identity,reason:'Adaptación propuesta que conserva la contradicción en su historia y explica su revisión.',sourceRefs:[],treatment:'declared-adaptation',unknowns:[]}]}]});
  const tool=createPreparationConfiguratorProposalTool({context:f.context,checkEligibility:()=>({kind:'active'})});
  await assert.rejects(tool.tool.execute('missing-required-treatment',proposal),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/un tratamiento por cada una/);assert.doesNotMatch(error.message,/PRIVATE-CURATED/);return true;
  });
  assert.equal(tool.readCandidate(),undefined);
  const treated={...proposal,actors:[{...proposal.actors[0],contradictionTreatments:[{contradiction:'PRIVATE-CURATED-CONTRADICTION-CONTENT',reason:'Revisión explícita de la identidad anterior, pendiente de aprobación.',sourceRefs:[]}]}]};
  await tool.tool.execute('required-treatment-supplied',treated);assert.ok(tool.readCandidate());
});

test('rechazos documentales y de reparto indican ubicación, IDs admitidos y que se reenvíe la propuesta completa',async()=>{
  const f=actorFixture(),actor=f.proposal.actors[0];assert.ok(actor);
  const tool=createPreparationConfiguratorProposalTool({context:f.context,checkEligibility:()=>({kind:'active'})});
  const documentary=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:[{...actor,sections:[{section:'inventory',value:[],reason:'Sin objetos documentados.',sourceRefs:[],treatment:'documentary-selection',unknowns:[]}]}]});
  await assert.rejects(tool.tool.execute('documentary-without-refs',documentary),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/^PREPARATION_CONFIGURATOR_DOCUMENTARY_REFERENCE_REQUIRED: /);
    assert.match(error.message,/actors\.personaje-prueba\.inventory/);assert.match(error.message,/IDs admitidos: ninguno/);
    assert.match(error.message,/usá declared-adaptation/);assert.match(error.message,/propuesta completa/);return true;
  });
  await assert.rejects(tool.tool.execute('empty-actors',{...f.proposal,actors:[]}),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/^PREPARATION_CONFIGURATOR_PROPOSAL_ACTORS_MISMATCH: /);
    assert.match(error.message,/\(personaje-prueba\)/);return true;
  });
  assert.equal(tool.readCandidate(),undefined);
});
