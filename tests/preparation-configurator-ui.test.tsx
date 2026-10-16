import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { PreparationConfiguratorPanel } from '../src/web/PreparationConfiguratorPanel.tsx';
import { PreparationConfiguratorApplyReceiptSchema, type PreparationConfiguratorApplyIntent, PreparationConfiguratorChoicesSchema, PreparationConfiguratorPublicJobSchema, PreparationConfiguratorPublicReviewSchema, type PreparationConfiguratorIntent } from '../src/domain/preparation-configurator-http.ts';
import { RunConfigurationDraftViewSchema } from '../src/domain/http.ts';
import { createEmptyRunConfigurationDraft } from '../src/domain/production.ts';
import type { PreparationConfiguratorClient } from '../src/web/preparation-configurator-client.ts';
import { HOST_SESSION_RESET_EVENT } from '../src/web/host-session-reset.ts';
function defineGlobal(name: string, value: unknown) { const prior = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); return () => { if (prior === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, prior); }; }
const runId = randomUUID(); const jobId = randomUUID(); const hash = 'a'.repeat(64);
const document = { view: RunConfigurationDraftViewSchema.parse({ kind: 'run-configuration-draft', configuration: createEmptyRunConfigurationDraft({ runId, revision: 0 }), state: { lifecycle: 'draft', configurationRevision: 0, worldRevision: null }, validation: { kind: 'valid', promotion: 'not-promoted' } }), etag: `"run-config:${runId}:c0"` };
const choices = PreparationConfiguratorChoicesSchema.parse({ kind: 'preparation-configurator-choices', runId, draftRevision: 0, draftHash: hash, actorSources: [{ label: 'Max expediente', reference: { kind: 'catalog-original', characterId: 'maxwell-smart', revision: 1, contentHash: hash, fullArchiveHash: hash } }], documents: [{ sourceId: 'investigacion-metodo', label: 'Actuación del Método', fullHash: hash }] });
const queued = PreparationConfiguratorPublicJobSchema.parse({ kind: 'preparation-configurator-job', scope: { runId, jobId, generation: 0, draftRevision: 0, draftHash: hash, contextHash: hash }, revision: 0, state: 'queued', failureCode: null, createdAt: 1, updatedAt: 1 });
const accepted = PreparationConfiguratorPublicJobSchema.parse({ ...queued, revision: 2, state: 'accepted' });
const review = PreparationConfiguratorPublicReviewSchema.parse({ kind: 'preparation-configurator-review', job: accepted, candidateId: randomUUID(), proposalHash: hash, proposal: { kind: 'preparation-configurator-proposal', schemaVersion: 1, contextHash: hash, settings: [{ section: 'name', value: 'El cono del silencio', reason: 'Conflicto operativo', sourceRefs: ['investigacion-metodo'], treatment: 'declared-adaptation', unknowns: ['Fecha exacta pendiente'] }], actors: [], placements: [], openQuestions: ['¿Qué sabe Max?'] } });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function setup() { const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true }); const restores = [defineGlobal('window', dom.window), defineGlobal('document', dom.window.document), defineGlobal('navigator', dom.window.navigator), defineGlobal('HTMLElement', dom.window.HTMLElement), defineGlobal('Node', dom.window.Node), defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)]; const { createRoot } = await import('react-dom/client'); const element = dom.window.document.getElementById('root'); assert.ok(element); const root = createRoot(element); return { dom, root, element, async close() { await act(async () => root.unmount()); for (const restore of restores.reverse()) restore(); dom.window.close(); } }; }

test('mounted preparation registers without inference, starts explicitly, reviews unchecked differences and applies selected only', async () => {
  const f = await setup(); const intents: PreparationConfiguratorIntent[] = []; const applications: PreparationConfiguratorApplyIntent[] = []; let started = false; let reloads = 0;
  const api: PreparationConfiguratorClient = { async choices() { return choices; }, async list() { return { kind: 'preparation-configurator-jobs', runId: choices.runId, items: [], hasMore: false }; }, async execute(intent) { intents.push(intent); if (intent.kind === 'start') started = true; return started ? accepted : queued; }, async read() { return started ? accepted : queued; }, async review() { return review; }, async apply(input) { applications.push(input); return PreparationConfiguratorApplyReceiptSchema.parse({ kind: 'preparation-configurator-applied', jobId, runId, candidateId: input.body.candidateId, proposalHash: input.body.proposalHash, baseDraftRevision: 0, baseDraftHash: hash, draftRevision: 1, draftHash: 'b'.repeat(64), selectionHash: hash }); } };
  try {
    await act(async () => f.root.render(<PreparationConfiguratorPanel document={document} api={api} onApplied={() => { ++reloads; }} />)); await settle(); assert.equal(intents.length, 0); assert.equal(f.element.querySelectorAll('input:checked').length, 0);
    const textarea = f.element.querySelector('textarea'); assert.ok(textarea); const setter = Object.getOwnPropertyDescriptor(f.dom.window.HTMLTextAreaElement.prototype, 'value')?.set; assert.ok(setter); await act(async () => { setter.call(textarea, 'Preparar una comedia de espionaje'); textarea.dispatchEvent(new f.dom.window.Event('input', { bubbles: true })); });
    function button(text: string) { const node = [...f.element.querySelectorAll('button')].find(value => value.textContent === text); assert.ok(node); return node; }
    await act(async () => button('Registrar propuesta sin iniciar inferencia').click()); await settle(); assert.equal(intents.length, 1); assert.equal(intents[0]?.kind, 'create'); assert.equal(started, false);
    await act(async () => button('Iniciar propuesta con el modelo').click()); await settle(); await settle(); assert.equal(intents.length, 2); assert.equal(started, true); assert.match(f.element.textContent ?? '', /Conflicto operativo/); assert.match(f.element.textContent ?? '', /Adaptación declarada/); assert.match(f.element.textContent ?? '', /Fecha exacta pendiente/); assert.match(f.element.textContent ?? '', /investigacion-metodo/); assert.match(f.element.textContent ?? '', /Actual/); assert.match(f.element.textContent ?? '', /Propuesta/);
    assert.equal(f.element.querySelectorAll('input:checked').length, 0); assert.equal(button('Aplicar únicamente cambios seleccionados').disabled, true); const select = [...f.element.querySelectorAll('article input[type="checkbox"]')][0]; assert.ok(select); await act(async () => select.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true }))); await act(async () => button('Aplicar únicamente cambios seleccionados').click()); await settle(); assert.equal(applications.length, 1); assert.deepEqual(applications[0]?.body.selection, { settings: ['name'], actors: [], placements: [] }); assert.equal(reloads, 1);
  } finally { await f.close(); }
});

test('session revocation clears proposal and selections and aborts in-flight operation without stale disclosure', async () => {
  const f = await setup(); let signal: AbortSignal | undefined; let complete: ((value: typeof choices) => void) | undefined; let writes = 0;
  const api: PreparationConfiguratorClient = { async choices(_runId, input) { signal = input; return await new Promise(resolve => { complete = resolve; }); }, async list() { return { kind: 'preparation-configurator-jobs', runId: choices.runId, items: [], hasMore: false }; }, async execute() { ++writes; return queued; }, async read() { return queued; }, async review() { return review; }, async apply() { throw new Error('unused'); } };
  try { await act(async () => f.root.render(<PreparationConfiguratorPanel document={document} api={api} onApplied={() => {}} />)); await settle(); assert.ok(signal); await act(async () => f.dom.window.dispatchEvent(new f.dom.window.Event(HOST_SESSION_RESET_EVENT))); assert.ok(complete); await act(async () => complete?.(choices)); await settle(); assert.match(f.element.textContent ?? '', /sesión del host cambió/); assert.doesNotMatch(f.element.textContent ?? '', /Max expediente|El cono del silencio/); assert.equal(writes, 0); }
  finally { await f.close(); assert.equal(signal?.aborted, true); }
});

test('uncertain create retry preserves key instructions and source cut despite local edits', async () => {
  const f = await setup(); const intents: PreparationConfiguratorIntent[] = [];
  const api: PreparationConfiguratorClient = { async choices() { return choices; }, async list() { return { kind: 'preparation-configurator-jobs', runId: choices.runId, items: [], hasMore: false }; }, async execute(intent) { intents.push(structuredClone(intent)); if (intents.length === 1) throw new Error('/PRIVATE_SESSION_PATH RAW_MODEL_OUTPUT'); return queued; }, async read() { return queued; }, async review() { return review; }, async apply() { throw new Error('unused'); } };
  try {
    await act(async () => f.root.render(<PreparationConfiguratorPanel document={document} api={api} onApplied={() => {}} />)); await settle();
    const textarea = f.element.querySelector('textarea'); assert.ok(textarea); const setter = Object.getOwnPropertyDescriptor(f.dom.window.HTMLTextAreaElement.prototype, 'value')?.set; assert.ok(setter); await act(async () => { setter.call(textarea, 'Situación inicial sin canon inventado'); textarea.dispatchEvent(new f.dom.window.Event('input', { bubbles: true })); });
    const create = [...f.element.querySelectorAll('button')].find(value => value.textContent === 'Registrar propuesta sin iniciar inferencia'); assert.ok(create); await act(async () => create.click()); await settle(); assert.equal(intents.length, 1); assert.doesNotMatch(f.element.textContent ?? '', /PRIVATE_SESSION_PATH|RAW_MODEL_OUTPUT/);
    await act(async () => f.root.render(<PreparationConfiguratorPanel document={document} dirty api={api} onApplied={() => {}} />)); await settle(); assert.equal(textarea.disabled, true);
    const retry = [...f.element.querySelectorAll('button')].find(value => value.textContent === 'Recuperar resultado del Configurador'); assert.ok(retry); await act(async () => retry.click()); await settle(); assert.equal(intents.length, 2); assert.deepEqual(intents[0], intents[1]); assert.equal(intents[1]?.kind, 'create');
  } finally { await f.close(); }
});

test('expired access diagnosis explains the next action without retrying the blocked job', async () => {
  const f=await setup(); let dispatches=0;
  const blocked=PreparationConfiguratorPublicJobSchema.parse({...queued,state:'blocked',revision:2,failureCode:'PREPARATION_CONFIGURATOR_ACCESS_REQUIRED'});
  const api:PreparationConfiguratorClient={
    async choices(){return choices;},async list(){return {kind:'preparation-configurator-jobs',runId:choices.runId,items:[blocked],hasMore:false};},
    async read(){return blocked;},async review(){return {...review,job:blocked,candidateId:null,proposalHash:null,proposal:null};},
    async execute(){dispatches++;throw new Error('Unexpected dispatch');},async apply(){throw new Error('Unexpected application');},
  };
  try {
    await act(async()=>f.root.render(<PreparationConfiguratorPanel document={document} api={api} onApplied={()=>{}}/>));await settle();
    const recover=[...f.element.querySelectorAll('button')].find(button=>button.textContent===`Consultar propuesta ${jobId}`);assert.ok(recover);
    await act(async()=>recover.click());await settle();
    assert.match(f.element.textContent??'',/Abrí Acceso a Pi y comprobá el modelo/);
    assert.match(f.element.textContent??'',/no se reintenta automáticamente/);
    assert.equal(dispatches,0);
    assert.equal([...f.element.querySelectorAll('button')].some(button=>button.textContent==='Iniciar propuesta con el modelo'),false);
  } finally {await f.close();}
});

test('recommended curation selects an admitted pending actor locally and never registers or starts implicitly', async () => {
  const f=await setup(); const intents:PreparationConfiguratorIntent[]=[];
  const configured=RunConfigurationDraftViewSchema.parse({...document.view,configuration:{...document.view.configuration,roster:{kind:'configured',value:{activeCharacterIds:['maxwell-smart'],eligibleCharacterIds:['maxwell-smart'],preparedCharacters:[]},evidence:{kind:'integrator-default',decisionRef:'synthetic-selected-cast'}}}});
  const api:PreparationConfiguratorClient={async choices(){return choices;},async list(){return {kind:'preparation-configurator-jobs',runId:choices.runId,items:[],hasMore:false};},async execute(intent){intents.push(intent);return queued;},async read(){return queued;},async review(){return review;},async apply(){throw new Error('Unexpected apply');}};
  try{
    await act(async()=>f.root.render(<PreparationConfiguratorPanel document={{...document,view:configured}} api={api} onApplied={()=>{}}/>));await settle();
    const use=[...f.element.querySelectorAll('button')].find(button=>button.textContent==='Usar preparación recomendada');assert.ok(use);
    await act(async()=>use.click());await settle();
    assert.equal(intents.length,0);
    assert.match(f.element.querySelector('textarea')?.value??'',/maxwell-smart/);
    assert.match(f.element.querySelector('textarea')?.value??'',/No impongas respuestas/);
    const sources=[...f.element.querySelectorAll('fieldset input[type="checkbox"]')];assert.equal(sources.filter(input=>input instanceof f.dom.window.HTMLInputElement&&input.checked).length,1);
    const register=[...f.element.querySelectorAll('button')].find(button=>button.textContent==='Registrar propuesta sin iniciar inferencia');assert.ok(register);
    await act(async()=>register.click());await settle();
    assert.equal(intents.length,1);const intent=intents[0];assert.equal(intent?.kind,'create');if(intent?.kind!=='create')assert.fail();
    assert.deepEqual(intent.body.actorSources,[choices.actorSources[0]?.reference]);assert.deepEqual(intent.body.documentIds,[]);
    assert.equal(intents.some(item=>item.kind==='start'),false);
  }finally{await f.close();}
});
