import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { exportDossier,loadCatalog,readDossier } from '../src/adapters/catalog.ts';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { configuratorValueHash,validateConfiguratorContext,validateConfiguratorProposal,validateConfiguratorApproval } from '../src/application/configurator-context.ts';
import { createConfiguratorProposalTool } from '../src/application/configurator-tools.ts';

async function fixture() {
  const original=await readDossier({catalog:await loadCatalog({repositoryRoot:process.cwd()}),characterId:'maxwell-smart'});
  const target={...original,unknowns:[...original.unknowns,'Vacío sintético que debe permanecer explícito'],contradictions:[...original.contradictions,'Contradicción sintética conservada']};
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const context=validateConfiguratorContext({kind:'configurator-context',schemaVersion:1,role:'configurator',scope:{kind:'preparation',operationId:randomUUID(),profile:DEFAULT_INFERENCE_PROFILE},source:original,target,sourceFullHash:hash(exportDossier(original)),targetFullHash:hash(exportDossier(target)),documents:[{sourceId:'source-test',text:'Documento sintético del operador',fullHash:hash('Documento sintético del operador')}],evolutionEvidence:[]});
  const proposal={kind:'dossier-adaptation-proposal',sourceRevision:original.revision,targetRevision:target.revision,sourceHash:original.contentHash,targetHash:target.contentHash,sourceFullHash:context.sourceFullHash,targetFullHash:context.targetFullHash,reason:'Propuesta sintética versionada; no canon',evidenceIds:[],sourceIds:['source-test'],dossier:{...target},unknownTreatments:[]};
  return {original,target,context,proposal};
}

test('Configurator binds complete source and target versions, preserves unknowns and contradictions, and stages no authority',async()=>{
  const {context,proposal,original}=await fixture();
  assert.equal(validateConfiguratorProposal({context,proposal}).kind,'dossier-adaptation-proposal');
  for(const change of [{targetFullHash:'0'.repeat(64)},{targetRevision:999},{sourceIds:['unavailable']},{operatorApproved:true}])assert.throws(()=>validateConfiguratorProposal({context,proposal:{...proposal,...change}}));
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...proposal,dossier:{...proposal.dossier,unknowns:[]}}}));
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...proposal,dossier:{...proposal.dossier,contradictions:[]}}}));
  assert.throws(()=>validateConfiguratorContext({...context,documents:[{...context.documents[0],text:'Texto reemplazado'}]}));
  const tool=createConfiguratorProposalTool({context,checkEligibility:()=>({kind:'active'})});
  const first=await tool.tool.execute('one',proposal);const replay=await tool.tool.execute('two',proposal);
  assert.equal(first.details.status,'staged');assert.equal(replay.details.status,'existing');
  assert.equal(original.adaptations.length,0);
  const candidate=tool.readCandidate();assert.ok(candidate);candidate.proposal.reason='Edición externa';assert.notEqual(tool.readCandidate()?.proposal.reason,'Edición externa');
  await assert.rejects(()=>tool.tool.execute('three',{...proposal,reason:'Otra propuesta'}));
});

test('consent names exact candidate and context; missing lived evidence cannot promote identity or alter actor history',async()=>{
  const {context,proposal}=await fixture();
  const validated=validateConfiguratorProposal({context,proposal});
  const approval={kind:'operator-consent',proposalHash:configuratorValueHash(validated),contextHash:configuratorValueHash(context),targetFullHash:context.targetFullHash,operatorId:'operator',operationId:randomUUID(),confirmedAt:new Date().toISOString()};
  assert.equal(validateConfiguratorApproval({context,proposal,approval}).approval.operatorId,'operator');
  assert.throws(()=>validateConfiguratorApproval({context,proposal,approval:{...approval,proposalHash:'0'.repeat(64)}}));
  const {dossier: _dossier,unknownTreatments:_treatments,...parent}=proposal;
  assert.throws(()=>validateConfiguratorProposal({context,proposal:{...parent,kind:'identity-promotion-proposal',expectedIdentityVersion:1,identity:{selfReference:'Yo',selfConcept:'Cambio propuesto',values:[],dispositions:['atento'],contradictions:[]},effectiveBoundary:'future-coherent-boundary',unknowns:context.target.unknowns}}));
  const controller=new AbortController();const tool=createConfiguratorProposalTool({context,signal:controller.signal,checkEligibility:()=>{controller.abort();return {kind:'active'};}});
  await assert.rejects(()=>tool.tool.execute('cancel',proposal));assert.equal(tool.readCandidate(),undefined);
});
