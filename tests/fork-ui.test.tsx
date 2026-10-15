import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForkPanel, ForkJobStatus } from '../src/web/ForkPanel.tsx';
import { EpisodeForkOrigins } from '../src/web/DramaticStructurePanel.tsx';
import { ForkSourceSelectionSchema, ForkJobViewSchema } from '../src/domain/fork-http.ts';
import { DramaticEpisodeViewSchema } from '../src/domain/dramatic-structure.ts';
const runId='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const source={runId,commitIndex:7,worldRevision:3,worldSeq:2,snapshotHash:'a'.repeat(64),configurationRevision:0,configurationHash:'b'.repeat(64)};
test('fork SSR requires a confirmed source and does not claim publication or start inference',()=>{
 const empty=renderToStaticMarkup(<ForkPanel source={null} />); assert.match(empty,/disabled=""/); assert.match(empty,/no inicia actores ni genera audio/); assert.doesNotMatch(empty,/publicada/);
 const confirmed=renderToStaticMarkup(<ForkPanel source={ForkSourceSelectionSchema.parse({runId,commitIndex:7,worldRevision:3,worldSeq:2})} />);assert.match(confirmed,/Elegir corte para bifurcar/);assert.doesNotMatch(confirmed,/<button type="button" disabled/);
});
test('job GUI distinguishes staging, failed and ready, audio provenance and ready navigation',()=>{
 const base={kind:'fork-job',operationId:id,targetRunId:runId,source,name:'Otra puesta',reason:'Perspectiva',revision:0,createdAt:0,updatedAt:0,audioDerivation:{kind:'initial-ready-configuration',sourceConfigurationHash:'b'.repeat(64),effectiveHistory:'not-reconstructed',bindingState:'unbound'}};
 for(const state of ['staging','failed','ready']) {
  const job=ForkJobViewSchema.parse({...base,state,...(state==='failed'?{code:'FORK_INTERRUPTED'}:state==='ready'?{publishedAt:1}:{})});
  const html=renderToStaticMarkup(<ForkJobStatus job={job} onOpenRun={()=>{}} />);assert.match(html,/voces heredadas sin vincular/);assert.match(html,/no se reconstruye el historial efectivo/);
  assert.equal(html.includes('Abrir representación bifurcada'),state==='ready');
 }
});
test('inherited episode and acts show source cuts without treating zero as new opening',()=>{
 const cut={commitIndex:0,worldRevision:0,worldSeq:0,structureRevision:0};
 const episode=DramaticEpisodeViewSchema.parse({episodeId:id,ordinal:1,title:'Heredado',lifecycle:'open',openingCut:cut,closingCut:null,consequenceEventIds:[],openLines:[],sceneIds:[],acts:[],forkOrigins:[{source,sourceStructureHash:'c'.repeat(64),episodeId:runId,openingCut:{commitIndex:4,worldRevision:2,worldSeq:1,structureRevision:1},closingCut:null,consequenceEventIds:[],openLines:[]}]});
 const html=renderToStaticMarkup(<EpisodeForkOrigins episode={episode}/>);assert.match(html,/Base dramática heredada/);assert.match(html,/no son nuevas aperturas/);assert.match(html,/Apertura en origen: commit 4/);assert.match(html,/actos se conservaron/);
});

test('only a derived Ready preparation can edit structure before starting actors',async()=>{
 const {structureLifecycleAllowsEdit}=await import('../src/web/DramaticStructurePanel.tsx');
 assert.equal(structureLifecycleAllowsEdit('ready',true),true);
 assert.equal(structureLifecycleAllowsEdit('ready',false),false);
 assert.equal(structureLifecycleAllowsEdit('draft',true),false);
 assert.equal(structureLifecycleAllowsEdit('closed',true),false);
 assert.equal(structureLifecycleAllowsEdit('paused',false),true);
});

test('derived preparation editor explains its preserved history and disables ordinary writes',async()=>{
 const {RunDraftEditor}=await import('../src/web/RunDraftEditor.tsx');
 const {draftFixture}=await import('./fixtures/continuista.ts');
 const html=renderToStaticMarkup(<RunDraftEditor draft={draftFixture()} catalog={[]} saving={false} lifecycle="ready" readOnly readOnlyReason="fork-published" onSave={()=>{}} onValidate={()=>{}} onDirty={()=>{}} />);
 assert.match(html,/Esta preparación hereda una historia y una continuidad/);
 assert.match(html,/disabled="">Guardar borrador/);
 assert.match(html,/disabled="">Validar puesta/);
 assert.doesNotMatch(html,/Esta representación está activa o finalizada/);
});
