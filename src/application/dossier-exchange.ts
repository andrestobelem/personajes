import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { exportDossier, importDossier } from '../adapters/catalog.ts';
import { DossierAdaptationImportSchema, DossierArchiveSchema, DossierSchema, type Dossier } from '../domain/catalog.ts';
import { CharacterIdSchema } from '../domain/values.ts';
import { DossierImportViewSchema as ImportViewSchema,DossierImportPreviewMetadataSchema as PreviewSchema,DossierImportApplyRequestSchema } from '../domain/dossier-exchange.ts';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const maxDecoded=16*1024*1024;
const IdSchema=z.uuid();
function boundedJson(value:unknown,depth=0):void {
  if(depth>32)throw new Error('IMPORT_JSON_DEPTH');
  if(Array.isArray(value)){for(const child of value)boundedJson(child,depth+1);}
  else if(value!==null&&typeof value==='object'){
    const entries=Object.entries(value);if(entries.length>512)throw new Error('IMPORT_JSON_PROPERTIES');
    for(const [,child]of entries)boundedJson(child,depth+1);
  }
}
/** Operator-owned dossier quarantine. Canonical researched originals stay immutable.
 * Applied adaptations are separate immutable records; runtime preparation must select
 * them explicitly rather than treating imported text as executed history. */
export function openDossierExchange(input:{journalPath:string;getDossier(characterId:string):Dossier;now?:()=>number}){
  const db=new DatabaseSync(input.journalPath);const now=input.now??Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS exchange_dossier_imports(import_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,view_json TEXT NOT NULL,archive_json TEXT NOT NULL,UNIQUE(principal_id,operation_id));
    CREATE TABLE IF NOT EXISTS exchange_dossier_previews(token TEXT PRIMARY KEY,principal_id TEXT NOT NULL,preview_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exchange_dossier_adaptations(import_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,adaptation_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exchange_dossier_exports(export_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,operation_id TEXT NOT NULL,character_id TEXT NOT NULL,archive_json TEXT NOT NULL,UNIQUE(principal_id,operation_id));`);
  const integrity=exchangeIntegrity(db);
  for(const table of ['exchange_dossier_imports','exchange_dossier_previews','exchange_dossier_adaptations','exchange_dossier_exports'])integrity.migrate(table);
  function get(principalId:string,raw:unknown){
    integrity.verify('exchange_dossier_imports','import_id=? AND principal_id=?',[IdSchema.parse(raw),principalId]);
    const row=db.prepare('SELECT view_json FROM exchange_dossier_imports WHERE import_id=? AND principal_id=?').get(IdSchema.parse(raw),principalId);
    if(!row)throw new Error('IMPORT_NOT_FOUND');
    return ImportViewSchema.parse(JSON.parse(z.strictObject({view_json:z.string()}).parse(row).view_json));
  }
  function quarantine(principalId:string,operationId:string,raw:unknown){
    const request=z.strictObject({kind:z.literal('dossier'),fileName:z.string().min(1).max(150).regex(/^[A-Za-z0-9_.-]+$/),contentBase64:z.string().max(22*1024*1024)}).parse(raw);
    IdSchema.parse(operationId);
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.contentBase64))throw new Error('IMPORT_BASE64_INVALID');
    const bytes=Buffer.from(request.contentBase64,'base64');if(bytes.length>maxDecoded)throw new Error('IMPORT_TOO_LARGE');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const parsed:unknown=JSON.parse(text);boundedJson(parsed);
    const archive=DossierArchiveSchema.parse(parsed);
    // Existing serializer checks Markdown hashes and normalized sections without executing content.
    const canonical=exportDossier(archive.dossier);const requestHash=hash(JSON.stringify(request));
    const previous=db.prepare('SELECT import_id,request_hash FROM exchange_dossier_imports WHERE principal_id=? AND operation_id=?').get(principalId,operationId);
    if(previous){integrity.verify('exchange_dossier_imports','principal_id=? AND operation_id=?',[principalId,operationId]);const old=z.strictObject({import_id:z.string(),request_hash:z.string()}).parse(previous);if(old.request_hash!==requestHash)throw new Error('IMPORT_IDEMPOTENCY_REUSE');return get(principalId,old.import_id);}
    const importId=randomUUID();const view=ImportViewSchema.parse({importId,revision:0,kind:'dossier',state:'quarantined',characterId:archive.dossier.characterId,sourceHash:archive.dossier.contentHash,fileName:request.fileName});
    db.prepare('INSERT INTO exchange_dossier_imports(import_id,principal_id,operation_id,request_hash,view_json,archive_json) VALUES(?,?,?,?,?,?)').run(importId,principalId,operationId,requestHash,JSON.stringify(view),canonical);
    integrity.seal('exchange_dossier_imports','import_id=?',[importId]);
    return view;
  }
  function preview(principalId:string,raw:unknown){
    const view=get(principalId,raw);const row=z.strictObject({archive_json:z.string()}).parse(db.prepare('SELECT archive_json FROM exchange_dossier_imports WHERE import_id=?').get(view.importId));
    const source=DossierArchiveSchema.parse(JSON.parse(row.archive_json)).dossier;
    const target=DossierSchema.parse(input.getDossier(view.characterId));if(target.characterId!==view.characterId)throw new Error('IMPORT_TARGET_IDENTITY_MISMATCH');
    const differences={importId:view.importId,sourceRevision:source.revision,targetRevision:target.revision,sourceHash:source.contentHash,targetHash:target.contentHash,fullBeforeHash:hash(exportDossier(target)),fullAfterHash:hash(exportDossier(source)),characterId:view.characterId};
    const result=PreviewSchema.parse({...differences,previewToken:randomUUID(),expiresAt:now()+300000,diffHash:hash(JSON.stringify(differences))});
    db.prepare('INSERT INTO exchange_dossier_previews(token,principal_id,preview_json) VALUES(?,?,?)').run(result.previewToken,principalId,JSON.stringify(result));
    integrity.seal('exchange_dossier_previews','token=?',[result.previewToken]);
    // Explicit complete before/after permits actual review; these are researcher views.
    return {...result,before:target,after:source};
  }
  function apply(principalId:string,raw:unknown){
    const request=DossierImportApplyRequestSchema.parse(raw);
    integrity.verify('exchange_dossier_previews','token=? AND principal_id=?',[request.previewToken,principalId]);
    const row=db.prepare('SELECT preview_json FROM exchange_dossier_previews WHERE token=? AND principal_id=?').get(request.previewToken,principalId);
    if(!row)throw new Error('IMPORT_PREVIEW_NOT_FOUND');
    const p=PreviewSchema.parse(JSON.parse(z.strictObject({preview_json:z.string()}).parse(row).preview_json));
    if(request.importId!==undefined&&request.importId!==p.importId)throw new Error('IMPORT_PREVIEW_TARGET_MISMATCH');
    if(p.diffHash!==request.confirmDiffHash)throw new Error('IMPORT_DIFF_CONFIRMATION_REQUIRED');
    const prior=db.prepare('SELECT adaptation_json FROM exchange_dossier_adaptations WHERE import_id=? AND principal_id=?').get(p.importId,principalId);
    if(prior){integrity.verify('exchange_dossier_adaptations','import_id=? AND principal_id=?',[p.importId,principalId]);return DossierAdaptationImportSchema.parse(JSON.parse(z.strictObject({adaptation_json:z.string()}).parse(prior).adaptation_json));}
    if(p.expiresAt<=now())throw new Error('IMPORT_PREVIEW_EXPIRED');
    const current=DossierSchema.parse(input.getDossier(p.characterId));
    if(current.characterId!==p.characterId||current.contentHash!==p.targetHash||current.revision!==p.targetRevision||hash(exportDossier(current))!==p.fullBeforeHash)throw new Error('IMPORT_TARGET_DIVERGED');
    const source=z.strictObject({archive_json:z.string()}).parse(db.prepare('SELECT archive_json FROM exchange_dossier_imports WHERE import_id=?').get(p.importId));
    integrity.verify('exchange_dossier_imports','import_id=? AND principal_id=?',[p.importId,principalId]);
    if(hash(source.archive_json)!==p.fullAfterHash)throw new Error('IMPORT_SOURCE_DIVERGED');
    const adaptation=importDossier(source.archive_json);
    const view=get(principalId,p.importId);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO exchange_dossier_adaptations(import_id,principal_id,adaptation_json) VALUES(?,?,?)').run(p.importId,principalId,JSON.stringify(adaptation));
      integrity.seal('exchange_dossier_adaptations','import_id=?',[p.importId]);
      db.prepare('UPDATE exchange_dossier_imports SET view_json=? WHERE import_id=?').run(JSON.stringify({...view,revision:view.revision+1,state:'applied'}),p.importId);
      integrity.seal('exchange_dossier_imports','import_id=?',[p.importId]);
      db.exec('COMMIT');return adaptation;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function exportArchive(principalId:string,operationId:string,raw:unknown){
    const characterId=CharacterIdSchema.parse(raw);IdSchema.parse(operationId);
    const prior=db.prepare('SELECT export_id,character_id,archive_json FROM exchange_dossier_exports WHERE principal_id=? AND operation_id=?').get(principalId,operationId);
    if(prior){integrity.verify('exchange_dossier_exports','principal_id=? AND operation_id=?',[principalId,operationId]);const old=z.strictObject({export_id:z.string(),character_id:z.string(),archive_json:z.string()}).parse(prior);if(old.character_id!==characterId)throw new Error('EXPORT_IDEMPOTENCY_REUSE');return {exportId:old.export_id,sha256:hash(old.archive_json)};}
    const archive=exportDossier(input.getDossier(characterId));const exportId=randomUUID();db.prepare('INSERT INTO exchange_dossier_exports(export_id,principal_id,operation_id,character_id,archive_json) VALUES(?,?,?,?,?)').run(exportId,principalId,operationId,characterId,archive);integrity.seal('exchange_dossier_exports','export_id=?',[exportId]);return {exportId,sha256:hash(archive)};
  }
  function download(principalId:string,raw:unknown){
    integrity.verify('exchange_dossier_exports','export_id=? AND principal_id=?',[IdSchema.parse(raw),principalId]);
    const row=db.prepare('SELECT archive_json FROM exchange_dossier_exports WHERE export_id=? AND principal_id=?').get(IdSchema.parse(raw),principalId);
    if(!row)throw new Error('EXPORT_NOT_FOUND');const archive=z.strictObject({archive_json:z.string()}).parse(row).archive_json;
    return {bytes:Buffer.from(archive),sha256:hash(archive),filename:'personajes-dossier.json'};
  }
  return Object.freeze({quarantine,get,preview,apply,exportArchive,download,close:()=>db.close()});
}
