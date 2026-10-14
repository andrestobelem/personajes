import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
const tables=z.enum(['exchange_dossier_imports','exchange_dossier_previews','exchange_dossier_adaptations','exchange_dossier_exports','exchange_http_operations','backup_jobs','backup_restore_previews']);
const scalar=z.union([z.string(),z.number(),z.null()]);
const rowSchema=z.record(z.string(),scalar);
function digestRow(raw:unknown){
 const row=rowSchema.parse(raw);
 const values=Object.entries(row).filter(([key])=>key!=='integrity_hash').sort(([a],[b])=>a.localeCompare(b));
 return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
/** Digest includes every durable field, including principal and resource/operation IDs.
 * Legacy/unsealed metadata fails closed. This detects corruption, not a malicious writer
 * able to change both payload and its checksum; filesystem ownership remains required. */
export function exchangeIntegrity(database:DatabaseSync){
 function migrate(table:unknown){const name=tables.parse(table);const columns=database.prepare(`PRAGMA table_info(${name})`).all().map(row=>z.object({name:z.string()}).parse(row).name);if(!columns.includes('integrity_hash'))database.exec(`ALTER TABLE ${name} ADD COLUMN integrity_hash TEXT`);}
 function seal(table:unknown,where:string,values:string[]){const name=tables.parse(table);const row=database.prepare(`SELECT * FROM ${name} WHERE ${where}`).get(...values);if(!row)throw new Error('EXCHANGE_METADATA_MISSING');database.prepare(`UPDATE ${name} SET integrity_hash=? WHERE ${where}`).run(digestRow(row),...values);}
 function verify(table:unknown,where:string,values:string[]){const name=tables.parse(table);const raw=database.prepare(`SELECT * FROM ${name} WHERE ${where}`).get(...values);if(!raw)return;const row=rowSchema.parse(raw);if(typeof row.integrity_hash!=='string'||digestRow(row)!==row.integrity_hash)throw new Error('EXCHANGE_METADATA_TAMPERED');}
 return {migrate,seal,verify};
}
