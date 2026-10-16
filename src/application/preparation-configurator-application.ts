import {z} from 'zod';
import {canonicalJson,sha256CanonicalJson} from '../domain/canonical-json.ts';
import {PreparationFieldSchema,PreparationDraftSchema,ContinuityContextSchema,PreparationProvenanceSchema,type PreparationDraft,type PreparedCharacter} from '../domain/preparation.ts';
import {RunConfigurationDraftSchema,WorldPreparationCandidateSchema,ProductionAudioSchema} from '../domain/production.ts';
import {RunDraftPatchSchema} from '../domain/world-journal.ts';
import {WorldCharacterSchema,WorldEntityIdSchema} from '../domain/world-schema.ts';
import {PreparationConfiguratorReviewSchema,type PreparationConfiguratorProposal} from '../domain/preparation-configurator.ts';
import {buildPreparationConfiguratorReview,validatePreparationConfiguratorContext} from './preparation-configurator-context.ts';
import {createEmptyPreparationDraft,prepareCharacter} from './prepare-character.ts';

import {PreparationConfiguratorSelectionSchema} from '../domain/preparation-configurator-selection.ts';
export {PreparationConfiguratorSelectionSchema} from '../domain/preparation-configurator-selection.ts';
export type {PreparationConfiguratorSelection} from '../domain/preparation-configurator-selection.ts';
const MetadataSchema=z.strictObject({principalId:z.string().min(1).max(200),recordedAt:z.string().datetime({offset:true})});

type ActorSuggestion=PreparationConfiguratorProposal['actors'][number];
type ActorSection=ActorSuggestion['sections'][number];

/** Pure conversion of operator-selected suggestions. Ownership, physical proofs,
 * transactional CAS and idempotency remain the journal host's responsibility. */
export function applyPreparationConfiguratorSelection(input:{context:unknown;proposal:unknown;proposalId:unknown;currentDraft:unknown;selection:unknown;
  host:{principalId:string;recordedAt:string;uuid:(fieldKey:string)=>string}}){
  const context=validatePreparationConfiguratorContext(input.context);
  const review=PreparationConfiguratorReviewSchema.parse(buildPreparationConfiguratorReview(input));
  const selection=PreparationConfiguratorSelectionSchema.parse(input.selection);
  const metadata=MetadataSchema.parse({principalId:input.host.principalId,recordedAt:input.host.recordedAt});
  const draft=RunConfigurationDraftSchema.parse(input.currentDraft);
  const evidence={kind:'operator-choice',operatorId:metadata.principalId,recordedAt:metadata.recordedAt};
  const updates:Record<string,unknown>={};
  const appliedFields:string[]=[];
  const configured=(value:unknown)=>({kind:'configured',value,evidence});
  const put=(field:string,value:unknown)=>{updates[field]=configured(value);};
  const chosenSettings=selection.settings.map(section=>{
    const suggestion=review.proposal.settings.find(value=>value.section===section);
    if(suggestion===undefined)throw new Error('PREPARATION_CONFIGURATOR_SELECTED_SETTING_MISSING');return suggestion;
  });
  for(const setting of chosenSettings){
    appliedFields.push(`settings.${setting.section}`);
    switch(setting.section){
      case 'continuity':{
        const previous=draft.continuity.kind==='empty'?undefined:draft.continuity.value;
        const body={...setting.value,revision:previous?.continuityId===setting.value.continuityId?previous.revision+1:0,
          inclusions:setting.value.inclusions.map(inclusion=>({...inclusion,confirmedBy:metadata.principalId,confirmedAt:metadata.recordedAt}))};
        put('continuity',ContinuityContextSchema.parse({...body,contentHash:sha256CanonicalJson(body)}));break;
      }
      case 'worldLayout':break;
      case 'audio':{
        const base=draft.audio.kind==='empty'?undefined:draft.audio.value;
        if(base===undefined||(setting.value.kind==='enabled'&&base.mode.kind!=='enabled'))throw new Error('PREPARATION_CONFIGURATOR_AUDIO_CONFIGURATION_REQUIRED');
        put('audio',ProductionAudioSchema.parse({...base,mode:setting.value.kind==='disabled'?setting.value:base.mode}));break;
      }
      default:put(setting.section,setting.value);
    }
  }
  let next=RunConfigurationDraftSchema.parse({...draft,...updates});
  if(next.roster.kind==='empty'&&(selection.actors.length>0||selection.placements.length>0))throw new Error('PREPARATION_CONFIGURATOR_ROSTER_REQUIRED');
  const roster=next.roster.kind==='empty'?undefined:next.roster.value;
  const prepared=[...(roster?.preparedCharacters??[])];
  const partials=[...(roster?.preparationDrafts??[])];
  const actorResults=new Map<string,PreparedCharacter>();
  const continuity=next.continuity.kind==='empty'?undefined:next.continuity.value;
  for(const selected of selection.actors){
    const suggestion=review.proposal.actors.find(actor=>actor.characterId===selected.characterId);
    const source=context.actorSources.find(actor=>actor.characterId===selected.characterId);
    if(suggestion===undefined||source===undefined)throw new Error('PREPARATION_CONFIGURATOR_SELECTED_ACTOR_MISSING');
    if(continuity===undefined)throw new Error('PREPARATION_CONFIGURATOR_CONTINUITY_REQUIRED');
    const existing=prepared.find(actor=>actor.characterId===selected.characterId);
    let partial=partials.find(actor=>actor.characterId===selected.characterId);
    if(partial===undefined&&existing!==undefined){
      const empty=createEmptyPreparationDraft({characterId:existing.characterId,dossierRevision:existing.dossierRevision,dossierHash:existing.dossierHash,
        ...(existing.dossierSource===undefined?{}:{dossierSource:existing.dossierSource}),continuity:existing.continuity,identityVersion:existing.identityVersion+1});
      partial=PreparationDraftSchema.parse({...empty,
        ...Object.fromEntries(PreparationFieldSchema.options.map(field=>[field,{kind:'declared',value:existing[field]}]))});
    }
    const prior=partial;
    const exactSource=prior?.dossierSource!==undefined&&canonicalJson(prior.dossierSource)===canonicalJson(source);
    if(prior!==undefined&&!exactSource){
      const hasPriorCuration=PreparationFieldSchema.options.some(field=>prior[field].kind==='declared');
      if(hasPriorCuration&&selected.sections.length!==PreparationFieldSchema.options.length)
        throw new Error('PREPARATION_CONFIGURATOR_SOURCE_RECURATION_REQUIRED');
      // Full explicit recuration starts from the selected archive, never from
      // a Markdown/revision match that can hide a different adaptation/source.
      partial=createEmptyPreparationDraft({characterId:selected.characterId,dossierRevision:source.revision,dossierHash:source.contentHash,dossierSource:source,
        continuity,identityVersion:prior.identityVersion});
      const initial=suggestion.sections.find(section=>section.section==='initialExperience');
      if(initial?.section==='initialExperience'&&initial.value.kind==='preserve-existing'&&prior.initialExperience.kind==='declared')
        partial=PreparationDraftSchema.parse({...partial,initialExperience:prior.initialExperience});
    }
    partial??=createEmptyPreparationDraft({characterId:selected.characterId,dossierRevision:source.revision,dossierHash:source.contentHash,dossierSource:source,
      continuity,identityVersion:existing?.identityVersion??1});
    // A different continuity/source is not permission to relabel prior curation.
    // Old declared values remain visible and prepareCharacter reports mismatch.
    const patch:Record<string,unknown>={};
    for(const field of selected.sections){
      const section=suggestion.sections.find(value=>value.section===field);
      if(section===undefined)throw new Error('PREPARATION_CONFIGURATOR_SELECTED_ACTOR_SECTION_MISSING');
      if(section.section==='initialExperience'&&section.value.kind==='preserve-existing'){
        if(partial.initialExperience.kind!=='declared')throw new Error('PREPARATION_CONFIGURATOR_INITIAL_EXPERIENCE_MISSING');
        patch[field]={kind:'declared',value:partial.initialExperience.value};
        appliedFields.push(`actors.${selected.characterId}.${field}`);continue;
      }
      const dossierRefs=new Set(source.frozenDossier.sourceRefs.map(ref=>ref.id));
      const continuityRefs=new Set([...continuity.milestones,...continuity.inclusions].flatMap(value=>value.sourceRefs));
      const externalRefs=section.sourceRefs.filter(ref=>!dossierRefs.has(ref));
      const permittedRefs=section.sourceRefs.filter(ref=>dossierRefs.has(ref)||continuityRefs.has(ref));
      const reason=externalRefs.length===0?section.reason:`${section.reason}
Fuentes externas admitidas revisadas por ${metadata.principalId}: ${externalRefs.join(', ')}. No se atribuyen como evidencia del expediente.`;
      const provenance=PreparationProvenanceSchema.parse(section.treatment==='declared-adaptation'?{
        kind:'explicit-adaptation',dossierRevision:source.revision,dossierHash:source.contentHash,
        continuity:{continuityId:continuity.continuityId,revision:continuity.revision,contentHash:continuity.contentHash},
        adaptationId:input.host.uuid(`actors.${selected.characterId}.${field}.adaptation`),reason,
        authoredBy:metadata.principalId,createdAt:metadata.recordedAt,sourceRefs:permittedRefs,
      }:externalRefs.length>0?{kind:'curator-declaration',dossierRevision:source.revision,dossierHash:source.contentHash,
        continuity:{continuityId:continuity.continuityId,revision:continuity.revision,contentHash:continuity.contentHash},
        reason,authoredBy:metadata.principalId,createdAt:metadata.recordedAt,sourceRefs:permittedRefs,
      }:{kind:'dossier-evidence',dossierRevision:source.revision,dossierHash:source.contentHash,
        continuity:{continuityId:continuity.continuityId,revision:continuity.revision,contentHash:continuity.contentHash},
        curatedBy:metadata.principalId,curatedAt:metadata.recordedAt,sourceRefs:section.sourceRefs});
      const value=sectionValue({section,partial,provenance,actorId:selected.characterId,uuid:input.host.uuid});
      patch[field]={kind:'declared',value:{value,provenance}};
      appliedFields.push(`actors.${selected.characterId}.${field}`);
    }
    partial=PreparationDraftSchema.parse({...partial,...patch});
    const result=prepareCharacter({draft:partial,dossier:source.frozenDossier});
    const oldIndex=prepared.findIndex(actor=>actor.characterId===selected.characterId);
    if(oldIndex>=0)prepared.splice(oldIndex,1);
    const partialIndex=partials.findIndex(actor=>actor.characterId===selected.characterId);
    if(partialIndex>=0)partials.splice(partialIndex,1);
    if(result.kind==='prepared'){prepared.push(result.character);actorResults.set(selected.characterId,result.character);}
    else partials.push(partial);
  }
  if(roster!==undefined&&selection.actors.length>0){
    put('roster',{...roster,preparedCharacters:prepared,preparationDrafts:partials});
    next=RunConfigurationDraftSchema.parse({...next,...updates});
  }
  const layout=chosenSettings.find(setting=>setting.section==='worldLayout');
  if(layout!==undefined||selection.placements.length>0){
    const previous=WorldPreparationCandidateSchema.parse(next.worldSnapshot.kind==='empty'?{}:next.worldSnapshot.value);
    // A brand-new Escenario has no prior offers. This host initialization is
    // neither model input nor an event; an existing candidate's absence stays unknown.
    const initialOffers=next.worldSnapshot.kind==='empty'&&layout?.section==='worldLayout'?{offers:[]}:{};
    const world={schemaVersion:1,runId:draft.runId,revision:0,seq:0,...initialOffers,...previous,
      ...(layout?.section==='worldLayout'?layout.value:{}),
      entities:layout?.section==='worldLayout'?[
        ...(previous.entities??[]).filter(entity=>entity.kind==='character'),...(layout.value.entities??[]),
      ]:previous.entities};
    const entities=[...(world.entities??[])];
    for(const characterId of selection.placements){
      const placement=review.proposal.placements.find(actor=>actor.characterId===characterId);
      const character=actorResults.get(characterId)??prepared.find(actor=>actor.characterId===characterId);
      if(placement===undefined)throw new Error('PREPARATION_CONFIGURATOR_SELECTED_PLACEMENT_MISSING');
      if(character===undefined)throw new Error('PREPARATION_CONFIGURATOR_PLACEMENT_NOT_PREPARED');
      if(character.inventory.value.length>0)throw new Error('PREPARATION_CONFIGURATOR_PLACEMENT_MATERIAL_CONFIGURATION_REQUIRED');
      const actor=placedActor({placement,character,runId:draft.runId,...(world.clock===undefined?{}:{fictionalAt:world.clock.instant}),...(world.seq===undefined?{}:{worldSeq:world.seq}),existing:entities.find(entity=>entity.kind==='character'&&entity.characterId===characterId),uuid:input.host.uuid});
      const old=entities.findIndex(entity=>entity.kind==='character'&&entity.characterId===characterId);
      if(old>=0)entities.splice(old,1);entities.push(actor);appliedFields.push(`placements.${characterId}`);
    }
    const {entities:_entities,...withoutEntities}=world;
    put('worldSnapshot',WorldPreparationCandidateSchema.parse({...withoutEntities,...(entities.length===0?{}:{entities})}));
  }
  const patch=RunDraftPatchSchema.parse(updates);
  next=RunConfigurationDraftSchema.parse({...draft,...patch});
  for(const field of ['inferenceProfile','budget','icmWorkspace','humanParticipants'] as const)
    if(canonicalJson({value:next[field]??null})!==canonicalJson({value:draft[field]??null}))throw new Error('PREPARATION_CONFIGURATOR_PROTECTED_FIELD_CHANGED');
  return {patch,nextDraft:next,review,appliedFields};
}

function sectionValue(input:{section:ActorSection;partial:PreparationDraft;provenance:z.infer<typeof PreparationProvenanceSchema>;actorId:string;uuid:(key:string)=>string}):unknown{
  const {section}=input;
  switch(section.section){
    case 'antecedents':return section.value.map(antecedent=>({...antecedent,provenance:input.provenance}));
    case 'initialExperience':{
      if(section.value.kind==='none')return section.value;
      if(input.partial.initialExperience.kind!=='declared')throw new Error('PREPARATION_CONFIGURATOR_INITIAL_EXPERIENCE_MISSING');
      return input.partial.initialExperience.value.value;
    }
    case 'unknownPolicy':return {...section.value,fields:section.value.fields.map((field,index)=>field.kind==='source-not-established'?field:{...field,
      adaptationId:input.uuid(`actors.${input.actorId}.unknownPolicy.fields.${index}.adaptation`)})};
    default:return section.value;
  }
}

function placedActor(input:{placement:PreparationConfiguratorProposal['placements'][number];character:PreparedCharacter;existing:unknown;runId:string;fictionalAt?:number;worldSeq?:number;uuid:(key:string)=>string}){
  const existing=input.existing===undefined?undefined:WorldCharacterSchema.parse(input.existing);
  const {character,placement}=input;
  const initial=character.initialExperience.value;
  const experiences=initial.kind==='run-cut'&&initial.runId===input.runId?initial.experiences:[];
  if(initial.kind==='run-cut'&&initial.runId===input.runId&&(input.fictionalAt===undefined||input.worldSeq===undefined||initial.throughFictionalAt>input.fictionalAt||initial.throughWorldSeq>input.worldSeq))
    throw new Error('PREPARATION_CONFIGURATOR_PLACEMENT_INITIAL_EXPERIENCE_CUT_INVALID');
  const {reason:_reason,sourceRefs:_refs,treatment:_treatment,unknowns:_unknowns,recognizedCharacterIds,...physical}=placement;
  const capabilities=character.capabilities.value.flatMap(capability=>{
    switch(capability.kind){case 'speech':return ['speak'];case 'gesture':return ['gesture'];case 'movement':return ['move'];case 'nonverbal-sound':return ['animalSound'];case 'operate-device':return ['useDevice'];case 'world-action':return [capability.action];case 'other':return [];default:{const exhaustive:never=capability;return exhaustive;}}
  });
  return WorldCharacterSchema.parse({...physical,kind:'character',entityId:existing?.entityId??WorldEntityIdSchema.parse(input.uuid(`placements.${character.characterId}.entity`)),
    preparation:{kind:'prepared',continuityId:character.continuity.continuityId,identityVersion:character.identityVersion},capabilities:[...new Set(capabilities)],
    mind:{goals:character.goals.value.map(goal=>({kind:goal.kind,id:input.uuid(`placements.${character.characterId}.goals.${goal.goalId}`),sourceGoalId:goal.goalId,
      description:goal.kind==='shared'?goal.sharedOutcome:goal.desiredOutcome,reviewConditions:goal.reviewConditions,priority:goal.priority,
      state:goal.status==='achieved'?'completed':goal.status,revision:0,history:[],...(goal.kind==='shared'?{ownMotivation:goal.ownMotivation,participants:goal.participantIds.filter(id=>id!==character.characterId)}:{})})),
      beliefs:experiences.flatMap(experience=>experience.kind==='belief'&&experience.basedOn.length>0?[{experienceId:experience.experienceId,content:experience.content,confidence:experience.confidence,basedOn:experience.basedOn}]:[]),relationships:[],relationshipDescriptions:character.relationships.value.map(relationship=>({reference:relationship.otherReference,description:relationship.descriptionFromOwnerPerspective,confidence:relationship.confidence,revision:0})),
      recognizedCharacterIds,experiences}});
}
