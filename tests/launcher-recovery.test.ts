import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {z} from 'zod';
import {HostRecoveryJobSchema,HostRecoveryOwnershipSchema} from '../src/domain/host-recovery.ts';
import {SessionCreatedSchema,ApiProblemSchema} from '../src/domain/http.ts';

const options={skip:!existsSync('dist/index.html')?'Ejecutar npm run build para verificar el launcher real.':false};
const readySchema=z.strictObject({kind:z.literal('serverReady'),origin:z.string().url(),representation:z.literal('host-recovery-pending')});
const fixtureSchema=z.strictObject({operationId:z.uuid(),backupId:z.uuid()});

function crashScript(root:string,phase:string,output:string){return `
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {loadCatalog} from './src/adapters/catalog.ts';
import {openLocalHost} from './src/application/local-host.ts';
import {createProductionHost} from './src/server/production-host.ts';
import {createHostRequestBarrier} from './src/application/host-request-barrier.ts';
import {createHostRecoveryOperation} from './src/application/host-recovery-operation.ts';
import {assessHostRecovery,applyHostRecoveryPreservation} from './src/application/host-recovery-assessment.ts';
const root=${JSON.stringify(root)};
const catalog=await loadCatalog({repositoryRoot:process.cwd()});
const admissionBarrier=createHostRequestBarrier();
let production=await createProductionHost({host:openLocalHost({privateDataRoot:root}),catalog,admissionBarrier});
const backupId=randomUUID();const job=await production.exchange.backups.create({backupId,scope:{kind:'all'}});
if(job.state!=='succeeded')throw new Error('FIXTURE_BACKUP_FAILED');
const bundle=production.exchange.backups.verify(backupId);
const assessment=assessHostRecovery({privateDataRoot:root,...bundle,manifestHash:bundle.hash});
if(assessment.kind!=='compatible')throw new Error(assessment.code);
const operation=createHostRecoveryOperation({privateDataRoot:root,
 async close({gate}){await production.close({directoryOperation:gate});},
 prepare({stageRoot}){applyHostRecoveryPreservation({stageRoot,plan:assessment.preserve});},
 async reopen({gate}){production=await createProductionHost({host:openLocalHost({privateDataRoot:root,directoryOperation:gate}),catalog,admissionBarrier,directoryOperation:gate});},
 verify(){},
 failpoint(point){if(point===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');},
});
const operationId=randomUUID();await operation.begin({operationId,principalId:'local-operator',backupId,manifest:bundle.manifest,manifestHash:bundle.hash,targetFingerprint:assessment.fingerprint,confirmDiffHash:'d'.repeat(64),bundleRoot:bundle.bundleRoot});
writeFileSync(${JSON.stringify(output)},JSON.stringify({operationId,backupId}));
await operation.execute({operationId,principalId:'local-operator'});
throw new Error('FIXTURE_DID_NOT_CRASH');
`;}

for(const phase of ['afterOriginalRename','afterReopen'])test(`launcher restarts the offline control plane after SIGKILL at ${phase} without opening or recreating the canonical host`,{...options,timeout:30_000},async(t)=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-launcher-recovery-'));const root=join(directory,'host');const fixturePath=join(directory,'fixture.json');
 const fixtureChild=spawn(process.execPath,['--import','tsx','--input-type=module','-e',crashScript(root,phase,fixturePath)],{env:process.env,stdio:['ignore','pipe','pipe']});
 let fixtureErrors='';fixtureChild.stderr.on('data',(chunk:Buffer)=>{fixtureErrors+=chunk.toString();});
 const fixtureTimeout=setTimeout(()=>fixtureChild.kill('SIGKILL'),15_000);const [fixtureCode,fixtureSignal]=await once(fixtureChild,'exit');clearTimeout(fixtureTimeout);
 assert.equal(fixtureCode,null,fixtureErrors);assert.equal(fixtureSignal,'SIGKILL',fixtureErrors);assert.ok(existsSync(fixturePath),fixtureErrors);
 const fixture=fixtureSchema.parse(JSON.parse(readFileSync(fixturePath,'utf8')));const rootExists=existsSync(root);assert.equal(rootExists,phase==='afterReopen');
 const originalJournal=rootExists?readFileSync(join(root,'world.sqlite')):undefined;
 const originalOwnership=rootExists?readFileSync(join(root,'host-ownership.json')):undefined;
 const env:NodeJS.ProcessEnv={...process.env,PERSONAJES_PRIVATE_DATA_ROOT:root,PERSONAJES_PORT:'0'};delete env.PERSONAJES_ICM_BINARY;
 const child=spawn(process.execPath,['--import','tsx','src/server/index.ts'],{env,stdio:['ignore','pipe','pipe']});const exit=once(child,'exit');let stderr='';child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;rmSync(directory,{recursive:true,force:true});});
 const ready=await new Promise<z.infer<typeof readySchema>>((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(new Error('CONTROL_PLANE_START_TIMEOUT: '+stderr)),15_000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('CONTROL_PLANE_EXIT: '+stderr));});
  child.stdout.on('data',(chunk:Buffer)=>{output+=chunk.toString();for(const line of output.split('\n').slice(0,-1)){try{const parsed=readySchema.safeParse(JSON.parse(line));if(parsed.success){clearTimeout(timer);resolve(parsed.data);return;}}catch{/* Structured partial output only. */}}});
 });
 assert.equal(existsSync(root),rootExists,'the launcher must not create the missing root or open the installed one before resume');
 if(rootExists){assert.deepEqual(readFileSync(join(root,'world.sqlite')),originalJournal);assert.deepEqual(readFileSync(join(root,'host-ownership.json')),originalOwnership);}
 const security={Origin:ready.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
 async function authenticate(){
  const page=await fetch(ready.origin+'/',{headers:security});assert.equal(page.status,200);const bootNonce=(await page.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(bootNonce);
  const response=await fetch(ready.origin+'/api/v1/session',{method:'POST',headers:security,body:JSON.stringify({bootNonce})});assert.equal(response.status,200);const session=SessionCreatedSchema.parse(await response.json());const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return {...security,Cookie:cookie,'X-CSRF-Token':session.csrfToken};
 }
 let headers=await authenticate();
 const path=`/api/v1/host-recoveries/${fixture.operationId}`;assert.equal((await fetch(ready.origin+path)).status,401);const poll=await fetch(ready.origin+path,{headers});assert.equal(poll.status,200,await poll.clone().text());const job=HostRecoveryJobSchema.parse(await poll.json());assert.equal(job.operationId,fixture.operationId);assert.notEqual(job.state,'succeeded');
 for(const blocked of ['/api/v1/health',`/api/v1/backups/${fixture.backupId}`,'/api/v1/runs']){const response=await fetch(ready.origin+blocked,{headers});assert.equal(response.status,503);assert.equal(ApiProblemSchema.parse(await response.json()).error.code,'HOST_RECOVERY_IN_PROGRESS');}
 assert.equal(existsSync(root),rootExists);if(rootExists)assert.deepEqual(readFileSync(join(root,'world.sqlite')),originalJournal);
 const ownershipResponse=await fetch(ready.origin+path+'/ownership',{headers});assert.equal(ownershipResponse.status,200,await ownershipResponse.clone().text());const ownership=HostRecoveryOwnershipSchema.parse(await ownershipResponse.json());assert.equal(ownership.directoryOperation.kind,'present','SIGKILL leaves a stale external operation gate');
 const resumeHeaders={...headers,'Idempotency-Key':randomUUID(),'If-Match':poll.headers.get('etag')??''};
 const withoutNonce=await fetch(ready.origin+path+'/resume',{method:'POST',headers:resumeHeaders,body:'{}'});assert.equal(withoutNonce.status,409,'releasing a stale gate requires its observed nonce');
 const resume=await fetch(ready.origin+path+'/resume',{method:'POST',headers:{...resumeHeaders,'Idempotency-Key':randomUUID()},body:JSON.stringify(ownership.directoryOperation.kind==='present'?{expectedDirectoryOperationNonce:ownership.directoryOperation.nonce}:{})});assert.equal(resume.status,202,await resume.clone().text());let current=HostRecoveryJobSchema.parse(await resume.json());
 const deadline=Date.now()+15_000;while(current.state!=='succeeded'){
  assert.ok(Date.now()<deadline,JSON.stringify({current,stderr}));let response=await fetch(ready.origin+path,{headers});if(response.status===401){headers=await authenticate();response=await fetch(ready.origin+path,{headers});}
  assert.equal(response.status,200,await response.clone().text());current=HostRecoveryJobSchema.parse(await response.json());assert.notEqual(current.state,'failed',JSON.stringify({current,stderr}));assert.notEqual(current.state,'interrupted',JSON.stringify({current,stderr}));
  if(current.state!=='succeeded')await new Promise<void>(done=>setTimeout(done,10));
 }
 assert.equal(current.phase,'verified');assert.equal(existsSync(root),true);assert.equal((await fetch(ready.origin+'/api/v1/health',{headers})).status,200);
 assert.equal((await fetch(ready.origin+`/api/v1/backups/${fixture.backupId}`,{headers})).status,200,'reopened services read the recovered journal');
 child.kill('SIGTERM');const stopTimeout=setTimeout(()=>child.kill('SIGKILL'),10_000);const [code,signal]=await exit;clearTimeout(stopTimeout);assert.equal(signal,null,stderr);assert.equal(code,0,stderr);
 assert.equal(existsSync(root),true);
});
