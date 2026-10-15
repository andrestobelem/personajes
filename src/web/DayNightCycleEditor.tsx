import React from 'react';
import { dayNightCalendarDiagnostics } from '../domain/routine-calendar.ts';
import { WorldClockSchema } from '../domain/world-schema.ts';
import { worldCandidate } from './world-preparation.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { dayNightForm, applyDayNightForm } from './day-night-form.ts';

export function DayNightCycleEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void }) {
  const [form, setForm] = React.useState(() => dayNightForm(props.draft));
  const [error, setError] = React.useState('');
  let diagnostics: string[] = [];
  try {
    const preview = applyDayNightForm({ draft: props.draft, ...form });
    const clock = WorldClockSchema.safeParse(worldCandidate(preview).clock);
    if (clock.success) diagnostics = dayNightCalendarDiagnostics({ clock: clock.data });
  } catch { /* Incomplete local fields are reported on apply. */ }
  function edit(next: typeof form) { setForm(next); setError(''); props.onPendingChange(true); }
  return <section className="draft-section" id="draft-dayNight"><h3>Ciclo de día y noche</h3>
    <label>Ciclo editorial<select value={form.mode} onChange={event => edit({ ...form, mode: event.target.value })}><option value="absent">Sin ciclo configurado</option><option value="configured">Configurar horarios locales</option></select></label>
    {form.mode === 'configured' && <><div className="form-row"><label>Comienzo del día<input type="time" step="60" value={form.day} onChange={event => edit({ ...form, day: event.target.value })} /></label><label>Comienzo de la noche<input type="time" step="60" value={form.night} onChange={event => edit({ ...form, night: event.target.value })} /></label></div>
      <label>Resolución de cambios horarios<select value={form.disambiguation} onChange={event => edit({ ...form, disambiguation: event.target.value })}><option value="">Elegir política</option><option value="compatible">Compatible: primera ocurrencia repetida; desplazar hora inexistente</option></select></label></>}
    <p className="field-help">Los horarios usan la convención del reloj ficticio y se repiten cada día, también al cruzar medianoche. En zonas IANA, una hora repetida usa su primera ocurrencia y una hora inexistente se desplaza por el salto horario. No se eligen horas por defecto.</p>
    <p className="field-help">La fase es una referencia editorial. No cambia la iluminación física ni crea percepciones o recuerdos. Las rutinas de cada personaje se preparan por separado.</p>
    {diagnostics.map((detail,index) => <p key={index} role="status">Advertencia de calendario: {detail}</p>)}
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" onClick={() => { try { props.onChange(applyDayNightForm({ draft: props.draft, ...form })); props.onPendingChange(false); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Revisá los horarios elegidos.'); } }}>Aplicar ciclo de día y noche</button>
  </section>;
}
