import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { exchangeIntegrity } from '../adapters/exchange-integrity.ts';
import { OperatorResponseSchema,type OperatorRequest,type OperatorResponse } from './operator-extension.ts';

function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 return JSON.stringify(value);
}
/** Shares the existing global operator receipt namespace. A sealed restore intent
 * can resume an interrupted dispatch, while a reused key cannot select a new one. */
export function openExternalRestoreOperations(input:{journalPath:string}) {
 const db=new DatabaseSync(input.journalPath);
 const integrity=exchangeIntegrity(db);
 const pending=new Map<string,Promise<OperatorResponse>>();
 return {close(){if(pending.size>0)throw new Error('RESTORE_OPERATIONS_ACTIVE');db.close();},async execute(request:OperatorRequest,dispatch:()=>Promise<OperatorResponse>):Promise<OperatorResponse>{
  if(request.kind==='read')return await dispatch();
  const hash=createHash('sha256').update(canonical({method:request.method,path:request.path,body:request.body})).digest('hex');
  const kind=request.path[2]==='restore-preview'?'restore-preview':'restore';
  const identity=JSON.stringify([request.principalId,request.idempotencyKey]);
  const raw=db.prepare('SELECT request_hash,response_json,operation_kind FROM exchange_http_operations WHERE principal_id=? AND operation_id=?').get(request.principalId,request.idempotencyKey);
  if(raw!==undefined){
   integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
   const old=z.strictObject({request_hash:z.string(),response_json:z.string().nullable(),operation_kind:z.string()}).parse(raw);
   if(old.request_hash!==hash||old.operation_kind!==kind)throw new Error('EXCHANGE_IDEMPOTENCY_REUSE');
   if(old.response_json!==null)return OperatorResponseSchema.parse(JSON.parse(old.response_json));
  }else{
   db.exec('BEGIN IMMEDIATE');
   try {
    db.prepare('INSERT INTO exchange_http_operations(principal_id,operation_id,request_hash,response_json,operation_kind) VALUES(?,?,?,NULL,?)').run(request.principalId,request.idempotencyKey,hash,kind);
    integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const active=pending.get(identity);if(active!==undefined)return await active;
  const work=Promise.resolve().then(async()=>{
    const response=await dispatch();
    // A stream is never a restore mutation's durable result.
    if(response.kind!=='json')throw new Error('RESTORE_RESPONSE_INVALID');
    db.exec('BEGIN IMMEDIATE');
    try {
     integrity.verify('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
     db.prepare('UPDATE exchange_http_operations SET response_json=? WHERE principal_id=? AND operation_id=?').run(JSON.stringify(response),request.principalId,request.idempotencyKey);
     integrity.seal('exchange_http_operations','principal_id=? AND operation_id=?',[request.principalId,request.idempotencyKey]);
     db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    // Dispatch may have durably admitted a fork before reporting a failure.
    // Keep its sealed NULL intent on any failure; only this same request may resume.
    return response;
  });
  pending.set(identity,work);
  try{return await work;}finally{if(pending.get(identity)===work)pending.delete(identity);}
 }};
}
