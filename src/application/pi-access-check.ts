import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { PiAccessCheckUsageSchema } from '../domain/pi-access-jobs.ts';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import { PersistedInferenceProfileSchema, SelectableInferenceProfileSchema, type PersistedInferenceProfile } from '../domain/inference-profile.ts';

const FingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const CredentialSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('oauth'), refresh: z.string().min(1), access: z.string().min(1), expires: z.number().finite() }).passthrough(),
  z.object({ type: z.literal('api_key'), key: z.string().min(1).optional(), env: z.record(z.string(), z.unknown()).optional() }).passthrough(),
]);
/** Host-private HMAC. A refresh invalidates conservatively; it is not a stable public account ID. */
export function fingerprintPiCredential(input: { credential: unknown; privateSalt: string }): string {
  const salt = z.string().min(32).parse(input.privateSalt);
  const credential = CredentialSchema.parse(input.credential);
  return createHmac('sha256', salt).update(JSON.stringify(credential)).digest('hex');
}
export function fingerprintInferenceProfile(profile: PersistedInferenceProfile): string {
  return createHash('sha256').update(JSON.stringify(PersistedInferenceProfileSchema.parse(profile))).digest('hex');
}
type AccessRuntime = Pick<ModelRuntime, 'getModel' | 'checkAuth' | 'isUsingOAuth' | 'getAuth' | 'streamSimple'>;
type EffectiveProfile = { provider: string; api: string; model: string; providerThinkingLevel: string | null; reasoningEvidence: 'sdk-payload-and-response' };
type SafeUsage = z.infer<typeof UsageSchema>;
type ResultBase = { provider: PersistedInferenceProfile['provider']; requestedProfile: PersistedInferenceProfile; profileFingerprint: string; accountFingerprint: string | null };
export type PiAccessCheckResult = ResultBase & (
  | { kind: 'passed'; effectiveProfile: EffectiveProfile; usage: SafeUsage }
  | { kind: 'failed'; code: 'AUTH_REQUIRED' | 'MODEL_UNAVAILABLE' | 'PROFILE_MISMATCH' | 'PROVIDER_REJECTED' | 'LOCAL_FAILURE' }
  | { kind: 'aborted'; code: 'CANCELLED_BEFORE_DISPATCH' }
  | { kind: 'ambiguous'; code: 'CANCELLED_AFTER_DISPATCH' | 'TIMEOUT' | 'TRANSPORT_UNCERTAIN' | 'AUTH_CHANGED' | 'UNCONFIRMED_PAYLOAD' }
);
const UsageSchema = PiAccessCheckUsageSchema.strip();
/** Construction is inert. The host invokes execute only for an explicit operator command. */
export function createPiAccessCheck(input: {
  modelRuntime: AccessRuntime;
  profile: PersistedInferenceProfile;
  readCredentialFingerprint(input: { provider: PersistedInferenceProfile['provider']; signal: AbortSignal }): Promise<string | undefined>;
  timeoutMs?: number;
}) {
  const profile = PersistedInferenceProfileSchema.parse(input.profile);
  const timeoutMs = z.number().int().min(1).max(60_000).parse(input.timeoutMs ?? 30_000);
  const profileFingerprint = fingerprintInferenceProfile(profile);
  let busy = false;
  let closed = false;
  const closing = new AbortController();
  const pending = new Set<Promise<PiAccessCheckResult>>();
  async function whenSettled(): Promise<void> { while (pending.size > 0) await Promise.allSettled([...pending]); }
  return Object.freeze({
    whenSettled,
    async close(): Promise<void> { closed = true; closing.abort(); await whenSettled(); },
    async execute(options: { signal?: AbortSignal } = {}): Promise<PiAccessCheckResult> {
      const base: ResultBase = { provider: profile.provider, requestedProfile: profile, profileFingerprint, accountFingerprint: null };
      if (!SelectableInferenceProfileSchema.safeParse(profile).success) return { ...base, kind: 'failed', code: 'MODEL_UNAVAILABLE' };
      if (closed) return { ...base, kind: 'aborted', code: 'CANCELLED_BEFORE_DISPATCH' };
      if (busy) return { ...base, kind: 'failed', code: 'LOCAL_FAILURE' };
      if (options.signal?.aborted) return { ...base, kind: 'aborted', code: 'CANCELLED_BEFORE_DISPATCH' };
      busy = true;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const signal = AbortSignal.any([closing.signal, timeout.signal, ...(options.signal === undefined ? [] : [options.signal])]);
      let dispatched = false;
      let payloadConfirmed = false;
      let responseReceived = false;
      let payloadRejected = false;
      function cancelled(): PiAccessCheckResult {
        if (timeout.signal.aborted) return { ...base, kind: 'ambiguous', code: 'TIMEOUT' };
        return dispatched ? { ...base, kind: 'ambiguous', code: 'CANCELLED_AFTER_DISPATCH' } : { ...base, kind: 'aborted', code: 'CANCELLED_BEFORE_DISPATCH' };
      }
      try {
        const operation = async (): Promise<PiAccessCheckResult> => {
          const model = input.modelRuntime.getModel(profile.provider, profile.model);
          if (!model || model.provider !== profile.provider || model.id !== profile.model || model.api !== profile.api || !model.reasoning || model.thinkingLevelMap?.[profile.reasoningEffort] !== profile.reasoningEffort) return { ...base, kind: 'failed', code: 'MODEL_UNAVAILABLE' };
          const auth = await input.modelRuntime.checkAuth(profile.provider, { signal });
          if (!auth || (profile.provider === 'openai-codex' && auth.type !== 'oauth')) return { ...base, kind: 'failed', code: 'AUTH_REQUIRED' };
          if (!await input.modelRuntime.getAuth(model, { signal })) return { ...base, kind: 'failed', code: 'AUTH_REQUIRED' };
          const fingerprint = await input.readCredentialFingerprint({ provider: profile.provider, signal });
          if (fingerprint === undefined) return { ...base, kind: 'failed', code: 'AUTH_REQUIRED' };
          base.accountFingerprint = FingerprintSchema.parse(fingerprint);
          if (signal.aborted) return cancelled();
          const requestOptions: ModelsSimpleStreamOptions = { transport: 'sse', reasoning: profile.reasoningEffort, maxTokens: 64, signal, timeoutMs, maxRetries: 0, maxRetryDelayMs: 0,
            onPayload(payload, requestedModel) {
              payloadRejected = true;
              if (signal.aborted) throw new Error('Cancelled');
              const envelope = z.object({ model: z.string() }).passthrough().parse(payload);
              let effort: string;
              if (profile.provider === 'openai-codex') effort = z.object({ reasoning: z.object({ effort: z.string() }) }).parse(payload).reasoning.effort;
              else {
                const native = z.object({ output_config: z.object({ effort: z.string() }), messages: z.array(z.object({ role: z.string(), output_config: z.object({ effort: z.string() }).optional() }).passthrough()).optional() }).parse(payload);
                // Pi 1.2 managed-effort Claude uses a final system overlay; top-level high is its prefix base.
                effort = native.messages?.findLast((message) => message.role === 'system' && message.output_config !== undefined)?.output_config?.effort ?? native.output_config.effort;
              }
              if (envelope.model !== profile.model || requestedModel.id !== profile.model || requestedModel.provider !== profile.provider || requestedModel.api !== profile.api || effort !== profile.reasoningEffort) throw new Error('Profile mismatch');
              payloadConfirmed = true; payloadRejected = false; dispatched = true;
              return undefined;
            },
            onResponse() { responseReceived = true; },
          };
          // No persistent AgentSession, system prompt, fictional context, tools or character data.
          const stream = input.modelRuntime.streamSimple(model, { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }, requestOptions);
          const message = await stream.result();
          if (signal.aborted) return cancelled();
          if (message.stopReason === 'aborted') return cancelled();
          if (payloadRejected) return { ...base, kind: 'failed', code: 'PROFILE_MISMATCH' };
          if (message.stopReason === 'error') return responseReceived ? { ...base, kind: 'failed', code: 'PROVIDER_REJECTED' } : { ...base, kind: 'ambiguous', code: 'TRANSPORT_UNCERTAIN' };
          if (!payloadConfirmed) return { ...base, kind: 'ambiguous', code: 'UNCONFIRMED_PAYLOAD' };
          if (message.provider !== profile.provider || message.model !== profile.model || message.api !== profile.api || (message.responseModel !== undefined && message.responseModel !== profile.model) || (message.providerThinkingLevel !== undefined && message.providerThinkingLevel !== profile.reasoningEffort) || !['stop', 'length'].includes(message.stopReason) || message.content.some((part) => part.type === 'toolCall')) return { ...base, kind: 'failed', code: 'PROFILE_MISMATCH' };
          const after = await input.readCredentialFingerprint({ provider: profile.provider, signal });
          if (after !== base.accountFingerprint) return { ...base, kind: 'ambiguous', code: 'AUTH_CHANGED' };
          return { ...base, kind: 'passed', effectiveProfile: { provider: message.provider, api: message.api, model: message.responseModel ?? message.model, providerThinkingLevel: message.providerThinkingLevel ?? null, reasoningEvidence: 'sdk-payload-and-response' }, usage: UsageSchema.parse(message.usage) };
        };
        let onAbort: (() => void) | undefined;
        const abort = new Promise<PiAccessCheckResult>((resolve) => { onAbort = () => resolve(cancelled()); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); });
        const running = operation().finally(() => { busy = false; pending.delete(running); });
        pending.add(running);
        try { return await Promise.race([running, abort]); }
        finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
      } catch { return signal.aborted ? cancelled() : dispatched ? { ...base, kind: 'ambiguous', code: 'TRANSPORT_UNCERTAIN' } : { ...base, kind: 'failed', code: 'LOCAL_FAILURE' }; }
      finally { clearTimeout(timer); }
    },
  });
}
