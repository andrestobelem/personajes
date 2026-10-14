import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { WorldSnapshotSchema, characterCanReceiveAt } from '../domain/world.ts';
import type { WorldEvent, WorldSnapshot } from '../domain/world.ts';
import {
  RunStageViewSchema, StageEntitySchema, PublicSpeakerSchema, ConfirmedEventViewSchema,
  ConversationViewSchema, ConfirmedEventPageSchema, ConversationPageSchema, TechnicalJobViewSchema, TechnicalJobPageSchema,
  ObservationPageRequestSchema, ObservationStageRequestSchema,
} from '../domain/run-observation.ts';
import type { RunStageView } from '../domain/run-observation.ts';
import { RunIdSchema, WorldSeqSchema } from '../domain/values.ts';

type Journal = Pick<ReturnType<typeof openJournal>,'readWorldLifecycle'|'readWorldConfiguration'|'loadWorld'|'readObservationEvents'|'readObservationDeliveries'|'readObservationJobs'>;
const missing = {kind:'missing'} satisfies {kind:'missing'};
const invalidCut = {kind:'invalidRequest',code:'invalid-cut'} satisfies {kind:'invalidRequest';code:'invalid-cut'};
const invalidCursor = {kind:'invalidRequest',code:'invalid-cursor'} satisfies {kind:'invalidRequest';code:'invalid-cursor'};
const CursorSchema = z.strictObject({version:z.literal(1),runId:RunIdSchema,surface:z.enum(['events','conversations','jobs']),
  from:WorldSeqSchema,to:WorldSeqSchema,after:WorldSeqSchema.nullable(),afterKey:z.string().min(1).max(200).nullable()});

function encodeCursor(value:z.infer<typeof CursorSchema>):string {
  return 'ob1.'+Buffer.from(JSON.stringify(CursorSchema.parse(value))).toString('base64url');
}
function decodeCursor(raw:string):z.infer<typeof CursorSchema>|undefined {
  if (!/^ob1\.[A-Za-z0-9_-]{1,2040}$/.test(raw)) return undefined;
  try {
    const payload=Buffer.from(raw.slice(4),'base64url');
    if (payload.toString('base64url')!==raw.slice(4)) return undefined;
    const parsed=CursorSchema.safeParse(JSON.parse(payload.toString('utf8')));
    return parsed.success?parsed.data:undefined;
  } catch {return undefined;}
}

/** Public stage shows only the active scene, presentation labels and ground objects.
 * Held inventory, absent characters, private places/minds and identity metadata
 * belong to separate, explicitly authorized inspection surfaces. */
export function projectRunStage(input:{snapshot:WorldSnapshot;configuration:unknown;lifecycle:unknown}):RunStageView {
  const world=WorldSnapshotSchema.parse(input.snapshot);
  const configuration=ReadyRunConfigurationSchema.parse(input.configuration);
  const scene=world.scenes.find((item)=>item.id===world.activeSceneId);
  if (scene===undefined) throw new Error('Escena activa sin estado confirmado');
  const places=world.places.filter((place)=>scene.placeIds.includes(place.id));
  const visiblePlaces=new Set(places.map((place)=>place.id));
  const entities:z.infer<typeof StageEntitySchema>[]=[];
  for (const entity of world.entities) {
    switch(entity.kind) {
      case 'character':
        if (entity.presence.kind!=='present'||entity.presence.sceneId!==scene.id||!scene.participantIds.includes(entity.characterId)||!visiblePlaces.has(entity.placeId)) break;
        entities.push(StageEntitySchema.parse({kind:'character',entityId:entity.entityId,label:entity.presentation.label,
          placeId:entity.placeId,position:entity.position,species:entity.species,
          availability:characterCanReceiveAt({snapshot:world,characterId:entity.characterId})?'available':'unavailable'}));
        break;
      case 'device':
        if (!visiblePlaces.has(entity.placeId)) break;
        entities.push(StageEntitySchema.parse({kind:'device',entityId:entity.entityId,label:entity.label,placeId:entity.placeId,
          position:entity.position,availability:entity.availability,power:entity.power}));
        break;
      case 'object': {
        const entry=world.inventory.find((item)=>item.objectEntityId===entity.entityId);
        if (entry?.location.kind!=='atPlace'||!visiblePlaces.has(entry.location.placeId)) break;
        entities.push(StageEntitySchema.parse({kind:'object',entityId:entity.entityId,label:entity.label,
          placeId:entry.location.placeId,position:entry.location.position,holderEntityId:null,
          ...(entity.quantity===undefined?{}:{quantity:entity.quantity}),...(entity.condition===undefined?{}:{condition:entity.condition})}));
        break;
      }
      default:{const exhaustive:never=entity;throw new Error(String(exhaustive));}
    }
  }
  const connections=world.connections.filter((connection)=>visiblePlaces.has(connection.from)&&visiblePlaces.has(connection.to));
  const doorIds=new Set(connections.flatMap((connection)=>connection.doorId===null?[]:[connection.doorId]));
  const humanParticipants=configuration.humanParticipants.flatMap<RunStageView['humanParticipants'][number]>((profile)=>{
    const presence=profile.presence;
    if (presence.kind==='remote') return [{participantId:profile.identity.participantId,label:profile.identity.displayName,presence:'remote',placeId:null,position:null}];
    const place=places.find((candidate)=>candidate.id===presence.placeId);
    if (presence.sceneId!==scene.id||place===undefined||presence.position.x<0||presence.position.x>place.width||presence.position.y<0||presence.position.y>place.height) return [];
    return [{participantId:profile.identity.participantId,label:profile.identity.displayName,presence:'inScene',placeId:presence.placeId,position:presence.position}];
  });
  return RunStageViewSchema.parse({kind:'run-stage',runId:world.runId,configRevision:configuration.configRevision,
    worldRevision:world.revision,worldSeq:world.seq,fictionalAt:world.clock.instant,clock:world.clock,lifecycle:input.lifecycle,
    activeSceneId:scene.id,scenes:[{id:scene.id,label:scene.label,lifecycle:scene.lifecycle.kind,placeIds:scene.placeIds}],
    places:places.map(({id,name,width,height,lighting})=>({id,name,width,height,lighting})),entities,
    connections:connections.map(({from,to,durationMs,arrivalPoint,doorId})=>({from,to,durationMs,arrivalPoint,doorId})),
    doors:world.doors.filter((door)=>doorIds.has(door.id)).map(({id,label,state})=>({id,label,state})),
    channels:world.channels.filter((channel)=>channel.placeIds.some((id)=>visiblePlaces.has(id))).map((channel)=>({
      id:channel.id,kind:channel.kind,label:channel.label,enabled:channel.enabled,placeIds:channel.placeIds.filter((id)=>visiblePlaces.has(id))})),humanParticipants});
}

function characterReference(snapshot:WorldSnapshot,stage:RunStageView,actorId:string) {
  const source=snapshot.entities.find((entity)=>entity.kind==='character'&&entity.characterId===actorId);
  const visible=source===undefined?undefined:stage.entities.find((entity)=>entity.entityId===source.entityId&&entity.kind==='character');
  return visible===undefined?undefined:{entityId:visible.entityId,label:visible.label};
}
function speakerFor(event:WorldEvent,snapshot:WorldSnapshot,stage:RunStageView) {
  if (event.origin.kind==='system') return null;
  if (event.origin.kind==='human') {
    const participantId=event.origin.participantId;
    if (!stage.humanParticipants.some((participant)=>participant.participantId===participantId)) return undefined;
    if (event.kind!=='humanIntervention') return undefined;
    return PublicSpeakerSchema.parse({kind:'human',participantId:event.origin.participantId,label:event.speakerDisplayName});
  }
  const ref=characterReference(snapshot,stage,event.origin.actorId);
  return ref===undefined?undefined:PublicSpeakerSchema.parse({kind:'character',...ref});
}
function eventSummary(event:WorldEvent,stage:RunStageView,speaker:z.infer<typeof PublicSpeakerSchema>|null):string|undefined {
  const label=speaker?.label??'Escenario';
  const object=(entityId:string)=>stage.entities.find((entity)=>entity.entityId===entityId)?.label;
  switch(event.kind) {
    case 'humanIntervention': case 'communicated':
      if (!stage.channels.some((channel)=>channel.id===event.channelId)) return undefined;
      return `${label} emitió una comunicación.`;
    case 'moved': {
      const from=stage.places.find((place)=>place.id===event.from)?.name;
      const to=stage.places.find((place)=>place.id===event.to)?.name;
      return from===undefined||to===undefined?undefined:`${label} se desplazó de ${from} a ${to}.`;
    }
    case 'objectTaken':return object(event.objectEntityId)===undefined?undefined:`${label} tomó ${object(event.objectEntityId)}.`;
    case 'offerCreated':case 'offerAccepted':case 'offerInvalidated':return object(event.objectEntityId)===undefined?undefined:`Una oferta sobre ${object(event.objectEntityId)} cambió de estado.`;
    case 'deviceUsed':return object(event.deviceEntityId)===undefined?undefined:`${label} utilizó ${object(event.deviceEntityId)}.`;
    case 'waited':return `${label} esperó.`;
    case 'rested':return `${label} descansó.`;
    default:{const exhaustive:never=event;throw new Error(String(exhaustive));}
  }
}

export function createRunObservationApplication(input:{journal:Journal}) {
  function readStage(rawInput:unknown) {
    const parsed=ObservationStageRequestSchema.safeParse(rawInput);if(!parsed.success)return invalidCut;
    const request=parsed.data;
    const state=input.journal.readWorldLifecycle({runId:request.runId});if(state===undefined)return missing;
    if(request.atWorldSeq!==undefined&&request.atWorldSeq>state.lastWorldSeq)return invalidCut;
    const snapshot=input.journal.loadWorld({runId:request.runId,...(request.atWorldSeq===undefined?{}:{throughWorldSeq:request.atWorldSeq})});
    if(snapshot===undefined)return invalidCut;
    const configuration=input.journal.readWorldConfiguration({runId:request.runId});if(configuration===undefined)return missing;
    return {kind:'found',value:projectRunStage({snapshot,configuration,lifecycle:state.lifecycle})} satisfies {kind:'found';value:RunStageView};
  }

  function readPage(rawInput:unknown,surface:'events'|'conversations') {
    const parsed=ObservationPageRequestSchema.safeParse(rawInput);if(!parsed.success)return invalidCut;
    const request=parsed.data;
    const state=input.journal.readWorldLifecycle({runId:request.runId});if(state===undefined)return missing;
    const configuration=input.journal.readWorldConfiguration({runId:request.runId});if(configuration===undefined)return missing;
    const cursor=request.pageCursor===undefined?undefined:decodeCursor(request.pageCursor);
    if (request.pageCursor!==undefined&&(cursor===undefined||cursor.runId!==request.runId||cursor.surface!==surface
      ||cursor.from!==request.fromWorldSeq||cursor.after===null||cursor.afterKey!==null
      ||(request.toWorldSeq!==undefined&&request.toWorldSeq!==cursor.to))) return invalidCursor;
    const to=cursor?.to??request.toWorldSeq??state.lastWorldSeq;
    if(request.fromWorldSeq>to||to>state.lastWorldSeq||(cursor?.after!==undefined&&cursor.after!==null&&(cursor.after<request.fromWorldSeq||cursor.after>to)))return invalidCut;
    const rows=input.journal.readObservationEvents({runId:request.runId,fromWorldSeq:request.fromWorldSeq,toWorldSeq:to,
      afterWorldSeq:cursor?.after??null,limit:request.limit,communicationsOnly:surface==='conversations'});
    if(rows===undefined)return missing;
    const events:z.infer<typeof ConfirmedEventViewSchema>[]=[];
    const conversations:z.infer<typeof ConversationViewSchema>[]=[];
    for(const {event,snapshot} of rows) {
      const stage=projectRunStage({snapshot,configuration,lifecycle:state.lifecycle});
      const speaker=speakerFor(event,snapshot,stage);if(speaker===undefined)continue;
      const summary=eventSummary(event,stage,speaker);if(summary===undefined)continue;
      events.push(ConfirmedEventViewSchema.parse({kind:'confirmed-event',eventId:event.id,runId:request.runId,
        worldSeq:event.seq,fictionalAt:event.fictitiousAt,durationMs:event.durationMs,sceneId:stage.activeSceneId,eventType:event.kind,speaker,summary}));
      if((event.kind!=='communicated'&&event.kind!=='humanIntervention')||speaker===null)continue;
      const channel=stage.channels.find((item)=>item.id===event.channelId);if(channel===undefined)continue;
      const refs=(ids:readonly string[])=>ids.flatMap((id)=>{const ref=characterReference(snapshot,stage,id);return ref===undefined?[]:[ref];});
      const statuses=input.journal.readObservationDeliveries({runId:request.runId,eventId:event.id});
      if(statuses.length>100)throw new Error('Audiencia de publicación supera el contrato');
      const deliveries=statuses.flatMap((delivery)=>{
        const recipient=characterReference(snapshot,stage,delivery.actorId);
        return recipient===undefined?[]:[{recipient,state:delivery.state,memoryProjection:delivery.memoryProjection}];
      });
      conversations.push(ConversationViewSchema.parse({kind:'published-communication',eventId:event.id,runId:request.runId,
        worldSeq:event.seq,fictionalAt:event.fictitiousAt,sceneId:stage.activeSceneId,speaker,channel:{id:channel.id,label:channel.label},
        content:event.content,emission:'emitted',requestedRecipients:refs(event.requestedAudience),effectiveAudience:refs(event.effectiveAudience),
        requestedRecipientCount:event.requestedAudience.length,effectiveAudienceCount:event.effectiveAudience.length,deliveries}));
    }
    const last=rows.at(-1);
    const nextCursor=rows.length===request.limit&&last!==undefined&&last.event.seq<to
      ?encodeCursor({version:1,runId:request.runId,surface,from:request.fromWorldSeq,to,after:last.event.seq,afterKey:null}):null;
    const common={runId:request.runId,fromWorldSeq:request.fromWorldSeq,toWorldSeq:to,lastWorldSeq:state.lastWorldSeq,nextCursor};
    return surface==='events'
      ?{kind:'found',value:ConfirmedEventPageSchema.parse({...common,kind:'confirmed-event-page',items:events})} satisfies {kind:'found';value:z.infer<typeof ConfirmedEventPageSchema>}
      :{kind:'found',value:ConversationPageSchema.parse({...common,kind:'conversation-page',items:conversations})} satisfies {kind:'found';value:z.infer<typeof ConversationPageSchema>};
  }

  function readJobs(rawInput:unknown) {
    const parsed=z.strictObject({runId:RunIdSchema,cursor:z.string().min(1).max(2048).optional(),limit:z.number().int().min(1).max(100).default(25)}).safeParse(rawInput);
    if(!parsed.success)return invalidCursor;
    const request=parsed.data;const stageResult=readStage({runId:request.runId});if(stageResult.kind!=='found')return stageResult;
    const snapshot=input.journal.loadWorld({runId:request.runId});if(snapshot===undefined)return missing;
    const cursor=request.cursor===undefined?undefined:decodeCursor(request.cursor);
    if(request.cursor!==undefined&&(cursor===undefined||cursor.runId!==request.runId||cursor.surface!=='jobs'||cursor.afterKey===null||cursor.after!==null))return invalidCursor;
    const rows=input.journal.readObservationJobs({runId:request.runId,afterKey:cursor?.afterKey??null,limit:request.limit});
    const items=rows.map(({row,usage})=>{
      const safe=TechnicalJobViewSchema.shape.safeCode.safeParse(row.safe_code);
      return TechnicalJobViewSchema.parse({jobId:row.job_id,runId:request.runId,kind:row.kind,generation:row.generation,pulseId:row.pulse_id,
        state:row.state,actor:row.actor_id===null?null:characterReference(snapshot,stageResult.value,row.actor_id)??null,
        createdAt:row.created_at,updatedAt:row.updated_at,elapsedMs:Math.max(0,row.updated_at-row.created_at),
        modelCalls:usage.calls,modelWallTimeMs:usage.measured,reservedWallTimeMs:usage.reserved,safeCode:safe.success?safe.data:null});
    });
    const last=rows.at(-1);const nextCursor=rows.length===request.limit&&last!==undefined
      ?encodeCursor({version:1,runId:request.runId,surface:'jobs',from:WorldSeqSchema.parse(0),to:WorldSeqSchema.parse(0),after:null,afterKey:last.row.page_key}):null;
    return {kind:'found',value:TechnicalJobPageSchema.parse({kind:'technical-job-page',runId:request.runId,items,nextCursor})} satisfies {kind:'found';value:z.infer<typeof TechnicalJobPageSchema>};
  }
  return Object.freeze({readStage,readEvents:(request:unknown)=>readPage(request,'events'),readConversations:(request:unknown)=>readPage(request,'conversations'),readJobs});
}
