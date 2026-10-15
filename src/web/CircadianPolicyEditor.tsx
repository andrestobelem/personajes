import React from 'react';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { draftFieldState } from './draft-form.ts';
import { applyCircadianPolicyForm, circadianPolicyForm } from './circadian-policy-form.ts';

export function CircadianPolicyEditor(props: {
  draft: RunConfigurationDraft;
  onChange: (draft: RunConfigurationDraft) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [form, setForm] = React.useState(() => circadianPolicyForm(props.draft));
  const [error, setError] = React.useState('');
  const state = draftFieldState(props.draft.circadianPolicy);
  function edit(next: typeof form) { setForm(next); setError(''); props.onPendingChange(true); }
  function apply() {
    try {
      const next = applyCircadianPolicyForm({ draft: props.draft, ...form });
      props.onChange(next); props.onPendingChange(false); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Revisá la política de reloj.'); }
  }
  return <section className="draft-section" id="draft-circadianPolicy">
    <div className="section-heading"><h3>Reloj del Escenario</h3><span className={`field-state field-state-${state.kind}`} title={state.detail}>{state.label}</span></div>
    <label>Reloj circadiano<select value={form.mode} onChange={(event) => edit({ ...form, mode: event.target.value })}>
      <option value="">Pendiente</option><option value="manual-only">Avance manual</option>
      <option value="advance-while-running">Avance automático hacia rutinas</option>
    </select></label>
    {form.mode === 'advance-while-running' && <label>Máximo avance por salto · milisegundos<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={form.maxAdvanceMs} onChange={(event) => edit({ ...form, maxAdvanceMs: event.target.value })} /></label>}
    <p className="field-help">El avance automático busca el próximo límite de una rutina preparada, dentro del máximo elegido y sólo durante ejecución sin trabajo en vuelo. No sigue el reloj del equipo ni acumula tiempo fuera de línea. Cero impide saltos automáticos; un límite más lejano que el máximo no se alcanza mediante saltos parciales.</p>
    <p className="field-help">Las rutinas actuales usan intervalos con fecha y hora concretas. La repetición diaria y el ciclo de día y noche todavía no están implementados. Cambiar esta política no crea rutinas ni inicia la obra.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button onClick={apply}>Aplicar política de reloj</button>
  </section>;
}
