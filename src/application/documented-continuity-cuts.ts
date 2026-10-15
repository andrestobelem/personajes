import { z } from 'zod';
import { ContinuityContextSchema, ContinuityMilestoneSchema } from '../domain/preparation.ts';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { ProposalIdSchema, SourceRefIdSchema } from '../domain/values.ts';

export const DocumentedContinuityCutIdSchema = z.enum(['max-99-wedding-preparations', 'hymie-kaos-introduction']);
export type DocumentedContinuityCutId = z.infer<typeof DocumentedContinuityCutIdSchema>;
export const DocumentedContinuityCutSchema = z.strictObject({
  id: DocumentedContinuityCutIdSchema,
  revision: z.number().int().min(1),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  sources: z.array(z.strictObject({
    url: z.url().startsWith('https://').max(120).pipe(SourceRefIdSchema), title: z.string().min(1).max(200),
    scope: z.string().min(1).max(500), uncertainty: z.string().min(1).max(500),
  })).min(1).max(10),
  milestones: z.array(ContinuityMilestoneSchema.extend({ sourceRefs: z.array(SourceRefIdSchema).min(1).max(1000) })).min(1).max(100),
}).superRefine((cut, context) => {
  const refs = new Set(cut.sources.map((source) => source.url));
  for (const [index, milestone] of cut.milestones.entries()) {
    if (milestone.sourceRefs.some((reference) => !refs.has(reference))) context.addIssue({ code: 'custom', path: ['milestones', index, 'sourceRefs'], message: 'El hito cita una fuente ajena al corte.' });
  }
});
export type DocumentedContinuityCut = z.infer<typeof DocumentedContinuityCutSchema>;

const weddingSource = 'https://tv.apple.com/us/episode/with-love-and-twitches/umc.cmc.5yr8eis7zcn0gpo9z9hj1tblq?l=es';
const hymieSource = 'https://tv.apple.com/us/episode/back-to-the-old-drawing-board/umc.cmc.49vtacltota1xby2kioyqv318';

/** Bounded editorial catalog verified against distributor synopses on 2026-10-15.
 * URLs identify the episode/language; Apple may append showId when opening it.
 * These selections are neither runtime snapshots nor a complete canon timeline.
 */
const documentedContinuityCuts = z.array(DocumentedContinuityCutSchema).parse([
  {
    id: 'max-99-wedding-preparations', revision: 1, title: 'Preparativos de la boda de Max y 99',
    description: 'With Love and Twitches: la sinopsis sitúa el día previsto de la boda y el esfuerzo de Max por llegar al altar. La celebración consumada queda por establecer; no se incorporan embarazo ni nacimientos.',
    sources: [{ url: weddingSource, title: 'Apple TV · With Love and Twitches · sinopsis en español',
      scope: 'Sinopsis del distribuidor: identifica a Max y 99 y la dificultad de llegar a tiempo al altar.',
      uncertainty: 'No acredita el desenlace de la ceremonia, pensamientos privados ni fecha diegética. La fecha de catálogo es de emisión, no de ficción.' }],
    milestones: [
      { milestoneId: 'boda-max-99-prevista', label: 'Está previsto el día de la boda de Max y 99; Max afronta dificultades para llegar al altar.', status: 'reached', sourceRefs: [weddingSource] },
      { milestoneId: 'matrimonio-max-99-celebrado', label: 'Celebración de la ceremonia matrimonial de Max y 99: no establecida por la sinopsis consultada.', status: 'undetermined', sourceRefs: [weddingSource] },
    ],
  },
  {
    id: 'hymie-kaos-introduction', revision: 1, title: 'Presentación de Hymie por KAOS',
    description: 'Back to the Old Drawing Board: KAOS crea a Hymie para secuestrar a un científico de CONTROL. No se presupone el resultado del plan ni su posterior relación con CONTROL.',
    sources: [{ url: hymieSource, title: 'Apple TV · Back to the Old Drawing Board · sinopsis',
      scope: 'Sinopsis del distribuidor: KAOS crea un robot llamado Hymie para secuestrar a un científico de CONTROL.',
      uncertainty: 'No acredita secuestro consumado, cambio de lealtad, programación completa, saberes privados ni fecha diegética.' }],
    milestones: [
      { milestoneId: 'hymie-creado-por-kaos', label: 'KAOS ha creado a Hymie con el propósito de secuestrar a un científico de CONTROL.', status: 'reached', sourceRefs: [hymieSource] },
      { milestoneId: 'hymie-lealtad-control', label: 'Colaboración posterior de Hymie con CONTROL: no establecida por la sinopsis consultada.', status: 'undetermined', sourceRefs: [hymieSource] },
    ],
  },
]);

// Consumers may inspect the catalog but cannot change the evidence used by later
// preparations. Freeze every mutable level of this known, schema-validated shape.
for (const cut of documentedContinuityCuts) {
  for (const source of cut.sources) Object.freeze(source);
  Object.freeze(cut.sources);
  for (const milestone of cut.milestones) {
    Object.freeze(milestone.sourceRefs);
    Object.freeze(milestone);
  }
  Object.freeze(cut.milestones);
  Object.freeze(cut);
}
export const DOCUMENTED_CONTINUITY_CUTS = Object.freeze(documentedContinuityCuts);

/** Build a proposed continuity only: no world, date, actor curation or memories are inferred. */
export async function createDocumentedContinuityDraft(input: {
  cutId: string; runId: string; uuid: () => string;
}): Promise<RunConfigurationDraft> {
  const cutId = DocumentedContinuityCutIdSchema.parse(input.cutId);
  const cut = DOCUMENTED_CONTINUITY_CUTS.find((candidate) => candidate.id === cutId);
  if (cut === undefined) throw new Error('El corte documental no está disponible.');
  const draft = createEmptyRunConfigurationDraft({ runId: input.runId, revision: 0 });
  const core = {
    continuityId: `documented-${cut.id}`, revision: cut.revision, kind: 'original',
    label: `${cut.title} · corte documental limitado v${cut.revision}. ${cut.description} ${cut.sources.map((source) => `${source.title}. ${source.scope} Límite: ${source.uncertainty}`).join(' ')}`,
    milestones: cut.milestones, inclusions: [],
  };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(core)));
  const contentHash = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const continuity = ContinuityContextSchema.parse({ ...core, contentHash });
  const nameProposalId = ProposalIdSchema.parse(input.uuid());
  const continuityProposalId = ProposalIdSchema.parse(input.uuid());
  if (new Set<string>([nameProposalId, continuityProposalId, draft.runId]).size !== 3) throw new Error('El generador de identificadores repitió un UUID.');
  return RunConfigurationDraftSchema.parse({ ...draft,
    name: { kind: 'proposed', source: 'editorial', proposalId: nameProposalId, value: `${cut.title} · preparación por completar` },
    continuity: { kind: 'proposed', source: 'editorial', proposalId: continuityProposalId, value: continuity },
  });
}
