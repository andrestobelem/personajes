import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { createNarrationObservation } from '../src/application/narration-observation.ts';
import { createNarratorPiWorker } from '../src/application/narrator-pi-worker.ts';
import { createNarrationRoutes } from '../src/server/narration-routes.ts';
import { createLocalHttpServer } from '../src/server/http.ts';
import { SessionCreatedSchema } from '../src/domain/http.ts';
import { PublicNarrationPageSchema } from '../src/domain/narration-observation.ts';
import { fixture,fixtureReviewer } from './fixtures/narrator-run.ts';
import { controlledNarratorSessionFactory } from './fixtures/narrator-session.ts';

async function publishedFixture() {
  const f=await fixture();const stats={requests:0,disposed:0};
  const worker=createNarratorPiWorker({journal:f.journal,runtime:f.runtime,ownerToken:randomUUID(),reviewer:fixtureReviewer(f),sessionFactory:controlledNarratorSessionFactory({root:f.directory,physicalSessions:true,stats})});
  try {const result=await worker.run({runId:f.runId,pulseId:f.pulseId});assert.equal(result.kind,'published');if(result.kind!=='published'||result.receipt.kind!=='published')assert.fail('Missing synthetic durable publication');return {...f,stats,publication:result.receipt.publication};}
  catch(error){f.close();throw error;}
}

test('public narration exposes accepted offstage text only, respects historical revision and reads without reinference or world mutation',async()=>{
  const f=await publishedFixture();
  try {
    const app=createNarrationObservation({journal:f.journal});const world=f.journal.loadWorld({runId:f.runId});assert.ok(world);
    const beforeBudget=f.journal.readRunModelTimeBudget({runId:f.runId});const requests=f.stats.requests;
    const current=app.read({runId:f.runId});assert.equal(current.kind,'found');if(current.kind!=='found')assert.fail('No current page');
    assert.equal(current.page.items.length,1);assert.equal(current.page.items[0]?.publicationId,f.publication.publicationId);assert.equal(current.page.items[0]?.text,f.publication.text);
    assert.doesNotMatch(JSON.stringify(current.page),/contextHash|proposalHash|reviewEvidenceId|candidateHash|sessionPath|lease|ownerToken|claimToken|recordedWorldFacts|sourceRecordedFactIds|thinking|reasoning/);
    const initial=f.journal.readInspectorWorldCut({runId:f.runId,atWorldSeq:world.seq-1});assert.ok(initial);
    const past=app.read({runId:f.runId,atWorldSeq:initial.snapshot.seq,worldRevision:initial.snapshot.revision});assert.equal(past.kind,'found');if(past.kind!=='found')assert.fail('No past page');assert.equal(past.page.items.length,0);
    assert.equal(app.read({runId:f.runId,atWorldSeq:world.seq+1}).kind,'missing-or-invalid-cut');
    assert.equal(app.read({runId:f.runId,atWorldSeq:world.seq,worldRevision:world.revision+1}).kind,'missing-or-invalid-cut');
    assert.equal(f.stats.requests,requests);assert.deepEqual(f.journal.readRunModelTimeBudget({runId:f.runId}),beforeBudget);assert.deepEqual(f.journal.loadWorld({runId:f.runId}),world);
  }finally{f.close();}
});

test('public narration cursor is bounded and bound to run and exact cut; matching keyset cursor advances without replay',async()=>{
  const f=await publishedFixture();
  try {
    const app=createNarrationObservation({journal:f.journal});const world=f.journal.loadWorld({runId:f.runId});assert.ok(world);
    const cursor=(overrides:Record<string,unknown>={})=>'nv1.'+Buffer.from(JSON.stringify({version:1,runId:f.runId,worldSeq:world.seq,worldRevision:world.revision,publishedAt:f.publication.publishedAt,publicationId:f.publication.publicationId,...overrides})).toString('base64url');
    const after=app.read({runId:f.runId,atWorldSeq:world.seq,worldRevision:world.revision,cursor:cursor(),limit:1});assert.equal(after.kind,'found');if(after.kind!=='found')assert.fail('Cursor not accepted');assert.equal(after.page.items.length,0);assert.equal(after.page.nextCursor,null);
    for(const value of ['garbage',cursor({runId:randomUUID()}),cursor({worldRevision:world.revision-1}),cursor({worldSeq:world.seq-1}),cursor({token:'private'}),'nv1.!!!!'])assert.equal(app.read({runId:f.runId,cursor:value}).kind,'invalid-cursor');
    assert.throws(()=>app.read({runId:f.runId,limit:101}));
  }finally{f.close();}
});

test('application continuation cursor contains only exact public cut and ordering key, and passes bounded keyset to reader',async()=>{
  const f=await publishedFixture();
  try {
    const world=f.journal.loadWorld({runId:f.runId});assert.ok(world);
    const stored=f.journal.readNarrationPublicationPage({runId:f.runId,throughWorldSeq:world.seq,throughWorldRevision:world.revision,limit:1});assert.ok(stored);assert.equal(stored.items.length,1);
    const reads:unknown[]=[];
    // Exercise continuation mechanics with an explicit controlled page boundary;
    // its item remains the real accepted receipt from this SQLite fixture.
    const app=createNarrationObservation({journal:{readInspectorWorldCut:f.journal.readInspectorWorldCut,readNarrationPublicationPage:raw=>{reads.push(raw);assert.ok(typeof raw==='object'&&raw!==null);return 'afterPublicationId'in raw?{items:[],hasMore:false}:{items:stored.items,hasMore:true};}}});
    const first=app.read({runId:f.runId,limit:1});assert.equal(first.kind,'found');if(first.kind!=='found')assert.fail('Missing page');assert.ok(first.page.nextCursor);
    const payload=JSON.parse(Buffer.from(first.page.nextCursor.slice(4),'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(payload).sort(),['version','runId','worldSeq','worldRevision','publishedAt','publicationId'].sort());
    const next=app.read({runId:f.runId,atWorldSeq:world.seq,worldRevision:world.revision,limit:1,cursor:first.page.nextCursor});assert.equal(next.kind,'found');
    assert.deepEqual(reads[1],{runId:f.runId,throughWorldSeq:world.seq,throughWorldRevision:world.revision,limit:1,afterPublishedAt:f.publication.publishedAt,afterPublicationId:f.publication.publicationId});
  }finally{f.close();}
});

test('narration HTTP reads require local authentication and reject unknown, duplicated or invalid query fields',async(t)=>{
  const f=await publishedFixture();t.after(()=>f.close());
  const server=createLocalHttpServer({catalog:await loadCatalog({repositoryRoot:process.cwd()}),shellHtml:'<html><head></head><body></body></html>',operatorExtensions:[createNarrationRoutes(createNarrationObservation({journal:f.journal}))]});t.after(()=>server.close());
  const {origin}=await server.listen();const originHeaders={Origin:origin,'Sec-Fetch-Site':'same-origin'};const path=`${origin}/api/v1/runs/${f.runId}/narrations`;
  assert.equal((await fetch(path,{headers:originHeaders})).status,401);
  const shell=await fetch(origin+'/',{headers:originHeaders});const nonce=(await shell.text()).match(/name="personajes-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1];assert.ok(nonce);
  const login=await fetch(origin+'/api/v1/session',{method:'POST',headers:{...originHeaders,'Content-Type':'application/json'},body:JSON.stringify({bootNonce:nonce})});const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);SessionCreatedSchema.parse(await login.json());
  const headers={...originHeaders,Cookie:cookie};const response=await fetch(path,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const page=PublicNarrationPageSchema.parse(await response.json());assert.equal(page.items[0]?.text,f.publication.text);
  for(const query of ['?private=true','?limit=1&limit=2','?limit=0','?limit=101','?atWorldSeq=-1','?worldRevision=9007199254740992','?cursor=invalid'])assert.equal((await fetch(path+query,{headers})).status,422);
});
