import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ExperienceSchema, FrozenExperienceSchema } from '../domain/experience.ts';
import type { Experience, FrozenExperience } from '../domain/experience.ts';
import { CharacterIdSchema, RunIdSchema, WorldSeqSchema, HashSchema } from '../domain/values.ts';

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error('Valor no serializable');
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function freezeExperience(input: unknown): FrozenExperience {
  const envelope = ExperienceSchema.parse(input);
  const canonicalPayload = canonicalize(envelope);
  if (Buffer.byteLength(canonicalPayload, 'utf8') > 65_536) {
    throw new Error('La experiencia excede el límite de ICM; no se truncó');
  }
  const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex');
  return FrozenExperienceSchema.parse({ envelope, canonicalPayload, payloadHash });
}

export function readPrivateExperience(input: {
  summary: unknown;
  actorId: z.infer<typeof CharacterIdSchema>;
  runId: z.infer<typeof RunIdSchema>;
  throughWorldSeq: z.infer<typeof WorldSeqSchema>;
  expectedPayloadHash: z.infer<typeof HashSchema>;
}): Experience {
  const summary = z.string().refine((text) => Buffer.byteLength(text, 'utf8') <= 65_536, 'Envelope ICM demasiado grande').parse(input.summary);
  const parsed: unknown = JSON.parse(summary);
  const frozen = freezeExperience(parsed);
  if (frozen.envelope.actorId !== input.actorId || frozen.envelope.runId !== input.runId) {
    throw new Error('La experiencia no pertenece al actor y corrida');
  }
  if (frozen.envelope.worldSeq > input.throughWorldSeq) {
    throw new Error('La experiencia es posterior al corte solicitado');
  }
  if (frozen.payloadHash !== input.expectedPayloadHash || frozen.canonicalPayload !== summary) {
    throw new Error('La experiencia no coincide con el payload congelado');
  }
  return frozen.envelope;
}
