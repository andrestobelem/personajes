/** Pure local-calendar resolution. No wall clock, host APIs, or world-schema runtime import. */
import { Temporal } from '@js-temporal/polyfill';
import type { AvailabilityRoutine, WorldClock } from './world-schema.ts';

type State = 'available' | 'unavailable';
type Interval = { from: number; to: number; state: State };
type Calendar = { intervals: Interval[]; diagnostics: string[] };
type RoutineInput = { routine: AvailabilityRoutine; clock: WorldClock; instant?: number };
const LIMIT = 8_640_000_000_000_000;
const supportedInstant = (instant: number) => Number.isInteger(instant) && Math.abs(instant) <= LIMIT;

function zoneOf(clock: WorldClock): string {
  if (clock.convention.kind === 'ianaZone') return clock.convention.zone;
  const offset = clock.convention.offsetMinutes;
  return `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}

function localEndpoint(date: Temporal.PlainDate, minute: number, zone: string): number {
  const effectiveDate = minute === 1440 ? date.add({ days: 1 }) : date;
  const effectiveMinute = minute === 1440 ? 0 : minute;
  return Temporal.ZonedDateTime.from({
    timeZone: zone, year: effectiveDate.year, month: effectiveDate.month, day: effectiveDate.day,
    hour: Math.floor(effectiveMinute / 60), minute: effectiveMinute % 60,
  }, { disambiguation: 'compatible', overflow: 'reject' }).epochMilliseconds;
}

function expandDaily(input: {
  clock: WorldClock; instant: number;
  windows: readonly { fromMinute: number; toMinute: number; state: State }[];
}): Calendar {
  const diagnostics: string[] = [];
  const intervals: Interval[] = [];
  const zone = zoneOf(input.clock);
  let today: Temporal.PlainDate;
  try {
    if (!supportedInstant(input.instant)) throw new RangeError();
    today = Temporal.Instant.fromEpochMilliseconds(input.instant).toZonedDateTimeISO(zone).toPlainDate();
  } catch {
    return { intervals, diagnostics: ['Zona horaria no soportada o instante fuera del dominio del calendario.'] };
  }
  // Four dates on either side include overnight windows and the largest civil-date jumps.
  for (let offset = -4; offset <= 4; offset += 1) {
    for (const [index, window] of input.windows.entries()) {
      try {
        const date = today.add({ days: offset });
        const endDate = window.toMinute < window.fromMinute ? date.add({ days: 1 }) : date;
        const from = localEndpoint(date, window.fromMinute, zone);
        const to = localEndpoint(endDate, window.toMinute, zone);
        if (from >= to) {
          diagnostics.push(`Ventana ${index + 1} del ${date.toString()} colapsada o invertida por la resolución horaria; se omite.`);
        } else {
          intervals.push({ from, to, state: window.state });
        }
      } catch {
        diagnostics.push(`Ventana ${index + 1}: fecha o extremo fuera del dominio del calendario.`);
      }
    }
  }
  // DST gap displacement can make disjoint civil windows overlap. Neither wins arbitrarily.
  const collided = new Set<Interval>();
  const sorted = intervals.sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    if (left === undefined) continue;
    for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
      const right = sorted[otherIndex];
      if (right === undefined || right.from >= left.to) break;
      // Repeated dates after a dateline jump can resolve to the exact same interval.
      if (left.from === right.from && left.to === right.to && left.state === right.state) continue;
      collided.add(left); collided.add(right);
    }
  }
  if (collided.size > 0) diagnostics.push('Ventanas reordenadas o solapadas por la resolución horaria; se omiten todas las afectadas.');
  return { intervals: sorted.filter((interval) => !collided.has(interval)), diagnostics: [...new Set(diagnostics)] };
}

function calendar(input: RoutineInput): Calendar {
  if (input.routine.kind === 'always') return { intervals: [], diagnostics: [] };
  if (input.routine.kind === 'windows') return { intervals: input.routine.windows, diagnostics: [] };
  return expandDaily({ clock: input.clock, instant: input.instant ?? input.clock.instant, windows: input.routine.windows });
}
function stateAt(intervals: readonly Interval[], defaultState: State, at: number): State {
  return intervals.find((interval) => interval.from <= at && at < interval.to)?.state ?? defaultState;
}
function transitions(intervals: readonly Interval[], defaultState: State): { at: number; state: State }[] {
  const edges = intervals.flatMap((interval) => [
    { at: interval.from, state: interval.state, delta: 1 },
    { at: interval.to, state: interval.state, delta: -1 },
  ]).sort((left, right) => left.at - right.at || left.delta - right.delta);
  const active: Record<State, number> = { available: 0, unavailable: 0 };
  const changes: { at: number; state: State }[] = [];
  let state = defaultState;
  let index = 0;
  while (index < edges.length) {
    const first = edges[index];
    if (first === undefined) break;
    const at = first.at;
    // Group all half-open ends and starts at one instant before publishing a change.
    while (index < edges.length) {
      const edge = edges[index];
      if (edge === undefined || edge.at !== at) break;
      active[edge.state] += edge.delta;
      index += 1;
    }
    const nextState = active.available > 0 ? 'available' : active.unavailable > 0 ? 'unavailable' : defaultState;
    if (nextState !== state) changes.push({ at, state: nextState });
    state = nextState;
  }
  return changes;
}

export function routineIsAvailable(input: RoutineInput): boolean {
  if (input.routine.kind === 'always') return true;
  const result = calendar(input);
  if (result.diagnostics.some((diagnostic) => diagnostic.startsWith('Zona horaria'))) return false;
  return stateAt(result.intervals, input.routine.defaultState, input.instant ?? input.clock.instant) === 'available';
}

/** Start of the current uninterrupted available period, only if an actual off→on transition exists. */
export function currentRoutineBoundary(input: RoutineInput): number | undefined {
  if (input.routine.kind === 'always') return undefined;
  const at = input.instant ?? input.clock.instant;
  const { intervals } = calendar(input);
  if (stateAt(intervals, input.routine.defaultState, at) !== 'available') return undefined;
  // Expansion edges are synthetic for daily recurrence; never publish them as convocations.
  const candidates = transitions(intervals, input.routine.defaultState).filter((change) => change.at <= at && change.state === 'available');
  const last = candidates.at(-1)?.at;
  if (input.routine.kind === 'daily' && last !== undefined && last === intervals.reduce((minimum, interval) => Math.min(minimum, interval.from), Infinity)) return undefined;
  return last;
}

export function nextRoutineBoundary(input: { routine: AvailabilityRoutine; clock: WorldClock; after?: number }): number | undefined {
  if (input.routine.kind === 'always') return undefined;
  const after = input.after ?? input.clock.instant;
  // Absolute schedules preserve their historical endpoint semantics. Recurring
  // schedules filter redundant endpoints to avoid generating empty days forever.
  if (input.routine.kind === 'windows') {
    const future = input.routine.windows.flatMap(window => [window.from, window.to]).filter(at => at > after);
    return future.length === 0 ? undefined : Math.min(...future);
  }
  const { intervals } = calendar({ ...input, instant: after });
  const next = transitions(intervals, input.routine.defaultState).find((change) => change.at > after)?.at;
  // A boundary at the far expansion edge is an artefact of truncation, not tomorrow's recurrence.
  if (input.routine.kind === 'daily' && next !== undefined && next === intervals.reduce((maximum, interval) => Math.max(maximum, interval.to), -Infinity)) return undefined;
  return next;
}

export function routineCalendarDiagnostics(input: { routine: AvailabilityRoutine; clock: WorldClock }): string[] {
  return calendar(input).diagnostics;
}

function dayCalendar(clock: WorldClock, instant: number): Calendar | undefined {
  if (clock.dayNight === undefined) return undefined;
  return expandDaily({ clock, instant, windows: [{ fromMinute: clock.dayNight.dayStartsAtMinute, toMinute: clock.dayNight.nightStartsAtMinute, state: 'available' }] });
}
export function dayNightAt({ clock }: { clock: WorldClock }): 'day' | 'night' | undefined {
  const result = dayCalendar(clock, clock.instant);
  if (result === undefined || result.diagnostics.some((diagnostic) => diagnostic.startsWith('Zona horaria'))) return undefined;
  return stateAt(result.intervals, 'unavailable', clock.instant) === 'available' ? 'day' : 'night';
}
export function nextDayNightBoundary({ clock, after = clock.instant }: { clock: WorldClock; after?: number }): number | undefined {
  const result = dayCalendar(clock, after);
  return result === undefined ? undefined : transitions(result.intervals, 'unavailable').find((change) => change.at > after)?.at;
}

export function dayNightCalendarDiagnostics({ clock }: { clock: WorldClock }): string[] {
  return dayCalendar(clock, clock.instant)?.diagnostics ?? [];
}
