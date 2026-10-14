import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DirectorContextSchema, DirectorObservationSchema, type DirectorContext } from '../domain/admin-roles.ts';

/** Host supplies committed events, never proposals, raw memory or model transcripts. */
export function validateDirectorContext(rawContext: unknown): DirectorContext {
  const context = DirectorContextSchema.parse(rawContext);
  const eventIds = new Set<string>();
  let lastSeq = -1;
  for (const event of context.confirmedEvents) {
    if (event.runId !== context.scope.runId || event.seq > context.scope.throughWorldSeq
      || event.fictitiousAt > context.scope.fictitiousAt || event.seq <= lastSeq || eventIds.has(event.id)) {
      throw new Error('El Director requiere eventos confirmados del corte autorizado');
    }
    eventIds.add(event.id); lastSeq = event.seq;
  }
  if (new Set(context.participantCharacterIds).size !== context.participantCharacterIds.length) throw new Error('Participantes duplicados');
  const annotationIds = new Set<string>();
  for (const annotation of context.previousAnnotations) {
    if (annotation.scope.runId !== context.scope.runId || annotation.scope.throughWorldSeq > context.scope.throughWorldSeq
      || annotation.scope.fictitiousAt > context.scope.fictitiousAt || annotationIds.has(annotation.annotationId)) {
      throw new Error('Anotación previa fuera del corte autorizado');
    }
    annotationIds.add(annotation.annotationId);
  }
  return context;
}

export function validateDirectorObservation(input: { context: unknown; observation: unknown }) {
  const context = validateDirectorContext(input.context);
  const observation = DirectorObservationSchema.parse(input.observation);
  const eventIds = new Set(context.confirmedEvents.map(event => event.id));
  if (observation.assessment.evidenceEventIds.some(id => !eventIds.has(id))
    || observation.affectedCharacterIds.some(id => !context.participantCharacterIds.includes(id))) {
    throw new Error('La observación usa referencias no autorizadas');
  }
  const revision = observation.revision;
  if (revision.kind === 'rectification'
    && !context.previousAnnotations.some(annotation => annotation.annotationId === revision.supersedes)) {
    throw new Error('La rectificación no identifica una anotación previa');
  }
  return observation;
}

export function directorContextHash(context: unknown): string {
  return createHash('sha256').update(canonicalDirectorValue(validateDirectorContext(context))).digest('hex');
}
export function canonicalDirectorValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Valor no serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalDirectorValue).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalDirectorValue(record[key])}`).join(',')}}`;
}
