import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {CuratedCharacterDesiresSchema} from '../src/domain/character-biography.ts';
import {DossierSchema,parseDossierMarkdown} from '../src/domain/catalog.ts';
import {hashDossierMarkdown} from '../src/adapters/catalog.ts';
import {freezeCatalogDossierSource} from '../src/application/dossier-source-repository.ts';
import {canonicalJson,sha256CanonicalJson,sha256Utf8} from '../src/domain/canonical-json.ts';
import {createEmptyRunConfigurationDraft,RunConfigurationDraftSchema} from '../src/domain/production.ts';
import {createIcmWorkspaceSnapshot} from '../src/domain/icm-workspace.ts';
import {renderIcmContextPacket as renderPacket} from '../src/application/icm-context-compiler.ts';
import {PreparationConfiguratorProposalSchema,PreparationConfiguratorRequestSchema} from '../src/domain/preparation-configurator.ts';
import {compilePreparationConfiguratorContext,compilePreparationConfiguratorPacket,validatePreparationConfiguratorContext,
  projectPreparationConfiguratorModelContext,validatePreparationConfiguratorProposal,buildPreparationConfiguratorReview,PREPARATION_CONFIGURATOR_POLICY,preparationConfiguratorPolicy} from '../src/application/preparation-configurator-context.ts';
import {curateCharacter,characterCurationForm} from '../src/web/character-preparation.ts';
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

test('compila un borrador incompleto exacto y paquete preparation-cut sin Ready, sesiones, WorldRun ni inferencia',()=>{
  const f=fixture();assert.equal(f.context.draft.continuity.kind,'empty');assert.equal(f.context.draft.worldSnapshot.kind,'empty');
  assert.equal(f.context.budget.maxPiCallsPerRun,null);assert.equal(f.context.budget.maxWallTimeMs,null);
  assert.deepEqual(validatePreparationConfiguratorContext(f.context),f.context);
  const packet=compilePreparationConfiguratorPacket(f.context);assert.equal(packet.scope.cut.kind,'preparation-cut');assert.equal(packet.scope.audience.role,'configurator');
  const rendered=renderPacket({packet,expectedPacketHash:packet.packetHash,scope:packet.scope,workspace:f.context.workspace});
  assert.match(rendered,/ICM_CONFIGURATOR_ONLY/);assert.match(rendered,/Vacío documental/);
  assert.deepEqual(f.input.admittedDraft,f.draft);assert.equal(f.draft.roster.kind==='configured'?f.draft.roster.value.preparedCharacters.length:-1,0);
});

test('propuesta completa contiene puesta y nueve secciones actorales separadas, manteniendo sólo cambios propuestos',()=>{
  const f=fixture();const before=canonicalJson(f.input);
  assert.deepEqual(validatePreparationConfiguratorProposal({context:f.context,proposal:f.proposal}),f.proposal);
  const review=buildPreparationConfiguratorReview({context:f.context,proposal:f.proposal,proposalId:randomUUID(),currentDraft:f.draft});
  assert.equal(review.state,'proposed-only');assert.equal(review.changes.settings.length,3);assert.equal(review.changes.actors.length,2);
  assert.ok(review.changes.settings.every(value=>value.kind==='proposed'&&value.source==='configurator'));
  assert.ok(review.changes.actors.every(value=>value.suggestion.sections.length===9));
  assert.deepEqual(review.baseDraft,f.draft);assert.equal(canonicalJson(f.input),before);
  assert.doesNotMatch(JSON.stringify(review.changes),/operator-choice|confirmedBy|authoredBy|curatedBy|consent|prepared-character/);
});

test('snapshot stale, perfil o presupuesto no elegidos e ICM alterado no habilitan compilación',()=>{
  const f=fixture();
  assert.throws(()=>compilePreparationConfiguratorContext({...f.input,admittedDraft:{...f.draft,revision:4}}),/DRAFT_MISMATCH/);
  for(const field of ['inferenceProfile','budget','icmWorkspace']){
    const draft=RunConfigurationDraftSchema.parse({...f.draft,[field]:{kind:'empty'}});
    assert.throws(()=>compilePreparationConfiguratorContext({...f.input,admittedDraft:draft,request:{...f.input.request,draftHash:sha256CanonicalJson(draft)}}),/OPERATOR_SELECTION_REQUIRED/);
  }
  assert.throws(()=>validatePreparationConfiguratorContext({...f.context,budget:{...f.context.budget,maxPiCallsPerRun:7}}),/CONTEXT_MISMATCH/);
  assert.throws(()=>compilePreparationConfiguratorContext({...f.input,admittedDocuments:[{...f.document,text:'Contenido reemplazado'}]}),/DOCUMENT_MISMATCH/);
  assert.throws(()=>compilePreparationConfiguratorContext({...f.input,admittedActorSources:[{...f.sources[0],fullArchiveHash:'0'.repeat(64)},f.sources[1]]}),/SOURCE_MISMATCH|HASH_MISMATCH/);
});

test('sugerencias rechazan autoridad, identidad humana, perfil, presupuesto, ICM y memoria inventada',()=>{
  const f=fixture();
  for(const section of ['humanParticipants','inferenceProfile','budget','icmWorkspace'])assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,settings:[{section,value:{},reason:'No permitido',sourceRefs:[],treatment:'declared-adaptation',unknowns:[]}]}}));
  const actor=f.proposal.actors[0];assert.ok(actor);
  for(const addition of [{authoredBy:'invento'},{consent:true},{evidence:{kind:'operator-choice'}}])assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,...addition}}));
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,actors:[{...actor,sections:[{section:'initialExperience',value:{kind:'run-cut',experiences:[]},reason:'Inventar recuerdo',sourceRefs:[],treatment:'declared-adaptation',unknowns:[]}]},...f.proposal.actors.slice(1)]}}));
  const setting=f.proposal.settings[0];assert.ok(setting);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,settings:[{...setting,section:'worldLayout',value:{entities:[{kind:'character',mind:{experiences:['falsa']}}]}}]}}));
});

test('fuentes, actores, citas, vacíos y contradicciones permanecen ligados a la selección exacta',()=>{
  const f=fixture(),actor=f.proposal.actors[0];assert.ok(actor);const section=actor.sections[0];assert.ok(section);
  const replace=(replacement:unknown)=>({...f.proposal,actors:[replacement,...f.proposal.actors.slice(1)]});
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,characterId:'agente-99'})}),/ACTORS_MISMATCH/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,sourceFullHash:'0'.repeat(64)})}),/SOURCE_MISMATCH/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,unknowns:[]})}),/GAPS_REMOVED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,contradictions:[]})}),/GAPS_REMOVED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,sections:[{...section,sourceRefs:['hymie-source']}]})}),/REFERENCE_NOT_ADMITTED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,sections:[{...section,sourceRefs:['invented-source']}]})}),/REFERENCE_NOT_ADMITTED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:replace({...actor,sections:[{...section,treatment:'documentary-selection',sourceRefs:[]}]})}),/DOCUMENTARY_REFERENCE_REQUIRED/);
  assert.throws(()=>buildPreparationConfiguratorReview({context:f.context,proposal:f.proposal,proposalId:randomUUID(),currentDraft:{...f.draft,revision:4}}),/DRAFT_STALE/);
});

test('conocimiento adaptado se propone con motivo y antecedentes propios sin fabricar adaptationId ni resolver el vacío documental',()=>{
  const f=fixture(),actor=f.proposal.actors[0];assert.ok(actor);
  const policy=actor.sections.find(section=>section.section==='unknownPolicy');assert.ok(policy);
  const history=actor.sections.find(section=>section.section==='antecedents');assert.ok(history);
  const sections=actor.sections.map(section=>section.section==='antecedents'?{...section,value:[{antecedentId:'formacion-propuesta',kind:'biography',statement:'Formación añadida para esta adaptación, no canon encontrado.',applicability:{kind:'unconditional'}}]}:
    section.section==='unknownPolicy'?{...section,value:{defaultTreatment:'do-not-infer-or-assert',fields:[{kind:'character-knowledge-adaptation',topic:'Formación matemática no establecida',reason:'Propuesta editorial para esta puesta',antecedentIds:['formacion-propuesta']}]}}:section);
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,actors:[{...actor,sections},...f.proposal.actors.slice(1)]});
  const validated=validatePreparationConfiguratorProposal({context:f.context,proposal});assert.deepEqual(validated.actors[0]?.unknowns,actor.unknowns);
  assert.doesNotMatch(JSON.stringify(validated),/adaptationId|authoredBy|confirmedAt/);
  const adapted=proposal.actors[0];assert.ok(adapted);
  const missing={...proposal,actors:[{...adapted,sections:adapted.sections.map(section=>section.section==='antecedents'?{...section,value:[]}:section)},...proposal.actors.slice(1)]};
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:missing}),/ADAPTATION_ANTECEDENT_REQUIRED/);
  const falseEvidence={...proposal,actors:[{...adapted,sections:adapted.sections.map(section=>section.section==='unknownPolicy'?{...section,treatment:'documentary-selection'}:section)},...proposal.actors.slice(1)]};
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:falseEvidence}),/ADAPTATION_ANTECEDENT_REQUIRED/);
});

test('identidad previa no pierde contradicción sin tratamiento explícito aunque el resumen documental la conserve',()=>{
  const f=fixture(),source=f.sources[0],actor=f.proposal.actors[0];assert.ok(source&&actor);
  const continuityField=draftFixture().continuity;assert.ok(continuityField.kind!=='empty');
  const goals=actor.sections.find(section=>section.section==='goals'),capabilities=actor.sections.find(section=>section.section==='capabilities');
  assert.ok(goals?.section==='goals'&&capabilities?.section==='capabilities');
  const prepared=curateCharacter({form:{...characterCurationForm(),selfReference:'Max',selfConcept:'Identidad anterior',dispositions:'Atento',contradictions:'Contradicción anterior de identidad',voice:'Voz anterior',
    goals:goals.value,capabilities:capabilities.value,lifeNarrative:'Historia sintética anterior con vacíos documentales preservados.',lifeUnknowns:source.frozenDossier.unknowns.join('\n'),lifeContradictions:[...source.frozenDossier.contradictions,'Contradicción anterior de identidad'].join('\n'),desires:CuratedCharacterDesiresSchema.parse([{desireId:'comprender-anterior',description:'Comprender la situación.',stakes:'Orientarse sin inventar certezas.',tension:'Su atención convive con dudas.',goalIds:goals.value.map(goal=>goal.goalId)}]),noInitialExperiences:true,provenanceKind:'curator-declaration',reason:'Curación anterior explícita'},
    dossier:source.frozenDossier,dossierSource:source,continuity:continuityField.value,uuid:randomUUID,recordedAt:'2026-10-16T12:00:00Z'});
  assert.ok(f.draft.roster.kind==='configured');
  const draft=RunConfigurationDraftSchema.parse({...f.draft,continuity:continuityField,roster:{...f.draft.roster,value:{...f.draft.roster.value,preparedCharacters:[prepared]}}});
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:draft,request:{...f.input.request,draftHash:sha256CanonicalJson(draft)}});
  const proposal=PreparationConfiguratorProposalSchema.parse({...f.proposal,contextHash:context.contextHash,
    actors:[{...actor,contradictions:[...actor.contradictions,'Contradicción anterior de identidad']},...f.proposal.actors.slice(1)]});
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal}),/IDENTITY_CONTRADICTION_TREATMENT_REQUIRED/);
  const treated=PreparationConfiguratorProposalSchema.parse({...proposal,actors:[{...proposal.actors[0],sections:actor.sections.map(section=>section.section==='identity'?{...section,value:{...section.value,lifeHistory:prepared.identity.value.lifeHistory,desires:prepared.identity.value.desires}}:section),contradictionTreatments:[{contradiction:'Contradicción anterior de identidad',reason:'Nueva adaptación propuesta; no borra la versión histórica.',sourceRefs:[f.document.sourceId]}]},...proposal.actors.slice(1)]});
  assert.doesNotThrow(()=>validatePreparationConfiguratorProposal({context,proposal:treated}));
  assert.deepEqual(prepared.identity.value.contradictions,['Contradicción anterior de identidad']);
  const continuitySuggestion=f.proposal.settings.find(setting=>setting.section==='continuity');assert.ok(continuitySuggestion);
  assert.throws(()=>PreparationConfiguratorProposalSchema.parse({...f.proposal,settings:[{...continuitySuggestion,value:{...continuitySuggestion.value,revision:9}}]}));
});

test('conserva aislamiento de paquetes y rechaza fuentes o actores no seleccionados y ubicaciones con conocimiento ajeno',()=>{
  const f=fixture(),source=f.sources[0];assert.ok(source);
  const draft=RunConfigurationDraftSchema.parse({...f.draft,icmWorkspace:{kind:'configured',evidence:{kind:'operator-choice',operatorId:'test',recordedAt:'2026-10-16T12:00:00Z'},value:createIcmWorkspaceSnapshot({sources:[
    ...f.context.workspace.sources.map(item=>({sourceId:item.sourceId,audience:item.audience,revision:item.revision,sourceHash:item.sourceHash,sections:item.sections.map(section=>({sectionId:section.sectionId,markdown:section.markdown}))})),
    {sourceId:'actor.maxwell-smart.context',audience:{role:'actor',actorId:'maxwell-smart'},revision:0,sourceHash:sha256Utf8('actor'),sections:[{sectionId:'process',markdown:'ACTOR_OWN_CONTRACT_NOT_CONFIGURATOR_ROLE'}]},
    {sourceId:'role.director',audience:{role:'director'},revision:0,sourceHash:sha256Utf8('director'),sections:[{sectionId:'process',markdown:'DIRECTOR_PRIVATE_CONTRACT_NOT_CONFIGURATOR_ROLE'}]},
  ]})}});
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:draft,request:{...f.input.request,draftHash:sha256CanonicalJson(draft)}});
  const packet=compilePreparationConfiguratorPacket(context);assert.doesNotMatch(packet.roleContractMarkdown,/ACTOR_OWN_CONTRACT|DIRECTOR_PRIVATE_CONTRACT/);
  const model=projectPreparationConfiguratorModelContext(context);
  assert.equal(model.contextHash,context.contextHash);assert.equal(model.workspace.snapshotHash,context.workspace.snapshotHash);
  assert.deepEqual(model.actorSources,context.actorSources,'selected identity, history and complete research sources remain available for curation');
  assert.deepEqual(model.documents,context.documents);assert.deepEqual(model.profile,context.profile);assert.deepEqual(model.budget,context.budget);
  assert.match(canonicalJson(context),/ACTOR_OWN_CONTRACT_NOT_CONFIGURATOR_ROLE/,'durable context retains its complete frozen sources');
  const rendered=renderPacket({packet,expectedPacketHash:packet.packetHash,scope:packet.scope,workspace:context.workspace});
  assert.doesNotMatch(rendered,/ACTOR_OWN_CONTRACT|DIRECTOR_PRIVATE_CONTRACT/);
  assert.match(rendered,/ICM_CONFIGURATOR_ONLY/);assert.match(rendered,/Vacío documental maxwell-smart/);
  assert.equal('icmWorkspace' in model.draft,false);assert.doesNotMatch(canonicalJson(model.workspace),/markdown/);
  const placement={characterId:source.characterId,trueDisplayName:'Max',species:'human',presentation:{kind:'ordinary',label:'Agente'},placeId:'sala',position:{x:2,y:2},collisionRadius:0.2,blocksMovement:true,
    presence:{kind:'present',sceneId:randomUUID()},availability:{kind:'available'},routine:{kind:'always'},recognizedCharacterIds:[],reason:'Propuesta de colocación',sourceRefs:[f.document.sourceId],treatment:'declared-adaptation',unknowns:[]};
  assert.doesNotThrow(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,placements:[placement]}}));
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,placements:[{...placement,sourceRefs:['hymie-source']}]}}),/REFERENCE_NOT_ADMITTED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context:f.context,proposal:{...f.proposal,placements:[{...placement,characterId:'agente-99'}]}}),/ACTORS_MISMATCH/);
  assert.throws(()=>PreparationConfiguratorProposalSchema.parse({...f.proposal,placements:[{...placement,mind:{experiences:[]}}]}));
});


test('policy host embodied exige historia y deseos del actor sin alterar paquetes legacy ni confiar en marcador del modelo',()=>{
  const f=fixture();
  const draft=RunConfigurationDraftSchema.parse({...f.draft,characterDefinitionPolicy:{kind:'embodied-v1'}});
  const context=compilePreparationConfiguratorContext({...f.input,admittedDraft:draft,request:{...f.input.request,draftHash:sha256CanonicalJson(draft)}});
  const legacyProposal={...f.proposal,contextHash:context.contextHash};
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:legacyProposal}),/EMBODIED_IDENTITY_REQUIRED/);
  const proposal=PreparationConfiguratorProposalSchema.parse({...legacyProposal,actors:legacyProposal.actors.map(actor=>{
    const goals=actor.sections.find(section=>section.section==='goals');assert.ok(goals?.section==='goals');
    return {...actor,sections:actor.sections.map(section=>section.section==='identity'?{...section,value:{...section.value,
      lifeHistory:{kind:'curated-life-history',narrative:'Historia sintética de una adaptación propuesta. Conserva los vacíos de las fuentes y no afirma recuerdos vividos ni canon adicional.',antecedentIds:[],unknowns:actor.unknowns,contradictions:actor.contradictions},
      desires:[{desireId:'comprender-situacion',description:'Comprender la situación de este ensayo.',stakes:'Poder orientar sus decisiones.',tension:'Desea entender, pero reconoce sus dudas.',goalIds:goals.value.map(goal=>goal.goalId)}]}}:section)};
  })});
  assert.deepEqual(validatePreparationConfiguratorProposal({context,proposal}),proposal);
  assert.equal(compilePreparationConfiguratorPacket(f.context).hostPolicyMarkdown,PREPARATION_CONFIGURATOR_POLICY);
  assert.equal(preparationConfiguratorPolicy(f.context),PREPARATION_CONFIGURATOR_POLICY);
  assert.match(compilePreparationConfiguratorPacket(context).hostPolicyMarkdown,/historia de vida narrativa amplia/);
  const actor=proposal.actors[0];assert.ok(actor);
  const identity=actor.sections.find(section=>section.section==='identity');assert.ok(identity?.section==='identity');const lifeHistory=identity.value.lifeHistory,desires=identity.value.desires;assert.ok(lifeHistory&&desires);
  const change=(value:unknown)=>({...proposal,actors:[{...actor,sections:actor.sections.map(section=>section.section==='identity'?{...section,value}:section)},...proposal.actors.slice(1)]});
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:change({...identity.value,lifeHistory:{...lifeHistory,antecedentIds:['antecedente-ajeno']}})}),/BIOGRAPHY_LINK_MISMATCH/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:change({...identity.value,desires:desires.map(desire=>({...desire,goalIds:['goal-ajeno']}))})}),/BIOGRAPHY_LINK_MISMATCH/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:change({...identity.value,lifeHistory:{...lifeHistory,unknowns:[]}})}),/BIOGRAPHY_GAPS_REMOVED/);
  assert.throws(()=>validatePreparationConfiguratorProposal({context,proposal:{...proposal,characterDefinitionPolicy:{kind:'embodied-v1'}}}));
});
