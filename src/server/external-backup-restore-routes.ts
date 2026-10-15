import { z } from 'zod';
import { BackupRegistrationIdSchema,backupRegistrationEtag } from '../domain/backup-transfer.ts';
import { RestorePreviewSchema,RestoreSelectionSchema } from '../domain/backup.ts';
import { ForkJobViewSchema,forkJobEtag } from '../domain/fork-http.ts';
import { HashSchema } from '../domain/values.ts';
import type { openBackupTransferService } from '../application/backup-transfer-service.ts';
import type { openBackupService } from '../application/backup-service.ts';
import { operatorJson,type OperatorExtension } from './operator-extension.ts';
import { openExternalRestoreOperations } from './external-restore-operations.ts';

/** A registration is host-owned evidence of admission, not an assertion of the
 * uploaded author's identity. External archives can only seed a separate fork. */
export function createExternalBackupRestoreRoutes(input:{transfers:ReturnType<typeof openBackupTransferService>;backups:ReturnType<typeof openBackupService>;journalPath:string}):OperatorExtension & {close():void}{
 const operations=openExternalRestoreOperations({journalPath:input.journalPath});
 return {name:'external-backup-restore',close:()=>operations.close(),matches:({path})=>path.length===3&&path[0]==='backup-registrations'&&['restore-preview','restore'].includes(path[2]??''),
 async handle(request){
  try{
   if(request.kind!=='write'||request.method!=='POST')throw new Error('RESTORE_EXTERNAL_ROUTE_NOT_FOUND');
   const registrationId=BackupRegistrationIdSchema.parse(request.path[1]);
   return await operations.execute(request,async()=>{
   const registration=input.transfers.getRegistration({registrationId,principalId:request.principalId});
   if(request.path[2]==='restore-preview'){
    const selection=RestoreSelectionSchema.parse(request.body);
    if(selection.mode!=='fork')throw new Error('RESTORE_EXTERNAL_RECOVER_UNAVAILABLE');
    const preview=input.backups.preview({backupId:registration.sourceBackupId,principalId:request.principalId,
     idempotencyKey:request.idempotencyKey,externalRegistrationId:registrationId,...selection});
    return operatorJson(RestorePreviewSchema.parse(preview));
   }
   if(request.path[2]==='restore'){
    if(request.ifMatch!==backupRegistrationEtag(registration))throw new Error('RESTORE_EXTERNAL_IF_MATCH_REQUIRED');
    const body=z.strictObject({previewToken:z.uuid(),confirmDiffHash:HashSchema}).parse(request.body);
    const job=ForkJobViewSchema.parse(await input.backups.restore({...body,principalId:request.principalId,backupId:registration.sourceBackupId,externalRegistrationId:registrationId}));
    return operatorJson(job,202,{ETag:forkJobEtag(job),Location:`/api/v1/forks/${job.operationId}`});
   }
   throw new Error('RESTORE_EXTERNAL_ROUTE_NOT_FOUND');
   });
  }catch(error){
   const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)?error.message:'RESTORE_EXTERNAL_REQUEST_INVALID';
   const missing=code.endsWith('NOT_FOUND');const precondition=code.includes('IF_MATCH');
   return {kind:'problem',status:missing?404:precondition?412:409,error:{kind:missing?'notFound':precondition?'precondition':'conflict',code,message:'La continuación requiere un backup admitido y la confirmación de su revisión.'}};
  }
 }};
}
