import { z } from 'zod';

const OpenAICodexSolProfileSchema = z.strictObject({
  provider: z.literal('openai-codex'),
  api: z.literal('openai-codex-responses'),
  model: z.literal('gpt-6.1-sol'),
  reasoningEffort: z.literal('low'),
  fallback: z.literal('none'),
});

const AnthropicClaudeProfileSchema = z.strictObject({
  provider: z.literal('anthropic'),
  api: z.literal('anthropic-messages'),
  model: z.literal('claude-opus-5-5'),
  reasoningEffort: z.literal('medium'),
  fallback: z.literal('none'),
});

const LegacyOpenAICodexLunaProfileSchema = z.strictObject({
  provider: z.literal('openai-codex'),
  api: z.literal('openai-codex-responses'),
  model: z.literal('gpt-6-luna'),
  reasoningEffort: z.literal('xhigh'),
  fallback: z.literal('none'),
});

/** New choices a representation may explicitly select. */
export const SelectableInferenceProfileSchema = z.discriminatedUnion('model', [
  OpenAICodexSolProfileSchema,
  AnthropicClaudeProfileSchema,
]);
export type SelectableInferenceProfile = z.infer<typeof SelectableInferenceProfileSchema>;

/** Includes the retired profile only to read previously persisted representations and sessions. */
export const PersistedInferenceProfileSchema = z.discriminatedUnion('model', [
  OpenAICodexSolProfileSchema,
  AnthropicClaudeProfileSchema,
  LegacyOpenAICodexLunaProfileSchema,
]);
export type PersistedInferenceProfile = z.infer<typeof PersistedInferenceProfileSchema>;

const LegacyStoredPiSessionProfileSchema = z.strictObject({
  provider: z.literal('openai-codex'),
  model: z.literal('gpt-6-luna'),
  reasoning: z.literal('xhigh'),
});

/** Read-only compatibility for the compact profile previously stored with Pi session checkpoints. */
export const StoredPiProfileSchema = z.union([
  PersistedInferenceProfileSchema,
  LegacyStoredPiSessionProfileSchema,
]);
export type StoredPiProfile = z.infer<typeof StoredPiProfileSchema>;

export const DEFAULT_INFERENCE_PROFILE: SelectableInferenceProfile = SelectableInferenceProfileSchema.parse({
  provider: 'openai-codex',
  api: 'openai-codex-responses',
  model: 'gpt-6.1-sol',
  reasoningEffort: 'low',
  fallback: 'none',
});

export const CLAUDE_INFERENCE_PROFILE: SelectableInferenceProfile = SelectableInferenceProfileSchema.parse({
  provider: 'anthropic',
  api: 'anthropic-messages',
  model: 'claude-opus-5-5',
  reasoningEffort: 'medium',
  fallback: 'none',
});

export const LEGACY_INFERENCE_PROFILE: PersistedInferenceProfile = PersistedInferenceProfileSchema.parse({
  provider: 'openai-codex',
  api: 'openai-codex-responses',
  model: 'gpt-6-luna',
  reasoningEffort: 'xhigh',
  fallback: 'none',
});

export type InferenceProvider = SelectableInferenceProfile['provider'];
export type InferenceAuthenticationMethod = 'oauth' | 'api_key';

/** New representations require the explicit OAuth login for their selected provider. */
export function isInferenceAuthenticationMethodAllowed(input: {
  provider: InferenceProvider;
  method: InferenceAuthenticationMethod;
}): boolean {
  return input.method === 'oauth';
}

/** Interpret a historical profile for session recovery without rewriting its stored JSON/hash. */
export function resolveStoredPiProfile(raw: unknown): PersistedInferenceProfile {
  const profile = StoredPiProfileSchema.parse(raw);
  if ('reasoning' in profile) return LEGACY_INFERENCE_PROFILE;
  return profile;
}

/** Missing profile on a historical Ready snapshot means the old fixed Luna profile semantically. */
export function resolveReadyInferenceProfile(input: {
  inferenceProfile?: PersistedInferenceProfile | undefined;
}): PersistedInferenceProfile {
  return input.inferenceProfile ?? LEGACY_INFERENCE_PROFILE;
}
