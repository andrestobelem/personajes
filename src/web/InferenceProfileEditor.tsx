import { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE } from '../domain/inference-profile.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField, draftFieldState } from './draft-form.ts';

export function InferenceProfileEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void }) {
  const field = props.draft.inferenceProfile;
  const profile = field === undefined || field.kind === 'empty' ? undefined : field.value;
  const selected = profile?.model === DEFAULT_INFERENCE_PROFILE.model ? 'sol-low'
    : profile?.model === CLAUDE_INFERENCE_PROFILE.model ? 'opus-medium' : '';
  const state = draftFieldState(field);
  return <section className="draft-section" id="draft-inferenceProfile">
    <div className="section-heading"><h3>Modelo de los agentes</h3><span className={`field-state field-state-${state.kind}`} title={state.detail}>{state.label}</span></div>
    <label>Modelo y razonamiento<select value={selected} onChange={(event) => props.onChange(changeDraftField({
      draft: props.draft, field: 'inferenceProfile', value: event.target.value === 'sol-low' ? DEFAULT_INFERENCE_PROFILE
        : event.target.value === 'opus-medium' ? CLAUDE_INFERENCE_PROFILE : undefined,
    }))}>
      <option value="">Elegir un perfil</option>
      <option value="sol-low">GPT-6.1 Sol · bajo</option>
      <option value="opus-medium">Claude Opus 5.5 · medio</option>
    </select></label>
    <p className="field-help">Cada actor conserva su propia instancia Pi. El perfil elegido se aplica a los agentes de esta representación, sin sustitución automática.</p>
    {(field === undefined || profile?.model === 'gpt-6-luna') && <p className="field-help">Perfil histórico: Luna 6 · xhigh. Se conserva para leer la historia; no está habilitado para nuevas inferencias. Elegir otro perfil modifica esta preparación y exige volver a validarla.</p>}
    {selected === 'opus-medium' ? <p className="field-help">Claude requiere acceso propio de Anthropic en el host. El login de OpenAI no habilita Claude; seleccionar este perfil no configura credenciales ni hace una llamada.</p>
      : selected === 'sol-low' ? <p className="field-help">OpenAI Codex usa login OAuth. La credencial guardada y la disponibilidad del modelo se verifican por separado.</p>
        : <p className="field-help">Elegí un perfil antes de una nueva ejecución. La ausencia de este campo en una preparación histórica no cambia su modelo anterior.</p>}
  </section>;
}
