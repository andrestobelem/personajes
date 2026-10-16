import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {DossierSchema,parseDossierMarkdown} from '../src/domain/catalog.ts';
import {hashDossierMarkdown,exportDossier} from '../src/adapters/catalog.ts';
import {freezeCatalogDossierSource,validateFrozenDossierSource} from '../src/application/dossier-source-repository.ts';
import {DossierSourceReferenceSchema,type DossierSource} from '../src/domain/dossier-source.ts';
import {canonicalJson,sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {createEmptyRunConfigurationDraft,RunConfigurationDraftSchema} from '../src/domain/production.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {PreparationConfiguratorProposalSchema,PreparationConfiguratorRequestSchema} from '../src/domain/preparation-configurator.ts';
import {compilePreparationConfiguratorContext,validatePreparationConfiguratorProposal} from '../src/application/preparation-configurator-context.ts';
import {applyPreparationConfiguratorSelection,PreparationConfiguratorSelectionSchema} from '../src/application/preparation-configurator-application.ts';
import {PreparationFieldSchema} from '../src/domain/preparation.ts';
import {WorldSnapshotSchema} from '../src/domain/world-schema.ts';
import {draftFixture} from './fixtures/continuista.ts';

function fixture(){
  const sources=['maxwell-smart','hymie'].map(characterId=>{
    const markdown=`# ${characterId}\n\nIdentidad de prueba; no documenta canon.`;
    const parsed=parseDossierMarkdown({characterId,displayName:characterId,markdown,contentHash:hashDossierMarkdown(markdown)});
    const dossier=DossierSchema.parse({...parsed,sourceRefs:[{id:`${characterId}-source`,kind:'documentary',reference:'Fuente sintética',scope:'Prueba pura',uncertainty:'No acredita canon'}],
      unknowns:[`Vacío documental ${characterId}`],contradictions:[`Contradicción documental ${characterId}`]});
    return freezeCatalogDossierSource(dossier);
  });
  const document={sourceId:'declared-setting',text:'Adaptación editorial para la puesta, no episodio canónico.',fullHash:sha256Utf8('Adaptación editorial para la puesta, no episodio canónico.')};
  const evidence={kind:'operator-choice',operatorId:'test-operator',recordedAt:'2026-10-16T12:00:00Z'};
  const workspace=createIcmWorkspaceSnapshot({sources:[{sourceId:'role.configurator',audience:{role:'configurator'},revision:0,sourceHash:sha256Utf8('setup'),sections:[{sectionId:'process',markdown:'ICM_CONFIGURATOR_ONLY: proponer una puesta, sin actuar.'}]}]});
  const draft=RunConfigurationDraftSchema.parse({...createEmptyRunConfigurationDraft({runId:randomUUID(),revision:3}),
    roster:{kind:'configured',evidence,value:{eligibleCharacterIds:[...sources.map(source=>source.characterId),'agente-99'],activeCharacterIds:sources.map(source=>source.characterId),preparedCharacters:[]}},
    budget:{kind:'configured',evidence,value:{maxPiCallsPerRun:null,maxPiCallsPerPulse:null,maxConcurrentPiRequests:1,maxWallTimeMs:null,requestTimeoutMs:30000}},
    icmWorkspace:{kind:'configured',evidence,value:workspace}});
  const request=PreparationConfiguratorRequestSchema.parse({kind:'preparation-configurator-request',schemaVersion:1,runId:draft.runId,draftRevision:draft.revision,draftHash:sha256CanonicalJson(draft),jobId:randomUUID(),generation:0,
    instructions:'Preparar una propuesta extensa de puesta y una curación separada para cada actor, conservando límites.',
    actorSources:sources.map(source=>({kind:source.kind,characterId:source.characterId,revision:source.revision,contentHash:source.contentHash,fullArchiveHash:source.fullArchiveHash})),documentIds:[document.sourceId]});
  const input={request,admittedDraft:draft,admittedActorSources:sources,admittedDocuments:[document]};
  const context=compilePreparationConfiguratorContext(input);
  const explanation={reason:'Adaptación editorial de prueba pendiente de revisión del operador.',sourceRefs:[document.sourceId],treatment:'declared-adaptation',unknowns:[]};
  const proposal=PreparationConfiguratorProposalSchema.parse({kind:'preparation-configurator-proposal',schemaVersion:1,contextHash:context.contextHash,
    settings:[{section:'name',value:'Ensayo propuesto',...explanation},{section:'worldLayout',value:{places:[{id:'sala',name:'Sala propuesta',width:10,height:8,lighting:'normal'}]},...explanation},
      {section:'continuity',value:{continuityId:'adaptacion-prueba',kind:'adaptation',label:'Continuidad propuesta, sin hechos canónicos importados',milestones:[],inclusions:[]},...explanation}],
    actors:sources.map(source=>({characterId:source.characterId,sourceFullHash:source.fullArchiveHash,unknowns:source.frozenDossier.unknowns,contradictions:source.frozenDossier.contradictions,contradictionTreatments:[],
      sections:[{section:'identity',value:{selfReference:source.characterId,selfConcept:'Identidad propuesta, sujeta a curación.',values:[],dispositions:['Atento al interlocutor'],contradictions:[]},...explanation},
        {section:'voice',value:{kind:'spoken',recipe:'Español de doblaje; voz distinta y situada, sin afirmar una voz creada.'},...explanation},
        {section:'antecedents',value:[],...explanation},{section:'goals',value:[{kind:'situated',goalId:'entender-pregunta',ownerCharacterId:source.characterId,desiredOutcome:'Entender la consulta',priority:0.5,reviewConditions:[],status:'active',evidenceRefs:[]}],...explanation},
        {section:'relationships',value:[],...explanation},{section:'capabilities',value:[{capabilityId:'hablar',kind:'speech',description:'Habla propuesta'}],...explanation},
        {section:'inventory',value:[],...explanation},{section:'initialExperience',value:{kind:'none'},...explanation},
        {section:'unknownPolicy',value:{defaultTreatment:'do-not-infer-or-assert',fields:source.frozenDossier.unknowns.map(topic=>({kind:'source-not-established',topic}))},...explanation}]})),
    placements:[],openQuestions:['Elegir fecha, lugar definitivo y presencia humana; no están confirmados.']});
  return {input,context,proposal,sources,draft,document};
}

function apply(f:ReturnType<typeof fixture>,selection:unknown,proposal:unknown=f.proposal){
  const ids=new Map<string,string>();
  return applyPreparationConfiguratorSelection({context:f.context,proposal,proposalId:'00000000-0000-4000-8000-000000000900',currentDraft:f.draft,selection,
    host:{principalId:'authenticated-operator',recordedAt:'2026-10-16T14:00:00Z',uuid:key=>{let id=ids.get(key);if(id===undefined){id=randomUUID();ids.set(key,id);}return id;}}});
}
const fullActors=(f:ReturnType<typeof fixture>)=>f.proposal.actors.map(actor=>({characterId:actor.characterId,sections:PreparationFieldSchema.options}));

test('aplica sólo secciones seleccionadas, metadata del host y ninguna elección protegida',()=>{
  const f=fixture(),before=canonicalJson(f.context);
  const result=apply(f,{settings:['name'],actors:[],placements:[]});
  assert.deepEqual(Object.keys(result.patch),['name']);
  assert.deepEqual(result.appliedFields,['settings.name']);
  assert.equal(result.nextDraft.name.kind==='configured'&&result.nextDraft.name.value,'Ensayo propuesto');
  assert.deepEqual(result.nextDraft.name.kind==='configured'&&result.nextDraft.name.evidence,{kind:'operator-choice',operatorId:'authenticated-operator',recordedAt:'2026-10-16T14:00:00Z'});
  for(const key of ['roster','inferenceProfile','budget','icmWorkspace','humanParticipants','worldSnapshot'] as const)assert.deepEqual(result.nextDraft[key],f.draft[key]);
  assert.equal(canonicalJson(f.context),before);
});

test('curación completa publica preparado con procedencia exacta, metadata host y vacíos documentales preservados',()=>{
  const f=fixture();const result=apply(f,{settings:['continuity'],actors:fullActors(f),placements:[]});
  assert.equal(result.nextDraft.roster.kind,'configured');
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  assert.equal(result.nextDraft.roster.value.preparedCharacters.length,2);
  assert.deepEqual(result.nextDraft.roster.value.preparationDrafts,[]);
  for(const actor of result.nextDraft.roster.value.preparedCharacters){
    const source=f.sources.find(source=>source.characterId===actor.characterId);assert.ok(source);
    assert.deepEqual(actor.dossierSource,source);
    assert.deepEqual(actor.dossierSource?.frozenDossier.unknowns,source.frozenDossier.unknowns);
    assert.deepEqual(actor.dossierSource?.frozenDossier.contradictions,source.frozenDossier.contradictions);
    assert.equal(actor.identity.provenance.kind,'explicit-adaptation');
    if(actor.identity.provenance.kind!=='explicit-adaptation')assert.fail('Sin adaptación');
    assert.equal(actor.identity.provenance.authoredBy,'authenticated-operator');
    assert.deepEqual(actor.identity.provenance.sourceRefs,[],'no falsifica evidencia del dossier para un documento externo');
    assert.match(actor.identity.provenance.reason,/declared-setting/);
  }
  assert.equal(result.review.state,'proposed-only','aplicar no reescribe la propuesta original como canon');
});

test('selección parcial nueva se conserva sin completar defaults ni ejecutar actores',()=>{
  const f=fixture();const actor=f.proposal.actors[0];assert.ok(actor);
  const result=apply(f,{settings:['continuity'],actors:[{characterId:actor.characterId,sections:['identity']}],placements:[]});
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  assert.deepEqual(result.nextDraft.roster.value.preparedCharacters,[]);
  const partial=result.nextDraft.roster.value.preparationDrafts?.[0];assert.ok(partial);
  assert.equal(partial.identity.kind,'declared');
  for(const field of PreparationFieldSchema.options.filter(field=>field!=='identity'))assert.equal(partial[field].kind,'empty');
  assert.equal(result.nextDraft.worldSnapshot.kind,'empty');
});

test('rechaza referencias seleccionadas ausentes, duplicadas, vacías o cortes ajenos',()=>{
  const f=fixture();
  for(const selection of [
    {settings:[],actors:[],placements:[]},
    {settings:['name','name'],actors:[],placements:[]},
    {settings:['fictionalAt'],actors:[],placements:[]},
    {settings:[],actors:[{characterId:'agente-99',sections:['identity']}],placements:[]},
  ])assert.throws(()=>apply(f,selection));
  assert.equal(PreparationConfiguratorSelectionSchema.safeParse({settings:['budget'],actors:[],placements:[]}).success,false);
  assert.throws(()=>apply({...f,draft:RunConfigurationDraftSchema.parse({...f.draft,revision:4})},{settings:['name'],actors:[],placements:[]}),/DRAFT_STALE/);
});

test('fuentes externas documentales usan declaración curatorial sin convertirlas en evidencia de expediente',()=>{
  const f=fixture();const actor=f.proposal.actors[0];assert.ok(actor);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:f.proposal.actors.map(value=>({...value,sections:value.sections.map(section=>({...section,treatment:'documentary-selection'}))}))});
  const result=apply(f,{settings:['continuity'],actors:fullActors(f),placements:[]},proposal);
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  const prepared=result.nextDraft.roster.value.preparedCharacters[0];assert.ok(prepared);
  assert.equal(prepared.identity.provenance.kind,'curator-declaration');
  assert.deepEqual(prepared.identity.provenance.kind==='curator-declaration'&&prepared.identity.provenance.sourceRefs,[]);
  assert.deepEqual(result.review.proposal.actors[0]?.sections[0]?.sourceRefs,['declared-setting']);
});

test('un contexto parcial conserva contradicciones y vacíos antes de otra propuesta',()=>{
  const f=fixture();const actor=f.proposal.actors[0];assert.ok(actor);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:f.proposal.actors.map(value=>({...value,sections:value.sections.map(section=>section.section==='identity'?{...section,value:{...section.value,contradictions:['Contradicción ya curada']}}:section)}))});
  const result=apply(f,{settings:['continuity'],actors:[{characterId:actor.characterId,sections:['identity','unknownPolicy']}],placements:[]},proposal);
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:result.nextDraft,request:{...f.input.request,draftHash:sha256CanonicalJson(result.nextDraft)}});
  const nextProposal=PreparationConfiguratorProposalSchema.parse({...proposal,contextHash:context.contextHash});
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:nextProposal}),/GAPS_REMOVED/);
  const preserved=PreparationConfiguratorProposalSchema.parse({...nextProposal,actors:nextProposal.actors.map(value=>value.characterId===actor.characterId?{...value,contradictions:[...value.contradictions,'Contradicción ya curada']}:value)});
  assert.deepEqual(validatePreparationConfiguratorProposal({context,proposal:preserved}),preserved);
});

test('no inventa modelo TTS al aceptar habilitación de audio incompleta',()=>{
  const f=fixture();const setting=f.proposal.settings[0];assert.ok(setting);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,settings:[...f.proposal.settings,{...setting,section:'audio',value:{kind:'enabled'}}]});
  assert.throws(()=>apply(f,{settings:['audio'],actors:[],placements:[]},proposal),/AUDIO_CONFIGURATION_REQUIRED/);
  assert.equal(f.draft.audio.kind==='configured'&&f.draft.audio.value.mode.kind,'disabled');
});

function physicalProposal(f:ReturnType<typeof fixture>){
  const base=draftFixture();if(base.worldSnapshot.kind==='empty')assert.fail('Falta world fixture');
  const world=WorldSnapshotSchema.parse(base.worldSnapshot.value);
  const actor=world.entities.find(entity=>entity.kind==='character');assert.ok(actor);
  const explanation=f.proposal.settings[0];assert.ok(explanation);
  const {kind:_kind,entityId:_id,preparation:_preparation,capabilities:_capabilities,mind:_mind,...physical}=actor;
  const layout={clock:world.clock,places:world.places,doors:world.doors,connections:world.connections,perceptualPaths:world.perceptualPaths,
    channels:world.channels,entities:world.entities.filter(entity=>entity.kind!=='character'),inventory:world.inventory,
    scenes:world.scenes.map(scene=>({...scene,participantIds:f.sources.map(source=>source.characterId)})),activeSceneId:world.activeSceneId,actionDurations:world.actionDurations};
  return PreparationConfiguratorProposalSchema.parse({...f.proposal,
    settings:[...f.proposal.settings.filter(setting=>setting.section!=='worldLayout'),{...explanation,section:'worldLayout',value:layout}],
    placements:f.sources.map((source,index)=>({...physical,characterId:source.characterId,position:{x:2+index*2,y:2},
      recognizedCharacterIds:f.sources.filter(other=>other.characterId!==source.characterId).map(other=>other.characterId),
      reason:explanation.reason,sourceRefs:explanation.sourceRefs,treatment:explanation.treatment,unknowns:[]}))});
}

test('aplica placement con identidad física y metas del host, sin aceptar mentes del modelo',()=>{
  const f=fixture(),proposal=physicalProposal(f);
  const result=apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:f.sources.map(source=>source.characterId)},proposal);
  if(result.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Sin world');
  const actors=result.nextDraft.worldSnapshot.value.entities?.filter(entity=>entity.kind==='character');assert.equal(actors?.length,2);
  for(const actor of actors??[]){
    assert.equal(actor.preparation.kind,'prepared');
    assert.deepEqual(actor.capabilities,['speak']);
    assert.equal(actor.mind.goals.length,1);
    assert.equal(actor.mind.goals[0]?.sourceGoalId,'entender-pregunta');
    assert.deepEqual(actor.mind.experiences,[]);
    assert.deepEqual(actor.mind.beliefs,[]);
  }
  assert.deepEqual(result.nextDraft.humanParticipants,f.draft.humanParticipants);
});

test('placement del configurador respeta acciones preparadas tipadas e ignora palabras en descripciones',()=>{
  const f=fixture(),base=physicalProposal(f);
  const proposal=PreparationConfiguratorProposalSchema.parse({...base,actors:base.actors.map(actor=>({...actor,sections:actor.sections.map(section=>section.section==='capabilities'?{
    ...section,value:[
      {capabilityId:`observe-${actor.characterId}`,kind:'world-action',action:'observe',description:'La descripción dice take, pero la acción curada es observar.'},
      {capabilityId:`other-${actor.characterId}`,kind:'other',description:'take offer wait rest observe'},
    ],
  }:section)}))});
  const result=apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:f.sources.map(source=>source.characterId)},proposal);
  if(result.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Sin world');
  const actors=result.nextDraft.worldSnapshot.value.entities?.filter(entity=>entity.kind==='character');assert.equal(actors?.length,2);
  for(const actor of actors??[]){assert.deepEqual(actor.capabilities,['observe']);assert.ok(!actor.capabilities.includes('take'));}
});

test('materialización de inventario requiere propiedades explícitas y no crea objetos por defecto',()=>{
  const f=fixture(),base=physicalProposal(f);
  const proposal=PreparationConfiguratorProposalSchema.parse({...base,actors:base.actors.map(actor=>({...actor,sections:actor.sections.map(section=>section.section==='inventory'?{
    ...section,value:[{itemId:'objeto-pendiente',name:'Objeto curado',description:'Sin propiedades físicas confirmadas.',quantity:1,condition:'unknown'}],
  }:section)}))});
  const actor=f.sources[0];assert.ok(actor);
  assert.throws(()=>apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:[actor.characterId]},proposal),/MATERIAL_CONFIGURATION_REQUIRED/);
  assert.equal(f.draft.worldSnapshot.kind,'empty');
});

test('preserve-existing conserva experiencia curada y su procedencia sin nueva memoria ni autoría',()=>{
  const f=fixture();const first=apply(f,{settings:['continuity'],actors:fullActors(f),placements:[]});
  if(first.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  const prepared=first.nextDraft.roster.value.preparedCharacters[0];assert.ok(prepared);
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:first.nextDraft,request:{...f.input.request,draftHash:sha256CanonicalJson(first.nextDraft)}});
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,contextHash:context.contextHash,
    actors:f.proposal.actors.map(actor=>({...actor,sections:actor.sections.map(section=>section.section==='initialExperience'?{...section,value:{kind:'preserve-existing'}}:section)}))});
  const result=apply({...f,context,draft:first.nextDraft},{settings:[],actors:[{characterId:prepared.characterId,sections:['initialExperience']}],placements:[]},proposal);
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  assert.deepEqual(result.nextDraft.roster.value.preparedCharacters.find(actor=>actor.characterId===prepared.characterId)?.initialExperience,prepared.initialExperience);
});

test('cambiar continuidad y una sección no reetiqueta curaciones previas ni mantiene al actor habilitado',()=>{
  const f=fixture();const first=apply(f,{settings:['continuity'],actors:fullActors(f),placements:[]});
  if(first.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  const original=first.nextDraft.roster.value.preparedCharacters[0];assert.ok(original);
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:first.nextDraft,request:{...f.input.request,draftHash:sha256CanonicalJson(first.nextDraft)}});
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,contextHash:context.contextHash});
  const result=apply({...f,context,draft:first.nextDraft},{settings:['continuity'],actors:[{characterId:original.characterId,sections:['identity']}],placements:[]},proposal);
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  assert.equal(result.nextDraft.roster.value.preparedCharacters.some(actor=>actor.characterId===original.characterId),false);
  const partial=result.nextDraft.roster.value.preparationDrafts?.find(actor=>actor.characterId===original.characterId);assert.ok(partial);
  assert.deepEqual(partial.continuity,original.continuity,'el host no relabela la preparación antigua como si hubiera sido revisada');
  assert.deepEqual(partial.voice.kind==='declared'&&partial.voice.value,original.voice);
});

test('las once secciones de puesta quedan configuradas sólo cuando fueron elegidas',()=>{
  const f=fixture(),explanation=f.proposal.settings[0];assert.ok(explanation);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,settings:[...f.proposal.settings,
    {...explanation,section:'fictionalAt',value:-123456789},
    {...explanation,section:'dramaticLine',value:{purpose:'Explorar el aviso sin decidir por los personajes.',question:{kind:'absent'},conflict:{kind:'not-formulated'}}},
    {...explanation,section:'dramaticReferences',value:[]},
    {...explanation,section:'circadianPolicy',value:{kind:'manual-only'}},
    {...explanation,section:'spanishVariety',value:{kind:'proposed',label:'Doblaje de prueba propuesto.',source:'editorial-proposal'}},
    {...explanation,section:'narrationMode',value:{kind:'disabled'}},
    {...explanation,section:'maxReformulations',value:0},
    {...explanation,section:'audio',value:{kind:'disabled'}},
  ]});
  const result=apply(f,{settings:proposal.settings.map(setting=>setting.section),actors:[],placements:[]},proposal);
  assert.equal(result.appliedFields.length,11);
  assert.equal(Object.keys(result.patch).length,11);
  assert.equal('worldSnapshot' in result.patch,true);
  assert.equal('worldLayout' in result.patch,false);
  assert.equal(result.nextDraft.fictionalAt.kind==='configured'&&result.nextDraft.fictionalAt.value,-123456789);
  assert.equal(result.nextDraft.spanishVariety.kind==='configured'&&result.nextDraft.spanishVariety.value.kind,'proposed','aceptar la propuesta no finge confirmación de variedad vocal');
});

test('dos adaptaciones con igual revisión y Markdown requieren recurar nueve secciones antes de cambiar fuente completa',()=>{
  const f=fixture(),original=f.sources[0];assert.ok(original);
  // Synthetic saved-adaptation snapshots, with complete valid archive lineage.
  const saved=(alias:string)=>{
    const predecessor=DossierSchema.parse({...original.frozenDossier,aliases:[alias]});
    const adaptationId=randomUUID();
    const dossier=DossierSchema.parse({...predecessor,revision:predecessor.revision+1,adaptations:[...predecessor.adaptations,{
      adaptationId,basedOnHash:predecessor.contentHash,reason:'Adaptación sintética explícita de metadata.',createdAt:'2026-10-16T10:00:00Z',
    }]});
    return validateFrozenDossierSource({kind:'saved-adaptation',characterId:dossier.characterId,revision:dossier.revision,contentHash:dossier.contentHash,
      fullArchiveHash:sha256Utf8(exportDossier(dossier)),importedArchiveHash:sha256Utf8(exportDossier(predecessor)),importId:randomUUID(),adaptationId,frozenDossier:dossier});
  };
  const sourceA=saved('Fuente completa A'),sourceB=saved('Fuente completa B');
  assert.equal(sourceA.revision,sourceB.revision);assert.equal(sourceA.contentHash,sourceB.contentHash);
  assert.notEqual(sourceA.fullArchiveHash,sourceB.fullArchiveHash);
  const rebase=(draft:ReturnType<typeof fixture>['draft'],sources:DossierSource[])=>{
    const references=sources.map(source=>DossierSourceReferenceSchema.parse(source.kind==='catalog-original'?{
      kind:source.kind,characterId:source.characterId,revision:source.revision,contentHash:source.contentHash,fullArchiveHash:source.fullArchiveHash,
    }:{kind:source.kind,characterId:source.characterId,revision:source.revision,contentHash:source.contentHash,fullArchiveHash:source.fullArchiveHash,importId:source.importId,adaptationId:source.adaptationId}));
    const input={...f.input,admittedDraft:draft,admittedActorSources:sources,request:{...f.input.request,draftHash:sha256CanonicalJson(draft),actorSources:references}};
    const context=compilePreparationConfiguratorContext(input);
    const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,contextHash:context.contextHash,
      actors:f.proposal.actors.map(actor=>({...actor,sourceFullHash:sources.find(source=>source.characterId===actor.characterId)?.fullArchiveHash}))});
    return {...f,input,context,proposal,sources,draft};
  };
  const firstInput=rebase(f.draft,[sourceA,...f.sources.slice(1)]);
  const first=apply(firstInput,{settings:['continuity'],actors:fullActors(firstInput),placements:[]});
  if(first.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  const preparedA=first.nextDraft.roster.value.preparedCharacters.find(actor=>actor.characterId===sourceA.characterId);assert.ok(preparedA);
  const before=canonicalJson(first.nextDraft);
  const nextInput=rebase(first.nextDraft,[sourceB,...f.sources.slice(1)]);
  assert.throws(()=>apply(nextInput,{settings:[],actors:[{characterId:sourceB.characterId,sections:['identity']}],placements:[]}),/SOURCE_RECURATION_REQUIRED/);
  assert.equal(canonicalJson(first.nextDraft),before,'rechazar no modifica la curación ni la fuente A');
  assert.deepEqual(preparedA.dossierSource,sourceA);
  const full=apply(nextInput,{settings:[],actors:[{characterId:sourceB.characterId,sections:PreparationFieldSchema.options}],placements:[]});
  if(full.nextDraft.roster.kind!=='configured')assert.fail('Sin roster');
  const preparedB=full.nextDraft.roster.value.preparedCharacters.find(actor=>actor.characterId===sourceB.characterId);assert.ok(preparedB);
  assert.deepEqual(preparedB.dossierSource,sourceB);
  assert.notDeepEqual(preparedB.voice.provenance,preparedA.voice.provenance,'la sección voice se recura explícitamente y no conserva procedencia A bajo encabezado B');
});

test('worldLayout y placements desde empty producen snapshot completo sin ofertas ni acontecimientos fabricados',()=>{
  const f=fixture(),proposal=physicalProposal(f);
  assert.equal(f.draft.worldSnapshot.kind,'empty');
  assert.equal(Object.hasOwn(proposal.settings.find(setting=>setting.section==='worldLayout')?.value??{},'offers'),false,'el modelo no puede entregar ofertas');
  const result=apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:f.sources.map(source=>source.characterId)},proposal);
  if(result.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Falta world');
  const world=WorldSnapshotSchema.parse(result.nextDraft.worldSnapshot.value);
  assert.deepEqual(world.offers,[]);
  assert.equal(world.seq,0,'la preparación no registra hechos ficticios');
  assert.equal(world.revision,0);
  assert.equal(world.entities.filter(entity=>entity.kind==='character').length,2);
});

test('aceptar worldLayout preserva ofertas existentes y no completa una ausencia en candidato previo',()=>{
  const f=fixture(),proposal=physicalProposal(f);
  const first=apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:f.sources.map(source=>source.characterId)},proposal);
  if(first.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Falta world');
  const world=WorldSnapshotSchema.parse(first.nextDraft.worldSnapshot.value);
  const owner=world.entities.find(entity=>entity.kind==='character');assert.ok(owner);
  const recipient=world.entities.find(entity=>entity.kind==='character'&&entity.characterId!==owner.characterId);assert.ok(recipient);if(recipient.kind!=='character')assert.fail('Falta destinatario');
  const objectId=randomUUID();
  const existing=WorldSnapshotSchema.parse({...world,entities:[...world.entities,{kind:'object',entityId:objectId,label:'Objeto existente',description:'Objeto de un candidato anterior.',collisionRadius:0,blocksMovement:false,portable:true}],
    inventory:[...world.inventory,{objectEntityId:objectId,location:{kind:'heldBy',entityId:owner.entityId},revision:0}],
    offers:[{state:'open',id:randomUUID(),handle:'oferta-previa',objectEntityId:objectId,ownerEntityId:owner.entityId,recipientCharacterId:recipient.characterId,objectRevision:0,createdAt:world.clock.instant,expiresAt:world.clock.instant+1000}]});
  for(const candidate of [existing,((value)=>{const {offers:_offers,...withoutOffers}=value;return withoutOffers;})(existing)]){
    const draft=RunConfigurationDraftSchema.parse({...first.nextDraft,worldSnapshot:{...first.nextDraft.worldSnapshot,value:candidate}});
    const input={...f.input,admittedDraft:draft,request:{...f.input.request,draftHash:sha256CanonicalJson(draft)}};
    const context=compilePreparationConfiguratorContext(input);
    const nextProposal=PreparationConfiguratorProposalSchema.parse({...proposal,contextHash:context.contextHash,
      settings:proposal.settings.map(setting=>setting.section==='worldLayout'?{...setting,value:{...setting.value,entities:existing.entities.filter(entity=>entity.kind!=='character'),inventory:existing.inventory}}:setting)});
    const result=apply({...f,input,context,draft},{settings:['worldLayout'],actors:[],placements:[]},nextProposal);
    if(result.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Falta world');
    assert.deepEqual(result.nextDraft.worldSnapshot.value.offers,'offers' in candidate?candidate.offers:undefined);
    assert.equal(Object.hasOwn(result.nextDraft.worldSnapshot.value,'offers'),Object.hasOwn(candidate,'offers'));
    assert.equal(WorldSnapshotSchema.safeParse(result.nextDraft.worldSnapshot.value).success,Object.hasOwn(candidate,'offers'),'un candidato que no declara ofertas sigue pendiente');
  }
});

test('placement presente en una escena sin participantes los incorpora como al colocar manualmente',()=>{
  const f=fixture(),physical=physicalProposal(f);
  const proposal=PreparationConfiguratorProposalSchema.parse({...physical,settings:physical.settings.map(setting=>setting.section==='worldLayout'
    ?{...setting,value:{...setting.value,scenes:setting.value.scenes?.map(({participantIds:_omitted,...scene})=>scene)}}:setting)});
  const result=apply(f,{settings:['continuity','worldLayout'],actors:fullActors(f),placements:f.sources.map(source=>source.characterId)},proposal);
  if(result.nextDraft.worldSnapshot.kind!=='configured')assert.fail('Sin world');
  const world=result.nextDraft.worldSnapshot.value;
  const present=(world.entities??[]).flatMap(entity=>entity.kind==='character'&&entity.presence.kind==='present'?[{characterId:entity.characterId,sceneId:entity.presence.sceneId}]:[]);
  assert.equal(present.length,2);
  for(const actor of present)assert.ok(world.scenes?.find(scene=>scene.id===actor.sceneId)?.participantIds?.includes(actor.characterId));
});

test('una excepción de conocimiento comparte su adaptación con la política y sus antecedentes y deja al actor preparado',()=>{
  const f=fixture(),actor=f.proposal.actors[0];assert.ok(actor);
  const sections=actor.sections.map(section=>section.section==='antecedents'?{...section,treatment:'declared-adaptation' as const,value:[
      {antecedentId:'formacion-propuesta',kind:'biography' as const,statement:'Formación añadida para esta adaptación, no canon encontrado.',applicability:{kind:'unconditional' as const}},
      ...section.value]}
    :section.section==='unknownPolicy'?{...section,treatment:'declared-adaptation' as const,value:{...section.value,fields:[...section.value.fields,
      {kind:'character-knowledge-adaptation' as const,topic:'Formación matemática no establecida',reason:'Propuesta editorial para esta puesta',antecedentIds:['formacion-propuesta']}]}}:section);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:[{...actor,sections},...f.proposal.actors.slice(1)]});
  const result=apply(f,{settings:['continuity'],actors:fullActors(f),placements:[]},proposal);
  if(result.nextDraft.roster.kind!=='configured')assert.fail('Sin reparto');
  const prepared=result.nextDraft.roster.value.preparedCharacters.find(value=>value.characterId===actor.characterId);
  if(prepared===undefined)assert.fail('La excepción de conocimiento no debe impedir la preparación completa');
  const exception=prepared.unknownPolicy.value.fields.find(field=>field.kind==='character-knowledge-adaptation');
  if(exception?.kind!=='character-knowledge-adaptation')assert.fail('Falta la excepción de conocimiento');
  assert.equal(prepared.unknownPolicy.provenance.kind==='explicit-adaptation'?prepared.unknownPolicy.provenance.adaptationId:undefined,exception.adaptationId);
  const linked=prepared.antecedents.value.find(value=>value.antecedentId==='formacion-propuesta');
  assert.equal(linked?.provenance.kind==='explicit-adaptation'?linked.provenance.adaptationId:undefined,exception.adaptationId);
});
