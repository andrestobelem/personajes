import type { Dossier } from '../domain/catalog.ts';
import type { DossierEditableFields } from '../domain/dossier-edit.ts';
export type { DossierEditableFields } from '../domain/dossier-edit.ts';

/** Editorial input only: identity, ancestry, hashes and parsed sections remain host-owned. */

export function dossierEditableFields(dossier: Dossier): DossierEditableFields {
  return structuredClone({ displayName: dossier.displayName, aliases: dossier.aliases, performers: dossier.performers, markdown: dossier.markdown, sourceRefs: dossier.sourceRefs, unknowns: dossier.unknowns, contradictions: dossier.contradictions, avatarRef: dossier.avatarRef, voiceRecipe: dossier.voiceRecipe });
}

/** Keep empty rows and exact text until the host previews and validates the manuscript. */
export function replaceEditorialRow(values: readonly string[], index: number, value: string): string[] {
  return values.map((current, position) => position === index ? value : current);
}
