import { useState } from 'react';
import { PREPARATION_PRESETS, type PreparationPreset } from '../application/preparation-presets.ts';
import { DOCUMENTED_CONTINUITY_CUTS } from '../application/documented-continuity-cuts.ts';

export type PreparationPresetChoice = PreparationPreset;

export function PreparationPresetChooser(props: {
  onChoose: (preset: PreparationPresetChoice) => void;
  onChooseContinuity: (cutId: string) => void;
  onCancel: () => void;
}) {
  const [cutId, setCutId] = useState('');
  const selectedCut = DOCUMENTED_CONTINUITY_CUTS.find((cut) => cut.id === cutId);
  return <section className="draft-section" aria-label="Elegir punto de partida">
    <span className="eyebrow">NUEVA PREPARACIÓN</span>
    <h2>Elegí un punto de partida</h2>
    <p>Podés revisar y editar todas las propuestas antes de confirmar la puesta.</p>
    <div className="form-row">
      {PREPARATION_PRESETS.map((preset) => <section className="edit-notice" key={preset.id}>
        <h3>{preset.label}</h3><p>{preset.description}</p>
        <button className={preset.id === 'fibonacci' ? 'primary-button' : undefined} onClick={() => props.onChoose(preset.id)}>{preset.id === 'fibonacci' ? 'Proponer ensayo Max y Hymie' : 'Empezar en blanco'}</button>
        {preset.id === 'fibonacci' ? <details><summary>Ver propuestas y límites del ensayo</summary>
          <p>Propone fecha, lugar, mapa, reparto y propósito. La identidad y los antecedentes de cada actor requieren curación explícita. Tras prepararlos, colocalos en la escena desde el editor del Escenario.</p>
          <p>Sugerencias de objetivos para revisar durante la curación:</p><ul>{preset.goalSuggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
          <p>Estas sugerencias no se agregan automáticamente a los objetivos ni garantizan una respuesta.</p>
        </details> : <p>También podés preparar una continuidad documentada, registrando sus fuentes y conservando los datos que falten.</p>}
      </section>)}
    </div>
    <section className="edit-notice" aria-label="Puesta desde continuidad documentada">
      <h3>Continuidad documentada</h3>
      <p>Elegí antecedentes respaldados por fuentes. La fecha y el lugar de tu nueva escena, el reparto y sus recuerdos siguen pendientes de elección y curación.</p>
      <label htmlFor="documented-continuity-cut">Corte documentado</label>
      <select id="documented-continuity-cut" value={cutId} onChange={(event) => setCutId(event.target.value)}>
        <option value="">Elegir un corte y revisar sus fuentes</option>
        {DOCUMENTED_CONTINUITY_CUTS.map((cut) => <option key={cut.id} value={cut.id}>{cut.title} · revisión {cut.revision}</option>)}
      </select>
      {selectedCut && <div aria-label="Fuentes y límites del corte">
        <p>{selectedCut.description}</p>
        <ul>{selectedCut.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.scope} {source.uncertainty}</p></li>)}</ul>
        <p>Una sinopsis respalda los hechos que enumera; los demás conservan su estado indeterminado. Elegir este corte no convierte sus antecedentes en recuerdos de los actores ni recrea el episodio.</p>
      </div>}
      <button disabled={selectedCut === undefined} onClick={() => { if (selectedCut) props.onChooseContinuity(selectedCut.id); }}>Proponer continuidad elegida</button>
    </section>
    <p className="field-help">Estas opciones crean sólo una edición local: guardar, confirmar las propuestas, validar y empezar son pasos posteriores.</p>
    <button onClick={props.onCancel}>Volver sin crear</button>
  </section>;
}
