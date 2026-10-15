import { z } from 'zod';
import { BackupFenceSchema, BackupIdSchema } from './backup.ts';
import { HashSchema } from './values.ts';

export const BackupImportIdSchema=z.uuid().brand<'BackupImportId'>();
export const BackupRegistrationIdSchema=z.uuid().brand<'BackupRegistrationId'>();
export const BackupExportIdSchema=z.uuid().brand<'BackupExportId'>();
export const BACKUP_TRANSFER_PART_BYTES=1024*1024;
export const BACKUP_ARCHIVE_DEFAULT_MAX_BYTES=1024*1024*1024;
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const code=z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).nullable();
export const RegisteredBackupSchema=z.strictObject({
 kind:z.literal('registered-backup'),registrationId:BackupRegistrationIdSchema,
 sourceBackupId:BackupIdSchema,sourceLineageId:z.uuid(),manifestHash:HashSchema,
 archiveSha256:HashSchema,bytes:count,
 provenance:z.literal('operator-upload-unverified-origin'),sources:z.array(BackupFenceSchema).max(100000),
});
const importBase={kind:z.literal('backup-import'),importId:BackupImportIdSchema,
 fileName:z.string().min(1).max(150),bytes:count,receivedBytes:count,revision:count};
export const BackupImportViewSchema=z.discriminatedUnion('state',[
 z.strictObject({...importBase,state:z.literal('uploading'),safeCode:z.null()}),
 z.strictObject({...importBase,state:z.literal('validating'),safeCode:z.null()}),
 z.strictObject({...importBase,state:z.literal('registered'),safeCode:z.null(),registration:RegisteredBackupSchema}),
 z.strictObject({...importBase,state:z.literal('failed'),safeCode:code}),
 z.strictObject({...importBase,state:z.literal('interrupted'),safeCode:code}),
 z.strictObject({...importBase,state:z.literal('cancelled'),safeCode:z.null()}),
]).superRefine((value,ctx)=>{if(value.receivedBytes>value.bytes)ctx.addIssue({code:'custom',message:'Received bytes exceed archive size'});});
const exportBase={kind:z.literal('backup-export'),exportId:BackupExportIdSchema,backupId:BackupIdSchema,revision:count};
export const BackupExportViewSchema=z.discriminatedUnion('state',[
 z.strictObject({...exportBase,state:z.literal('queued'),safeCode:z.null()}),
 z.strictObject({...exportBase,state:z.literal('running'),safeCode:z.null()}),
 z.strictObject({...exportBase,state:z.literal('succeeded'),safeCode:z.null(),bytes:count,sha256:HashSchema,fileName:z.string().regex(/^[A-Za-z0-9_.-]{1,150}$/)}),
 z.strictObject({...exportBase,state:z.literal('failed'),safeCode:code}),
 z.strictObject({...exportBase,state:z.literal('interrupted'),safeCode:code}),
]);
export type BackupImportView=z.infer<typeof BackupImportViewSchema>;
export type BackupExportView=z.infer<typeof BackupExportViewSchema>;
export type RegisteredBackup=z.infer<typeof RegisteredBackupSchema>;
export function backupImportEtag(job:BackupImportView){return `"backup-import:${job.importId}:r${job.revision}"`;}
export function backupExportEtag(job:BackupExportView){return `"backup-export:${job.exportId}:r${job.revision}"`;}
export function backupRegistrationEtag(registration:RegisteredBackup){return `"backup-registration:${registration.registrationId}:${registration.manifestHash}"`;}
