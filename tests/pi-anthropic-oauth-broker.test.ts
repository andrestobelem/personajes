import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openJournal} from '../src/adapters/journal.ts';
import {createPiOAuthPort} from '../src/application/pi-oauth.ts';
import {createPiOAuthJobs,oauthSessionScope} from '../src/application/pi-oauth-jobs.ts';
import {PiOAuthInteractionViewSchema} from '../src/domain/http.ts';
import {PiOAuthJobViewSchema} from '../src/domain/pi-oauth-jobs.ts';
type Runtime=Parameters<typeof createPiOAuthPort>[0]['modelRuntime'];
async function fixture(options:{badUrl?:boolean}={}){
 const directory=mkdtempSync(join(tmpdir(),'personajes-anthropic-oauth-'));const path=join(directory,'world.sqlite');const journal=openJournal({path});let configured=false;let observedResponse:string|undefined;let rejectOnAbort=false;
 const runtime:Runtime={async listCredentials(){return configured?[{providerId:'anthropic',type:'oauth'}]:[];},async logout(provider){assert.equal(provider,'anthropic');configured=false;},async login(provider,kind,interaction){assert.equal(provider,'anthropic');assert.equal(kind,'oauth');assert.equal(await interaction.prompt({type:'select',message:'Login',options:[{id:'browser',label:'Browser'},{id:'copy_code',label:'Copy'}]}),'copy_code');interaction.notify({type:'auth_url',url:options.badUrl?'https://attacker.invalid/oauth/authorize':'https://claude.ai/oauth/authorize?state=PRIVATE_STATE&code_challenge=PRIVATE_PKCE'});try{observedResponse=await interaction.prompt({type:'manual_code',message:'Paste',...(interaction.signal===undefined?{}:{signal:interaction.signal})});}catch(error){rejectOnAbort=true;throw error;}configured=true;return {type:'oauth',access:'PRIVATE_ACCESS',refresh:'PRIVATE_REFRESH',expires:Date.now()+3600000};}};
 const broker=await createPiOAuthJobs({journal,oauth:createPiOAuthPort({modelRuntime:runtime}),anthropicOAuth:createPiOAuthPort({modelRuntime:runtime,provider:'anthropic'}),ownerToken:randomUUID()});const scope=oauthSessionScope('one-browser');
 async function event(jobId:string){for(let attempt=0;attempt<200;attempt++){const value=await broker.readInteraction({jobId,sessionScope:scope,after:0});if(value.kind==='authorization-code')return PiOAuthInteractionViewSchema.parse(value);await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Challenge missing');}
 async function terminal(jobId:string){for(let attempt=0;attempt<200;attempt++){const value=await broker.readJob({jobId});if(value!==undefined&&['succeeded','failed','canceled'].includes(value.state))return value;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Job did not terminate');}
 return {broker,journal,directory,path,scope,event,terminal,get observedResponse(){return observedResponse;},get rejectOnAbort(){return rejectOnAbort;},async close(){await broker.close();journal.close();rmSync(directory,{recursive:true,force:true});}};
}
test('Anthropic login OAuth tiene desafío de sesión de un uso y no persiste valores de autenticación',async()=>{
 const f=await fixture();try{const start=await f.broker.startLogin({provider:'anthropic',idempotencyKey:randomUUID(),sessionScope:f.scope});assert.notEqual(start.kind,'idempotencyConflict');if(start.kind==='idempotencyConflict')throw new Error();assert.equal(start.job.provider,'anthropic');const event=await f.event(start.job.jobId);if(event.kind!=='authorization-code')throw new Error();const request={jobId:start.job.jobId,challengeId:event.challengeId,response:'PRIVATE_CODE#PRIVATE_STATE',sessionScope:f.scope};assert.deepEqual(await f.broker.respondInteraction({...request,sessionScope:oauthSessionScope('another-browser')}),{kind:'forbidden'});assert.deepEqual(await f.broker.respondInteraction({...request,challengeId:randomUUID()}),{kind:'stale'});assert.deepEqual(await f.broker.respondInteraction(request),{kind:'accepted'});assert.deepEqual(await f.broker.respondInteraction(request),{kind:'stale'});assert.equal((await f.terminal(start.job.jobId)).state,'succeeded');assert.equal(f.observedResponse,request.response);assert.equal((await f.broker.status({provider:'anthropic'})).kind,'status');
 const stored=f.journal.listPiOAuthJobs({principalId:'local-operator',limit:1000});assert.equal(JSON.stringify(stored).includes('PRIVATE_'),false);const bytes=readFileSync(f.path);for(const secret of ['PRIVATE_CODE','PRIVATE_STATE','PRIVATE_ACCESS','PRIVATE_REFRESH','PRIVATE_PKCE'])assert.equal(bytes.includes(Buffer.from(secret)),false,secret);
 }finally{await f.close();}
});
test('Anthropic OAuth cancelación aborta prompt pendiente y elimina desafío',async()=>{
 const f=await fixture();try{const start=await f.broker.startLogin({provider:'anthropic',idempotencyKey:randomUUID(),sessionScope:f.scope});if(start.kind==='idempotencyConflict')throw new Error();const event=await f.event(start.job.jobId);if(event.kind!=='authorization-code')throw new Error();const current=PiOAuthJobViewSchema.parse(f.journal.readPiOAuthJob({jobId:start.job.jobId}));await f.broker.cancelJob({jobId:start.job.jobId,idempotencyKey:randomUUID(),expectedRevision:current.revision});assert.equal((await f.terminal(start.job.jobId)).state,'canceled');assert.equal(f.rejectOnAbort,true);assert.deepEqual(await f.broker.respondInteraction({jobId:start.job.jobId,challengeId:event.challengeId,response:'PRIVATE_LATE',sessionScope:f.scope}),{kind:'stale'});
 }finally{await f.close();}
});
test('Anthropic OAuth rechaza URL fuera del proveedor sin publicar enlace',async()=>{
 const f=await fixture({badUrl:true});try{const start=await f.broker.startLogin({provider:'anthropic',idempotencyKey:randomUUID(),sessionScope:f.scope});if(start.kind==='idempotencyConflict')throw new Error();const job=await f.terminal(start.job.jobId);assert.equal(job.state,'failed');assert.equal(job.safeCode,'OAUTH_CALLBACK_FAILED');assert.deepEqual(await f.broker.readInteraction({jobId:start.job.jobId,sessionScope:f.scope,after:0}),{kind:'waiting',cursor:0});
 }finally{await f.close();}
});
