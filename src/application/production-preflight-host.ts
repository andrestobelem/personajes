import { accessSync, closeSync, constants, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createPiSession, type PiRuntime } from '../adapters/pi.ts';
import { ICM_VERSION } from '../adapters/icm.ts';
import { listCharacters, type LoadedCatalog } from '../adapters/catalog.ts';
import type { openJournal } from '../adapters/journal.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE, SelectableInferenceProfileSchema, type InferenceProvider } from '../domain/inference-profile.ts';
import { fingerprintInferenceProfile } from './pi-access-check.ts';
import { freezeExperience } from './experience-envelope.ts';
import { PiAccessReceiptReadSchema } from '../domain/pi-access-jobs.ts';
import { RunPreflightPrivateEvidenceSchema, type RunPreflightPrivateEvidence } from '../domain/run-preflight-jobs.ts';
import { RunModelTimeBudgetSchema } from '../domain/model-time-budget.ts';
import { effectiveRequestTimeoutMs } from '../domain/production.ts';
import { RunIdSchema } from '../domain/values.ts';
import { type createPiAuthFingerprint } from './pi-auth-fingerprint.ts';
import type { ProductionPreflightHostPort, ReadyRunConfiguration } from './production-preflight.ts';

type Journal = Pick<ReturnType<typeof openJournal>, 'readWorldConfiguration' | 'loadWorld' | 'readRunConfigurationDraft' | 'readLatestAccessReceipt' | 'readLatestAccessOutcome' | 'readPiAccessJob' | 'readRunModelTimeBudget'>;
const ICM_CONFIG = '[store.backup]\nenabled = false\n\n[memory]\nauto_consolidate_enabled = false\n\n[embeddings]\nenabled = false\n';
function within(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); }
function privateExisting(path: string, root: string, kind: 'file' | 'directory') {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) || (process.getuid !== undefined && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0 || !within(root, realpathSync(path))) throw new Error('Private storage cannot be verified.');
  accessSync(path, constants.R_OK | constants.W_OK | (kind === 'directory' ? constants.X_OK : 0));
  return stat;
}
function packageVersion(name: string) {
  const module = fileURLToPath(import.meta.resolve(name));
  return z.object({ version: z.string().min(1).max(40) }).parse(JSON.parse(readFileSync(join(dirname(module), '..', 'package.json'), 'utf8'))).version;
}
function icmRead(binary: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => execFile(binary, [...args], { timeout: 2_000, maxBuffer: 1_000_000, encoding: 'utf8', env }, (error, stdout) => error ? reject(new Error('ICM readonly check is unavailable.')) : resolve(stdout.trim())));
}
/** Reads actual host resources. It never creates sessions/ICM databases, refreshes auth or probes paid providers. */
export function createProductionPreflightHost(input: { journal: Journal; catalog: LoadedCatalog; piRuntime: PiRuntime; authentication: ReturnType<typeof createPiAuthFingerprint>; icmBinaryPath?: string }): ProductionPreflightHostPort & { readPrivateEvidence(input: { configuration: ReadyRunConfiguration }): RunPreflightPrivateEvidence } {
  const journal = input.journal;
  const captured = new Map<InferenceProvider, RunPreflightPrivateEvidence>();
  function evidence(provider: InferenceProvider) {
    let value = captured.get(provider);
    if (value === undefined) { value = { provider, profileFingerprint: null, accountFingerprint: null, accessReceipt: null }; captured.set(provider, value); }
    return value;
  }
  function ready(runId: unknown) { return ReadyRunConfigurationSchema.parse(journal.readWorldConfiguration({ runId: RunIdSchema.parse(runId) })); }
  return {
    async readCurrentConfigurationRevision({ runId }) {
      const draft = journal.readRunConfigurationDraft({ runId });
      if (draft !== undefined) return { kind: 'loaded', revision: draft.revision };
      try { return { kind: 'loaded', revision: ready(runId).configRevision }; } catch { return { kind: 'unavailable', code: 'configuration-not-ready' }; }
    },
    async loadCurrentWorldSnapshot({ runId }) { const world = journal.loadWorld({ runId }); if (world === undefined) throw new Error('Committed world unavailable.'); return world; },
    async loadPreparedActorContexts({ runId, characterIds }) {
      try {
        const configuration = ready(runId);
        const actors = configuration.roster.preparedCharacters.filter((actor) => characterIds.includes(actor.characterId));
        if (actors.length !== characterIds.length) return { kind: 'unavailable', code: 'prepared-context-missing' };
        return { kind: 'loaded', runId, actors };
      } catch { return { kind: 'unavailable', code: 'prepared-context-unavailable' }; }
    },
    async readCatalogEligibility({ characterIds }) {
      const catalogIds = new Set(listCharacters(input.catalog).map((character) => character.characterId));
      return { kind: 'loaded', entries: characterIds.map((characterId) => ({ characterId, state: catalogIds.has(characterId) ? { kind: 'eligible' } : { kind: 'ineligible', reason: 'La identidad no pertenece al catálogo individual vigente.' } })) };
    },
    async readPiSdkStatus() {
      try { return { kind: 'ready', piCodingAgentVersion: packageVersion('@earendil-works/pi-coding-agent'), piAiVersion: packageVersion('@earendil-works/pi-ai'), sessionFactoryAvailable: typeof createPiSession === 'function' }; }
      catch { return { kind: 'unavailable', code: 'pi-sdk-installation-unavailable' }; }
    },
    async readPiModelProfile({ provider }) {
      const selected = provider === 'openai-codex' ? DEFAULT_INFERENCE_PROFILE : CLAUDE_INFERENCE_PROFILE;
      const model = input.piRuntime.modelRuntime.getModel(selected.provider, selected.model);
      if (!model || model.provider !== selected.provider || model.id !== selected.model || model.api !== selected.api || !model.reasoning || model.thinkingLevelMap?.[selected.reasoningEffort] !== selected.reasoningEffort) return { kind: 'missing', code: 'selected-model-unavailable' };
      const fingerprint = fingerprintInferenceProfile(selected);
      const previous = evidence(provider); captured.set(provider, RunPreflightPrivateEvidenceSchema.parse({ ...previous, profileFingerprint: fingerprint }));
      return { kind: 'configured', profile: { ...selected, fingerprint } };
    },
    async readInferenceAuthenticationStatus({ provider }) {
      const status = await input.authentication.readInferenceAuthenticationStatus({ provider });
      if (status.kind === 'authenticated') { const previous = evidence(provider); captured.set(provider, RunPreflightPrivateEvidenceSchema.parse({ ...previous, accountFingerprint: status.accountFingerprint })); }
      return status.kind === 'unavailable' ? { ...status, code: 'provider-credential-unavailable' } : status;
    },
    async readInferenceAccessCheckReceipt({ provider, accountFingerprint, profileFingerprint }) {
      try {
        const current = await input.authentication.readCredentialFingerprint({ provider });
        if (current !== accountFingerprint) return { kind: 'missing', provider };
        const receipt = PiAccessReceiptReadSchema.parse(journal.readLatestAccessReceipt({ provider, accountFingerprint, profileFingerprint }));
        if (receipt.kind === 'missing') return { kind: 'missing', provider };
        const latest = journal.readLatestAccessOutcome({ provider, profileFingerprint });
        if (latest === undefined || latest.jobId !== receipt.jobId || latest.resultKind !== receipt.resultKind) return { kind: 'missing', provider };
        const job = journal.readPiAccessJob({ jobId: receipt.jobId });
        if (!job || job.provider !== provider || fingerprintInferenceProfile(job.profile) !== profileFingerprint || job.resultKind !== receipt.resultKind) return { kind: 'unavailable', provider, code: 'access-receipt-proof-invalid' };
        const previous = evidence(provider);
        const receiptEvidence = { jobId: receipt.jobId, resultKind: receipt.resultKind, provider: receipt.provider, profileFingerprint: receipt.profileFingerprint, accountFingerprint: receipt.accountFingerprint, checkedAt: receipt.checkedAt, expiresAt: receipt.expiresAt };
        if (previous.profileFingerprint === profileFingerprint && previous.accountFingerprint === accountFingerprint) captured.set(provider, RunPreflightPrivateEvidenceSchema.parse({ ...previous, accessReceipt: receiptEvidence }));
        const common = { provider, accountFingerprint: receipt.accountFingerprint, profileFingerprint: receipt.profileFingerprint, checkedAt: receipt.checkedAt, expiresAt: receipt.expiresAt };
        return receipt.resultKind === 'passed' ? { ...common, kind: 'passed' } : { ...common, kind: 'failed', code: receipt.code ?? 'LOCAL_FAILURE' };
      } catch { return { kind: 'unavailable', provider, code: 'access-receipt-unavailable' }; }
    },
    async readPiRuntimeReadiness({ runId, activeCharacterIds, narrationMode }) {
      try {
        const configuration = ready(runId);
        if (activeCharacterIds.some((id) => !configuration.roster.preparedCharacters.some((actor) => actor.characterId === id))) return { kind: 'unavailable', code: 'actor-runtime-context-missing' };
      } catch { return { kind: 'unavailable', code: 'actor-runtime-context-unavailable' }; }
      // Actor + Continuista factories exist; Director/narrator execution and their tool policies do not.
      // Returning an all-ready role bundle would incorrectly enable starting the entire production.
      return { kind: 'unavailable', code: narrationMode.kind === 'enabled' ? 'director-and-narrator-runtime-unavailable' : 'director-runtime-unavailable' };
    },
    async readIcmMemoryReadiness({ runId, actorIds }) {
      if (input.icmBinaryPath === undefined || !isAbsolute(input.icmBinaryPath)) return { kind: 'unavailable', code: 'icm-binary-not-configured' };
      try {
        const binary = realpathSync(input.icmBinaryPath); if (!lstatSync(binary).isFile()) return { kind: 'unavailable', code: 'icm-binary-invalid' };
        accessSync(binary, constants.X_OK);
        if (await icmRead(binary, ['--version'], { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }) !== `icm ${ICM_VERSION}`) return { kind: 'unavailable', code: 'icm-version-mismatch' };
        const root = realpathSync(input.piRuntime.privateDataRoot);
        const inodes = new Set<string>();
        const actors = [];
        for (const characterId of actorIds) {
          const runDirectory = join(root, 'runs', runId); const actorsDirectory = join(runDirectory, 'actors'); const actorDirectory = join(actorsDirectory, characterId);
          for (const path of [runDirectory, actorsDirectory, actorDirectory, join(actorDirectory, 'home'), join(actorDirectory, 'tmp')]) privateExisting(path, root, 'directory');
          const config = join(actorDirectory, 'icm-config.toml'); privateExisting(config, root, 'file');
          if (readFileSync(config, 'utf8') !== ICM_CONFIG) throw new Error('ICM configuration differs.');
          const databasePath = join(actorDirectory, 'memory.sqlite'); const stat = privateExisting(databasePath, root, 'file');
          const inode = `${stat.dev}:${stat.ino}`; if (stat.nlink !== 1 || inodes.has(inode)) throw new Error('ICM isolation cannot be verified.'); inodes.add(inode);
          // SQLite mode=ro can create WAL coordination files. Require those resources
          // to have been provisioned outside preflight before opening a WAL database.
          const header = Buffer.alloc(100); const descriptor = openSync(databasePath, constants.O_RDONLY | constants.O_NOFOLLOW);
          let bytes: number;
          try { bytes = readSync(descriptor, header, 0, header.length, 0); } finally { closeSync(descriptor); }
          if (bytes !== 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') throw new Error('SQLite header unavailable.');
          if (header[18] === 2 || header[19] === 2) {
            try { for (const suffix of ['-wal', '-shm']) privateExisting(`${databasePath}${suffix}`, root, 'file'); }
            catch { return { kind: 'unavailable', code: 'icm-readonly-sidecars-not-provisioned' }; }
          }
          const database = new DatabaseSync(databasePath, { readOnly: true });
          try {
            z.object({ integrity_check: z.literal('ok') }).parse(database.prepare("PRAGMA integrity_check('memories')").get());
            z.object({ user_version: z.literal(1) }).parse(database.prepare('PRAGMA user_version').get());
            const columns = z.array(z.object({ name: z.string() })).parse(database.prepare('PRAGMA table_info(memories)').all());
            const required = ['id', 'created_at', 'updated_at', 'last_accessed', 'access_count', 'weight', 'topic', 'summary', 'raw_excerpt', 'keywords', 'importance', 'source_type', 'source_data', 'related_ids', 'embedding', 'summary_hash'];
            if (required.some((name) => !columns.some((column) => column.name === name))) throw new Error('ICM memory schema is incomplete.');
            z.object({ value: z.string().regex(/^[1-9][0-9]*$/) }).parse(database.prepare("SELECT value FROM icm_metadata WHERE key='embedding_dims'").get());
            const names = z.array(z.object({ name: z.string() })).parse(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all());
            if (['memories', 'memories_fts', 'concepts_fts', 'feedback_fts', 'messages_fts'].some((name) => !names.some((table) => table.name === name))) throw new Error('ICM SQLite schema unavailable.');
          } finally { database.close(); }
          const output = await icmRead(binary, ['--db', databasePath, '--no-embeddings', '--read-only', 'list', '--format', 'json', '--all'], { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: join(actorDirectory, 'home'), TMPDIR: join(actorDirectory, 'tmp'), ICM_CONFIG: config, ICM_DB_BACKEND: 'sqlite' });
          const memories = z.array(z.object({ id: z.string().min(1), topic: z.string().min(1), summary: z.string().max(65_536) }).passthrough()).max(10_000).parse(JSON.parse(output));
          for (const memory of memories) { const frozen = freezeExperience(JSON.parse(memory.summary)); if (frozen.envelope.runId !== runId || frozen.envelope.actorId !== characterId || frozen.canonicalPayload !== memory.summary) throw new Error('ICM memory scope could not be verified.'); }
          actors.push({ runId, characterId, state: 'recoverable', isolation: { kind: 'run-actor', runId, characterId } });
        }
        return { kind: 'ready', version: ICM_VERSION, backend: 'sqlite', actors };
      } catch { return { kind: 'unavailable', code: 'icm-private-storage-unavailable' }; }
    },
    readPrivateEvidence({ configuration }) {
      const profile = SelectableInferenceProfileSchema.safeParse(configuration.inferenceProfile);
      return RunPreflightPrivateEvidenceSchema.parse(profile.success ? evidence(profile.data.provider) : { provider: null, profileFingerprint: null, accountFingerprint: null, accessReceipt: null });
    },
    async readRunBudgetReadiness({ runId, budget }) {
      try {
        const actual = RunModelTimeBudgetSchema.parse(journal.readRunModelTimeBudget({ runId }));
        if (actual.runId !== runId || actual.maxPiCallsPerRun !== budget.maxPiCallsPerRun
          || actual.maxPiCallsPerPulse !== budget.maxPiCallsPerPulse || actual.maxConcurrentPiRequests !== budget.maxConcurrentPiRequests
          || actual.maxWallTimeMs !== budget.maxWallTimeMs || actual.requestTimeoutMs !== effectiveRequestTimeoutMs(budget)) {
          return { kind: 'unavailable', code: 'run-budget-scope-mismatch' };
        }
        if (actual.status === 'legacy-unknown') return { kind: 'unavailable', code: 'run-wall-time-legacy-unknown' };
        if (actual.status === 'uncertain') return { kind: 'unavailable', code: 'run-wall-time-uncertain' };
        if (actual.wallTimeRemainingMs === 0) return { kind: 'unavailable', code: 'budget-exhausted' };
        return { kind: 'available', runCallsUsed: actual.runCallsUsed, pulseCallsUsed: actual.pulseCallsUsed,
          activePiRequests: actual.activePiRequests, wallTimeUsedMs: actual.wallTimeMeasuredMs };
      } catch { return { kind: 'unavailable', code: 'run-budget-unavailable' }; }
    },
    async readVoiceReadiness() { return { kind: 'unavailable', code: 'voice-runtime-unavailable' }; },
  };
}
