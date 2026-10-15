import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { inspectHostDirectoryOperation, inspectHostOwnership, isHostOwnershipFailure, recoverHostDirectoryOperation, recoverHostOwnership, type HostDirectoryOperation } from '../adapters/host-ownership.ts';
import { BackupFenceSchema } from '../domain/backup.ts';
import { HostRecoveryOwnershipSchema, hostRecoveryEtag } from '../domain/host-recovery.ts';
import { OperationIdSchema } from '../domain/values.ts';
import { operatorJson, type OperatorExtension } from '../server/operator-extension.ts';
import type { BackupRestorePort } from './backup-service.ts';
import { assessHostRecovery, applyHostRecoveryPreservation } from './host-recovery-assessment.ts';
import { createHostRecoveryOperation, type HostRecoveryContext } from './host-recovery-operation.ts';
import type { createHostRequestBarrier } from './host-request-barrier.ts';

/** Only the explicit resume path calls this under its directory capability.
 * A live or ambiguous prior owner is never removed. */
export function releaseInterruptedHostOwnership(input: {privateDataRoot:string;directoryOperation:HostDirectoryOperation}) {
  if (!existsSync(join(input.privateDataRoot, 'host-ownership.json'))) return;
  const owner = inspectHostOwnership(input);
  recoverHostOwnership({...input,expectedNonce:owner.nonce,operatorConfirmed:true});
}

/** HTTP survives the exchange, but all application/database services are closed.
 * This control plane reads only its external durable receipts while offline. */
export function createHostRecoveryRuntime(input: {
  privateDataRoot: string;
  admissionBarrier: ReturnType<typeof createHostRequestBarrier>;
  resetSessions(): Promise<void>;
  closeProduction(input: { directoryOperation: HostDirectoryOperation }): Promise<void>;
  reopenProduction(input: { directoryOperation: HostDirectoryOperation }): Promise<void>;
  onDiagnostic?(input: { kind: 'hostRecoveryDiagnostic'; code: string }): void;
}) {
  let closed = false;
  let productionClosed = false;
  let releaseAdmission: (() => void) | undefined;
  const scheduled = new Map<string, Promise<void>>();
  const resuming = new Set<string>();
  function directoryOperationRecord() {
    const path = join(dirname(input.privateDataRoot), `.${basename(input.privateDataRoot)}.personajes-host-operation`);
    return existsSync(path) ? inspectHostDirectoryOperation({privateDataRoot:input.privateDataRoot}) : undefined;
  }
  function compatible(context: HostRecoveryContext) {
    const assessment = assessHostRecovery({ privateDataRoot: input.privateDataRoot,
      bundleRoot: context.bundleRoot, manifest: context.manifest, manifestHash: context.manifestHash });
    if (assessment.kind !== 'compatible') throw new Error(assessment.code);
    if (assessment.fingerprint !== context.targetFingerprint) throw new Error('RECOVERY_TARGET_DIVERGED');
    return assessment;
  }
  const operation = createHostRecoveryOperation({
    privateDataRoot: input.privateDataRoot,
    async close({ gate }) {
      await input.resetSessions();
      // A rejected close can leave uncertain handles; keep admission closed even
      // when cleanup or a later control-plane write fails before its receipt.
      productionClosed = true;
      await input.closeProduction({ directoryOperation: gate });
    },
    prepare(context) {
      applyHostRecoveryPreservation({ stageRoot: context.stageRoot, plan: compatible(context).preserve });
    },
    async reopen({ gate }) {
      await input.reopenProduction({ directoryOperation: gate });
    },
    async reopenOriginal({gate}) {
      await input.reopenProduction({directoryOperation:gate});
    },
    verify(context) {
      if (context.phase !== 'staged') { compatible(context); return; }
      const db = new DatabaseSync(join(context.root, 'world.sqlite'), { readOnly: true });
      try {
        if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw new Error('RECOVERY_STAGED_SQLITE_INVALID');
        const fences = db.prepare('SELECT run_id,commit_index,world_revision,last_seq,snapshot_hash FROM world_runs ORDER BY run_id').all().map(raw => {
          const row = z.strictObject({ run_id: z.string(), commit_index: z.number(), world_revision: z.number(), last_seq: z.number(), snapshot_hash: z.string() }).parse(raw);
          return BackupFenceSchema.parse({ runId: row.run_id, commitIndex: row.commit_index, worldRevision: row.world_revision, lastSeq: row.last_seq, snapshotHash: row.snapshot_hash });
        });
        const expected = [...context.manifest.fences].sort((a, b) => a.runId.localeCompare(b.runId));
        if (JSON.stringify(fences) !== JSON.stringify(expected)) throw new Error('RECOVERY_STAGED_FENCE_MISMATCH');
        const identity = z.strictObject({ lineage_id: z.uuid() }).parse(db.prepare('SELECT lineage_id FROM backup_host_identity').get());
        if (identity.lineage_id !== context.manifest.lineageId) throw new Error('RECOVERY_STAGED_LINEAGE_MISMATCH');
      } finally { db.close(); }
    },
  });
  function diagnostic(error: unknown) {
    const code = error instanceof Error && /^(?:RECOVERY_|HOST_RECOVERY_)[A-Z_]{1,60}$/.test(error.message) ? error.message : 'HOST_RECOVERY_FAILED';
    try { input.onDiagnostic?.({ kind: 'hostRecoveryDiagnostic', code }); } catch { /* Diagnostics have no authority. */ }
  }
  function schedule(identity: { operationId: string; principalId: string }) {
    if (closed || scheduled.has(identity.operationId)) return;
    // The restore request must finish its SQLite receipt and leave HTTP admission
    // before this operation attempts to drain all requests and close the journal.
    const work = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      try {
        releaseAdmission ??= await input.admissionBarrier.acquireRecovery();
        const result = await operation.execute(identity);
        if (result.state === 'succeeded' || result.state === 'aborted') { productionClosed=false;releaseAdmission(); releaseAdmission = undefined; }
        else if (!productionClosed && result.phase === 'queued') { releaseAdmission(); releaseAdmission = undefined; }
      } catch (error) {
        diagnostic(error);
        if (!productionClosed) { releaseAdmission?.(); releaseAdmission = undefined; }
      }
    }).finally(() => { scheduled.delete(identity.operationId); });
    scheduled.set(identity.operationId, work);
  }
  function wrap(fork: BackupRestorePort): BackupRestorePort {
    return {
      preview(context) {
        if (context.mode === 'fork') return fork.preview(context);
        const result = assessHostRecovery({ privateDataRoot: input.privateDataRoot, bundleRoot: context.bundleRoot,
          manifest: context.manifest, manifestHash: context.manifestHash });
        return { targetFingerprint: result.fingerprint,
          differences: result.kind === 'blocked' ? result.details : [
            'Se recuperará el host en su misma carpeta, con las mismas representaciones, memorias y sesiones Pi.',
            'Se conservarán las credenciales actuales, los backups y sus recibos administrativos posteriores.',
            'La operación cerrará los servicios, conservará el original y verificará la reapertura antes de declarar éxito.',
            'Las sesiones de la interfaz se restablecerán. La recuperación no iniciará actuaciones ni generará audio.',
          ], blockers: result.kind === 'blocked' ? [result.code] : [] };
      },
      async apply(context) {
        if (context.mode === 'fork') return fork.apply(context);
        if (closed) throw new Error('HOST_RECOVERY_CLOSED');
        const job = await operation.begin({ operationId: context.operationId, principalId: context.principalId,
          backupId: context.manifest.backupId, manifest: context.manifest, manifestHash: context.manifestHash,
          targetFingerprint: context.targetFingerprint, confirmDiffHash: context.confirmDiffHash, bundleRoot: context.bundleRoot });
        if (job.state === 'queued') schedule({ operationId: job.operationId, principalId: context.principalId });
        return job;
      },
    };
  }
  const routes: OperatorExtension = {
    name: 'host-recovery-control',
    matches: ({ path }) => path[0] === 'host-recoveries',
    async handle(request) {
      if (request.query.size !== 0 || request.path.length < 2 || request.path.length > 3) return {
        kind: 'problem', status: 404, error: { kind: 'notFound', code: 'RECOVERY_OPERATION_NOT_FOUND', message: 'No se encontró la recuperación solicitada.' },
      };
      const id = OperationIdSchema.safeParse(request.path[1]);
      const job = id.success ? operation.read({ operationId: id.data, principalId: request.principalId }) : undefined;
      if (job === undefined) return { kind: 'problem', status: 404, error: { kind: 'notFound', code: 'RECOVERY_OPERATION_NOT_FOUND', message: 'No se encontró la recuperación solicitada.' } };
      try {
        if(request.kind==='read'&&request.path.length===2)return operatorJson(job, 200, { ETag: hostRecoveryEtag(job) });
        if(request.kind==='read'&&request.path[2]==='ownership') {
          const gate=directoryOperationRecord();
          return operatorJson(HostRecoveryOwnershipSchema.parse({kind:'host-recovery-ownership',operationId:job.operationId,
            directoryOperation:gate===undefined?{kind:'absent'}:{kind:'present',nonce:gate.nonce,pid:gate.pid}}));
        }
        if(request.kind==='write'&&request.method==='POST'&&request.path[2]==='resume') {
          if(closed||scheduled.has(job.operationId)||resuming.has(job.operationId))throw new Error('HOST_RECOVERY_BUSY');
          const body=z.strictObject({expectedDirectoryOperationNonce:z.uuid().optional()}).parse(request.body);
          const match=/^"host-recovery:([0-9a-f-]{36}):r(0|[1-9][0-9]*)"$/.exec(request.ifMatch??'');
          if(match?.[1]!==job.operationId) return {kind:'problem',status:412,error:{kind:'precondition',code:'RECOVERY_IF_MATCH_REQUIRED',message:'Consultá la revisión de la recuperación antes de reanudar.'}};
          const expectedRevision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(Number(match[2]));
          resuming.add(job.operationId);
          try {
            const gate=directoryOperationRecord();
            if(gate!==undefined) {
              if(body.expectedDirectoryOperationNonce!==gate.nonce)throw new Error('RECOVERY_DIRECTORY_NONCE_REQUIRED');
              recoverHostDirectoryOperation({privateDataRoot:input.privateDataRoot,expectedNonce:gate.nonce,operatorConfirmed:true});
            }
            const resumed=await operation.resume({operationId:job.operationId,principalId:request.principalId,idempotencyKey:request.idempotencyKey,
              expectedRevision,...body});
            // Cached admission can outlive its execution; never reschedule success.
            const current=operation.read({operationId:job.operationId,principalId:request.principalId});
            if(current?.state==='queued')schedule({operationId:job.operationId,principalId:request.principalId});
            return operatorJson(resumed,202,{ETag:hostRecoveryEtag(resumed),Location:`/api/v1/host-recoveries/${job.operationId}`});
          } finally {resuming.delete(job.operationId);}
        }
        return {kind:'problem',status:404,error:{kind:'notFound',code:'RECOVERY_OPERATION_NOT_FOUND',message:'No se encontró la operación solicitada.'}};
      } catch(error) {
        const code=isHostOwnershipFailure(error)?`RECOVERY_OWNERSHIP_${error.code}`:error instanceof Error&&/^(?:RECOVERY_|HOST_RECOVERY_)[A-Z_]{1,60}$/.test(error.message)?error.message:'HOST_RECOVERY_REQUEST_INVALID';
        return {kind:'problem',status:409,error:{kind:'conflict',code,message:'La recuperación conserva sus datos y requiere revisar su estado antes de continuar.'}};
      }
    },
  };
  return Object.freeze({ wrap, routes,
    pendingOperations(){return operation.list({principalId:'local-operator'}).filter(job=>job.state!=='succeeded'&&job.state!=='aborted');},
    async enterOffline(){releaseAdmission??=await input.admissionBarrier.acquireRecovery();productionClosed=true;},
    async wait() { while (scheduled.size > 0) await Promise.all([...scheduled.values()]); },
    async close() { closed = true; while (scheduled.size > 0) await Promise.all([...scheduled.values()]); },
  });
}
