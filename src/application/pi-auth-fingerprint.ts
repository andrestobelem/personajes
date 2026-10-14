import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { readStoredCredential } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import type { InferenceProvider } from '../domain/inference-profile.ts';

const ProviderSchema = z.enum(['openai-codex', 'anthropic']);
const OAuthSchema = z.object({ type: z.literal('oauth'), access: z.string().min(1), refresh: z.string().min(1), expires: z.number().finite() }).passthrough();
const KeySchema = z.object({ type: z.literal('api_key'), key: z.string().optional(), env: z.record(z.string(), z.string()).optional() });
export type PiAuthenticationStatus = { kind: 'authenticated'; provider: InferenceProvider; method: 'oauth' | 'api_key'; accountFingerprint: string }
  | { kind: 'disconnected' | 'expired' | 'unavailable'; provider: InferenceProvider };
function inside(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); }
function owned(path: string, kind: 'file' | 'directory') {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) || (process.getuid !== undefined && stat.uid !== process.getuid())) throw new Error('Private authentication path is not owned by this host.');
  return stat;
}
/** Mirrors SDK non-command config templates only. Never runs shell commands or refreshes auth. */
export function resolveReadonlyAuthTemplate(value: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (value.startsWith('!')) return undefined;
  let missing = false;
  const resolved = value.replace(/\$\$|\$!|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined, plain: string | undefined) => {
    if (match === '$$') return '$'; if (match === '$!') return '!';
    const name = braced ?? plain; const result = name === undefined ? undefined : env[name];
    if (!result) { missing = true; return ''; } return result;
  });
  return missing || !resolved ? undefined : resolved;
}
/** Must be constructed after exclusive host ownership. Its salt stays outside repo and SQLite. */
export function createPiAuthFingerprint(input: { privateDataRoot: string; environment?: Readonly<Record<string, string | undefined>>; now?: () => number }) {
  if (!isAbsolute(input.privateDataRoot)) throw new Error('Private data root must be absolute.');
  owned(input.privateDataRoot, 'directory');
  const root = realpathSync(input.privateDataRoot);
  if (inside(realpathSync(process.cwd()), root)) throw new Error('Authentication fingerprints must live outside the repository.');
  const authDirectory = join(root, 'pi', 'auth');
  for (const path of [join(root, 'pi'), authDirectory]) {
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    owned(path, 'directory'); chmodSync(path, 0o700);
    if (!inside(root, realpathSync(path))) throw new Error('Authentication directory escaped its private root.');
  }
  const saltPath = join(authDirectory, 'access-fingerprint.salt');
  if (!existsSync(saltPath)) {
    let descriptor: number | undefined;
    try { descriptor = openSync(saltPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); writeFileSync(descriptor, `${randomBytes(32).toString('hex')}\n`); fsyncSync(descriptor); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw new Error('Private fingerprint salt could not be initialized.'); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  const saltStat = owned(saltPath, 'file');
  if ((saltStat.mode & 0o077) !== 0) throw new Error('Fingerprint salt permissions must be private.');
  const salt = z.string().regex(/^[0-9a-f]{64}\n?$/).parse(readFileSync(saltPath, 'utf8')).trim();
  const authPath = join(authDirectory, 'auth.json');
  const now = input.now ?? Date.now;
  function fingerprint(value: unknown) { return createHmac('sha256', salt).update(JSON.stringify(value)).digest('hex'); }
  function inspect(rawProvider: InferenceProvider): PiAuthenticationStatus {
    const provider = ProviderSchema.parse(rawProvider);
    try {
      if (existsSync(authPath)) {
        const stat = owned(authPath, 'file');
        if ((stat.mode & 0o077) !== 0) return { kind: 'unavailable', provider };
      }
      const credential = readStoredCredential(provider, authPath);
      if (credential !== undefined) {
        if (credential.type === 'oauth') {
          const stored = OAuthSchema.parse(credential);
          if (stored.expires <= now()) return { kind: 'expired', provider };
          return { kind: 'authenticated', provider, method: 'oauth', accountFingerprint: fingerprint({ provider, credential: stored }) };
        }
        if (provider === 'openai-codex') return { kind: 'disconnected', provider };
        const stored = KeySchema.parse(credential);
        const environment = { ...(input.environment ?? process.env), ...Object.fromEntries(Object.entries(stored.env ?? {}).filter(([, value]) => value !== '')) };
        if (stored.key !== undefined) {
          const effective = resolveReadonlyAuthTemplate(stored.key, environment);
          if (effective === undefined) return { kind: 'unavailable', provider };
          return { kind: 'authenticated', provider, method: 'api_key', accountFingerprint: fingerprint({ provider, effective, env: stored.env ?? {} }) };
        }
        // A stored API-key credential can delegate its missing key to provider-scoped env; no cross-provider fallback.
        return ambient(provider, environment);
      }
      return provider === 'openai-codex' ? { kind: 'disconnected', provider } : ambient(provider, input.environment ?? process.env);
    } catch { return { kind: 'unavailable', provider }; }
  }
  function ambient(provider: 'anthropic', environment: Readonly<Record<string, string | undefined>>): PiAuthenticationStatus {
    for (const name of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
      const secret = environment[name];
      if (secret) return { kind: 'authenticated', provider, method: 'api_key', accountFingerprint: fingerprint({ provider, source: name, effective: secret }) };
    }
    // Federation/executable auth cannot be fingerprinted read-only; fail closed rather than hash a file pointer.
    return environment.ANTHROPIC_IDENTITY_TOKEN_FILE ? { kind: 'unavailable', provider } : { kind: 'disconnected', provider };
  }
  return Object.freeze({
    async readInferenceAuthenticationStatus(input: { provider: InferenceProvider }): Promise<PiAuthenticationStatus> { return inspect(input.provider); },
    async readCredentialFingerprint(input: { provider: InferenceProvider; signal?: AbortSignal }): Promise<string | undefined> {
      input.signal?.throwIfAborted(); const status = inspect(input.provider); input.signal?.throwIfAborted(); return status.kind === 'authenticated' ? status.accountFingerprint : undefined;
    },
  });
}
