import React from 'react';
import { z } from 'zod';
import { ContinuityContextSchema, type ContinuityContext } from '../domain/preparation.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField } from './draft-form.ts';

type MilestoneForm = { milestoneId: string; label: string; status: string; sources: string };
type InclusionForm = { inclusionId: string; label: string; sources: string; confirmedBy: string; confirmedAt: string };
export type ContinuityForm = { continuityId: string; revision: string; kind: string; label: string; milestones: MilestoneForm[]; inclusions: InclusionForm[] };
export function continuityForm(value: ContinuityContext | undefined): ContinuityForm {
  return { continuityId: value?.continuityId ?? '', revision: value === undefined ? '' : String(value.revision), kind: value?.kind ?? '', label: value?.label ?? '',
    milestones: value?.milestones.map((item) => ({ milestoneId: item.milestoneId, label: item.label, status: item.status, sources: item.sourceRefs.join('\n') })) ?? [],
    inclusions: value?.inclusions.map((item) => ({ ...item, sources: item.sourceRefs.join('\n') })) ?? [] };
}
const sourceRefs = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export async function compileContinuityForm(form: ContinuityForm, prior?: ContinuityContext): Promise<ContinuityContext> {
  if (!form.revision.trim()) throw new Error('Elegí una revisión de continuidad.');
  const core = { continuityId: form.continuityId, revision: Number(form.revision), kind: form.kind, label: form.label,
    milestones: form.milestones.map((item) => ({ milestoneId: item.milestoneId, label: item.label, status: item.status, sourceRefs: sourceRefs(item.sources) })),
    inclusions: form.inclusions.map((item) => {
      const previous = prior?.inclusions.find((entry) => entry.inclusionId === item.inclusionId);
      const references = sourceRefs(item.sources);
      const unchanged = previous?.label === item.label && previous.confirmedBy === item.confirmedBy && JSON.stringify(previous.sourceRefs) === JSON.stringify(references);
      return { inclusionId: item.inclusionId, label: item.label, sourceRefs: references, confirmedBy: item.confirmedBy, confirmedAt: unchanged ? previous.confirmedAt : new Date().toISOString() };
    }) };
  // A reproducible digest of this authored cut; this does not certify historical truth.
  const parsed = ContinuityContextSchema.parse({ ...core, contentHash: '0'.repeat(64) });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...parsed, contentHash: undefined })));
  const contentHash = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return ContinuityContextSchema.parse({ ...parsed, contentHash });
}
export function ContinuityPreparationEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void }) {
  const prior = props.draft.continuity.kind === 'empty' ? undefined : props.draft.continuity.value;
  const [form, setForm] = React.useState(() => continuityForm(prior));
  const [error, setError] = React.useState('');
  const [applying, setApplying] = React.useState(false);
  function edit(next: ContinuityForm) { setForm(next); props.onPendingChange(true); setError(''); }
  async function apply() {
    setApplying(true);
    try { const value = await compileContinuityForm(form, prior); props.onChange(changeDraftField({ draft: props.draft, field: 'continuity', value })); props.onPendingChange(false); }
    catch (failure) { setError(failure instanceof z.ZodError ? failure.issues.map((issue) => { const labels: Record<string, string> = {"continuityId": "Identificador de continuidad", "revision": "Revisión", "kind": "Tipo de continuidad", "label": "Descripción", "milestones": "Hitos", "inclusions": "Inclusiones"}; const field = issue.path.findLast((part) => typeof part === 'string'); return `${typeof field === 'string' ? labels[field] ?? field : 'Configuración'}: ${issue.message}`; }).join(' · ') : failure instanceof Error ? failure.message : 'Revisá la continuidad.'); }
    finally { setApplying(false); }
  }
  return <section className="draft-section" id="draft-continuity"><h3>Continuidad elegida</h3><p className="field-help">Declarás qué hechos e historia pertenecen a esta ficción. Una fecha de emisión no prueba cuándo sucede un episodio. Las fuentes se registran como referencias, sin enviar documentos globales al reparto.</p>
    {error && <p className="error" role="alert">{error}</p>}<fieldset disabled={applying}>
    <div className="form-row"><label>Identificador de continuidad<input value={form.continuityId} placeholder="Identificador elegido, letras minúsculas y guiones" onChange={(event) => edit({ ...form, continuityId: event.target.value })} /></label><label>Revisión<input type="number" min="0" value={form.revision} onChange={(event) => edit({ ...form, revision: event.target.value })} /></label><label>Relación con el material original<select value={form.kind} onChange={(event) => edit({ ...form, kind: event.target.value })}><option value="">Pendiente</option><option value="original">Continuidad original</option><option value="adaptation">Adaptación declarada</option></select></label></div>
    <label>Descripción de la continuidad<textarea value={form.label} maxLength={1_000} onChange={(event) => edit({ ...form, label: event.target.value })} /></label>
    <h4>Hitos históricos y estado</h4><p className="field-help">No se presupone que ningún hito haya ocurrido. Podés conservarlo como indeterminado. Sin filas, declarás que este corte no enumera hitos.</p>
    {form.milestones.map((item, index) => <div className="draft-section" key={index}><label>Identificador del hito<input value={item.milestoneId} onChange={(event) => edit({ ...form, milestones: form.milestones.map((row, i) => i === index ? { ...row, milestoneId: event.target.value } : row) })} /></label><label>Qué hecho describe<textarea maxLength={500} value={item.label} onChange={(event) => edit({ ...form, milestones: form.milestones.map((row, i) => i === index ? { ...row, label: event.target.value } : row) })} /></label><label>Estado<select value={item.status} onChange={(event) => edit({ ...form, milestones: form.milestones.map((row, i) => i === index ? { ...row, status: event.target.value } : row) })}><option value="">Pendiente</option><option value="reached">Ya ocurrió</option><option value="notReached">Todavía no ocurrió</option><option value="undetermined">Indeterminado</option></select></label><label>Referencias de evidencia · una por línea<textarea value={item.sources} onChange={(event) => edit({ ...form, milestones: form.milestones.map((row, i) => i === index ? { ...row, sources: event.target.value } : row) })} /></label><button onClick={() => edit({ ...form, milestones: form.milestones.filter((_, i) => i !== index) })}>Quitar hito</button></div>)}
    <button onClick={() => edit({ ...form, milestones: [...form.milestones, { milestoneId: '', label: '', status: '', sources: '' }] })}>Agregar hito</button>
    <h4>Inclusiones y adaptaciones explícitas</h4><p className="field-help">Registrá las excepciones e inclusiones que confirmás para esta puesta, con su procedencia. La confirmación temporal es metadato real, no fecha de la ficción.</p>
    {form.inclusions.map((item, index) => <div className="draft-section" key={item.inclusionId}><label>Inclusión o excepción<textarea maxLength={1_000} value={item.label} onChange={(event) => edit({ ...form, inclusions: form.inclusions.map((row, i) => i === index ? { ...row, label: event.target.value } : row) })} /></label><label>Referencias de evidencia · una por línea<textarea value={item.sources} onChange={(event) => edit({ ...form, inclusions: form.inclusions.map((row, i) => i === index ? { ...row, sources: event.target.value } : row) })} /></label><label>Quién confirma<input value={item.confirmedBy} onChange={(event) => edit({ ...form, inclusions: form.inclusions.map((row, i) => i === index ? { ...row, confirmedBy: event.target.value } : row) })} /></label><button onClick={() => edit({ ...form, inclusions: form.inclusions.filter((_, i) => i !== index) })}>Quitar inclusión</button></div>)}
    <button onClick={() => edit({ ...form, inclusions: [...form.inclusions, { inclusionId: crypto.randomUUID(), label: '', sources: '', confirmedBy: '', confirmedAt: '' }] })}>Agregar inclusión</button><button className="primary-button" onClick={() => void apply()}>Aplicar continuidad</button>
    </fieldset></section>;
}
