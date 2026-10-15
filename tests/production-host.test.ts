import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {loadCatalog} from '../src/adapters/catalog.ts';
import {withHostDirectoryOperation} from '../src/adapters/host-ownership.ts';
import {openLocalHost} from '../src/application/local-host.ts';
import {createHostRequestBarrier} from '../src/application/host-request-barrier.ts';
import {createProductionHost} from '../src/server/production-host.ts';

const binaryPath=process.env.PERSONAJES_ICM_TEST_BINARY;
for(const mode of ['mechanical','representation'] as const)test(`production host can close and recompose ${mode} services within the directory operation without implicit work`,{skip:mode==='representation'&&binaryPath===undefined?'ICM real no configurado':false},async()=>{
 const root=mkdtempSync(join(tmpdir(),'personajes-production-host-'));const catalog=await loadCatalog({repositoryRoot:process.cwd()});
 const first=await createProductionHost({host:openLocalHost({privateDataRoot:root}),catalog,admissionBarrier:createHostRequestBarrier(),...(mode==='representation'&&binaryPath!==undefined?{icmBinaryPath:binaryPath}:{})});
 try{
  assert.equal(first.httpOptions.runtimeComposition().kind,mode==='representation'?'composed':'unavailable');
  await first.recover();
  const next=await withHostDirectoryOperation({privateDataRoot:root,operation:async directoryOperation=>{
   await first.close({directoryOperation});
   return await createProductionHost({host:openLocalHost({privateDataRoot:root,directoryOperation}),catalog,admissionBarrier:createHostRequestBarrier(),directoryOperation,...(mode==='representation'&&binaryPath!==undefined?{icmBinaryPath:binaryPath}:{})});
  }});
  try{await next.recover();assert.equal(next.httpOptions.runtimeComposition().kind,mode==='representation'?'composed':'unavailable');}
  finally{await next.close();} // The directory-operation capability has expired.

  const db=new DatabaseSync(join(root,'world.sqlite'),{readOnly:true});try{
   for(const table of ['world_runs','actor_pi_sessions','actor_turn_jobs','request_reservations','fork_jobs','pi_oauth_jobs','pi_access_jobs'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0,table);
  }finally{db.close();}
 }finally{await first.close();rmSync(root,{recursive:true,force:true});rmSync(root+'-auth',{recursive:true,force:true});}
});
