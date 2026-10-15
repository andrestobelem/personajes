import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import {
  DirectionCommandWriteSchema, DirectionEventsPageSchema, DirectionEventsQuerySchema,
  DirectionLookupResultSchema, DirectionLookupSchema, DirectionMutationResultSchema,
} from '../domain/direction-indications.ts';

type Journal=Pick<ReturnType<typeof openJournal>,'applyDirectionCommand'|'readDirectionOperation'|'readDirectionEvents'>;

export function createDirectionApplication(input:{journal:Journal}){
  function readEvents(raw:unknown){
    const request=DirectionEventsQuerySchema.parse(raw);
    const result=input.journal.readDirectionEvents(request);
    return result===undefined?undefined:DirectionEventsPageSchema.parse(result);
  }
  function apply(raw:unknown){
    return DirectionMutationResultSchema.parse(input.journal.applyDirectionCommand(DirectionCommandWriteSchema.parse(raw)));
  }
  function readOperation(raw:unknown){
    return DirectionLookupResultSchema.parse(input.journal.readDirectionOperation(DirectionLookupSchema.parse(raw)));
  }
  return Object.freeze({readEvents,apply,readOperation});
}

export type DirectionApplication=ReturnType<typeof createDirectionApplication>;
export type DirectionEventsRequest=z.infer<typeof DirectionEventsQuerySchema>;
