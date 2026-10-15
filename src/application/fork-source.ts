import { z } from 'zod';
import { ActorStateCutSchema } from '../domain/actor-state-cut.ts';
import { BackupOriginSchema } from '../domain/fork-origin.ts';
import { DramaticStructureViewSchema } from '../domain/dramatic-structure.ts';
import { WorldSnapshotSchema } from '../domain/world-schema.ts';
import { RevisionSchema, RunIdSchema, WorldSeqSchema } from '../domain/values.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { freezeExperience } from './experience-envelope.ts';

export const ForkSourceRequestSchema=z.strictObject({
  runId:RunIdSchema,commitIndex:RevisionSchema,worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,
});
export const ForkSourceDataSchema=z.strictObject({
  snapshot:WorldSnapshotSchema,configuration:ReadyRunConfigurationSchema,cuts:z.array(ActorStateCutSchema).min(1),structure:DramaticStructureViewSchema,
});
export const ForkSourceReadResultSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('found'),...ForkSourceDataSchema.shape}),
  z.strictObject({kind:z.literal('missing')}),
  z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['invalid-cut','checkpoint-not-recorded','configuration-not-ready'])}),
]);

/** A host-verified bundle source frozen for recovery, never an HTTP actor-state input. */
export const BackupForkSourceSchema=z.strictObject({kind:z.literal('backup-fork-source'),backup:BackupOriginSchema,...ForkSourceDataSchema.shape})
  .superRefine((value,context)=>{
    const reject=(message:string)=>context.addIssue({code:'custom',message});
    const source=value.cuts[0]?.source;if(source===undefined){reject('Falta corte privado de la fuente backup');return;}
    if(value.snapshot.runId!==source.runId||value.snapshot.revision!==source.worldRevision||value.snapshot.seq!==source.worldSeq
      ||hashContinuistaValue(value.snapshot)!==source.snapshotHash||value.configuration.runId!==source.runId
      ||value.configuration.configRevision!==source.configurationRevision||hashContinuistaValue(value.configuration)!==source.configurationHash
      ||value.structure.runId!==source.runId||value.structure.activeSceneId!==value.snapshot.activeSceneId||value.structure.structureRevision>source.commitIndex)
      reject('La fuente backup no coincide con su frontera exacta');
    const actors=value.snapshot.entities.filter(entity=>entity.kind==='character');
    if(value.cuts.length!==actors.length||new Set(value.cuts.map(cut=>cut.actorId)).size!==actors.length
      ||actors.some(actor=>!value.cuts.some(cut=>cut.actorId===actor.characterId)))reject('Lote privado de backup incompleto');
    const globalIds=new Set<string>();
    for(const cut of value.cuts){
      if(hashContinuistaValue(cut.source)!==hashContinuistaValue(source))reject('Cortes privados de fuentes distintas');
      const admitted=new Set<string>(cut.experiences.map(frozen=>frozen.envelope.experienceId));
      const prepared=value.configuration.roster.preparedCharacters.find(actor=>actor.characterId===cut.actorId);
      const initial=prepared?.initialExperience.value;
      if(initial?.kind==='run-cut')for(const experience of initial.experiences)admitted.add(experience.experienceId);
      const own=new Map(cut.experiences.map(frozen=>[frozen.envelope.experienceId,frozen]));
      for(const frozen of cut.experiences){
        const experience=frozen.envelope;const verified=freezeExperience(experience);
        if(verified.canonicalPayload!==frozen.canonicalPayload||verified.payloadHash!==frozen.payloadHash||globalIds.has(experience.experienceId))reject('Experiencia backup alterada o ambigua');
        globalIds.add(experience.experienceId);
        if(experience.fictitiousAt>value.snapshot.clock.instant||experience.receivedAt>value.snapshot.clock.instant)reject('Experiencia posterior al reloj de backup');
        if(('basedOn' in experience&&experience.basedOn.some(id=>!admitted.has(id)))||(experience.predecessor.kind==='revision'&&!admitted.has(experience.predecessor.experienceId)))reject('Experiencia backup sin antecedente admitido');
      }
      const actor=actors.find(candidate=>candidate.characterId===cut.actorId);
      if(actor!==undefined)for(const experience of actor.mind.experiences){
        if(own.get(experience.experienceId)?.payloadHash!==freezeExperience(experience).payloadHash)reject('Memoria del snapshot ausente del corte privado de backup');
      }
    }
  });
export type BackupForkSource=z.infer<typeof BackupForkSourceSchema>;
