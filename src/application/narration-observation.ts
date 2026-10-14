import {z} from 'zod';
import type {openJournal} from '../adapters/journal.ts';
import {RunIdSchema,WorldSeqSchema,RevisionSchema} from '../domain/values.ts';
import {NarrationPublicationIdSchema} from '../domain/narration.ts';
import {NarrationPageRequestSchema,PublicNarrationPageSchema} from '../domain/narration-observation.ts';

const CursorSchema=z.strictObject({version:z.literal(1),runId:RunIdSchema,worldSeq:WorldSeqSchema,
  worldRevision:RevisionSchema,publishedAt:z.number().int().nonnegative().safe(),publicationId:NarrationPublicationIdSchema});
type Journal=Pick<ReturnType<typeof openJournal>,'readInspectorWorldCut'|'readNarrationPublicationPage'>;
export function createNarrationObservation({journal}:{journal:Journal}) {
  return {read(raw:unknown){
    const request=NarrationPageRequestSchema.parse(raw);
    const cut=journal.readInspectorWorldCut({runId:request.runId,...(request.atWorldSeq===undefined?{}:{atWorldSeq:request.atWorldSeq}),...(request.worldRevision===undefined?{}:{worldRevision:request.worldRevision})});
    if(cut===undefined)return {kind:'missing-or-invalid-cut'} as const;
    let cursor:z.infer<typeof CursorSchema>|undefined;
    if(request.cursor!==undefined){
      if(!/^nv1\.[A-Za-z0-9_-]{1,2040}$/.test(request.cursor))return {kind:'invalid-cursor'} as const;
      try{
        const encoded=request.cursor.slice(4);const bytes=Buffer.from(encoded,'base64url');
        if(bytes.toString('base64url')!==encoded)return {kind:'invalid-cursor'} as const;
        cursor=CursorSchema.parse(JSON.parse(bytes.toString('utf8')));
      }catch{return {kind:'invalid-cursor'} as const;}
      if(cursor.runId!==request.runId||cursor.worldSeq!==cut.snapshot.seq||cursor.worldRevision!==cut.snapshot.revision)return {kind:'invalid-cursor'} as const;
    }
    const page=journal.readNarrationPublicationPage({runId:request.runId,throughWorldSeq:cut.snapshot.seq,throughWorldRevision:cut.snapshot.revision,
      limit:request.limit,...(cursor===undefined?{}:{afterPublishedAt:cursor.publishedAt,afterPublicationId:cursor.publicationId})});
    if(page===undefined)return {kind:'missing-or-invalid-cut'} as const;
    const items=page.items.map(({publication,sceneId})=>({kind:'published-narration' as const,publicationId:publication.publicationId,
      text:publication.text,sceneId,sourceWorldSeq:publication.scope.throughWorldSeq,sourceWorldRevision:publication.scope.worldRevision,
      publishedAt:publication.publishedAt,uncertainty:publication.uncertainty}));
    const last=items.at(-1);
    const nextCursor=page.hasMore&&last!==undefined?'nv1.'+Buffer.from(JSON.stringify(CursorSchema.parse({version:1,runId:request.runId,worldSeq:cut.snapshot.seq,
      worldRevision:cut.snapshot.revision,publishedAt:last.publishedAt,publicationId:last.publicationId}))).toString('base64url'):null;
    return {kind:'found' as const,page:PublicNarrationPageSchema.parse({kind:'narration-page',runId:request.runId,atWorldSeq:cut.snapshot.seq,worldRevision:cut.snapshot.revision,items,nextCursor})};
  }};
}
