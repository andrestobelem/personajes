import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BackupManifestSchema } from '../domain/backup.ts';

export const ApprovedJournalSchemaSchema = z.array(z.strictObject({
  type: z.enum(['table', 'index', 'trigger', 'view']), name: z.string().min(1).max(256),
  tbl_name: z.string().min(1).max(256), sql: z.string().max(256 * 1024).nullable(),
})).min(1).max(2_000);
export type ApprovedJournalSchema = z.infer<typeof ApprovedJournalSchemaSchema>;
export const ExternalBackupValidationRequestSchema = z.strictObject({
  bundleRoot: z.string().min(1), manifest: BackupManifestSchema, manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedJournalSchema: ApprovedJournalSchemaSchema, sourceOutputRoot: z.string().min(1),
  limits: z.strictObject({
    timeoutMs: z.number().int().min(100).max(60_000).default(30_000),
    maxSourceBytes: z.number().int().min(1).max(64 * 1024 * 1024).default(64 * 1024 * 1024),
    maxTotalSourceBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(64 * 1024 * 1024),
    maxStdoutBytes: z.number().int().min(256).max(64 * 1024).default(16 * 1024),
  }).default({ timeoutMs: 30_000, maxSourceBytes: 64 * 1024 * 1024, maxTotalSourceBytes: 64 * 1024 * 1024, maxStdoutBytes: 16 * 1024 }),
});
export const ExternalBackupValidationResultSchema = z.strictObject({
  journalVersion: z.literal(37), sources: z.array(z.strictObject({
    runId: z.uuid(), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(64 * 1024 * 1024),
  })).max(100_000),
});
export type ExternalBackupValidationResult = z.infer<typeof ExternalBackupValidationResultSchema>;
const WorkerReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('validated'), resultHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('rejected'), code: z.string().regex(/^EXTERNAL_BACKUP_[A-Z_]+$/) }),
]);
function reject(code: string): never { throw new Error(code); }
function privateDirectory(path: string, create: boolean) {
  if (!isAbsolute(path)) reject('EXTERNAL_BACKUP_PATH_INVALID');
  if (!existsSync(path)) {
    if (!create) reject('EXTERNAL_BACKUP_PATH_INVALID');
    const parent = dirname(path); if (realpathSync(parent) !== parent || lstatSync(parent).isSymbolicLink()) reject('EXTERNAL_BACKUP_PATH_INVALID');
    mkdirSync(path, { mode: 0o700 });
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) reject('EXTERNAL_BACKUP_PATH_INVALID');
}

/** The parent never opens an imported SQLite handle. Validation happens in a
 * short-lived process with private copies, a closed environment and bounded output. */
export async function validateExternalBackup(input: {
  bundleRoot: string; manifest: unknown; manifestHash: string; approvedJournalSchema: ApprovedJournalSchema;
  sourceOutputRoot: string; limits?: { timeoutMs?: number; maxSourceBytes?: number; maxTotalSourceBytes?: number; maxStdoutBytes?: number };
}): Promise<ExternalBackupValidationResult> {
  const request = ExternalBackupValidationRequestSchema.parse(input);
  privateDirectory(request.bundleRoot, false); privateDirectory(request.sourceOutputRoot, true);
  if (request.bundleRoot === request.sourceOutputRoot || request.sourceOutputRoot.startsWith(request.bundleRoot + '/') || request.bundleRoot.startsWith(request.sourceOutputRoot + '/')) reject('EXTERNAL_BACKUP_OUTPUT_SCOPE_INVALID');
  if (readdirSync(request.sourceOutputRoot).length !== 0) reject('EXTERNAL_BACKUP_OUTPUT_NOT_EMPTY');
  const work = mkdtempSync(join(request.sourceOutputRoot, '.validation-'));
  try {
    const requestPath = join(work, 'request.json'); writeFileSync(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 });
    const reply = await new Promise<z.infer<typeof WorkerReplySchema>>((resolve, rejectPromise) => {
      const child = spawn(process.execPath, ['--max-old-space-size=512', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./external-backup-worker.ts', import.meta.url)), requestPath], {
        cwd: work, env: { HOME: work, TMPDIR: work, LANG: 'C', LC_ALL: 'C' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = []; let outputBytes = 0; let exceeded = false; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, request.limits.timeoutMs);
      function capture(bytes: Buffer, keep: boolean) {
        outputBytes += bytes.length;
        if (outputBytes > request.limits.maxStdoutBytes) { exceeded = true; child.kill('SIGKILL'); }
        else if (keep) stdout.push(bytes);
      }
      child.stdout.on('data', (bytes: Buffer) => capture(bytes, true)); child.stderr.on('data', (bytes: Buffer) => capture(bytes, false));
      child.once('error', () => { clearTimeout(timer); rejectPromise(new Error('EXTERNAL_BACKUP_WORKER_FAILED')); });
      child.once('close', code => {
        clearTimeout(timer);
        if (timedOut) return rejectPromise(new Error('EXTERNAL_BACKUP_TIMEOUT'));
        if (exceeded) return rejectPromise(new Error('EXTERNAL_BACKUP_OUTPUT_LIMIT'));
        try {
          const parsed = WorkerReplySchema.parse(JSON.parse(Buffer.concat(stdout).toString('utf8')));
          if (code !== 0 && parsed.kind !== 'rejected') return rejectPromise(new Error('EXTERNAL_BACKUP_WORKER_FAILED'));
          resolve(parsed);
        } catch { rejectPromise(new Error('EXTERNAL_BACKUP_WORKER_FAILED')); }
      });
    });
    if (reply.kind === 'rejected') reject(reply.code);
    const resultPath = join(work, 'result.json'); const status = lstatSync(resultPath);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1 || status.size > 64 * 1024 * 1024) reject('EXTERNAL_BACKUP_RESULT_INVALID');
    const bytes = readFileSync(resultPath);
    if (createHash('sha256').update(bytes).digest('hex') !== reply.resultHash) reject('EXTERNAL_BACKUP_RESULT_INVALID');
    const result = ExternalBackupValidationResultSchema.parse(JSON.parse(bytes.toString('utf8')));
    for (const source of result.sources) if (source.path !== join(request.sourceOutputRoot, 'sources', `${source.runId}.json`)) reject('EXTERNAL_BACKUP_RESULT_INVALID');
    return result;
  } catch (error: unknown) {
    rmSync(join(request.sourceOutputRoot, 'sources'), { recursive: true, force: true }); throw error;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
