import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AvailabilityRoutineSchema, WorldClockSchema } from '../src/domain/world-schema.ts';
import { currentRoutineBoundary, dayNightAt, dayNightCalendarDiagnostics, nextDayNightBoundary, nextRoutineBoundary, routineCalendarDiagnostics, routineIsAvailable } from '../src/domain/routine-calendar.ts';

const ms = (iso: string) => Date.parse(iso);
const clock = (iso: string, zone = 'UTC') => WorldClockSchema.parse({ instant: ms(iso), convention: { kind: 'ianaZone', zone } });
const daily = (windows: { fromMinute: number; toMinute: number; state?: 'available' | 'unavailable' }[], defaultState = 'unavailable') => AvailabilityRoutineSchema.parse({ kind: 'daily', defaultState, disambiguation: 'compatible', windows: windows.map((window) => ({ ...window, state: window.state ?? 'available' })) });

test('overnight availability starts yesterday and uses half-open midnight intervals', () => {
  const routine = daily([{ fromMinute: 22 * 60, toMinute: 6 * 60 }]);
  const value = clock('2024-02-29T03:00:00Z');
  assert.equal(routineIsAvailable({ routine, clock: value }), true);
  assert.equal(currentRoutineBoundary({ routine, clock: value }), ms('2024-02-28T22:00:00Z'));
  assert.equal(nextRoutineBoundary({ routine, clock: value }), ms('2024-02-29T06:00:00Z'));
  assert.equal(routineIsAvailable({ routine, clock: value, instant: ms('2024-02-29T06:00:00Z') }), false);
});

test('full local days and adjacent windows merge without daily reactivation', () => {
  for (const routine of [daily([{ fromMinute: 0, toMinute: 1440 }]), daily([{ fromMinute: 0, toMinute: 720 }, { fromMinute: 720, toMinute: 1440 }]), daily([], 'available'), AvailabilityRoutineSchema.parse({ kind: 'always' })]) {
    const value = clock('2024-03-10T12:00:00Z', 'America/New_York');
    assert.equal(routineIsAvailable({ routine, clock: value }), true);
    assert.equal(currentRoutineBoundary({ routine, clock: value }), undefined);
    assert.equal(nextRoutineBoundary({ routine, clock: value }), undefined);
  }
  const routine = daily([{ fromMinute: 0, toMinute: 60 }], 'available');
  assert.equal(currentRoutineBoundary({ routine, clock: clock('2024-02-29T12:00:00Z') }), undefined);
});

test('compatible spring gap advances endpoint; day is 23 hours', () => {
  const routine = daily([{ fromMinute: 150, toMinute: 240 }]);
  const value = clock('2024-03-10T07:15:00Z', 'America/New_York');
  assert.equal(routineIsAvailable({ routine, clock: value }), false);
  assert.equal(nextRoutineBoundary({ routine, clock: value }), ms('2024-03-10T07:30:00Z'));
  assert.equal(currentRoutineBoundary({ routine, clock: value, instant: ms('2024-03-10T07:45:00Z') }), ms('2024-03-10T07:30:00Z'));
  const midnight = daily([{ fromMinute: 0, toMinute: 60 }]);
  assert.equal(nextRoutineBoundary({ routine: midnight, clock: clock('2024-03-10T06:00:00Z', 'America/New_York') }), ms('2024-03-11T04:00:00Z'));
});

test('compatible autumn fold chooses earlier endpoint and never starts again in repeated hour', () => {
  const routine = daily([{ fromMinute: 90, toMinute: 180 }]);
  const value = clock('2024-11-03T06:15:00Z', 'America/New_York');
  assert.equal(routineIsAvailable({ routine, clock: value }), true); // 01:15 second pass, after first 01:30.
  assert.equal(currentRoutineBoundary({ routine, clock: value }), ms('2024-11-03T05:30:00Z'));
  assert.equal(nextRoutineBoundary({ routine, clock: value }), ms('2024-11-03T08:00:00Z'));
  const midnight = daily([{ fromMinute: 0, toMinute: 60 }]);
  assert.equal(nextRoutineBoundary({ routine: midnight, clock: clock('2024-11-03T05:00:00Z', 'America/New_York') }), ms('2024-11-04T05:00:00Z'));
});

test('collapsed/inverted and reordered DST windows are omitted and diagnosed', () => {
  const value = clock('2024-03-10T07:45:00Z', 'America/New_York');
  for (const routine of [daily([{ fromMinute: 150, toMinute: 210 }]), daily([{ fromMinute: 150, toMinute: 195 }])]) {
    assert.equal(routineIsAvailable({ routine, clock: value }), false);
    assert.match(routineCalendarDiagnostics({ routine, clock: value }).join(' '), /colapsada o invertida/);
  }
  const overlapping = daily([{ fromMinute: 120, toMinute: 150 }, { fromMinute: 180, toMinute: 240, state: 'unavailable' }]);
  assert.match(routineCalendarDiagnostics({ routine: overlapping, clock: value }).join(' '), /solapadas/);
});

test('fixed ±14-hour offsets and leap date resolve without machine timezone', () => {
  const routine = daily([{ fromMinute: 0, toMinute: 60 }]);
  for (const offsetMinutes of [-840, 840]) {
    const start = ms('2024-02-29T00:00:00Z') - offsetMinutes * 60_000;
    const value = WorldClockSchema.parse({ instant: start + 30 * 60_000, convention: { kind: 'fixedOffset', offsetMinutes, label: 'Ficción' } });
    assert.equal(routineIsAvailable({ routine, clock: value }), true);
    assert.equal(currentRoutineBoundary({ routine, clock: value }), start);
    assert.equal(nextRoutineBoundary({ routine, clock: value }), start + 3_600_000);
  }
});

test('legacy windows merge default and contiguous states without introducing calendar assumptions', () => {
  const routine = AvailabilityRoutineSchema.parse({ kind: 'windows', defaultState: 'unavailable', windows: [{ from: 0, to: 10, state: 'available' }, { from: 10, to: 20, state: 'available' }] });
  const value = WorldClockSchema.parse({ instant: 15, convention: { kind: 'ianaZone', zone: 'Invalid/Zone' } });
  assert.equal(currentRoutineBoundary({ routine, clock: value }), 0);
  assert.equal(nextRoutineBoundary({ routine, clock: value }), 20);
  assert.equal(routineIsAvailable({ routine, clock: value }), true);
  assert.deepEqual(routineCalendarDiagnostics({ routine, clock: value }), []);
});

test('unsupported zones and domain extremes produce bounded diagnostics, never throw', () => {
  const routine = daily([{ fromMinute: 0, toMinute: 1440 }]);
  const value = clock('2024-01-01T00:00:00Z', 'Invalid/Zone');
  assert.equal(routineIsAvailable({ routine, clock: value }), false);
  assert.equal(currentRoutineBoundary({ routine, clock: value }), undefined);
  assert.equal(nextRoutineBoundary({ routine, clock: value }), undefined);
  assert.match(routineCalendarDiagnostics({ routine, clock: value }).join(' '), /Zona horaria/);
  for (const instant of [-8_640_000_000_000_000, 8_640_000_000_000_000]) {
    const edge = WorldClockSchema.parse({ instant, convention: { kind: 'fixedOffset', offsetMinutes: 840, label: 'edge' } });
    assert.doesNotThrow(() => routineIsAvailable({ routine, clock: edge }));
    assert.ok(routineCalendarDiagnostics({ routine, clock: edge }).length > 0);
  }
});

test('day/night is an explicit local interval, independent from lighting', () => {
  const value = WorldClockSchema.parse({ ...clock('2024-11-03T06:15:00Z', 'America/New_York'), dayNight: { dayStartsAtMinute: 90, nightStartsAtMinute: 180, disambiguation: 'compatible' } });
  assert.equal(dayNightAt({ clock: value }), 'day');
  assert.equal(nextDayNightBoundary({ clock: value }), ms('2024-11-03T08:00:00Z'));
  assert.equal(dayNightAt({ clock: clock('2024-11-03T06:15:00Z') }), undefined);
  const night = WorldClockSchema.parse({ ...value, instant: ms('2024-11-03T09:00:00Z') });
  assert.equal(dayNightAt({ clock: night }), 'night');
});

test('skipped civil date does not crash or introduce a spurious day-long unavailable period', () => {
  const routine = daily([{ fromMinute: 0, toMinute: 1440 }]);
  const value = clock('2011-12-30T12:00:00Z', 'Pacific/Apia');
  assert.equal(routineIsAvailable({ routine, clock: value }), true);
  assert.equal(currentRoutineBoundary({ routine, clock: value }), undefined);
  assert.equal(nextRoutineBoundary({ routine, clock: value }), undefined);
  assert.match(routineCalendarDiagnostics({ routine, clock: value }).join(' '), /colapsada/);
});

test('day/night exposes invalid-zone and collapsed-interval diagnostics without a character routine', () => {
  const configuration = { dayStartsAtMinute: 150, nightStartsAtMinute: 210, disambiguation: 'compatible' };
  const collapsed = WorldClockSchema.parse({ ...clock('2024-03-10T07:00:00Z', 'America/New_York'), dayNight: configuration });
  assert.match(dayNightCalendarDiagnostics({ clock: collapsed }).join(' '), /colapsada/);
  const invalid = WorldClockSchema.parse({ ...clock('2024-03-10T07:00:00Z', 'Invalid/Zone'), dayNight: configuration });
  assert.match(dayNightCalendarDiagnostics({ clock: invalid }).join(' '), /Zona horaria/);
  assert.equal(dayNightAt({ clock: invalid }), undefined);
  assert.equal(nextDayNightBoundary({ clock: invalid }), undefined);
  assert.deepEqual(dayNightCalendarDiagnostics({ clock: clock('2024-01-01T00:00:00Z') }), []);
});
