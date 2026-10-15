import { hashContinuistaValue } from '../domain/continuista-review.ts';
import { readBackupForkSource } from './backup-fork-source.ts';
import { createForkApplication } from './fork-application.ts';
import type { BackupRestoreContext, BackupRestorePort } from './backup-service.ts';
import type { createForkRuntime } from './fork-runtime.ts';
import type { openLocalHost } from './local-host.ts';
import type { BackupForkSource } from './fork-source.ts';

function failureCode(error: unknown) { return error instanceof Error && /^RESTORE_[A-Z_]{1,70}$/.test(error.message) ? error.message : 'RESTORE_SOURCE_INVALID'; }
/** Bundle authority is independent of a run with the same ID in the live host.
 * This port never applies an offline recover by replacing open database handles. */
export function createBackupForkRestorePort(input: { host: ReturnType<typeof openLocalHost>; runtime?: ReturnType<typeof createForkRuntime>;
  readExternalSource?:(request:{registrationId:string;principalId:string;runId:string})=>BackupForkSource;
}): BackupRestorePort {
  function source(context: BackupRestoreContext) {
    if (context.sourceRunId === undefined || context.name === undefined || context.reason === undefined) throw new Error('RESTORE_SELECTION_REQUIRED');
    if(context.externalRegistrationId!==undefined){
      if(input.readExternalSource===undefined)throw new Error('RESTORE_EXTERNAL_SOURCE_UNAVAILABLE');
      const parent=input.readExternalSource({registrationId:context.externalRegistrationId,principalId:context.principalId,runId:context.sourceRunId});
      if(parent.backup.backupId!==context.manifest.backupId||parent.backup.lineageId!==context.manifest.lineageId
        ||parent.backup.manifestHash!==context.manifestHash||parent.backup.externalRegistration?.registrationId!==context.externalRegistrationId)
        throw new Error('RESTORE_EXTERNAL_SOURCE_MISMATCH');
      return parent;
    }
    return readBackupForkSource({ host: input.host, request: { manifest: context.manifest, manifestHash: context.manifestHash, bundleRoot: context.bundleRoot, sourceRunId: context.sourceRunId } });
  }
  function fingerprint(context: BackupRestoreContext, parent: ReturnType<typeof source>) {
    return hashContinuistaValue({ backup: parent.backup, source: parent.cuts[0]?.source, principalId: context.principalId, operationId: context.operationId, name: context.name, reason: context.reason });
  }
  const application = createForkApplication({ journal: input.host.journal });
  function readResult(context: BackupRestoreContext) {
    const result = application.read({ operationId: context.operationId, principalId: context.principalId });
    if (result.kind !== 'found') throw new Error('RESTORE_JOB_NOT_FOUND');
    return result.job;
  }
  return {
    preview(context) {
      if (context.mode === 'recover') return { differences: ['Recuperar conserva la historia posterior y requiere exclusión offline del host.'], blockers: ['RESTORE_OFFLINE_OWNERSHIP_UNAVAILABLE'], targetFingerprint: 'offline-recovery-unavailable' };
      try {
        const parent = source(context);
        const anchor = parent.cuts[0]?.source;
        return { differences: [
          `Fuente del backup: ${parent.snapshot.runId}, commit ${anchor?.commitIndex}, Escenario ${parent.snapshot.revision}, secuencia ${parent.snapshot.seq}.`,
          'Se creará otra representación y otra continuidad con memorias propias aisladas; la fuente se conserva.',
          'Las sesiones, trabajos, secretos y comprobaciones de ejecución no se trasladan. Las voces requieren vinculación nueva.',
        ], blockers: input.runtime === undefined ? ['RESTORE_FORK_RUNTIME_UNAVAILABLE'] : [], targetFingerprint: fingerprint(context, parent) };
      } catch (error) { return { differences: [], blockers: [failureCode(error)], targetFingerprint: 'unavailable' }; }
    },
    async apply(context) {
      if (context.mode !== 'fork') throw new Error('RESTORE_OFFLINE_OWNERSHIP_UNAVAILABLE');
      const runtime = input.runtime;
      if (runtime === undefined) throw new Error('RESTORE_FORK_RUNTIME_UNAVAILABLE');
      const existing = input.host.journal.readForkJob({ operationId: context.operationId, principalId: context.principalId });
      if (existing !== undefined) {
        if (existing.backupOrigin?.backupId !== context.manifest.backupId || existing.backupOrigin.manifestHash !== context.manifestHash
          ||existing.backupOrigin.externalRegistration?.registrationId!==context.externalRegistrationId
          || existing.source.runId !== context.sourceRunId || existing.name !== context.name || existing.reason !== context.reason) throw new Error('RESTORE_OPERATION_CONFLICT');
        runtime.recoverOperation({ operationId: context.operationId, principalId: context.principalId });
        return readResult(context);
      }
      const parent = source(context);
      if (fingerprint(context, parent) !== context.targetFingerprint) throw new Error('RESTORE_TARGET_DIVERGED');
      const result = runtime.beginFromBackup({ source: parent, principalId: context.principalId, operationId: context.operationId,
        idempotencyKey: context.operationId, name: context.name, reason: context.reason });
      if (result.kind === 'idempotencyConflict') throw new Error('RESTORE_IDEMPOTENCY_REUSE');
      return readResult(context);
    },
  };
}
