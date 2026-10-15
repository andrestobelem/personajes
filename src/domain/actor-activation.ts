import { z } from 'zod';
import { CharacterIdSchema, FictionalInstantSchema } from './values.ts';
import { currentRoutineBoundary, nextRoutineBoundary, nextDayNightBoundary } from './routine-calendar.ts';
import { AvailabilityRoutineSchema, WorldClockSchema, WorldSnapshotSchema, type WorldSnapshot } from './world-schema.ts';
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
  const {routine,instant,clock}=z.strictObject({routine:AvailabilityRoutineSchema,instant:FictionalInstantSchema,clock:WorldClockSchema.optional()}).parse(input);
  if (routine.kind === 'daily' && clock === undefined) throw new Error('Una rutina diaria requiere la convención del reloj ficticio.');
  // Legacy absolute windows do not depend on a time zone; their old call shape remains valid.
  return currentRoutineBoundary({ routine, instant, clock: clock ?? { instant, convention: { kind: 'fixedOffset', offsetMinutes: 0, label: 'UTC' } } });
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
    const boundaryAt=currentRoutineAvailabilityBoundary({routine:actor.routine,instant:request.snapshot.clock.instant,clock:request.snapshot.clock});
    if(boundaryAt!==undefined&&boundaryAt>request.previousInstant)
      invitations.push(ActorActivationInvitationSchema.parse({actorId:actor.characterId,
        identityVersion:actor.preparation.identityVersion,trigger:{kind:'routine-boundary',boundaryAt}}));
  }
  return invitations;
}

/** Only actual scene participants whose explicit availability permits a future turn. */
export function nextActorRoutineBoundary(snapshot: WorldSnapshot, activeCharacterIds?: readonly string[]): number | undefined {
  const scene = snapshot.scenes.find(candidate => candidate.id === snapshot.activeSceneId && candidate.lifecycle.kind === 'open');
  if (scene === undefined) return undefined;
  const boundaries = snapshot.entities.flatMap(actor => {
    if (actor.kind !== 'character' || actor.preparation.kind !== 'prepared' || actor.availability.kind !== 'available'
      || actor.presence.kind !== 'present' || actor.presence.sceneId !== scene.id
      || !scene.participantIds.includes(actor.characterId) || !scene.placeIds.includes(actor.placeId)
      || (activeCharacterIds !== undefined && !activeCharacterIds.includes(actor.characterId))) return [];
    const boundary = nextRoutineBoundary({ routine: actor.routine, clock: snapshot.clock });
    return boundary === undefined ? [] : [boundary];
  });
  return boundaries.length === 0 ? undefined : Math.min(...boundaries);
}

export function nextWorldTimeBoundary(snapshot: WorldSnapshot, activeCharacterIds?: readonly string[]): number | undefined {
  if (!snapshot.scenes.some(scene => scene.id === snapshot.activeSceneId && scene.lifecycle.kind === 'open')) return undefined;
  const boundaries = [nextActorRoutineBoundary(snapshot, activeCharacterIds), nextDayNightBoundary({ clock: snapshot.clock })]
    .filter((at): at is number => at !== undefined);
  return boundaries.length === 0 ? undefined : Math.min(...boundaries);
}

/** Next fictional boundary, independent of wall time, offline duration or model latency. */
export function nextRoutineAdvance(input: unknown): number | undefined {
  const request = z.strictObject({ snapshot: WorldSnapshotSchema, policy: CircadianPolicySchema,
    activeCharacterIds: z.array(CharacterIdSchema).optional(),
    lifecycle: z.enum(['running', 'paused', 'stopped', 'closed', 'ready', 'draft']) }).parse(input);
  if (request.lifecycle !== 'running' || request.policy.kind !== 'advance-while-running' || request.policy.maxAdvanceMs === 0) return undefined;
  const next = nextWorldTimeBoundary(request.snapshot, request.activeCharacterIds);
  return next !== undefined && next - request.snapshot.clock.instant <= request.policy.maxAdvanceMs ? next : undefined;
}
