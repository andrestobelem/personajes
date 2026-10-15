import {z} from 'zod';
import {BackupIdSchema} from '../domain/backup.ts';
import {BackupExportIdSchema,BackupImportIdSchema,BackupRegistrationIdSchema,BackupExportViewSchema,BackupImportViewSchema,RegisteredBackupSchema,backupExportEtag,backupImportEtag,backupRegistrationEtag,BACKUP_TRANSFER_PART_BYTES,BACKUP_ARCHIVE_DEFAULT_MAX_BYTES,type BackupImportView} from '../domain/backup-transfer.ts';
import {HashSchema,RunIdSchema} from '../domain/values.ts';
import {ApiProblemSchema} from '../domain/http.ts';
import {ForkJobViewSchema,forkJobEtag} from '../domain/fork-http.ts';
import {ForkRestorePreviewSchema} from './backup-client.ts';
import {bootstrapSession} from './client.ts';
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const TransferFileSchema=z.strictObject({fileName:z.string().min(1).max(150),bytes:z.number().int().positive().max(BACKUP_ARCHIVE_DEFAULT_MAX_BYTES),prefixSha256:HashSchema});
const base={key:z.uuid(),importId:BackupImportIdSchema,revision:count};
export const TransferPendingSchema=z.discriminatedUnion('kind',[
 z.strictObject({...base,kind:z.literal('part'),offset:count,byteLength:z.number().int().positive().max(BACKUP_TRANSFER_PART_BYTES),sha256:HashSchema}),
 z.strictObject({...base,kind:z.enum(['finalize','retry','cancel'])}),
]);
export const UploadAttemptSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('creating'),file:TransferFileSchema,key:z.uuid()}),
 z.strictObject({kind:z.literal('active'),file:TransferFileSchema,importId:BackupImportIdSchema,pending:TransferPendingSchema.optional()}),
]).superRefine((value,ctx)=>{if(value.kind==='active'&&value.pending!==undefined&&(value.pending.importId!==value.importId||(value.pending.kind==='part'&&value.pending.offset+value.pending.byteLength>value.file.bytes)))ctx.addIssue({code:'custom',message:'La parte no corresponde a la carga conservada.'});});
const selection=z.strictObject({mode:z.literal('fork'),sourceRunId:RunIdSchema,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(4000)});
export const ExternalForkPreviewSchema=ForkRestorePreviewSchema.extend({externalRegistrationId:BackupRegistrationIdSchema});
export const ExternalAttemptSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('preview'),registrationId:BackupRegistrationIdSchema,key:z.uuid(),selection}),
 z.strictObject({kind:z.literal('apply'),registrationId:BackupRegistrationIdSchema,manifestHash:HashSchema,key:z.uuid(),preview:ExternalForkPreviewSchema,retry:z.strictObject({key:z.uuid(),job:ForkJobViewSchema}).optional()}),
]).superRefine((value,ctx)=>{if(value.kind==='apply'&&(value.preview.externalRegistrationId!==value.registrationId||value.preview.manifestHash!==value.manifestHash||value.preview.blockers.length>0||(value.retry!==undefined&&(value.retry.job.operationId!==value.preview.operationId||value.retry.job.source.runId!==value.preview.sourceRunId))))ctx.addIssue({code:'custom',message:'La confirmación no corresponde al registro externo.'});});
export const BackupTransferStateSchema=z.strictObject({upload:UploadAttemptSchema.optional(),export:z.strictObject({backupId:BackupIdSchema,key:z.uuid(),exportId:BackupExportIdSchema.optional()}).optional(),external:ExternalAttemptSchema.optional()});
export type BackupTransferState=z.infer<typeof BackupTransferStateSchema>;
export type UploadAttempt=z.infer<typeof UploadAttemptSchema>;
export type TransferPending=z.infer<typeof TransferPendingSchema>;
export type ExternalAttempt=z.infer<typeof ExternalAttemptSchema>;
export type ExternalForkPreview=z.infer<typeof ExternalForkPreviewSchema>;
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const storageKey='personajes:backup-transfer';
export function readBackupTransferState(storage:StoragePort):BackupTransferState {
 try{const raw=storage.getItem(storageKey);return raw===null?{}:BackupTransferStateSchema.parse(JSON.parse(raw));}catch{return {};}
}
export function writeBackupTransferState(storage:StoragePort,value:BackupTransferState):boolean {
 try{storage.setItem(storageKey,JSON.stringify(BackupTransferStateSchema.parse(value)));return true;}catch{return false;}
}
type TransferFile=Pick<File,'name'|'size'>&{slice(start?:number,end?:number):Pick<Blob,'arrayBuffer'>};
export async function chunkSha256(bytes:Uint8Array):Promise<string>{const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function captureTransferFile(file:TransferFile){
 const partial=TransferFileSchema.omit({prefixSha256:true}).parse({fileName:file.name,bytes:file.size});
 const prefix=new Uint8Array(await file.slice(0,BACKUP_TRANSFER_PART_BYTES).arrayBuffer());
 return TransferFileSchema.parse({...partial,prefixSha256:await chunkSha256(prefix)});
}
export async function verifyTransferFile(file:TransferFile,expected:z.infer<typeof TransferFileSchema>){
 const actual=await captureTransferFile(file);if(actual.fileName!==expected.fileName||actual.bytes!==expected.bytes||actual.prefixSha256!==expected.prefixSha256)throw new Error('Elegí el mismo archivo: nombre, tamaño y primera parte deben coincidir.');return actual;
}
export async function captureTransferPart(input:{file:TransferFile;importId:string;revision:number;offset:number}){
 const bytes=new Uint8Array(await input.file.slice(input.offset,input.offset+BACKUP_TRANSFER_PART_BYTES).arrayBuffer());
 const intent=TransferPendingSchema.parse({kind:'part',key:crypto.randomUUID(),importId:input.importId,revision:input.revision,offset:input.offset,byteLength:bytes.byteLength,sha256:await chunkSha256(bytes)});
 return intent;
}
export async function rebuildTransferPart(file:TransferFile,input:Extract<TransferPending,{kind:'part'}>){
 const intent=TransferPendingSchema.parse(input);if(intent.kind!=='part')throw new Error('Falta la parte conservada.');
 const bytes=new Uint8Array(await file.slice(intent.offset,intent.offset+intent.byteLength).arrayBuffer());
 if(bytes.byteLength!==intent.byteLength||await chunkSha256(bytes)!==intent.sha256)throw new Error('La parte elegida cambió; no se repite un contenido distinto con la misma identidad.');
 let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return {offset:intent.offset,contentBase64:btoa(binary),sha256:intent.sha256};
}
const RejectionSchema=z.strictObject({kind:z.literal('transfer-rejection'),code:z.string(),message:z.string(),status:count});
export function transferRejection(value:unknown){return RejectionSchema.safeParse(value).data;}
async function parse<T>(response:Response,schema:z.ZodType<T>):Promise<T>{
 const value:unknown=await response.json();if(!response.ok){const problem=ApiProblemSchema.safeParse(value);if(problem.success&&response.status>=400&&response.status<500&&response.status!==408)throw RejectionSchema.parse({kind:'transfer-rejection',code:problem.data.error.code,message:problem.data.error.message,status:response.status});throw new Error('No se confirmó la transferencia.');}return schema.parse(value);
}
export function newerBackupImport(current:BackupImportView|null,incoming:BackupImportView):BackupImportView{
 if(current===null)return incoming;
 if(current.importId!==incoming.importId||incoming.revision<current.revision||current.state==='registered'||current.state==='cancelled')return current;return incoming;
}
export function createBackupTransferClient(request:typeof fetch=(url,init)=>fetch(url,init),bootstrap=bootstrapSession){
 async function send(input:{path:string;method:string;key:string;body:unknown;etag?:string},signal:AbortSignal){
  const session=await bootstrap();return request(input.path,{method:input.method,credentials:'same-origin',signal,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':z.uuid().parse(input.key),...(input.etag===undefined?{}:{'If-Match':input.etag})},body:JSON.stringify(input.body)});
 }
 async function read(path:string,signal:AbortSignal){await bootstrap();return request(path,{credentials:'same-origin',signal});}
 async function importResult(response:Response,importId?:string){const job=await parse(response,BackupImportViewSchema);if((importId!==undefined&&job.importId!==importId)||response.headers.get('etag')!==backupImportEtag(job))throw new Error('La respuesta no corresponde a la carga conservada.');return job;}
 async function exportResult(response:Response,input:{backupId?:string;exportId?:string}){const job=await parse(response,BackupExportViewSchema);if((input.exportId!==undefined&&job.exportId!==input.exportId)||(input.backupId!==undefined&&job.backupId!==input.backupId)||response.headers.get('etag')!==backupExportEtag(job))throw new Error('La exportación pertenece a otra solicitud.');return job;}
 return Object.freeze({
  async beginExport(input:NonNullable<BackupTransferState['export']>,signal:AbortSignal){const intent=BackupTransferStateSchema.shape.export.unwrap().parse(input);return exportResult(await send({path:'/api/v1/backup-exports',method:'POST',key:intent.key,body:{backupId:intent.backupId}},signal),{backupId:intent.backupId});},
  async readExport(exportId:string,signal:AbortSignal){const id=BackupExportIdSchema.parse(exportId);return exportResult(await read(`/api/v1/backup-exports/${id}`,signal),{exportId:id});},
  async beginImport(input:Extract<UploadAttempt,{kind:'creating'}>,signal:AbortSignal){const intent=UploadAttemptSchema.parse(input);if(intent.kind!=='creating')throw new Error('Falta el inicio conservado.');const job=await importResult(await send({path:'/api/v1/backup-imports',method:'POST',key:intent.key,body:{fileName:intent.file.fileName,bytes:intent.file.bytes}},signal));if(job.fileName!==intent.file.fileName||job.bytes!==intent.file.bytes)throw new Error('La carga recibida corresponde a otro archivo.');return job;},
  async readImport(importId:string,signal:AbortSignal){const id=BackupImportIdSchema.parse(importId);return importResult(await read(`/api/v1/backup-imports/${id}`,signal),id);},
  async part(input:{intent:Extract<TransferPending,{kind:'part'}>;file:TransferFile},signal:AbortSignal){const intent=TransferPendingSchema.parse(input.intent);if(intent.kind!=='part')throw new Error('Falta la parte conservada.');const body=await rebuildTransferPart(input.file,intent);const result=await importResult(await send({path:`/api/v1/backup-imports/${intent.importId}/parts`,method:'PUT',key:intent.key,etag:`"backup-import:${intent.importId}:r${intent.revision}"`,body},signal),intent.importId);if(result.receivedBytes<intent.offset+intent.byteLength)throw new Error('La respuesta no confirmó la parte completa.');return result;},
  async control(input:Exclude<TransferPending,{kind:'part'}>,signal:AbortSignal){const intent=TransferPendingSchema.parse(input);if(intent.kind==='part')throw new Error('No es una operación de control.');const path=`/api/v1/backup-imports/${intent.importId}${intent.kind==='cancel'?'':`/${intent.kind}`}`;return importResult(await send({path,method:intent.kind==='cancel'?'DELETE':'POST',key:intent.key,etag:`"backup-import:${intent.importId}:r${intent.revision}"`,body:{}},signal),intent.importId);},
  async registration(registrationId:string,signal:AbortSignal){const id=BackupRegistrationIdSchema.parse(registrationId);const response=await read(`/api/v1/backup-registrations/${id}`,signal);const result=await parse(response,RegisteredBackupSchema);if(result.registrationId!==id||response.headers.get('etag')!==backupRegistrationEtag(result))throw new Error('El registro externo cambió de identidad.');return result;},
  async preview(input:Extract<ExternalAttempt,{kind:'preview'}>,signal:AbortSignal){const intent=ExternalAttemptSchema.parse(input);if(intent.kind!=='preview')throw new Error('Falta la selección conservada.');const result=await parse(await send({path:`/api/v1/backup-registrations/${intent.registrationId}/restore-preview`,method:'POST',key:intent.key,body:intent.selection},signal),ExternalForkPreviewSchema);if(result.externalRegistrationId!==intent.registrationId||result.sourceRunId!==intent.selection.sourceRunId||result.name!==intent.selection.name||result.reason!==intent.selection.reason)throw new Error('La revisión pertenece a otro registro externo.');return result;},
  async apply(input:Extract<ExternalAttempt,{kind:'apply'}>,signal:AbortSignal){const intent=ExternalAttemptSchema.parse(input);if(intent.kind!=='apply')throw new Error('Falta la confirmación conservada.');const response=await send({path:`/api/v1/backup-registrations/${intent.registrationId}/restore`,method:'POST',key:intent.key,etag:`"backup-registration:${intent.registrationId}:${intent.manifestHash}"`,body:{previewToken:intent.preview.previewToken,confirmDiffHash:intent.preview.diffHash}},signal);const job=await parse(response,ForkJobViewSchema);if(response.headers.get('etag')!==forkJobEtag(job)||job.operationId!==intent.preview.operationId||job.source.runId!==intent.preview.sourceRunId||job.name!==intent.preview.name||job.reason!==intent.preview.reason)throw new Error('No se confirmó el destino de la restauración externa.');return job;},
 });
}
export type BackupTransferClient=ReturnType<typeof createBackupTransferClient>;
