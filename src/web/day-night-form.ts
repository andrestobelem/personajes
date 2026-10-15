import { DayNightCycleSchema, WorldClockSchema } from '../domain/world-schema.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField } from './draft-form.ts';
import { worldCandidate } from './world-preparation.ts';

export function minuteTime(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
export function timeMinute(value: string, allowEndOfDay = false): number {
  if (allowEndOfDay && value === '24:00') return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Indicá una hora HH:mm válida; 24:00 sólo puede cerrar un intervalo.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function dayNightForm(draft: RunConfigurationDraft) {
  const cycle = worldCandidate(draft).clock?.dayNight;
  return { mode: cycle === undefined ? 'absent' : 'configured', day: cycle === undefined ? '' : minuteTime(cycle.dayStartsAtMinute), night: cycle === undefined ? '' : minuteTime(cycle.nightStartsAtMinute), disambiguation: cycle?.disambiguation ?? '' };
}
export function applyDayNightForm(input: { draft: RunConfigurationDraft; mode: string; day: string; night: string; disambiguation: string }): RunConfigurationDraft {
  const world = worldCandidate(input.draft);
  const current = WorldClockSchema.safeParse(world.clock);
  if (!current.success) throw new Error('Elegí primero el momento ficticio y su convención horaria.');
  const { dayNight: previous, ...clock } = current.data;
  if (input.mode === 'absent') return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: { ...world, clock } });
  if (input.mode !== 'configured' || input.disambiguation !== 'compatible') throw new Error('Elegí explícitamente el ciclo y la resolución de cambios horarios.');
  const cycle = DayNightCycleSchema.parse({ dayStartsAtMinute: timeMinute(input.day), nightStartsAtMinute: timeMinute(input.night), disambiguation: input.disambiguation });
  return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: { ...world, clock: { ...clock, dayNight: cycle } } });
}
