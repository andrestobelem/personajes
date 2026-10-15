import { z } from 'zod';
import { ContinuityContextSchema, ContinuityReferenceSchema, PreparedCharacterSchema, type PreparedCharacter, type PreparationProvenance } from '../domain/preparation.ts';
import { OperationIdSchema } from '../domain/values.ts';
import { WorldContinuityFenceSchema } from '../domain/world-journal.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { ReadyRunConfigurationSchema, readyConfigurationAtSnapshot } from './production-preflight.ts';
import { PreparedForkStateSchema } from './prepare-fork-state.ts';
import type { ForkIdentityManifest } from './fork-identities.ts';

const RequestSchema=z.strictObject({sourceConfiguration:ReadyRunConfigurationSchema,state:PreparedForkStateSchema,
  name:z.string().trim().min(1).max(120),principalId:z.string().min(1).max(200),recordedAt:z.string().datetime({offset:true}),operationId:OperationIdSchema});

/** Derive a complete setup without running providers or granting execution permissions. */
export function prepareForkConfiguration(raw:unknown){
  const request=RequestSchema.parse(raw);const {sourceConfiguration:source,state}=request;
  if(source.runId!==state.source.runId||source.configRevision!==state.source.configurationRevision||hashContinuistaValue(source)!==state.source.configurationHash)
    throw new Error('La configuración fuente no pertenece al corte de bifurcación');
  const mappedId=(kind:ForkIdentityManifest['ids'][number]['kind'],sourceId:string)=>{
    const entry=state.identities.ids.find(item=>item.kind===kind&&item.sourceId===sourceId);
    if(entry===undefined)throw new Error(`Identidad no registrada para ${kind}`);return entry.targetId;
  };
  const continuityId=state.identities.continuities.find(item=>item.sourceId===source.continuity.continuityId)?.targetId;
  if(continuityId===undefined)throw new Error('Continuidad derivada no registrada');
  const continuityContent={...source.continuity,continuityId,revision:0};
  const {contentHash:oldContentHash,...hashableContinuity}=continuityContent;void oldContentHash;
  const continuity=ContinuityContextSchema.parse({...hashableContinuity,contentHash:hashContinuistaValue(hashableContinuity)});
  const continuityReference=ContinuityReferenceSchema.parse({continuityId:continuity.continuityId,revision:continuity.revision,contentHash:continuity.contentHash});
  const provenance=(value:PreparationProvenance):PreparationProvenance=>({...value,continuity:continuityReference});
  const preparedCharacters=source.roster.preparedCharacters.map((prepared):PreparedCharacter=>PreparedCharacterSchema.parse({...prepared,continuity,
    forkOrigin:{kind:'fork',source:state.source,sourcePreparedHash:hashContinuistaValue(prepared),sourceContinuity:{continuityId:prepared.continuity.continuityId,revision:prepared.continuity.revision,contentHash:prepared.continuity.contentHash},principalId:request.principalId,recordedAt:request.recordedAt,operationId:request.operationId},
    identity:{...prepared.identity,provenance:provenance(prepared.identity.provenance)},
    voice:{...prepared.voice,provenance:provenance(prepared.voice.provenance)},
    antecedents:{...prepared.antecedents,provenance:provenance(prepared.antecedents.provenance),value:prepared.antecedents.value.map(item=>({...item,provenance:provenance(item.provenance)}))},
    goals:{...prepared.goals,provenance:provenance(prepared.goals.provenance)},
    relationships:{...prepared.relationships,provenance:provenance(prepared.relationships.provenance)},
    capabilities:{...prepared.capabilities,provenance:provenance(prepared.capabilities.provenance),value:prepared.capabilities.value.map(capability=>capability.kind==='operate-device'&&source.worldSnapshot.entities.some(entity=>entity.kind==='device'&&entity.entityId===capability.deviceId)?{...capability,deviceId:mappedId('entity',capability.deviceId)}:capability)},
    inventory:{...prepared.inventory,provenance:provenance(prepared.inventory.provenance)},
    initialExperience:{provenance:provenance(prepared.initialExperience.provenance),value:prepared.initialExperience.value.kind==='none'?prepared.initialExperience.value:{...prepared.initialExperience.value,continuity:continuityReference}},
    unknownPolicy:{...prepared.unknownPolicy,provenance:provenance(prepared.unknownPolicy.provenance)},
  }));
  const audio={...source.audio,
    speakerSlots:source.audio.speakerSlots.map(entry=>({...entry,slot:entry.slot.kind==='enabled-bound'?{kind:'enabled-unbound' as const}:entry.slot})),
    narratorSlot:source.audio.narratorSlot.kind==='enabled-bound'?{kind:'enabled-unbound' as const}:source.audio.narratorSlot,
    soundEffectSlots:source.audio.soundEffectSlots.map(entry=>({...entry,slot:entry.slot.kind==='enabled-bound'?{kind:'enabled-unbound' as const}:entry.slot})),
  };
  const configuration=readyConfigurationAtSnapshot(ReadyRunConfigurationSchema.parse({...source,runId:state.targetRunId,configRevision:0,name:request.name,continuity,
    roster:{...source.roster,preparedCharacters},
    humanParticipants:source.humanParticipants.map(profile=>({...profile,presence:{...profile.presence,channelId:mappedId('channel',profile.presence.channelId),...(profile.presence.kind==='inScene'?{sceneId:mappedId('scene',profile.presence.sceneId)}:{})}})),
    audio,worldSnapshot:state.snapshot,fictionalAt:state.snapshot.clock.instant,
    forkOrigin:{kind:'fork',operationId:request.operationId,source:state.source,principalId:request.principalId,recordedAt:request.recordedAt},
    snapshotFence:{runId:state.targetRunId,revision:0,seq:state.snapshot.seq,fictionalAt:state.snapshot.clock.instant},
    preparedActorFences:preparedCharacters.map(prepared=>({characterId:prepared.characterId,identityVersion:prepared.identityVersion,dossierRevision:prepared.dossierRevision,dossierHash:prepared.dossierHash,continuity:continuityReference})),
  }),state.snapshot);
  const contexts=state.snapshot.entities.flatMap(actor=>{
    if(actor.kind!=='character'||actor.preparation.kind!=='prepared')return [];
    const prepared=preparedCharacters.find(item=>item.characterId===actor.characterId);
    if(prepared===undefined||actor.preparation.continuityId!==prepared.continuity.continuityId||actor.preparation.identityVersion!==prepared.identityVersion)throw new Error('Personaje del destino sin preparación derivada concordante');
    return [{actorId:actor.characterId,continuityId:prepared.continuity.continuityId,continuityRevision:prepared.continuity.revision,continuityContentHash:prepared.continuity.contentHash,identityVersion:prepared.identityVersion,preparedContextHash:hashContinuistaValue(prepared)}];
  });
  return {configuration,continuityFence:WorldContinuityFenceSchema.parse({kind:'prepared-contexts',atWorldSeq:state.snapshot.seq,contexts})};
}
