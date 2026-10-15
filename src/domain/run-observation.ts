/** Browser-safe public projections. Never import actor context or private memory here. */
import { z } from 'zod';
import { DirectorObservationSchema } from './admin-roles.ts';
import { CharacterIdSchema, EventIdSchema, HumanParticipantIdSchema, JobIdSchema, PulseIdSchema, RevisionSchema, RunIdSchema, WorldSeqSchema, FictionalInstantSchema } from './values.ts';
import { ChannelIdSchema, CommunicationContentSchema, DoorIdSchema, PlaceIdSchema, SceneIdSchema, WorldClockSchema, WorldEntityIdSchema, WorldPointSchema } from './world-schema.ts';
import { WorldLifecycleSchema } from './run-lifecycle.ts';

const label = z.string().min(1).max(500);
export const PublicCharacterReferenceSchema = z.strictObject({entityId:WorldEntityIdSchema,label});
export const PublicSpeakerSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('character'),entityId:WorldEntityIdSchema,label}),
  z.strictObject({kind:z.literal('human'),participantId:HumanParticipantIdSchema,label}),
]);
const entityBase = {entityId:WorldEntityIdSchema,label};
export const StageEntitySchema = z.discriminatedUnion('kind',[
  z.strictObject({...entityBase,kind:z.literal('character'),placeId:PlaceIdSchema,position:WorldPointSchema,
    availability:z.enum(['available','unavailable']),species:z.enum(['human','animal','robot'])}),
  z.strictObject({...entityBase,kind:z.literal('device'),placeId:PlaceIdSchema,position:WorldPointSchema,
    availability:z.enum(['available','unavailable']),power:z.enum(['on','off'])}),
  z.strictObject({...entityBase,kind:z.literal('object'),placeId:PlaceIdSchema.nullable(),position:WorldPointSchema.nullable(),
    holderEntityId:WorldEntityIdSchema.nullable(),quantity:z.number().int().positive().optional(),condition:z.enum(['usable','damaged','unknown']).optional()}),
]);
export const StagePlaceSchema = z.strictObject({id:PlaceIdSchema,name:label,width:z.number().positive(),height:z.number().positive(),lighting:z.enum(['dark','dim','normal','bright']),
  environment:z.array(z.strictObject({label,detail:z.string().min(1).max(2_000),modality:z.enum(['visual','auditory'])})).max(100_000).optional()});
export const StageChannelSchema = z.strictObject({id:ChannelIdSchema,kind:z.enum(['speech','gesture']),label,enabled:z.boolean(),placeIds:z.array(PlaceIdSchema).max(100)});
export const StageSceneSchema = z.strictObject({id:SceneIdSchema,label,lifecycle:z.enum(['open','closed']),participantIds:z.array(CharacterIdSchema).max(100),placeIds:z.array(PlaceIdSchema).max(100)});
export const RunStageViewSchema = z.strictObject({kind:z.literal('run-stage'),runId:RunIdSchema,configRevision:RevisionSchema,
  worldRevision:RevisionSchema,worldSeq:WorldSeqSchema,commitIndex:RevisionSchema,fictionalAt:FictionalInstantSchema,clock:WorldClockSchema,dayNightPhase:z.enum(['day','night']).optional(),
  lifecycle:WorldLifecycleSchema,lifecycleAsOf:z.literal('current'),activeSceneId:SceneIdSchema.nullable(),scenes:z.array(StageSceneSchema).max(1),
  places:z.array(StagePlaceSchema).max(100),entities:z.array(StageEntitySchema).max(100_000),
  doors:z.array(z.strictObject({id:DoorIdSchema,label,state:z.enum(['open','closed','locked'])})).max(10_000),
  connections:z.array(z.strictObject({from:PlaceIdSchema,to:PlaceIdSchema,doorId:DoorIdSchema.nullable(),arrivalPoint:WorldPointSchema,durationMs:z.number().int().nonnegative()})).max(100_000),
  channels:z.array(StageChannelSchema).max(1_000),
  humanParticipants:z.array(z.strictObject({participantId:HumanParticipantIdSchema,label,presence:z.enum(['inScene','remote']),placeId:PlaceIdSchema.nullable(),position:WorldPointSchema.nullable()})).max(100),
});
export type RunStageView = z.infer<typeof RunStageViewSchema>;

export const PublicEventTypeSchema = z.enum(['moved','communicated','humanIntervention','objectTaken','offerCreated','offerAccepted','offerInvalidated','deviceUsed','waited','rested','clockAdvanced','circumstanceChanged']);
export const ConfirmedEventViewSchema = z.strictObject({kind:z.literal('confirmed-event'),eventId:EventIdSchema,runId:RunIdSchema,
  worldSeq:WorldSeqSchema,commitIndex:RevisionSchema,fictionalAt:FictionalInstantSchema,durationMs:z.number().int().nonnegative(),sceneId:SceneIdSchema,
  eventType:PublicEventTypeSchema,speaker:PublicSpeakerSchema.nullable(),summary:z.string().min(1).max(2_000)});
export const ConversationViewSchema = z.strictObject({kind:z.literal('published-communication'),eventId:EventIdSchema,runId:RunIdSchema,
  worldSeq:WorldSeqSchema,commitIndex:RevisionSchema,fictionalAt:FictionalInstantSchema,sceneId:SceneIdSchema,speaker:PublicSpeakerSchema,
  channel:z.strictObject({id:ChannelIdSchema,label}),content:CommunicationContentSchema,emission:z.literal('emitted'),
  requestedRecipients:z.array(PublicCharacterReferenceSchema).max(100),effectiveAudience:z.array(PublicCharacterReferenceSchema).max(100),
  requestedRecipientCount:z.number().int().nonnegative(),effectiveAudienceCount:z.number().int().nonnegative(),
  deliveries:z.array(z.strictObject({recipient:PublicCharacterReferenceSchema,state:z.enum(['planned','delivering','delivered','failed']),
    memoryProjection:z.enum(['pending','projected','notDelivered'])})).max(100),
});
export type ConversationView = z.infer<typeof ConversationViewSchema>;
const pageBase = {runId:RunIdSchema,fromWorldSeq:WorldSeqSchema,toWorldSeq:WorldSeqSchema,lastWorldSeq:WorldSeqSchema,
  nextCursor:z.string().min(1).max(2048).nullable()};
export const ConfirmedEventPageSchema = z.strictObject({...pageBase,kind:z.literal('confirmed-event-page'),items:z.array(ConfirmedEventViewSchema).max(100)});
export const ConversationPageSchema = z.strictObject({...pageBase,kind:z.literal('conversation-page'),items:z.array(ConversationViewSchema).max(100)});
export const TechnicalJobViewSchema = z.strictObject({jobId:JobIdSchema,runId:RunIdSchema,kind:z.enum(['actor','continuista','pulse','step','preflight','director','narrator','configurator','narration-reviewer']),
  generation:RevisionSchema,pulseId:PulseIdSchema.nullable(),state:z.enum(['queued','running','accepted','blocked','completed','succeeded','failed','canceled','interrupted','cancel-requested']),
  actor:PublicCharacterReferenceSchema.nullable(),createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),
  elapsedMs:z.number().int().nonnegative(),modelCalls:z.number().int().nonnegative(),modelWallTimeMs:z.number().int().nonnegative(),
  reservedWallTimeMs:z.number().int().nonnegative(),safeCode:z.enum(['job-inactive','execution-failed','cancelled','pi-incomplete','proposal-missing','review-incomplete','review-rejected','reformulations-exhausted','recovery-required','preflight-blocked','runtime-unavailable','terminal-incomplete','observation-missing','memory-unavailable','budget-exhausted']).nullable()});
export const TechnicalJobPageSchema = z.strictObject({kind:z.literal('technical-job-page'),runId:RunIdSchema,
  items:z.array(TechnicalJobViewSchema).max(100),nextCursor:z.string().min(1).max(2048).nullable()});
export type TechnicalJobView = z.infer<typeof TechnicalJobViewSchema>;

/** Accepted Director interpretation for the operator; no prompt, context, profile, or session data. */
export const DirectorObservationViewSchema = z.strictObject({
  annotationId: z.string().uuid(),
  worldRevision: RevisionSchema,
  worldSeq: WorldSeqSchema,
  commitIndex: RevisionSchema,
  acceptedAt: z.number().int().nonnegative(),
  evidenceEventReferences: z.array(z.strictObject({eventId:EventIdSchema,worldSeq:WorldSeqSchema,commitIndex:RevisionSchema})).max(1_000),
  observation: DirectorObservationSchema,
});
export const DirectorObservationListSchema = z.strictObject({
  kind: z.literal('director-observation-list'),
  runId: RunIdSchema,
  throughWorldSeq: WorldSeqSchema,
  throughCommitIndex: RevisionSchema,
  items: z.array(DirectorObservationViewSchema).max(10_000),
});
export type DirectorObservationView = z.infer<typeof DirectorObservationViewSchema>;

/** Host-only selector schema uses IDs internally; never serialize this as a public DTO. */
export const ObservationPageRequestSchema = z.strictObject({runId:RunIdSchema,fromWorldSeq:WorldSeqSchema.default(WorldSeqSchema.parse(0)),
  toWorldSeq:WorldSeqSchema.optional(),pageCursor:z.string().min(1).max(2048).optional(),limit:z.number().int().min(1).max(100).default(25)});
export const ObservationStageRequestSchema = z.strictObject({runId:RunIdSchema,atWorldSeq:WorldSeqSchema.optional(),atCommitIndex:RevisionSchema.optional()})
  .superRefine((request,context)=>{
    if(request.atWorldSeq!==undefined&&request.atCommitIndex!==undefined)context.addIssue({code:'custom',message:'Elegí un corte por secuencia o por commitIndex.'});
  });
export const InternalDeliveryStatusSchema = z.strictObject({actorId:CharacterIdSchema,state:z.enum(['planned','delivering','delivered','failed']),memoryProjection:z.enum(['pending','projected','notDelivered'])});
