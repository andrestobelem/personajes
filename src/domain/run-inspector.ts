import { z } from 'zod';
import { CharacterIdSchema, FictionalInstantSchema, RunIdSchema, WorldSeqSchema, RevisionSchema } from './values.ts';
import { ActorKnowledgeSchema, ActorMindSchema } from './world-schema.ts';

export const InspectorCharactersSchema=z.strictObject({kind:z.literal('inspector-characters'),runId:RunIdSchema,currentWorldSeq:WorldSeqSchema,items:z.array(z.strictObject({characterId:CharacterIdSchema,label:z.string().min(1).max(200)})).max(100)});
export const InspectorRequestSchema=z.strictObject({runId:RunIdSchema,characterId:CharacterIdSchema,atWorldSeq:WorldSeqSchema.optional(),worldRevision:RevisionSchema.optional()});
export const InspectorViewSchema=z.strictObject({
  kind:z.literal('private-character-inspector'),runId:RunIdSchema,characterId:CharacterIdSchema,label:z.string().min(1).max(200),
  atWorldSeq:WorldSeqSchema,currentWorldSeq:WorldSeqSchema,worldRevision:RevisionSchema,commitIndex:RevisionSchema,ambiguousSequence:z.boolean(),cutKind:z.enum(['current','causal-boundary','exact-revision']),fictitiousAt:FictionalInstantSchema,
  source:z.literal('committed-world-snapshot'),mind:ActorMindSchema,
  recognitionKnowledge:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('current'),source:z.literal('current-actor-knowledge'),knowledge:ActorKnowledgeSchema}),
    z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['historical-knowledge-not-versioned','current-knowledge-not-recorded'])}),
  ]),
  memorySearch:z.strictObject({kind:z.literal('unavailable'),reason:z.literal('versioned-memory-inspection-not-implemented')}),
}).superRefine((view,context)=>{
  if(view.atWorldSeq>view.currentWorldSeq)context.addIssue({code:'custom',path:['atWorldSeq'],message:'El corte no puede ser futuro'});
  if(view.recognitionKnowledge.kind==='current'&&(view.cutKind!=='current'||view.atWorldSeq!==view.currentWorldSeq||view.recognitionKnowledge.knowledge.runId!==view.runId||view.recognitionKnowledge.knowledge.actorId!==view.characterId))context.addIssue({code:'custom',path:['recognitionKnowledge'],message:'El reconocimiento actual no representa el pasado'});
  if(view.mind.experiences.some(experience=>experience.runId!==view.runId||experience.actorId!==view.characterId))context.addIssue({code:'custom',path:['mind','experiences'],message:'Experiencias de otro personaje fuera del ámbito'});
});
export type InspectorView=z.infer<typeof InspectorViewSchema>;
