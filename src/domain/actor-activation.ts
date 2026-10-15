import { z } from 'zod';
import { CharacterIdSchema, FictionalInstantSchema } from './values.ts';
import { AvailabilityRoutineSchema, WorldSnapshotSchema } from './world-schema.ts';
import { characterCanReceiveAt } from './world.ts';
import { CircadianPolicySchema } from './production.ts';

const ActivationPlanningSchema = z.strictObject({
  snapshot: WorldSnapshotSchema,
  activeCharacterIds: z.array(CharacterIdSchema).max(100),
  previousInstant: FictionalInstantSchema.optional(),
});

/** A technical invitation; it asserts neither perception nor a chosen action. */
export const ActorActivationInvitationSchema = z.strictObject({
  actorId: CharacterIdSchema,
  identityVersion: z.number().int().nonnegative(),
  trigger: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('initial-goal') }),
    z.strictObject({ kind: z.literal('routine-boundary'), boundaryAt: FictionalInstantSchema }),
  ]),
});

/** Start of the currently effective available interval, excluding redundant window edges. */
export function currentRoutineAvailabilityBoundary(input: unknown): number | undefined {
  const {routine,instant}=z.strictObject({routine:AvailabilityRoutineSchema,instant:FictionalInstantSchema}).parse(input);
  if(routine.kind==='always')return undefined;
  const boundaries=new Map<number,'available'|'unavailable'>();
  // Ends restore the default; a window beginning at the same instant takes precedence.
  for(const window of routine.windows)boundaries.set(window.to,routine.defaultState);
  for(const window of routine.windows)boundaries.set(window.from,window.state);
  let state=routine.defaultState;
  let availableFrom:number|undefined;
  for(const [at,next] of [...boundaries].sort(([left],[right])=>left-right)){
    if(at>instant)break;
    if(state==='unavailable'&&next==='available')availableFrom=at;
    if(next==='unavailable')availableFrom=undefined;
    state=next;
  }
  return state==='available'?availableFrom:undefined;
}

/** Pure eligibility only. Admission, stable identity and consumption belong to the journal. */
export function planActorActivationInvitations(input: unknown) {
  const request = ActivationPlanningSchema.parse(input);
  if (request.previousInstant !== undefined && request.previousInstant > request.snapshot.clock.instant)
    throw new Error('Activation planning cannot reverse fictional time');
  const invitations: z.infer<typeof ActorActivationInvitationSchema>[] = [];
  for (const actor of request.snapshot.entities) {
    if (actor.kind !== 'character' || actor.preparation.kind !== 'prepared'
      || !request.activeCharacterIds.includes(actor.characterId)
      || !characterCanReceiveAt({ snapshot: request.snapshot, characterId: actor.characterId })) continue;
    if (actor.mind.goals.some(goal => goal.state === 'active')) invitations.push(ActorActivationInvitationSchema.parse({
      actorId: actor.characterId, identityVersion: actor.preparation.identityVersion, trigger: { kind: 'initial-goal' },
    }));
    if (request.previousInstant === undefined) continue;
    const boundaryAt=currentRoutineAvailabilityBoundary({routine:actor.routine,instant:request.snapshot.clock.instant});
    if(boundaryAt!==undefined&&boundaryAt>request.previousInstant)
      invitations.push(ActorActivationInvitationSchema.parse({actorId:actor.characterId,
        identityVersion:actor.preparation.identityVersion,trigger:{kind:'routine-boundary',boundaryAt}}));
  }
  return invitations;
}

/** Next fictional boundary, independent of wall time, offline duration or model latency. */
export function nextRoutineAdvance(input: unknown): number | undefined {
  const request = z.strictObject({ snapshot: WorldSnapshotSchema, policy: CircadianPolicySchema,
    lifecycle: z.enum(['running', 'paused', 'stopped', 'closed', 'ready', 'draft']) }).parse(input);
  if (request.lifecycle !== 'running' || request.policy.kind !== 'advance-while-running' || request.policy.maxAdvanceMs === 0) return undefined;
  const now = request.snapshot.clock.instant;
  const boundaries = request.snapshot.entities.flatMap(actor => actor.kind === 'character' && actor.routine.kind === 'windows'
    ? actor.routine.windows.flatMap(window => [window.from, window.to]) : []).filter(boundary => boundary > now);
  const next = boundaries.length === 0 ? undefined : Math.min(...boundaries);
  return next !== undefined && next - now <= request.policy.maxAdvanceMs ? next : undefined;
}
