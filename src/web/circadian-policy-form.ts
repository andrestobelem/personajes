import { CircadianPolicySchema, type RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField } from './draft-form.ts';

export function circadianPolicyForm(draft: RunConfigurationDraft) {
  const policy = draft.circadianPolicy.kind === 'empty' ? undefined : draft.circadianPolicy.value;
  return { mode: policy?.kind ?? '', maxAdvanceMs: policy?.kind === 'advance-while-running' ? String(policy.maxAdvanceMs) : '' };
}

export function applyCircadianPolicyForm(input: {
  draft: RunConfigurationDraft; mode: string; maxAdvanceMs: string;
}): RunConfigurationDraft {
  if (input.mode === '') return changeDraftField({ draft: input.draft, field: 'circadianPolicy', value: undefined });
  if (input.mode === 'manual-only') return changeDraftField({ draft: input.draft, field: 'circadianPolicy', value: { kind: 'manual-only' } });
  if (input.mode !== 'advance-while-running') throw new Error('Elegí una política de reloj válida.');
  if (!/^\d+$/.test(input.maxAdvanceMs.trim())) throw new Error('Indicá un límite de avance en milisegundos enteros, mayor o igual que cero.');
  const parsed = CircadianPolicySchema.safeParse({ kind: input.mode, maxAdvanceMs: Number(input.maxAdvanceMs) });
  if (!parsed.success) throw new Error('El límite de avance debe ser un entero seguro mayor o igual que cero.');
  return changeDraftField({ draft: input.draft, field: 'circadianPolicy', value: parsed.data });
}
