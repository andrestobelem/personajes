import { ActorStateCutSchema } from '../domain/actor-state-cut.ts';
import type { ActorStateCut } from '../domain/actor-state-cut.ts';
import { ExperienceSchema } from '../domain/experience.ts';
import type { Experience, FrozenExperience } from '../domain/experience.ts';
import { RunIdSchema } from '../domain/values.ts';
import { freezeExperience } from './experience-envelope.ts';
import type { ForkIdentityRegistry } from './fork-identities.ts';

/** Materialize only the private archive that was admitted in the selected, verified checkpoint. */
export function createForkExperienceRemapper(input:{cut:ActorStateCut;targetRunId:string;identities:Pick<ForkIdentityRegistry,'id'|'handle'>;admittedAntecedents?:readonly Experience[]}) {
  const cut=ActorStateCutSchema.parse(input.cut);const targetRunId=RunIdSchema.parse(input.targetRunId);
  if(targetRunId===cut.source.runId)throw new Error('El fork requiere otra corrida');
  const own=new Map<string,FrozenExperience>(cut.experiences.map(item=>[item.envelope.experienceId,item]));
  const antecedents=new Set<string>();
  const antecedentHashes=new Map<string,string>();
  for(const raw of input.admittedAntecedents??[]){
    const experience=ExperienceSchema.parse(raw);
    if(experience.actorId!==cut.actorId||experience.runId===targetRunId||own.has(experience.experienceId))throw new Error('Antecedente autorizado ambiguo o ajeno');
    const hash=freezeExperience(experience).payloadHash;
    const prior=antecedentHashes.get(experience.experienceId);
    if(prior!==undefined&&prior!==hash)throw new Error('Antecedente autorizado contradictorio');
    antecedentHashes.set(experience.experienceId,hash);antecedents.add(experience.experienceId);
  }
  for(const item of cut.experiences){const verified=freezeExperience(item.envelope);if(verified.canonicalPayload!==item.canonicalPayload||verified.payloadHash!==item.payloadHash)throw new Error('Archivo privado inconsistente');}
  function reference(sourceId:string):string {
    if(own.has(sourceId))return input.identities.id('experience',sourceId);
    if(antecedents.has(sourceId))return sourceId;
    throw new Error('Referencia de experiencia no admitida');
  }
  function remap(raw:Experience):Experience {
    const experience=ExperienceSchema.parse(raw);const source=own.get(experience.experienceId);
    const verified=freezeExperience(experience);
    if(source===undefined||source.canonicalPayload!==verified.canonicalPayload||source.payloadHash!==verified.payloadHash)throw new Error('Experiencia fuera del corte privado');
    const base={...experience,runId:targetRunId,experienceId:input.identities.id('experience',experience.experienceId),
      predecessor:experience.predecessor.kind==='initial'?experience.predecessor:{kind:'revision',experienceId:reference(experience.predecessor.experienceId)},
      forkOrigin:{kind:'fork',sourceRunId:cut.source.runId,sourceActorId:cut.actorId,sourceExperienceId:experience.experienceId,sourcePayloadHash:source.payloadHash,
        sourceCommitIndex:cut.source.commitIndex,sourceWorldRevision:cut.source.worldRevision,sourceWorldSeq:cut.source.worldSeq,sourceSnapshotHash:cut.source.snapshotHash}};
    switch(experience.kind){
      case 'perception':return ExperienceSchema.parse({...base,kind:experience.kind,eventId:input.identities.id('event',experience.eventId),perceptionId:input.identities.id('perception',experience.perceptionId)});
      case 'testimony':return ExperienceSchema.parse({...base,kind:experience.kind,eventId:input.identities.id('event',experience.eventId),...(experience.speakerHandle===undefined?{}:{speakerHandle:input.identities.handle({actorId:experience.actorId,sourceHandle:experience.speakerHandle})})});
      case 'inference':case 'belief':case 'recollection':return ExperienceSchema.parse({...base,kind:experience.kind,basedOn:experience.basedOn.map(reference)});
      default:{const _exhaustive:never=experience;return _exhaustive;}
    }
  }
  const experiences=cut.experiences.map(item=>freezeExperience(remap(item.envelope)));
  if(experiences.some(item=>antecedents.has(item.envelope.experienceId)))throw new Error('Identidad materializada colisiona con un antecedente conservado');
  return {remap,reference,experiences};
}
