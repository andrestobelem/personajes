import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HashSchema } from './values.ts';
import {canonicalJson} from './canonical-encoding.ts';
export {canonicalJson} from './canonical-encoding.ts';

/** SHA-256 over exact UTF-8 bytes, without trimming or newline normalization. */
export function sha256Utf8(value: string): z.infer<typeof HashSchema> {
  return HashSchema.parse(createHash('sha256').update(value, 'utf8').digest('hex'));
}

/** SHA-256 over the canonical JSON representation of a domain value. */
export function sha256CanonicalJson(value: unknown): z.infer<typeof HashSchema> {
  return sha256Utf8(canonicalJson(value));
}
