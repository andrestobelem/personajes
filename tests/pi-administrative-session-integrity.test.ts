import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { verifyPiSessionCheckpointChain,readPiSessionCheckpointPrefix } from '../src/adapters/pi-session-integrity.ts';

function fixture(){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'personajes-admin-chain-')));const runId=randomUUID();const role='continuista' as const;
  const identity=join(root,'runs',runId,'roles',role);const cwd=join(identity,'cwd');const sessions=join(identity,'sessions');mkdirSync(cwd,{recursive:true,mode:0o700});mkdirSync(sessions,{mode:0o700});
  const sessionId=randomUUID();const timestamp='2026-10-14T12:00:00.000Z';const baseLeafId='base';const inputLeafId='input';const terminalLeafId='terminal';const sessionPath=join(sessions,'session.jsonl');
  const rows:Array<Record<string,unknown>>=[{type:'session',version:CURRENT_SESSION_VERSION,id:sessionId,timestamp,cwd},
    {type:'message',id:baseLeafId,parentId:null,timestamp,message:{role:'user',content:'Base autorizada',timestamp:1}},
    {type:'message',id:inputLeafId,parentId:baseLeafId,timestamp,message:{role:'user',content:'Propuesta exacta para revisar',timestamp:2}},
    {type:'message',id:terminalLeafId,parentId:inputLeafId,timestamp,message:{role:'assistant',content:[{type:'text',text:'Terminal sintético'}],timestamp:3,api:'openai-codex-responses',provider:'openai-codex',model:'gpt-6.1-sol',usage:{},stopReason:'stop'}}];
  const save=()=>writeFileSync(sessionPath,rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});save();
  return {root,rows,save,input:{privateDataRoot:root,runId,role,sessionId,sessionPath,baseLeafId,inputLeafId,terminalLeafId},cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('administrative JSONL proof freezes exact prefixes while preserving valid append-only history',()=>{
  const f=fixture();try{const proof=verifyPiSessionCheckpointChain(f.input);assert.equal(proof.kind,'verified');if(proof.kind!=='verified')assert.fail('No proof');
    const {baseLeafId:_base,inputLeafId:_input,terminalLeafId:_terminal,...identity}=f.input;
    const prefix=readPiSessionCheckpointPrefix({...identity,leafId:'input'});assert.equal(prefix.kind,'verified');if(prefix.kind!=='verified')assert.fail('No frozen prefix');assert.equal(prefix.prefixHash,proof.inputPrefixHash);
    f.rows.push({type:'label',id:'later',parentId:'terminal',timestamp:'2026-10-14T12:00:01.000Z',targetId:'terminal',label:'Historial posterior'});f.save();
    const appended=verifyPiSessionCheckpointChain({...f.input,expectedInputPrefixHash:proof.inputPrefixHash,expectedTerminalPrefixHash:proof.terminalPrefixHash});assert.equal(appended.kind,'verified');if(appended.kind!=='verified')assert.fail('Append lost proof');assert.notEqual(appended.fileHash,proof.fileHash);
    const row=f.rows[2];assert.ok(row);row.message={role:'user',content:'Propuesta sustituida conservando los IDs',timestamp:2};f.save();
    assert.deepEqual(verifyPiSessionCheckpointChain({...f.input,expectedInputPrefixHash:proof.inputPrefixHash}),{kind:'invalid',code:'session-content-hash'});
  }finally{f.cleanup();}
});
test('administrative chain rejects another branch, another session, another role and symlink file',()=>{
  const f=fixture();try{
    const terminal=f.rows[3];assert.ok(terminal);terminal.parentId='base';f.save();assert.deepEqual(verifyPiSessionCheckpointChain(f.input),{kind:'invalid',code:'session-chain'});
    terminal.parentId='input';f.save();assert.deepEqual(verifyPiSessionCheckpointChain({...f.input,sessionId:randomUUID()}),{kind:'invalid',code:'session-header'});
    assert.equal(verifyPiSessionCheckpointChain({...f.input,role:'narrator'}).kind,'invalid');
    const alias=join(f.root,'session-alias.jsonl');symlinkSync(f.input.sessionPath,alias);assert.deepEqual(verifyPiSessionCheckpointChain({...f.input,sessionPath:alias}),{kind:'invalid',code:'session-path'});
  }finally{f.cleanup();}
});
test('administrative JSONL rejects missing ancestry, duplicate IDs, partial records and oversized entries',()=>{
  const f=fixture();try{
    const input=f.rows[2];assert.ok(input);input.parentId='missing';f.save();assert.deepEqual(verifyPiSessionCheckpointChain(f.input),{kind:'invalid',code:'session-chain'});
    input.parentId='base';f.rows.push({...input});f.save();assert.deepEqual(verifyPiSessionCheckpointChain(f.input),{kind:'invalid',code:'session-chain'});f.rows.pop();
    writeFileSync(f.input.sessionPath,f.rows.map(row=>JSON.stringify(row)).join('\n'));assert.equal(verifyPiSessionCheckpointChain(f.input).kind,'invalid');
    input.message={role:'user',content:'x'.repeat(2*1024*1024+1),timestamp:2};f.save();assert.deepEqual(verifyPiSessionCheckpointChain(f.input),{kind:'invalid',code:'session-size'});
  }finally{f.cleanup();}
});
