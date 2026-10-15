import type { openJournal } from '../adapters/journal.ts';
import { ActorStateCutReadResultSchema, ActorStateCutRequestSchema } from '../domain/actor-state-cut.ts';
import { z } from 'zod';
import { RunIdSchema } from '../domain/values.ts';
import { InspectorCharactersSchema, InspectorRequestSchema, InspectorViewSchema } from '../domain/run-inspector.ts';
import { WorldSnapshotSchema } from '../domain/world-schema.ts';

type Journal=Pick<ReturnType<typeof openJournal>,'loadWorld'|'readWorldLifecycle'|'readActorKnowledge'|'readInspectorWorldCut'> & {readActorStateCut:(request:z.infer<typeof ActorStateCutRequestSchema>)=>unknown};
/** Authorization is host-session derived in HTTP, before any private reader is called. */
export function createRunInspectorApplication(input:{journal:Journal}) {
  return {
    characters(raw:unknown) {
      const {runId}=z.strictObject({runId:RunIdSchema}).parse(raw);
      const world=input.journal.loadWorld({runId});if(world===undefined)return {kind:'missing'} as const;
      const snapshot=WorldSnapshotSchema.parse(world);
      const actors=snapshot.entities.filter(entity=>entity.kind==='character');
      if(actors.length>100)throw new Error('Inspector roster exceeds supported bound');
      return {kind:'found' as const,view:InspectorCharactersSchema.parse({kind:'inspector-characters',runId,currentWorldSeq:snapshot.seq,items:actors.map(actor=>({characterId:actor.characterId,label:actor.trueDisplayName}))})};
    },
    inspect(raw:unknown) {
      const request=InspectorRequestSchema.parse(raw);
      const state=input.journal.readWorldLifecycle({runId:request.runId});if(state===undefined)return {kind:'missing'} as const;
      const currentWorldSeq=state.lastWorldSeq;const cut=request.atWorldSeq??currentWorldSeq;
      if(cut>currentWorldSeq)return {kind:'invalidCut'} as const;
      const historical=request.atWorldSeq!==undefined||request.worldRevision!==undefined;
      const selected=input.journal.readInspectorWorldCut({runId:request.runId,...(request.atWorldSeq===undefined?{}:{atWorldSeq:request.atWorldSeq}),...(request.worldRevision===undefined?{}:{worldRevision:request.worldRevision})});
      if(selected===undefined)return {kind:'invalidCut'} as const;
      const snapshot=WorldSnapshotSchema.parse(selected.snapshot);
      const actor=snapshot.entities.find(entity=>entity.kind==='character'&&entity.characterId===request.characterId);
      if(actor?.kind!=='character')return {kind:'missing'} as const;
      const knowledge=historical?undefined:input.journal.readActorKnowledge({runId:request.runId,actorId:request.characterId,throughWorldSeq:cut});
      const privateCut=historical?ActorStateCutReadResultSchema.parse(input.journal.readActorStateCut(ActorStateCutRequestSchema.parse({runId:request.runId,actorId:request.characterId,worldRevision:snapshot.revision,worldSeq:snapshot.seq,commitIndex:selected.commitIndex}))):undefined;
      if(privateCut?.kind==='found'&&(privateCut.cut.source.runId!==request.runId||privateCut.cut.actorId!==request.characterId||privateCut.cut.source.worldRevision!==snapshot.revision||privateCut.cut.source.worldSeq!==snapshot.seq||privateCut.cut.source.commitIndex!==selected.commitIndex))throw new Error('Actor checkpoint scope mismatch');
      const checkpoint=privateCut?.kind==='found'?privateCut.cut:undefined;
      const unavailableReason=privateCut?.kind==='unavailable'?privateCut.reason:'checkpoint-not-recorded';
      const offset=checkpoint===undefined?0:Math.min(request.memoryOffset,checkpoint.experiences.length);
      const items=checkpoint?.experiences.slice(offset,offset+request.memoryLimit)??[];
      const view=InspectorViewSchema.parse({kind:'private-character-inspector',runId:request.runId,characterId:request.characterId,label:actor.trueDisplayName,
        atWorldSeq:snapshot.seq,currentWorldSeq,worldRevision:snapshot.revision,commitIndex:selected.commitIndex,ambiguousSequence:selected.ambiguousSeq,cutKind:historical?(request.worldRevision===undefined?'causal-boundary':'exact-revision'):'current',fictitiousAt:snapshot.clock.instant,source:'committed-world-snapshot',mind:actor.mind,
        recognitionKnowledge:historical?(checkpoint?.knowledge.kind==='recorded'?{kind:'checkpoint',source:'actor-state-cut',knowledge:checkpoint.knowledge.value,revision:checkpoint.knowledge.revision,atWorldSeq:checkpoint.knowledge.atWorldSeq}:{kind:'unavailable',reason:checkpoint?.knowledge.kind==='unavailable'?checkpoint.knowledge.reason:unavailableReason}):knowledge===undefined?{kind:'unavailable',reason:'current-knowledge-not-recorded'}:{kind:'current',source:'current-actor-knowledge',knowledge:knowledge.knowledge},
        memorySearch:!historical?{kind:'unavailable',reason:'live-memory-search-not-supported'}:checkpoint===undefined?{kind:'unavailable',reason:unavailableReason}:{kind:'checkpoint',source:'admitted-experience-archive',checkpointSource:checkpoint.source,recordedAt:checkpoint.recordedAt,items,offset,limit:request.memoryLimit,total:checkpoint.experiences.length,hasMore:offset+items.length<checkpoint.experiences.length}});
      return {kind:'found' as const,view};
    },
  };
}
export type RunInspectorApplication=ReturnType<typeof createRunInspectorApplication>;
