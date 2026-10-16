import { z } from 'zod';
import { ActorStateCutSchema } from '../domain/actor-state-cut.ts';
import { FrozenExperienceSchema } from '../domain/experience.ts';
import { ActorKnowledgeSchema, WorldSnapshotSchema } from '../domain/world-schema.ts';
import { CharacterIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema } from '../domain/values.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { createForkIdentityRegistry, ForkIdentityManifestSchema } from './fork-identities.ts';
import { createForkExperienceRemapper } from './fork-experiences.ts';
import { freezeExperience } from './experience-envelope.ts';
import { remapForkActorKnowledge, remapForkWorld } from './fork-world-remap.ts';

export const ForkPrivateStateSchema=z.strictObject({
  actorId:CharacterIdSchema,
  knowledge:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('recorded'),revision:RevisionSchema,atWorldSeq:WorldSeqSchema,value:ActorKnowledgeSchema}),
    z.strictObject({kind:z.literal('unavailable'),reason:z.literal('knowledge-not-recorded')}),
  ]),
  experiences:z.array(FrozenExperienceSchema),
});
export const PreparedForkStateSchema=z.strictObject({
  kind:z.literal('prepared-fork-state'),source:ActorStateCutSchema.shape.source,
  targetRunId:RunIdSchema,snapshot:WorldSnapshotSchema,actors:z.array(ForkPrivateStateSchema),identities:ForkIdentityManifestSchema,
}).superRefine((state,context)=>{
  const invalid=(message:string)=>context.addIssue({code:'custom',message});
  if(state.targetRunId!==state.snapshot.runId||state.targetRunId!==state.identities.targetRunId||state.source.runId!==state.identities.sourceRunId
    ||state.snapshot.revision!==0||state.snapshot.seq!==state.source.worldSeq)invalid('Scope de paquete de bifurcación inconsistente');
  const expected=new Set(state.snapshot.entities.filter(entity=>entity.kind==='character').map(actor=>actor.characterId));
  if(expected.size!==state.actors.length)invalid('Paquete privado incompleto');
  const actorIds=new Set<string>();const experienceIds=new Set<string>();
  for(const actor of state.actors){
    if(actorIds.has(actor.actorId)||!expected.has(actor.actorId))invalid('Personaje ajeno o duplicado');
    actorIds.add(actor.actorId);
    if(actor.knowledge.kind==='recorded'&&(actor.knowledge.value.runId!==state.targetRunId||actor.knowledge.value.actorId!==actor.actorId||actor.knowledge.atWorldSeq>state.snapshot.seq))invalid('Conocimiento fuera del destino');
    for(const frozen of actor.experiences){
      const memory=frozen.envelope;const origin=memory.forkOrigin;
      if(memory.runId!==state.targetRunId||memory.actorId!==actor.actorId||experienceIds.has(memory.experienceId)||memory.worldSeq>state.snapshot.seq)invalid('Experiencia fuera del destino o duplicada');
      experienceIds.add(memory.experienceId);
      if(origin===undefined||origin.sourceRunId!==state.source.runId||origin.sourceActorId!==actor.actorId||origin.sourceCommitIndex!==state.source.commitIndex
        ||origin.sourceWorldRevision!==state.source.worldRevision||origin.sourceWorldSeq!==state.source.worldSeq||origin.sourceSnapshotHash!==state.source.snapshotHash)invalid('Procedencia fuera del corte fuente');
      const verified=freezeExperience(memory);if(verified.canonicalPayload!==frozen.canonicalPayload||verified.payloadHash!==frozen.payloadHash)invalid('Payload de memoria inconsistente');
    }
  }
});
const RequestSchema=z.strictObject({snapshot:WorldSnapshotSchema,configuration:ReadyRunConfigurationSchema,
  cuts:z.array(ActorStateCutSchema).min(1),targetRunId:RunIdSchema,restoredIdentities:ForkIdentityManifestSchema.optional()});

/** Host-only transformation. It is neither a published Run nor permission to start one. */
export function prepareForkState(raw:unknown){
  const request=RequestSchema.parse(raw);const snapshot=request.snapshot;const configuration=request.configuration;
  const source=request.cuts[0]?.source;if(source===undefined)throw new Error('Falta corte privado');
  if(source.runId!==snapshot.runId||source.worldRevision!==snapshot.revision||source.worldSeq!==snapshot.seq||source.snapshotHash!==hashContinuistaValue(snapshot)
    ||configuration.runId!==source.runId||configuration.configRevision!==source.configurationRevision||hashContinuistaValue(configuration)!==source.configurationHash)
    throw new Error('Fuente de bifurcación inconsistente');
  const actors=snapshot.entities.filter(entity=>entity.kind==='character');
  if(request.cuts.length!==actors.length||new Set(request.cuts.map(cut=>cut.actorId)).size!==actors.length)throw new Error('Lote privado incompleto');
  const identities=createForkIdentityRegistry({sourceRunId:source.runId,targetRunId:request.targetRunId,...(request.restoredIdentities===undefined?{}:{restored:request.restoredIdentities})});
  identities.continuity(configuration.continuity.continuityId);
  const admittedIds=new Set<string>();
  for(const cut of request.cuts)for(const item of cut.experiences){
    if(admittedIds.has(item.envelope.experienceId))throw new Error('ExperienceId ambiguo entre personajes');
    admittedIds.add(item.envelope.experienceId);
  }
  const preservedAntecedentIds=new Set(configuration.roster.preparedCharacters.flatMap(actor=>actor.initialExperience.value.kind==='run-cut'?actor.initialExperience.value.experiences.map(item=>item.experienceId):[]));
  const remappers=new Map<string,ReturnType<typeof createForkExperienceRemapper>>();
  for(const actor of actors){
    const cut=request.cuts.find(item=>item.actorId===actor.characterId);
    if(cut===undefined||hashContinuistaValue(cut.source)!==hashContinuistaValue(source))throw new Error('Cortes privados de fuentes diferentes');
    if(cut.experiences.some(item=>item.envelope.receivedAt>snapshot.clock.instant||item.envelope.fictitiousAt>snapshot.clock.instant))throw new Error('Memoria posterior al reloj del corte');
    const prepared=configuration.roster.preparedCharacters.find(item=>item.characterId===actor.characterId);
    const initial=prepared?.initialExperience.value;
    remappers.set(actor.characterId,createForkExperienceRemapper({cut,targetRunId:request.targetRunId,identities,...(initial?.kind==='run-cut'?{admittedAntecedents:initial.experiences}:{})}));
    if(cut.knowledge.kind==='recorded')for(const binding of cut.knowledge.value.bindings){
      const exists=binding.kind==='entity'?snapshot.entities.some(entity=>entity.entityId===binding.entityId)
        :binding.kind==='place'?snapshot.places.some(place=>place.id===binding.placeId)
        :binding.kind==='channel'?snapshot.channels.some(channel=>channel.id===binding.channelId)
        :binding.kind==='human'?(snapshot.humanParticipants??[]).some(human=>human.participantId===binding.participantId)
        :snapshot.offers.some(offer=>offer.id===binding.offerId);
      if(!exists)throw new Error('Conocimiento refiere un destino ausente del corte');
    }
  }
  const targetSnapshot=remapForkWorld({snapshot,targetRunId:request.targetRunId,identities,remapExperienceReference:input=>{
    const remapper=remappers.get(input.actorId);if(remapper===undefined)throw new Error('Referencia de otro personaje');return remapper.reference(input.experienceId);
  },remapExperience:experience=>{
    const remapper=remappers.get(experience.actorId);if(remapper===undefined)throw new Error('Memoria de otro personaje');return remapper.remap(experience);
  }});
  const targetActors=request.cuts.map(cut=>{
    const remapper=remappers.get(cut.actorId);if(remapper===undefined)throw new Error('Personaje fuera del corte');
    return {actorId:cut.actorId,experiences:remapper.experiences,knowledge:cut.knowledge.kind==='unavailable'?cut.knowledge:
      {...cut.knowledge,value:remapForkActorKnowledge({knowledge:cut.knowledge.value,targetRunId:request.targetRunId,identities})}};
  });
  if(targetActors.some(actor=>actor.experiences.some(item=>preservedAntecedentIds.has(item.envelope.experienceId))))throw new Error('Identidad materializada colisiona con antecedente conservado');
  return PreparedForkStateSchema.parse({kind:'prepared-fork-state',source,targetRunId:request.targetRunId,snapshot:targetSnapshot,actors:targetActors,identities:identities.manifest()});
}
