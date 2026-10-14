import { z } from 'zod';
import { effectiveRequestTimeoutMs, RunConfigurationDraftSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { FictionalInstantSchema } from '../domain/values.ts';
import { WorldClockSchema, WorldPlaceSchema } from '../domain/world-schema.ts';

export const DRAFT_SECTIONS = [
  ['name', 'Nombre'], ['fictionalAt', 'Fecha y hora ficticias'], ['worldSnapshot', 'Escenario inicial'],
  ['continuity', 'Continuidad'], ['roster', 'Reparto y preparación'], ['humanParticipants', 'Interlocutores humanos'],
  ['dramaticLine', 'Línea dramática'], ['circadianPolicy', 'Reloj'], ['spanishVariety', 'Español'],
  ['narrationMode', 'Narrador'], ['inferenceProfile', 'Modelo de los agentes'], ['budget', 'Presupuesto'], ['maxReformulations', 'Reformulaciones'], ['audio', 'Audio'],
] satisfies readonly (readonly [keyof RunConfigurationDraft, string])[];
export type DraftSection = typeof DRAFT_SECTIONS[number][0];

export function draftFieldState(field: RunConfigurationDraft[DraftSection]) {
  if (field === undefined) return { kind: 'empty' as const, label: 'Perfil histórico', detail: 'Esta preparación no registra una selección nueva de modelo.' };
  switch (field.kind) {
    case 'empty': return { kind: 'empty' as const, label: 'Pendiente', detail: 'Todavía no definido.' };
    case 'proposed': return { kind: 'proposed' as const, label: 'Propuesto', detail: `Propuesta de ${field.source}; falta confirmar.` };
    case 'configured': return field.evidence.kind === 'integrator-default'
      ? { kind: 'default' as const, label: 'Valor inicial', detail: 'Convención inicial del producto, editable.' }
      : { kind: 'configured' as const, label: 'Configurado', detail: 'Elección registrada para este borrador.' };
    default: { const exhaustive: never = field; return exhaustive; }
  }
}

export function changeDraftField(input: { draft: RunConfigurationDraft; field: DraftSection; value: unknown }) {
  return RunConfigurationDraftSchema.parse({ ...input.draft, [input.field]: input.value === undefined ? { kind: 'empty' }
    : { kind: 'configured', value: input.value, evidence: { kind: 'operator-choice', operatorId: 'local-user', recordedAt: new Date().toISOString() } } });
}
export function confirmDraftField(input: { draft: RunConfigurationDraft; field: DraftSection }) {
  const section = input.draft[input.field];
  if (section?.kind !== 'proposed') return input.draft;
  return changeDraftField({ ...input, value: section.value });
}

const FixedMomentInputSchema = z.strictObject({ dateTime: z.string(), offset: z.string() });
export function parseFixedMoment(raw: unknown):
  | { kind: 'valid'; instant: z.infer<typeof FictionalInstantSchema>; convention: z.infer<typeof WorldClockSchema>['convention'] }
  | { kind: 'invalid'; message: string } {
  const input = FixedMomentInputSchema.parse(raw);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.dateTime);
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(input.offset);
  if (!match || !offset) return { kind: 'invalid', message: 'Ingresá fecha, hora y diferencia UTC explícitas (por ejemplo, −03:00).' };
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6] ?? 0);
  const hoursOffset = Number(offset[2]); const minutesOffset = Number(offset[3]);
  const offsetMinutes = (offset[1] === '-' ? -1 : 1) * (hoursOffset * 60 + minutesOffset);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
    || minutesOffset > 59 || Math.abs(offsetMinutes) > 840) return { kind: 'invalid', message: 'La fecha, hora o diferencia UTC no es válida.' };
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { kind: 'invalid', message: 'Ese día no existe en el calendario gregoriano.' };
  const instant = FictionalInstantSchema.safeParse(date.getTime() - offsetMinutes * 60_000);
  if (!instant.success) return { kind: 'invalid', message: 'La fecha está fuera del calendario admitido.' };
  return { kind: 'valid', instant: instant.data, convention: { kind: 'fixedOffset', offsetMinutes, label: `UTC${input.offset}` } };
}

export function draftMomentInputs(draft: RunConfigurationDraft) {
  if (draft.fictionalAt.kind === 'empty') return { kind: 'editable' as const, dateTime: '', offset: '' };
  const candidate = draft.worldSnapshot.kind === 'empty' ? undefined : draft.worldSnapshot.value.clock;
  const clock = WorldClockSchema.safeParse(candidate);
  if (!clock.success || clock.data.convention.kind === 'ianaZone') return { kind: 'unsupported' as const,
    dateTime: '', offset: '', label: clock.success ? `Zona IANA: ${clock.data.convention.kind === 'ianaZone' ? clock.data.convention.zone : ''}` : 'Convención horaria pendiente', instant: draft.fictionalAt.value };
  const minutes = clock.data.convention.offsetMinutes;
  const offset = `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  return { kind: 'editable' as const, dateTime: new Date(draft.fictionalAt.value + minutes * 60_000).toISOString().slice(0, 19), offset };
}

export function setDraftMoment(input: { draft: RunConfigurationDraft; dateTime: string; offset: string }) {
  const parsed = parseFixedMoment({ dateTime: input.dateTime, offset: input.offset });
  if (parsed.kind === 'invalid') return parsed;
  const world = input.draft.worldSnapshot.kind === 'empty' ? {} : input.draft.worldSnapshot.value;
  const draft = changeDraftField({ draft: changeDraftField({ draft: input.draft, field: 'fictionalAt', value: parsed.instant }),
    field: 'worldSnapshot', value: { ...world, clock: { instant: parsed.instant, convention: parsed.convention } } });
  return { kind: 'applied' as const, draft };
}

export function draftPlaces(draft: RunConfigurationDraft) {
  return draft.worldSnapshot.kind === 'empty' ? [] : draft.worldSnapshot.value.places ?? [];
}
export function setDraftPlace(input: { draft: RunConfigurationDraft; name: string; description: string; width: string; height: string; lighting: string }) {
  const name = input.name.trim();
  if (!name) throw new Error('El lugar necesita un nombre elegido por vos.');
  if (!input.width.trim() || !input.height.trim() || !input.lighting) throw new Error('Completá ancho, alto e iluminación del lugar.');
  const world = input.draft.worldSnapshot.kind === 'empty' ? {} : input.draft.worldSnapshot.value;
  const places = draftPlaces(input.draft);
  const first = places[0];
  const place = WorldPlaceSchema.parse({ ...first, id: first?.id ?? `lugar-${crypto.randomUUID()}`, name, description: input.description,
    width: Number(input.width), height: Number(input.height), lighting: input.lighting });
  return changeDraftField({ draft: input.draft, field: 'worldSnapshot', value: { ...world, places: [place, ...places.slice(1)] } });
}

export function changedDraftSections(left: RunConfigurationDraft, right: RunConfigurationDraft): DraftSection[] {
  return DRAFT_SECTIONS.filter(([field]) => JSON.stringify(left[field]) !== JSON.stringify(right[field])).map(([field]) => field);
}
export function reconcileDraft(input: { local: RunConfigurationDraft; remote: RunConfigurationDraft; keepLocal: readonly DraftSection[] }) {
  if (input.local.runId !== input.remote.runId) throw new Error('No se pueden reconciliar representaciones distintas.');
  return input.keepLocal.reduce((draft, field) => RunConfigurationDraftSchema.parse({ ...draft, [field]: input.local[field] }), input.remote);
}

export function describeDraftSection(draft: RunConfigurationDraft, section: DraftSection): string {
  switch (section) {
    case 'inferenceProfile': return draft.inferenceProfile === undefined || draft.inferenceProfile.kind === 'empty'
      ? 'Modelo pendiente de selección explícita' : `${draft.inferenceProfile.value.model} · ${draft.inferenceProfile.value.reasoningEffort}`;
    case 'name': return draft.name.kind === 'empty' ? 'Sin nombre' : draft.name.value;
    case 'fictionalAt': return draft.fictionalAt.kind === 'empty' ? 'Momento pendiente' : `${new Date(draft.fictionalAt.value).toISOString()} (UTC)`;
    case 'worldSnapshot': {
      const world = draft.worldSnapshot;
      if (world.kind === 'empty') return 'Escenario pendiente';
      return `Lugares: ${world.value.places?.map((place) => `${place.name} · ${place.width} × ${place.height} · ${place.lighting}`).join('; ') || 'pendientes'}. Escenas: ${world.value.scenes?.map((scene) => scene.label).join('; ') || 'pendientes'}. Entidades: ${world.value.entities?.length ?? 0}.`;
    }
    case 'continuity': return draft.continuity.kind === 'empty' ? 'Continuidad pendiente' : `${draft.continuity.value.label} · revisión ${draft.continuity.value.revision}`;
    case 'roster': return draft.roster.kind === 'empty' ? 'Reparto pendiente' : `${draft.roster.value.activeCharacterIds.join(', ') || 'Sin participantes activos'} · ${draft.roster.value.preparedCharacters.length} contextos preparados`;
    case 'humanParticipants': return draft.humanParticipants.kind === 'empty' ? 'Interlocutores pendientes' : draft.humanParticipants.value.map((profile) => profile.identity.displayName).join(', ') || 'Sin perfiles humanos configurados';
    case 'dramaticLine': return draft.dramaticLine.kind === 'empty' ? 'Línea pendiente' : `${draft.dramaticLine.value.purpose}${draft.dramaticLine.value.question.kind === 'formulated' ? ` · ${draft.dramaticLine.value.question.text}` : ''}${draft.dramaticLine.value.conflict.kind === 'formulated' ? ` · ${draft.dramaticLine.value.conflict.statement}` : ' · Conflicto abierto'}`;
    case 'circadianPolicy': return draft.circadianPolicy.kind === 'empty' ? 'Reloj pendiente' : draft.circadianPolicy.value.kind === 'manual-only' ? 'Avance manual' : `Avance automático · máximo ${draft.circadianPolicy.value.maxAdvanceMs} ms`;
    case 'spanishVariety': return draft.spanishVariety.kind === 'empty' ? 'Variedad pendiente' : draft.spanishVariety.value.label;
    case 'narrationMode': return draft.narrationMode.kind === 'empty' ? 'Narrador pendiente' : draft.narrationMode.value.kind === 'enabled' ? 'Activado' : 'Desactivado';
    case 'budget': return draft.budget.kind === 'empty' ? 'Presupuesto pendiente' : `${draft.budget.value.maxPiCallsPerRun} solicitudes por obra · ${draft.budget.value.maxPiCallsPerPulse} por pulso · ${draft.budget.value.maxConcurrentPiRequests} simultáneas · ${draft.budget.value.maxWallTimeMs / 1_000} segundos acumulados · timeout ${effectiveRequestTimeoutMs(draft.budget.value)} ms por request`;
    case 'maxReformulations': return draft.maxReformulations.kind === 'empty' ? 'Límite pendiente' : `${draft.maxReformulations.value} reformulaciones`;
    case 'audio': return draft.audio.kind === 'empty' ? 'Audio pendiente' : draft.audio.value.mode.kind === 'disabled' ? 'Audio desactivado' : `Audio activado · ${draft.audio.value.speakerSlots.length} voces configuradas`;
    default: { const exhaustive: never = section; return exhaustive; }
  }
}
