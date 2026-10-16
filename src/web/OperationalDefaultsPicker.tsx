import React from 'react';
import {OPERATIONAL_DEFAULT_PRESETS,OperationalDefaultPresetSchema,type OperationalDefaultPreset} from './operational-defaults.ts';

export function OperationalDefaultsPicker(props:{disabled:boolean;pendingEdits:boolean;onApply:(preset:OperationalDefaultPreset)=>void}){
  const [preset,setPreset]=React.useState<OperationalDefaultPreset>('free-performance');
  const selected=OPERATIONAL_DEFAULT_PRESETS.find(option=>option.id===preset);
  return <section className="draft-section" aria-label="Defaults operativos elegibles">
    <div className="section-heading"><h3>Elegir defaults operativos</h3></div>
    <p>Elegí un punto de partida y revisalo antes de guardar. Aplicarlo cambia sólo esta edición local; no inicia la representación ni consume inferencias.</p>
    <label>Perfil operativo<select disabled={props.disabled||props.pendingEdits} value={preset} onChange={event=>setPreset(OperationalDefaultPresetSchema.parse(event.target.value))}>
      {OPERATIONAL_DEFAULT_PRESETS.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <p>{selected?.description}</p>
    <p>Modificará presupuesto, política del reloj, variedad editorial de español, narración y audio:</p>
    <ul>
      <li>Sin topes de llamadas por representación o pulso ni de tiempo acumulado; una solicitud simultánea y hasta 300.000 ms por solicitud.</li>
      <li>{preset==='manual-direction'?'Avance manual del reloj.':'Avance automático por saltos de hasta 60.000 ms, cuando el Escenario lo permita.'}</li>
      <li>Español latinoamericano de doblaje como propuesta editorial, pendiente de confirmar para síntesis.</li>
      <li>{preset==='text-narrator'?'Narrador textual activado.':'Narrador desactivado.'} Audio desactivado; conserva las voces y vinculaciones existentes.</li>
    </ul>
    <p>Conserva el modelo elegido (Sol 6.1 bajo o Claude Opus 5.5 medio), fecha, lugares, reparto, biografías, continuidad, identidad humana e ICM. Elegí el modelo por separado.</p>
    {props.pendingEdits&&<p role="status">Aplicá primero los formularios en edición para conservar sus cambios antes de elegir estos defaults.</p>}
    <button type="button" disabled={props.disabled||props.pendingEdits} onClick={()=>props.onApply(preset)}>Aplicar perfil operativo a la edición local</button>
  </section>;
}
