import {z} from 'zod';
import type {openJournal} from '../adapters/journal.ts';
import {CircumstanceMutationResultSchema,CircumstanceOptionsRequestSchema,CircumstanceOptionsSchema,CircumstanceWriteSchema} from '../domain/direction-circumstances.ts';
type Journal=Pick<ReturnType<typeof openJournal>,'readCircumstanceOptions'|'applyCircumstanceCommand'>;
export function createCircumstanceApplication(input:{journal:Journal;onCommitted?:(event:{runId:z.infer<typeof CircumstanceWriteSchema>['runId'];eventIds:string[];actorIds:string[]})=>void}){
  return Object.freeze({
    readOptions(raw:unknown){
      const result=input.journal.readCircumstanceOptions(CircumstanceOptionsRequestSchema.parse(raw));
      return result===undefined?undefined:CircumstanceOptionsSchema.parse(result);
    },
    apply(raw:unknown){
      const request=CircumstanceWriteSchema.parse(raw);
      const result=CircumstanceMutationResultSchema.parse(input.journal.applyCircumstanceCommand(request));
      if(result.kind==='stored'&&result.receipt.effect.kind==='applied'){
        try{input.onCommitted?.({runId:request.runId,eventIds:result.receipt.effect.eventIds,actorIds:result.receipt.effect.recipientActorIds});}
        catch{/* Presentation and scheduling cannot roll back a confirmed durable effect; delivery recovery retains its queue. */}
      }
      return result;
    },
  });
}
