import { z } from 'zod';
import { CharacterIdSchema, FictionalInstantSchema, RunIdSchema, WorldSeqSchema, RevisionSchema } from './values.ts';
import { ActorStateCutSchema } from './actor-state-cut.ts';
import { FrozenExperienceSchema } from './experience.ts';
import { ActorKnowledgeSchema, ActorMindSchema, WorldEntityIdSchema } from './world-schema.ts';

export const InspectorCharactersSchema=z.strictObject({kind:z.literal('inspector-characters'),runId:RunIdSchema,currentWorldSeq:WorldSeqSchema,items:z.array(z.strictObject({characterId:CharacterIdSchema,label:z.string().min(1).max(200)})).max(100)});
export const InspectorRequestSchema=z.strictObject({runId:RunIdSchema,characterId:CharacterIdSchema,atWorldSeq:WorldSeqSchema.optional(),worldRevision:RevisionSchema.optional(),memoryOffset:z.number().int().nonnegative().safe().default(0),memoryLimit:z.number().int().min(1).max(100).default(50)});
export const InspectorInventoryItemSchema=z.strictObject({
  objectEntityId:WorldEntityIdSchema,label:z.string().min(1).max(500),description:z.string().max(2_000),portable:z.boolean(),
  quantity:z.number().int().min(1).max(1_000_000).optional(),condition:z.enum(['usable','damaged','unknown']).optional(),
  subjectiveKnowledge:z.strictObject({name:z.string().min(1).max(500).optional(),description:z.string().max(2_000)}).nullable(),
});
export const InspectorViewSchema=z.strictObject({
  kind:z.literal('private-character-inspector'),runId:RunIdSchema,characterId:CharacterIdSchema,label:z.string().min(1).max(200),
  atWorldSeq:WorldSeqSchema,currentWorldSeq:WorldSeqSchema,worldRevision:RevisionSchema,commitIndex:RevisionSchema,ambiguousSequence:z.boolean(),cutKind:z.enum(['current','causal-boundary','exact-revision']),fictitiousAt:FictionalInstantSchema,
  source:z.literal('committed-world-snapshot'),mind:ActorMindSchema,inventory:z.array(InspectorInventoryItemSchema).max(100_000),
  recognitionKnowledge:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('checkpoint'),source:z.literal('actor-state-cut'),knowledge:ActorKnowledgeSchema,revision:RevisionSchema,atWorldSeq:WorldSeqSchema}),
    z.strictObject({kind:z.literal('current'),source:z.literal('current-actor-knowledge'),knowledge:ActorKnowledgeSchema}),
    z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['historical-knowledge-not-versioned','current-knowledge-not-recorded','checkpoint-not-recorded','actor-not-in-cut','invalid-cut','knowledge-not-recorded'])}),
  ]),
  memorySearch:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('checkpoint'),source:z.literal('admitted-experience-archive'),checkpointSource:ActorStateCutSchema.shape.source,recordedAt:ActorStateCutSchema.shape.recordedAt,items:z.array(FrozenExperienceSchema).max(100),offset:z.number().int().nonnegative().safe(),limit:z.number().int().min(1).max(100),total:z.number().int().nonnegative().safe(),hasMore:z.boolean()}),
    z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['versioned-memory-inspection-not-implemented','live-memory-search-not-supported','checkpoint-not-recorded','actor-not-in-cut','invalid-cut'])}),
  ]),
}).superRefine((view,context)=>{
  if(new Set(view.inventory.map(item=>item.objectEntityId)).size!==view.inventory.length)context.addIssue({code:'custom',path:['inventory'],message:'Un objeto no puede aparecer dos veces en las pertenencias del corte'});
  if(view.atWorldSeq>view.currentWorldSeq)context.addIssue({code:'custom',path:['atWorldSeq'],message:'El corte no puede ser futuro'});
  if(view.recognitionKnowledge.kind==='current'&&(view.cutKind!=='current'||view.atWorldSeq!==view.currentWorldSeq||view.recognitionKnowledge.knowledge.runId!==view.runId||view.recognitionKnowledge.knowledge.actorId!==view.characterId))context.addIssue({code:'custom',path:['recognitionKnowledge'],message:'El reconocimiento actual no representa el pasado'});
  if(view.recognitionKnowledge.kind==='checkpoint'&&(view.cutKind==='current'||view.recognitionKnowledge.knowledge.runId!==view.runId||view.recognitionKnowledge.knowledge.actorId!==view.characterId||view.recognitionKnowledge.atWorldSeq>view.atWorldSeq))context.addIssue({code:'custom',path:['recognitionKnowledge'],message:'El reconocimiento del corte debe pertenecer al personaje y al pasado seleccionado'});
  if(view.memorySearch.kind==='checkpoint'){const memory=view.memorySearch; if(view.cutKind==='current'||memory.checkpointSource.runId!==view.runId||memory.checkpointSource.worldRevision!==view.worldRevision||memory.checkpointSource.worldSeq!==view.atWorldSeq||memory.checkpointSource.commitIndex!==view.commitIndex||memory.items.length!==Math.min(memory.limit,memory.total-memory.offset)||memory.offset>memory.total||memory.hasMore!==(memory.offset+memory.items.length<memory.total)||memory.items.some(item=>item.envelope.runId!==view.runId||item.envelope.actorId!==view.characterId||item.envelope.worldSeq>view.atWorldSeq))context.addIssue({code:'custom',path:['memorySearch'],message:'Archivo privado fuera del personaje, corte o página solicitados'});}
  if(view.mind.experiences.some(experience=>experience.runId!==view.runId||experience.actorId!==view.characterId))context.addIssue({code:'custom',path:['mind','experiences'],message:'Experiencias de otro personaje fuera del ámbito'});
});
export type InspectorView=z.infer<typeof InspectorViewSchema>;
