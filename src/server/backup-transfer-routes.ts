import {closeSync,constants,createReadStream,fstatSync,openSync} from 'node:fs';
import {z} from 'zod';
import type {openBackupTransferService} from '../application/backup-transfer-service.ts';
import {BackupIdSchema} from '../domain/backup.ts';
import {HashSchema} from '../domain/values.ts';
import {BACKUP_TRANSFER_PART_BYTES,BackupExportIdSchema,BackupExportViewSchema,BackupImportIdSchema,BackupImportViewSchema,BackupRegistrationIdSchema,RegisteredBackupSchema,backupExportEtag,backupImportEtag,backupRegistrationEtag} from '../domain/backup-transfer.ts';
import {OperatorResponseSchema,operatorJson,type OperatorExtension,type OperatorRequest} from './operator-extension.ts';

type Service=ReturnType<typeof openBackupTransferService>;
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const partSchema=z.strictObject({offset:count,contentBase64:z.string().min(1).max(Math.ceil(BACKUP_TRANSFER_PART_BYTES/3)*4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),sha256:HashSchema});
function expectedRevision(request:OperatorRequest,importId:string){
 const match=/^"backup-import:([0-9a-f-]{36}):r(0|[1-9][0-9]{0,15})"$/.exec(request.ifMatch??'');
 if(match?.[1]!==importId)throw new Error('BACKUP_TRANSFER_IF_MATCH_REQUIRED');
 return count.parse(Number(match[2]));
}
/** Multipart requests and export streams keep bounded buffers. The service owns
 * durable idempotency; HTTP only contributes the authenticated operator and CAS. */
export function createBackupTransferRoutes(input:{service:()=>Service|undefined}):OperatorExtension{
 return {
  name:'backup-transfer',maxBodyBytes:Math.ceil(BACKUP_TRANSFER_PART_BYTES/3)*4+4096,
  matches({path,method}){return path[0]==='backup-exports'||path[0]==='backup-imports'||(method==='GET'&&path[0]==='backup-registrations'&&path.length===2);},
  async handle(request){
   try{
    z.strictObject({}).parse(Object.fromEntries(request.query));
    const service=input.service();if(service===undefined)throw new Error('BACKUP_TRANSFER_UNAVAILABLE');
    const [resource,id,action]=request.path;
    if(resource==='backup-exports'){
     if(request.path.length===1&&request.kind==='write'&&request.method==='POST'){
      const body=z.strictObject({backupId:BackupIdSchema}).parse(request.body);
      const job=BackupExportViewSchema.parse(await service.createExport({principalId:request.principalId,idempotencyKey:request.idempotencyKey,...body}));
      return operatorJson(job,202,{ETag:backupExportEtag(job),Location:`/api/v1/backup-exports/${job.exportId}`});
     }
     if(id!==undefined&&request.kind==='read'){
      const exportId=BackupExportIdSchema.parse(id);
      if(request.path.length===2){const job=BackupExportViewSchema.parse(service.getExport({principalId:request.principalId,exportId}));if(job.exportId!==exportId)throw new Error('BACKUP_TRANSFER_SCOPE_INVALID');return operatorJson(job,200,{ETag:backupExportEtag(job)});}
      if(request.path.length===3&&action==='download'){
       const download=await service.exportDownload({principalId:request.principalId,exportId});
       const metadata=z.strictObject({bytes:count,sha256:HashSchema,fileName:z.string().min(1).max(150).regex(/^[A-Za-z0-9_.-]+$/)}).parse({bytes:download.bytes,sha256:download.sha256,fileName:download.fileName});
       const descriptor=openSync(download.path,constants.O_RDONLY|constants.O_NOFOLLOW);
       try{
        const stat=fstatSync(descriptor);if(!stat.isFile()||stat.nlink!==1||stat.size!==metadata.bytes)throw new Error('BACKUP_TRANSFER_EXPORT_INVALID');
        const stream=createReadStream(download.path,{fd:descriptor,autoClose:true,highWaterMark:64*1024});
        return OperatorResponseSchema.parse({kind:'stream',status:200,mimeType:'application/octet-stream',bytesLength:metadata.bytes,sha256:metadata.sha256,filename:metadata.fileName,stream});
       }catch(error){closeSync(descriptor);throw error;}
      }
     }
    }
    if(resource==='backup-imports'){
     if(request.path.length===1&&request.kind==='write'&&request.method==='POST'){
      const body=z.strictObject({fileName:z.string().trim().min(1).max(150),bytes:count}).parse(request.body);
      const job=BackupImportViewSchema.parse(await service.beginImport({principalId:request.principalId,idempotencyKey:request.idempotencyKey,...body}));
      return operatorJson(job,201,{ETag:backupImportEtag(job),Location:`/api/v1/backup-imports/${job.importId}`});
     }
     if(id!==undefined){
      const importId=BackupImportIdSchema.parse(id);
      if(request.path.length===2&&request.kind==='read'){const job=BackupImportViewSchema.parse(service.getImport({principalId:request.principalId,importId}));if(job.importId!==importId)throw new Error('BACKUP_TRANSFER_SCOPE_INVALID');return operatorJson(job,200,{ETag:backupImportEtag(job)});}
      if(request.kind==='write'){
       const context={principalId:request.principalId,importId,idempotencyKey:request.idempotencyKey,expectedRevision:expectedRevision(request,importId)};
       if(request.path.length===3&&request.method==='PUT'&&action==='parts'){
        const body=partSchema.parse(request.body);const job=BackupImportViewSchema.parse(await service.appendImportPart({...context,...body}));return operatorJson(job,200,{ETag:backupImportEtag(job)});
       }
       if((request.path.length===3&&request.method==='POST'&&(action==='finalize'||action==='retry'))||(request.path.length===2&&request.method==='DELETE')){
        z.strictObject({}).parse(request.body);
        const job=BackupImportViewSchema.parse(await (request.method==='DELETE'?service.cancelImport(context):action==='finalize'?service.finalizeImport(context):service.retryImport(context)));
        return operatorJson(job,request.method==='DELETE'?200:202,{ETag:backupImportEtag(job)});
       }
      }
     }
    }
    if(resource==='backup-registrations'&&id!==undefined&&request.path.length===2&&request.kind==='read'){
     const registrationId=BackupRegistrationIdSchema.parse(id);const registration=RegisteredBackupSchema.parse(service.getRegistration({principalId:request.principalId,registrationId}));if(registration.registrationId!==registrationId)throw new Error('BACKUP_TRANSFER_SCOPE_INVALID');return operatorJson(registration,200,{ETag:backupRegistrationEtag(registration)});
    }
    throw new Error('BACKUP_TRANSFER_ROUTE_NOT_FOUND');
   }catch(error){
    const code=error instanceof z.ZodError?'BACKUP_TRANSFER_REQUEST_INVALID':error instanceof Error&&/^BACKUP_(?:TRANSFER|IMPORT|EXPORT|REGISTRATION)_[A-Z_]{1,55}$/.test(error.message)?error.message:'BACKUP_TRANSFER_FAILED';
    const missing=code.endsWith('NOT_FOUND');const precondition=code.includes('IF_MATCH')||code.includes('REVISION_CONFLICT');const dependency=code.endsWith('UNAVAILABLE');const invalid=error instanceof z.ZodError;
    return OperatorResponseSchema.parse({kind:'problem',status:missing?404:precondition?412:dependency?503:invalid?422:409,error:{kind:missing?'notFound':precondition?'precondition':dependency?'dependency':invalid?'validation':'conflict',code,message:'La transferencia requiere revisar sus datos o su estado.',...(dependency?{safeCode:code,retryable:true}:{}),...(invalid?{issues:[]}:{} )}});
   }
  },
 };
}
