import { z } from 'zod';
import type { PiRuntime } from '../adapters/pi.ts';

type AuthRuntime = Pick<PiRuntime['modelRuntime'], 'login' | 'logout' | 'listCredentials'>;
type Interaction = Parameters<AuthRuntime['login']>[2];
type LoginOptions = Parameters<AuthRuntime['login']>[3];

const CredentialMetadataSchema = z.array(z.strictObject({
  providerId: z.string().min(1), type: z.enum(['oauth', 'api_key']),
}));
const StatusSchema = z.strictObject({
  provider: z.literal('openai-codex'),
  configuration: z.enum(['oauth-configured', 'oauth-required']),
  accountAccess: z.literal('not-verified'),
});
type Status = z.infer<typeof StatusSchema>;
type Failure = { kind: 'failed'; code: 'OAUTH_BUSY' | 'OAUTH_CANCELLED' | 'OAUTH_LOGIN_FAILED' | 'OAUTH_LOGOUT_FAILED' | 'OAUTH_STATUS_UNAVAILABLE' };
const activeByRuntime = new WeakSet<AuthRuntime>();

/** Administrative host capability. It never returns credentials or verifies model access. */
export function createPiOAuthPort(input: { modelRuntime: AuthRuntime; loginOptions?: LoginOptions; signal?: AbortSignal }) {
  function combinedSignal(signal?: AbortSignal): AbortSignal | undefined {
    if (input.signal === undefined) return signal;
    return signal === undefined ? input.signal : AbortSignal.any([input.signal, signal]);
  }

  async function readStoredStatus(): Promise<{ kind: 'status'; value: Status } | Failure> {
    try {
      // SDK metadata listing is side-effect free and does not refresh tokens or run key commands.
      const credentials = CredentialMetadataSchema.parse(await input.modelRuntime.listCredentials());
      return { kind: 'status', value: StatusSchema.parse({
        provider: 'openai-codex',
        configuration: credentials.some((item) => item.providerId === 'openai-codex' && item.type === 'oauth')
          ? 'oauth-configured' : 'oauth-required',
        accountAccess: 'not-verified',
      }) };
    } catch { return { kind: 'failed', code: 'OAUTH_STATUS_UNAVAILABLE' }; }
  }

  async function status(): Promise<{ kind: 'status'; value: Status } | Failure> {
    if (input.signal?.aborted) return { kind: 'failed', code: 'OAUTH_CANCELLED' };
    return readStoredStatus();
  }

  return Object.freeze({
    status,
    /** Human UI callbacks only: authorization URLs, prompts and codes never enter actor context. */
    async login(interaction: Interaction): Promise<{ kind: 'configured'; status: Status } | Failure> {
      if (activeByRuntime.has(input.modelRuntime)) return { kind: 'failed', code: 'OAUTH_BUSY' };
      const signal = combinedSignal(interaction.signal);
      if (signal?.aborted) return { kind: 'failed', code: 'OAUTH_CANCELLED' };
      activeByRuntime.add(input.modelRuntime);
      try {
        const callbacks = signal === undefined ? interaction : { ...interaction, signal };
        const credential = await input.modelRuntime.login('openai-codex', 'oauth', callbacks, input.loginOptions);
        if (credential.type !== 'oauth') return { kind: 'failed', code: signal?.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_LOGIN_FAILED' };
        // Reconcile a completed SDK operation from persisted metadata even if
        // cancellation arrived after the credential was committed.
        const current = await readStoredStatus();
        if (current.kind === 'failed') return current;
        if (current.value.configuration === 'oauth-configured') return { kind: 'configured', status: current.value };
        return { kind: 'failed', code: signal?.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_LOGIN_FAILED' };
      } catch {
        // SDK failures may carry tokens, credential objects or callback URLs. Do not expose the error.
        return { kind: 'failed', code: signal?.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_LOGIN_FAILED' };
      } finally { activeByRuntime.delete(input.modelRuntime); }
    },
    async logout(options: Parameters<AuthRuntime['logout']>[1] = {}): Promise<{ kind: 'logged-out'; status: Status } | Failure> {
      if (activeByRuntime.has(input.modelRuntime)) return { kind: 'failed', code: 'OAUTH_BUSY' };
      const signal = combinedSignal(options?.signal);
      if (signal?.aborted) return { kind: 'failed', code: 'OAUTH_CANCELLED' };
      activeByRuntime.add(input.modelRuntime);
      try {
        await input.modelRuntime.logout('openai-codex', signal === undefined ? options : { ...options, signal });
        const current = await readStoredStatus();
        if (current.kind === 'failed') return current;
        if (current.value.configuration !== 'oauth-required') return { kind: 'failed', code: 'OAUTH_LOGOUT_FAILED' };
        return { kind: 'logged-out', status: current.value };
      } catch { return { kind: 'failed', code: signal?.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_LOGOUT_FAILED' }; }
      finally { activeByRuntime.delete(input.modelRuntime); }
    },
  });
}
