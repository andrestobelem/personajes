import { randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, readdirSync, realpathSync, renameSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { extractBackupArchive, writeBackupArchive } from '../adapters/backup-archive.ts';
import { inspectHostOwnership, type HostDirectoryOperation } from '../adapters/host-ownership.ts';
import { validateExternalBackup } from './external-backup-validation.ts';
import { BackupIdSchema, BackupManifestSchema, type BackupManifest } from '../domain/backup.ts';
import { BACKUP_ARCHIVE_DEFAULT_MAX_BYTES, BACKUP_TRANSFER_PART_BYTES, BackupExportIdSchema, BackupExportViewSchema, BackupImportIdSchema, BackupImportViewSchema, BackupRegistrationIdSchema, RegisteredBackupSchema, type BackupImportView, type BackupExportView } from '../domain/backup-transfer.ts';
import { HashSchema, RunIdSchema } from '../domain/values.ts';
import { BackupForkSourceSchema } from './fork-source.ts';
import { ForkSourceDataSchema } from './fork-source.ts';
import { boundedFile, directory, exactInventory, hashFile, privateDirectory, regular, sha256, syncDirectory } from './backup-transfer-files.ts';

const principal = z.string().trim().min(1).max(200);
const key = z.uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = { principalId: principal, importId: BackupImportIdSchema };
const mutation = { ...identity, idempotencyKey: key, expectedRevision: count };
const MetadataSchema = z.strictObject({ manifest: BackupManifestSchema, manifestHash: HashSchema, archiveSha256: HashSchema, bytes: count,
 sources: z.array(z.strictObject({ runId: RunIdSchema, fileName: z.string().regex(/^[0-9a-f-]{36}\.json$/), sha256: HashSchema, bytes: count })) });
const ImportRecordSchema = z.strictObject({ view: BackupImportViewSchema, registrationId: BackupRegistrationIdSchema, attempt: count, parts: z.array(z.strictObject({ offset:count, bytes:count.positive(), sha256:HashSchema })).max(16384), metadata: MetadataSchema.nullable() });
const ExportRecordSchema = z.strictObject({ view: BackupExportViewSchema, source: z.strictObject({ manifest: BackupManifestSchema, hash: HashSchema, bundleRoot: z.string().min(1) }) });
const JobSchema = z.strictObject({ id: z.uuid(), kind: z.enum(['import','export']), principal_id: principal, owner_token: z.uuid(), payload_json: z.string(), checksum: HashSchema });
const ReceiptSchema = z.strictObject({ principal_id: principal, operation_key: key, request_hash: HashSchema, result_json: z.string(), checksum: HashSchema });
const approvedSchema = z.array(z.strictObject({ type: z.enum(['table','index','trigger','view']), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() }));
const JOB_METADATA_BYTES=64*1024*1024;
const VALIDATION_SQLITE_BYTES=512*1024*1024;
const opened = new Set<string>();
const safeFailure = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'BACKUP_TRANSFER_VALIDATION_FAILED';

/** Durable operator transport. Uploaded SQLite is opened only by the isolated validator. */
export function openBackupTransferService(input: {
 privateDataRoot: string; ownerToken: string; directoryOperation?: HostDirectoryOperation | undefined;
 readLocalBackup: (backupId: z.infer<typeof BackupIdSchema>) => { manifest: BackupManifest; hash: string; bundleRoot: string };
 readApprovedJournalSchema: () => z.infer<typeof approvedSchema>;
 maxArchiveBytes?: number; maxStoredBytes?: number;
 validationLimits?: Parameters<typeof validateExternalBackup>[0]['limits'];
}) {
 const root = realpathSync(input.privateDataRoot); if(root!==input.privateDataRoot)throw new Error('BACKUP_TRANSFER_DIRECTORY_INVALID');directory(root);
 const ownerToken = z.uuid().parse(input.ownerToken);
 if (inspectHostOwnership({ privateDataRoot: root, directoryOperation:input.directoryOperation }).nonce !== ownerToken) throw new Error('BACKUP_TRANSFER_HOST_NOT_OWNED');
 const store = join(dirname(root), `.${basename(root)}.personajes-backup-exchange`);
 if (opened.has(store)) throw new Error('BACKUP_TRANSFER_ALREADY_OPEN');
 const maxArchiveBytes = z.number().int().positive().max(16384*BACKUP_TRANSFER_PART_BYTES).parse(input.maxArchiveBytes ?? BACKUP_ARCHIVE_DEFAULT_MAX_BYTES);
 const frozenBytes = input.validationLimits?.maxTotalSourceBytes ?? 64*1024*1024;
 const maxStoredBytes = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(input.maxStoredBytes ?? 8 * BACKUP_ARCHIVE_DEFAULT_MAX_BYTES);
 privateDirectory(store);
 exactInventory(store, new Set(['transfer.sqlite','transfer.sqlite-wal','transfer.sqlite-shm','transfer.sqlite-journal','imports','exports','registrations']));
 for (const child of ['imports','exports','registrations']) privateDirectory(join(store, child));
 const databasePath = join(store, 'transfer.sqlite');
 if (!existsSync(databasePath)) { const fd = openSync(databasePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); try { fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(store); }
 for (const suffix of ['', '-wal','-shm','-journal']) if (existsSync(databasePath + suffix)) { const fd = regular(databasePath + suffix); closeSync(fd); }
 const db = new DatabaseSync(databasePath);
 try {
 db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
 const check = db.prepare('PRAGMA quick_check').get(); if (z.object({ quick_check: z.literal('ok') }).safeParse(check).success === false) { db.close(); throw new Error('BACKUP_TRANSFER_LEDGER_INVALID'); }
 db.exec(`CREATE TABLE IF NOT EXISTS transfer_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),root_hash TEXT NOT NULL,schema_version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS transfer_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,principal_id TEXT NOT NULL,owner_token TEXT NOT NULL,payload_json TEXT NOT NULL,checksum TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS transfer_receipts(principal_id TEXT NOT NULL,operation_key TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(principal_id,operation_key));`);
 const expectedTables = new Map([
  ['transfer_meta','CREATE TABLE transfer_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),root_hash TEXT NOT NULL,schema_version INTEGER NOT NULL)'],
  ['transfer_jobs','CREATE TABLE transfer_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,principal_id TEXT NOT NULL,owner_token TEXT NOT NULL,payload_json TEXT NOT NULL,checksum TEXT NOT NULL)'],
  ['transfer_receipts','CREATE TABLE transfer_receipts(principal_id TEXT NOT NULL,operation_key TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(principal_id,operation_key))'],
 ]);
 for(const raw of db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema').all()){
  const row=z.strictObject({type:z.string(),name:z.string(),tbl_name:z.string(),sql:z.string().nullable()}).parse(raw);
  if(row.type==='index'&&row.sql===null&&row.name.startsWith('sqlite_autoindex_')&&expectedTables.has(row.tbl_name))continue;
  if(row.type!=='table'||row.sql!==expectedTables.get(row.name))throw new Error('BACKUP_TRANSFER_LEDGER_SCHEMA_INVALID');
 }
 const meta = db.prepare('SELECT root_hash,schema_version FROM transfer_meta WHERE singleton=1').get();
 if (!meta) db.prepare('INSERT INTO transfer_meta VALUES(1,?,1)').run(sha256(root));
 else if (!z.strictObject({ root_hash: z.literal(sha256(root)), schema_version: z.literal(1) }).safeParse(meta).success) { db.close(); throw new Error('BACKUP_TRANSFER_ROOT_MISMATCH'); }
 opened.add(store);
 let closing = false; let closed = false; let closePromise: Promise<void> | undefined; let queue = Promise.resolve(); const pending = new Set<Promise<void>>();
 function available() { if (closed || closing) throw new Error('BACKUP_TRANSFER_CLOSED'); directory(store); const fd = regular(databasePath); closeSync(fd); }
 function tx<T>(operation: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
 function digest(row: object) { return sha256(JSON.stringify(Object.entries(row).sort(([a],[b]) => a.localeCompare(b)))); }
 function job(id: string, principalId?: string) {
  const raw = principalId === undefined ? db.prepare('SELECT * FROM transfer_jobs WHERE id=?').get(id) : db.prepare('SELECT * FROM transfer_jobs WHERE id=? AND principal_id=?').get(id, principalId);
  if (!raw) throw new Error('BACKUP_TRANSFER_NOT_FOUND'); const parsed = JobSchema.parse(raw); const { checksum, ...data } = parsed;
  if (digest(data) !== checksum) throw new Error('BACKUP_TRANSFER_METADATA_TAMPERED'); return parsed;
 }
 function storeJob(id: string, kind: 'import'|'export', principalId: string, payload: z.infer<typeof ImportRecordSchema> | z.infer<typeof ExportRecordSchema>) {
  const data = { id, kind, principal_id: principalId, owner_token: ownerToken, payload_json: JSON.stringify(payload) };
  db.prepare('INSERT INTO transfer_jobs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_token=excluded.owner_token,payload_json=excluded.payload_json,checksum=excluded.checksum').run(data.id,data.kind,data.principal_id,data.owner_token,data.payload_json,digest(data));
 }
 function imported(importId: string, principalId?: string) { const row = job(importId, principalId); if (row.kind !== 'import') throw new Error('BACKUP_TRANSFER_NOT_FOUND'); const record = ImportRecordSchema.parse(JSON.parse(row.payload_json)); if (record.view.importId !== row.id) throw new Error('BACKUP_TRANSFER_METADATA_TAMPERED'); return { row, record }; }
 function exported(exportId: string, principalId?: string) { const row = job(exportId, principalId); if (row.kind !== 'export') throw new Error('BACKUP_TRANSFER_NOT_FOUND'); const record = ExportRecordSchema.parse(JSON.parse(row.payload_json)); if (record.view.exportId !== row.id || record.view.backupId !== record.source.manifest.backupId) throw new Error('BACKUP_TRANSFER_METADATA_TAMPERED'); return { row, record }; }
 function replay(principalId: string, operationKey: string, request: unknown): unknown | undefined {
  const raw = db.prepare('SELECT * FROM transfer_receipts WHERE principal_id=? AND operation_key=?').get(principalId,operationKey); if (!raw) return undefined;
  const parsed = ReceiptSchema.parse(raw); const { checksum, ...data } = parsed;
  if (digest(data) !== checksum) throw new Error('BACKUP_TRANSFER_METADATA_TAMPERED');
  if (parsed.request_hash !== sha256(JSON.stringify(request))) throw new Error('BACKUP_TRANSFER_IDEMPOTENCY_REUSE'); return JSON.parse(parsed.result_json);
 }
 function receipt(principalId: string, operationKey: string, request: unknown, result: BackupImportView | BackupExportView) {
  const data = { principal_id: principalId, operation_key: operationKey, request_hash: sha256(JSON.stringify(request)), result_json: JSON.stringify(result) };
  db.prepare('INSERT INTO transfer_receipts VALUES(?,?,?,?,?)').run(data.principal_id,data.operation_key,data.request_hash,data.result_json,digest(data));
 }
 function reserve(extra: number) {
  let reserved = 0;
  for (const raw of db.prepare('SELECT id FROM transfer_jobs').all()) {
   const id = z.object({ id: z.uuid() }).parse(raw).id; const row = job(id);
   if (row.kind === 'import') { const record = ImportRecordSchema.parse(JSON.parse(row.payload_json)); reserved += record.view.bytes + record.attempt * (2*record.view.bytes + frozenBytes + JOB_METADATA_BYTES + VALIDATION_SQLITE_BYTES) + JOB_METADATA_BYTES + record.parts.length * 2048; }
   else { const view = ExportRecordSchema.parse(JSON.parse(row.payload_json)).view; reserved += (view.state === 'succeeded' ? view.bytes : maxArchiveBytes)*2+65536; }
  }
  if (!Number.isSafeInteger(reserved + extra) || reserved + extra > maxStoredBytes) throw new Error('BACKUP_TRANSFER_DISK_LIMIT');
 }
 function schedule(operation: () => Promise<void>) {
  const work = queue.then(operation); queue = work.catch(() => {}); pending.add(work); void work.finally(() => pending.delete(work)).catch(() => {});
 }
 function verifyUploadedParts(path: string, record: z.infer<typeof ImportRecordSchema>): void {
  const fd=regular(path); let offset=0;
  try { for(const part of record.parts){
   if(part.offset!==offset||part.bytes>BACKUP_TRANSFER_PART_BYTES)throw new Error('BACKUP_IMPORT_PART_LEDGER_INVALID');
   const bytes=Buffer.alloc(part.bytes);let read=0;while(read<bytes.length){const n=readSync(fd,bytes,read,bytes.length-read,offset+read);if(!n)throw new Error('BACKUP_IMPORT_PART_CHANGED');read+=n;}
   if(sha256(bytes)!==part.sha256)throw new Error('BACKUP_IMPORT_PART_CHANGED');offset+=part.bytes;
  } if(offset!==record.view.bytes||fstatSync(fd).size!==offset)throw new Error('BACKUP_IMPORT_PART_LEDGER_INVALID'); }
  finally {closeSync(fd);}
 }
 function sourceRoot(id: string) { return join(store, 'registrations', id); }
 function verifyBundle(bundleRoot:string,manifest:BackupManifest):void {
  const files=new Set(['manifest.json',...manifest.files.map(file=>file.path)]);const dirs=new Set<string>();
  for(const file of files){let parent=dirname(file);while(parent!=='.'){dirs.add(parent);parent=dirname(parent);}}
  function visit(folder:string,prefix:string):void{directory(folder);for(const name of readdirSync(folder)){
   const path=join(folder,name);const relative=prefix+name;const stat=lstatSync(path);
   if(stat.isDirectory()&&!stat.isSymbolicLink()&&dirs.has(relative))visit(path,relative+'/');
   else if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!files.delete(relative))throw new Error('BACKUP_TRANSFER_BUNDLE_INVENTORY_INVALID');
  }}
  visit(bundleRoot,'');if(files.size)throw new Error('BACKUP_TRANSFER_BUNDLE_INVENTORY_INVALID');
  for(const file of manifest.files){const actual=hashFile(join(bundleRoot,file.path),256*1024*1024);if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)throw new Error('BACKUP_TRANSFER_BUNDLE_CHANGED');}
 }
 function validateMetadata(record: z.infer<typeof ImportRecordSchema>) {
  if (record.view.state !== 'registered' || record.metadata === null) throw new Error('BACKUP_TRANSFER_NOT_REGISTERED');
  const registration = record.view.registration; const metadata = record.metadata;
  if (registration.registrationId !== record.registrationId || registration.sourceBackupId !== metadata.manifest.backupId || registration.sourceLineageId !== metadata.manifest.lineageId || registration.manifestHash !== metadata.manifestHash || registration.archiveSha256 !== metadata.archiveSha256 || registration.bytes !== metadata.bytes || JSON.stringify(registration.sources) !== JSON.stringify(metadata.manifest.fences)) throw new Error('BACKUP_TRANSFER_METADATA_TAMPERED');
  const publishedRoot=sourceRoot(record.registrationId);exactInventory(publishedRoot,new Set(['bundle',...Array.from({length:record.attempt},(_,index)=>`frozen-${index+1}`)]));
  const bundleRoot = join(publishedRoot, 'bundle'); directory(bundleRoot);
  if (sha256(boundedFile(join(bundleRoot,'manifest.json'),16*1024*1024)) !== metadata.manifestHash) throw new Error('BACKUP_TRANSFER_MANIFEST_CHANGED');
  verifyBundle(bundleRoot,metadata.manifest);
  return { metadata, bundleRoot };
 }
 async function runExport(exportId: string) {
  const current = exported(exportId); if (current.record.view.state !== 'queued') return;
  const running = BackupExportViewSchema.parse({ ...current.record.view, state: 'running', revision: current.record.view.revision + 1 });
  storeJob(exportId,'export',current.row.principal_id,{ ...current.record, view: running });
  try {
   const exportRoot = join(store,'exports',exportId); privateDirectory(exportRoot); exactInventory(exportRoot,new Set(['archive.pba']));
   const path = join(exportRoot,'archive.pba');
   const result = await writeBackupArchive({ bundleRoot: current.record.source.bundleRoot, manifest: current.record.source.manifest, manifestHash: current.record.source.hash, archivePath: path, maxArchiveBytes });
   const view = BackupExportViewSchema.parse({ ...running, state: 'succeeded', revision: running.revision + 1, bytes: result.bytes, sha256: result.sha256, fileName: `personajes-backup-${running.backupId}.pba` });
   storeJob(exportId,'export',current.row.principal_id,{ ...current.record, view });
  } catch (error) { storeJob(exportId,'export',current.row.principal_id,{ ...current.record, view: BackupExportViewSchema.parse({ ...running,state:'failed',revision:running.revision+1,safeCode:safeFailure(error) }) }); }
 }
 async function runImport(importId: string) {
  const current = imported(importId); if (current.record.view.state !== 'validating') return;
  const importRoot = join(store,'imports',importId); const attemptRoot = join(importRoot,`attempt-${current.record.attempt}`); const published = sourceRoot(current.record.registrationId);
  try {
   privateDirectory(importRoot); exactInventory(importRoot,new Set(['archive.pba', ...readdirSync(importRoot).filter(name => /^attempt-[0-9]+$/.test(name))]));
   const archivePath=join(importRoot,'archive.pba');
   verifyUploadedParts(archivePath,current.record);
   const archive = hashFile(archivePath,maxArchiveBytes); if (archive.bytes !== current.record.view.bytes) throw new Error('BACKUP_IMPORT_ARCHIVE_SIZE_MISMATCH');
   let bundleRoot: string; let manifest: BackupManifest; let manifestHash: string; let publicationRoot: string;
   if (existsSync(published)) {
    directory(published); bundleRoot = join(published,'bundle'); publicationRoot = published;
    const raw = boundedFile(join(bundleRoot,'manifest.json'),16*1024*1024); manifest = BackupManifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))); manifestHash = sha256(raw);
    if(current.record.metadata===null||current.record.metadata.archiveSha256!==archive.sha256||current.record.metadata.manifestHash!==manifestHash||JSON.stringify(current.record.metadata.manifest)!==JSON.stringify(manifest))throw new Error('BACKUP_IMPORT_PUBLICATION_UNPROVEN');
    verifyBundle(bundleRoot,manifest);
   } else {
    privateDirectory(attemptRoot); exactInventory(attemptRoot,new Set());
    const extracted = await extractBackupArchive({ archivePath: join(importRoot,'archive.pba'), stageRoot: join(attemptRoot,'bundle'), maxArchiveBytes });
    if (extracted.archiveSha256 !== archive.sha256 || extracted.bytes !== archive.bytes) throw new Error('BACKUP_IMPORT_ARCHIVE_CHANGED');
    bundleRoot = join(attemptRoot,'bundle'); manifest = extracted.manifest; manifestHash = extracted.manifestHash; publicationRoot = attemptRoot;
   }
   if(imported(importId).record.view.state!=='validating')return;
   const frozenRoot = join(publicationRoot,`frozen-${current.record.attempt}`);
   const validated = await validateExternalBackup({ bundleRoot, manifest, manifestHash, approvedJournalSchema: approvedSchema.parse(input.readApprovedJournalSchema()), sourceOutputRoot: frozenRoot, ...(input.validationLimits === undefined ? {} : { limits: input.validationLimits }) });
   const sources = validated.sources.map(source => {
    const expected = join(frozenRoot,'sources',`${source.runId}.json`); if (source.path !== expected) throw new Error('BACKUP_IMPORT_SOURCE_SCOPE_INVALID');
    const actual = hashFile(source.path,input.validationLimits?.maxSourceBytes ?? 64*1024*1024); if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256) throw new Error('BACKUP_IMPORT_SOURCE_CHANGED');
    ForkSourceDataSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(boundedFile(source.path,input.validationLimits?.maxSourceBytes ?? 64*1024*1024))));
    return { runId: source.runId, fileName: `${source.runId}.json`, sha256: source.sha256, bytes: source.bytes };
   });
   if (sources.length !== manifest.fences.length || manifest.fences.some(fence => !sources.some(source => source.runId === fence.runId))) throw new Error('BACKUP_IMPORT_SOURCES_INCOMPLETE');
   const fresh = imported(importId); if (fresh.record.view.state !== 'validating' || fresh.record.attempt !== current.record.attempt) return;
   const metadata = MetadataSchema.parse({ manifest,manifestHash,archiveSha256:archive.sha256,bytes:archive.bytes,sources });
   // Persist the verified publication identity before renaming. A crash cannot adopt an unrelated registration directory.
   storeJob(importId,'import',fresh.row.principal_id,{...fresh.record,metadata});
   if (publicationRoot !== published) { renameSync(publicationRoot,published); syncDirectory(dirname(published)); syncDirectory(importRoot); }
   const registration = RegisteredBackupSchema.parse({ kind:'registered-backup',registrationId:current.record.registrationId,sourceBackupId:manifest.backupId,sourceLineageId:manifest.lineageId,manifestHash,archiveSha256:archive.sha256,bytes:archive.bytes,provenance:'operator-upload-unverified-origin',sources:manifest.fences });
   const view = BackupImportViewSchema.parse({ ...fresh.record.view,state:'registered',revision:fresh.record.view.revision+1,safeCode:null,registration });
   storeJob(importId,'import',fresh.row.principal_id,{ ...fresh.record,view,metadata });
  } catch (error) {
   const fresh = imported(importId); if (fresh.record.view.state !== 'validating') return;
   storeJob(importId,'import',fresh.row.principal_id,{ ...fresh.record,view:BackupImportViewSchema.parse({ ...fresh.record.view,state:'failed',revision:fresh.record.view.revision+1,safeCode:safeFailure(error) }) });
  }
 }
 // Startup only records abandoned work. It never extracts, validates, exports or calls models.
 tx(() => { for (const raw of db.prepare('SELECT id FROM transfer_jobs').all()) {
  const id = z.object({id:z.uuid()}).parse(raw).id; const row = job(id);
  if (row.kind === 'import') { const record = ImportRecordSchema.parse(JSON.parse(row.payload_json)); if (record.view.state === 'validating') storeJob(id,'import',row.principal_id,{...record,view:BackupImportViewSchema.parse({...record.view,state:'interrupted',revision:record.view.revision+1,safeCode:'BACKUP_TRANSFER_INTERRUPTED'})}); }
  else { const record = ExportRecordSchema.parse(JSON.parse(row.payload_json)); if (record.view.state === 'queued' || record.view.state === 'running') storeJob(id,'export',row.principal_id,{...record,view:BackupExportViewSchema.parse({...record.view,state:'interrupted',revision:record.view.revision+1,safeCode:'BACKUP_TRANSFER_INTERRUPTED'})}); }
 } });
 const expectedImports=new Set<string>();const expectedExports=new Set<string>();const expectedRegistrations=new Set<string>();
 for(const raw of db.prepare('SELECT id FROM transfer_jobs').all()){
  const id=z.object({id:z.uuid()}).parse(raw).id;const row=job(id);
  if(row.kind==='import'){expectedImports.add(id);expectedRegistrations.add(imported(id).record.registrationId);}else expectedExports.add(id);
 }
 exactInventory(join(store,'imports'),expectedImports);exactInventory(join(store,'exports'),expectedExports);exactInventory(join(store,'registrations'),expectedRegistrations);
 function getImport(raw: unknown) { available(); const request = z.strictObject(identity).parse(raw); return imported(request.importId,request.principalId).record.view; }
 function getExport(raw: unknown) { available(); const request = z.strictObject({principalId:principal,exportId:BackupExportIdSchema}).parse(raw); return exported(request.exportId,request.principalId).record.view; }
 async function createExport(raw: unknown) {
  available(); const request = z.strictObject({principalId:principal,idempotencyKey:key,backupId:BackupIdSchema}).parse(raw); const body = {kind:'export',...request};
  const prior = replay(request.principalId,request.idempotencyKey,body); if (prior !== undefined) return BackupExportViewSchema.parse(prior);
  reserve(2*maxArchiveBytes+65536); const source = z.strictObject({manifest:BackupManifestSchema,hash:HashSchema,bundleRoot:z.string().min(1)}).parse(input.readLocalBackup(request.backupId));
  if(Buffer.byteLength(JSON.stringify(source.manifest))>16*1024*1024||Buffer.byteLength(JSON.stringify(source.manifest))+source.manifest.files.reduce((sum,file)=>sum+file.bytes,0)>maxArchiveBytes)throw new Error('BACKUP_EXPORT_TOO_LARGE');
  if (source.manifest.backupId !== request.backupId) throw new Error('BACKUP_EXPORT_SOURCE_MISMATCH');
  const view = BackupExportViewSchema.parse({kind:'backup-export',exportId:randomUUID(),backupId:request.backupId,revision:0,state:'queued',safeCode:null});
  tx(() => { storeJob(view.exportId,'export',request.principalId,{view,source}); receipt(request.principalId,request.idempotencyKey,body,view); }); schedule(() => runExport(view.exportId)); return view;
 }
 async function beginImport(raw: unknown) {
  available(); const request = z.strictObject({principalId:principal,idempotencyKey:key,fileName:z.string().min(1).max(150).refine(value=>!/[\\/\u0000-\u001f]/.test(value)&&value!=='.'&&value!=='..'),bytes:count.positive().max(maxArchiveBytes)}).parse(raw); const body = {kind:'begin-import',...request};
  const prior = replay(request.principalId,request.idempotencyKey,body); if (prior !== undefined) return BackupImportViewSchema.parse(prior);
  reserve(request.bytes + JOB_METADATA_BYTES); const view = BackupImportViewSchema.parse({kind:'backup-import',importId:randomUUID(),fileName:request.fileName,bytes:request.bytes,receivedBytes:0,revision:0,state:'uploading',safeCode:null});
  tx(() => { storeJob(view.importId,'import',request.principalId,{view,registrationId:BackupRegistrationIdSchema.parse(randomUUID()),attempt:0,parts:[],metadata:null}); receipt(request.principalId,request.idempotencyKey,body,view); }); return view;
 }
 async function appendImportPart(raw: unknown) {
  available(); const request = z.strictObject({...mutation,offset:count,contentBase64:z.string().min(4).max(Math.ceil(BACKUP_TRANSFER_PART_BYTES/3)*4),sha256:HashSchema}).parse(raw);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.contentBase64)) throw new Error('BACKUP_IMPORT_BASE64_INVALID');
  const bytes = Buffer.from(request.contentBase64,'base64'); if (!bytes.length || bytes.length > BACKUP_TRANSFER_PART_BYTES || bytes.toString('base64') !== request.contentBase64 || sha256(bytes) !== request.sha256) throw new Error('BACKUP_IMPORT_PART_HASH_INVALID');
  const body = {kind:'append-import',...request}; const prior = replay(request.principalId,request.idempotencyKey,body); if (prior !== undefined) return BackupImportViewSchema.parse(prior);
  const {record} = imported(request.importId,request.principalId);
  if (record.view.revision !== request.expectedRevision) throw new Error('BACKUP_TRANSFER_REVISION_CONFLICT');
  if (record.view.state !== 'uploading') throw new Error('BACKUP_TRANSFER_INVALID_STATE');
  if (request.offset !== record.view.receivedBytes || request.offset + bytes.length > record.view.bytes) throw new Error('BACKUP_IMPORT_OFFSET_INVALID');
  const importRoot = join(store,'imports',request.importId); privateDirectory(importRoot); exactInventory(importRoot,new Set(['archive.pba']));
  const path = join(importRoot,'archive.pba'); if (!existsSync(path)) { const fd = openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600); closeSync(fd); syncDirectory(importRoot); }
  if(record.parts.length>=16384)throw new Error('BACKUP_IMPORT_PART_LIMIT');
  reserve(2048);
  const fd = regular(path,constants.O_RDWR);
  try {
   const size = fstatSync(fd).size;
   if (size < request.offset || size > request.offset + bytes.length) throw new Error('BACKUP_IMPORT_UNACKNOWLEDGED_TAIL');
   const tail = Buffer.alloc(size-request.offset); let read = 0;
   while (read < tail.length) { const n = readSync(fd,tail,read,tail.length-read,request.offset+read); if (!n) throw new Error('BACKUP_IMPORT_UNACKNOWLEDGED_TAIL'); read += n; }
   if (!tail.equals(bytes.subarray(0,tail.length))) throw new Error('BACKUP_IMPORT_UNACKNOWLEDGED_TAIL');
   let offset = tail.length; while (offset < bytes.length) { const n = writeSync(fd,bytes,offset,bytes.length-offset,request.offset+offset); if (!n) throw new Error('BACKUP_IMPORT_WRITE_FAILED'); offset += n; } fsyncSync(fd);
  } finally { closeSync(fd); }
  const view = BackupImportViewSchema.parse({...record.view,revision:record.view.revision+1,receivedBytes:record.view.receivedBytes+bytes.length});
  const parts = [...record.parts,{offset:request.offset,bytes:bytes.length,sha256:request.sha256}];
  if(parts.length>16384)throw new Error('BACKUP_IMPORT_PART_LIMIT');
  tx(() => {storeJob(view.importId,'import',request.principalId,{...record,view,parts});receipt(request.principalId,request.idempotencyKey,body,view);}); return view;
 }
 async function transition(raw: unknown, kind: 'finalize'|'retry'|'cancel') {
  available(); const request = z.strictObject(mutation).parse(raw); const body = {kind,...request}; const prior = replay(request.principalId,request.idempotencyKey,body); if (prior !== undefined) return BackupImportViewSchema.parse(prior);
  const {record} = imported(request.importId,request.principalId); if (record.view.revision !== request.expectedRevision) throw new Error('BACKUP_TRANSFER_REVISION_CONFLICT');
  if (kind === 'finalize' && (record.view.state !== 'uploading' || record.view.receivedBytes !== record.view.bytes)) throw new Error('BACKUP_TRANSFER_INVALID_STATE');
  if (kind === 'retry' && !['failed','interrupted'].includes(record.view.state)) throw new Error('BACKUP_TRANSFER_INVALID_STATE');
  if (kind === 'retry' && record.view.receivedBytes !== record.view.bytes) throw new Error('BACKUP_TRANSFER_INVALID_STATE');
  if (kind === 'cancel' && (record.view.state === 'registered' || record.view.state === 'cancelled')) throw new Error('BACKUP_TRANSFER_INVALID_STATE');
  const view = BackupImportViewSchema.parse({...record.view,state:kind==='cancel'?'cancelled':'validating',revision:record.view.revision+1,safeCode:null});
  const attempt = kind === 'cancel' ? record.attempt : record.attempt + 1;
  // Every retry reserves another possible extracted copy. Retained forensic attempts are never deleted implicitly.
  if (kind !== 'cancel') reserve(2*record.view.bytes + frozenBytes + JOB_METADATA_BYTES + VALIDATION_SQLITE_BYTES);
  tx(() => {storeJob(view.importId,'import',request.principalId,{...record,view,attempt});receipt(request.principalId,request.idempotencyKey,body,view);});
  if (kind !== 'cancel') schedule(() => runImport(view.importId)); return view;
 }
 function registrationRecord(principalId: string, registrationId: string) {
  for (const raw of db.prepare("SELECT id FROM transfer_jobs WHERE kind='import' AND principal_id=?").all(principalId)) { const id = z.object({id:z.uuid()}).parse(raw).id; const found = imported(id,principalId); if (found.record.registrationId === registrationId && found.record.view.state === 'registered') return found.record; }
  throw new Error('BACKUP_TRANSFER_NOT_FOUND');
 }
 function getRegistration(raw: unknown) { available(); const request = z.strictObject({principalId:principal,registrationId:BackupRegistrationIdSchema}).parse(raw); const record = registrationRecord(request.principalId,request.registrationId); const {metadata} = validateMetadata(record); void metadata; if (record.view.state !== 'registered') throw new Error('BACKUP_TRANSFER_NOT_REGISTERED'); return record.view.registration; }
 function resolveRegistration(raw: unknown) { available(); const request = z.strictObject({principalId:principal,registrationId:BackupRegistrationIdSchema}).parse(raw); const record = registrationRecord(request.principalId,request.registrationId); const {metadata,bundleRoot} = validateMetadata(record);
  return {manifest:metadata.manifest,hash:metadata.manifestHash,bundleRoot}; }
 function readRegisteredSource(raw: unknown) {
  available(); const request = z.strictObject({principalId:principal,registrationId:BackupRegistrationIdSchema,runId:RunIdSchema}).parse(raw); const record = registrationRecord(request.principalId,request.registrationId); const {metadata} = validateMetadata(record);
  const source = metadata.sources.find(value=>value.runId===request.runId); if (!source) throw new Error('BACKUP_TRANSFER_SOURCE_NOT_FOUND');
  const path = join(sourceRoot(record.registrationId),`frozen-${record.attempt}`,'sources',source.fileName); const bytes = boundedFile(path,input.validationLimits?.maxSourceBytes ?? 64*1024*1024);
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) throw new Error('BACKUP_TRANSFER_SOURCE_CHANGED');
  const state = ForkSourceDataSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))); const journal = metadata.manifest.files.find(file=>file.path==='world.sqlite'); if (!journal) throw new Error('BACKUP_TRANSFER_MANIFEST_INVALID');
  return BackupForkSourceSchema.parse({kind:'backup-fork-source',backup:{backupId:metadata.manifest.backupId,lineageId:metadata.manifest.lineageId,manifestHash:metadata.manifestHash,journalHash:journal.sha256,externalRegistration:{registrationId:record.registrationId,archiveSha256:metadata.archiveSha256,originAssurance:'operator-upload-unverified-origin'}},...state});
 }
 async function exportDownload(raw: unknown) {
  available(); const request = z.strictObject({principalId:principal,exportId:BackupExportIdSchema}).parse(raw); const {record} = exported(request.exportId,request.principalId); const view = record.view; if (view.state !== 'succeeded') throw new Error('BACKUP_TRANSFER_EXPORT_NOT_READY');
  const path = join(store,'exports',view.exportId,'archive.pba'); const actual = hashFile(path,maxArchiveBytes); if (actual.bytes !== view.bytes || actual.sha256 !== view.sha256) throw new Error('BACKUP_TRANSFER_EXPORT_CHANGED');
  return {path,bytes:view.bytes,sha256:view.sha256,fileName:view.fileName};
 }
 return Object.freeze({createExport,getExport,exportDownload,beginImport,getImport,appendImportPart,finalizeImport:(raw:unknown)=>transition(raw,'finalize'),retryImport:(raw:unknown)=>transition(raw,'retry'),cancelImport:(raw:unknown)=>transition(raw,'cancel'),getRegistration,resolveRegistration,readRegisteredSource,
  waitForIdle:async()=>{while(pending.size)await Promise.allSettled([...pending]);},
  close:()=>{if(closePromise!==undefined)return closePromise;closing=true;closePromise=(async()=>{await queue;db.close();closed=true;opened.delete(store);})();return closePromise;},
  limits:Object.freeze({maxArchiveBytes,maxStoredBytes,partBytes:BACKUP_TRANSFER_PART_BYTES}),
 });
 } catch(error) { opened.delete(store);try {db.close();}catch{}throw error;}
}
