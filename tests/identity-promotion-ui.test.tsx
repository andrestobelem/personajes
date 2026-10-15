import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {IdentityCoreDiff,IdentityEvolutionEvidence} from '../src/web/IdentityPromotionPanel.tsx';
import {CuratedIdentitySchema} from '../src/domain/preparation.ts';
const before=CuratedIdentitySchema.parse({selfReference:'Max',selfConcept:'Agente que aprende',values:['Lealtad'],dispositions:['Optimismo'],contradictions:['Confía aunque desconfía']});
test('identity proposal renders all five core fields without claiming applied evolution',()=>{
 const after=CuratedIdentitySchema.parse({...before,selfConcept:'Agente que empieza a escuchar',dispositions:['Escuchar antes de actuar']});
 const html=renderToStaticMarkup(<IdentityCoreDiff before={before} after={after}/>);
 for(const field of ['Cómo se nombra','Concepto de sí mismo','Valores','Disposiciones','Contradicciones'])assert.ok(html.includes(field));
 assert.match(html,/todavía no aplicado/);assert.match(html,/Agente que aprende/);assert.match(html,/Agente que empieza a escuchar/);assert.doesNotMatch(html,/aplicada y confirmada/);
});
test('missing evidence stays explicit and does not invent private mental states',()=>{
 const html=renderToStaticMarkup(<IdentityEvolutionEvidence actorId="max" items={[]}/>);assert.match(html,/No hay evidencia admitida disponible/);assert.match(html,/no se presenta como verdad omnisciente/);assert.match(html,/no se transmiten a otros personajes/);
});
test('operator entry never grants inspection automatically and historical controls stay disabled',async()=>{
 const {IdentityPromotionPanel}=await import('../src/web/IdentityPromotionPanel.tsx');const runId='11111111-1111-4111-8111-111111111111';
 const html=renderToStaticMarkup(<IdentityPromotionPanel runId={runId} inspectionAllowed={false}/>);assert.match(html,/no activa ese permiso automáticamente/);assert.match(html,/puede llamar al modelo seleccionado y consumir el presupuesto/);assert.match(html,/fieldset disabled/);assert.doesNotMatch(html,/Revisión privada de evolución|Aplicar evolución revisada/);
 const historical=renderToStaticMarkup(<IdentityPromotionPanel runId={runId} inspectionAllowed historical/>);assert.match(historical,/mirando un corte histórico/);assert.match(historical,/fieldset disabled/);
});
test('available candidate is distinct from journal-confirmed applied identity',async()=>{
 const {IdentityPromotionStatus}=await import('../src/web/IdentityPromotionPanel.tsx');const {IdentityPromotionJobViewSchema}=await import('../src/domain/identity-promotion-http.ts');
 const runId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';const source={runId,commitIndex:7,worldRevision:3,worldSeq:2,configurationRevision:1,configurationHash:'a'.repeat(64),snapshotHash:'b'.repeat(64)};
 const candidate=IdentityPromotionJobViewSchema.parse({kind:'configurator-job',jobId,runId,actorId:'max',generation:0,revision:1,state:'accepted',source,contextHash:'c'.repeat(64),failureCode:null,createdAt:0,updatedAt:1,promotion:{kind:'not-applied'}});
 const proposed=renderToStaticMarkup(<IdentityPromotionStatus job={candidate}/>);assert.match(proposed,/todavía no aplicada/);assert.doesNotMatch(proposed,/aplicada y confirmada/);
 const applied=IdentityPromotionJobViewSchema.parse({...candidate,revision:2,promotion:{kind:'applied',receipt:{kind:'identity-promotion-receipt',operationId:jobId,actorId:'max',source,target:{...source,commitIndex:8,worldRevision:4,configurationRevision:2},previousIdentityVersion:0,identityVersion:1,epochIndex:1,lifecycleRevision:2,contextHash:candidate.contextHash,proposalHash:'d'.repeat(64),recordedAt:'2026-10-20T00:00:00Z'}}});
 const html=renderToStaticMarkup(<IdentityPromotionStatus job={applied}/>);assert.match(html,/aplicada y confirmada por el journal/);assert.match(html,/pasado conserva su identidad anterior/);
});
test('private before/after review preserves unknowns, evidence subjectivity and contradiction explanations',async()=>{
 const {configuratorEvolutionFixture}=await import('./fixtures/configurator-evolution.ts');const {configuratorValueHash}=await import('../src/application/configurator-context.ts');const {IdentityPromotionReviewSchema,IdentityPromotionJobViewSchema}=await import('../src/domain/identity-promotion-http.ts');const {IdentityPromotionPrivateReview}=await import('../src/web/IdentityPromotionPanel.tsx');
 const fixture=await configuratorEvolutionFixture();try{const scope=fixture.context.scope;if(scope.kind!=='evolution')throw new Error('Fixture');const job=IdentityPromotionJobViewSchema.parse({kind:'configurator-job',jobId:scope.scope.jobId,runId:scope.scope.runId,actorId:scope.actorStateCut.actorId,generation:0,revision:1,state:'accepted',source:scope.anchor.source,contextHash:configuratorValueHash(fixture.context),failureCode:null,createdAt:0,updatedAt:1,promotion:{kind:'not-applied'}});
 const review=IdentityPromotionReviewSchema.parse({kind:'identity-promotion-review',job,context:fixture.context,proposal:fixture.proposal,candidateHash:'d'.repeat(64),proposalHash:configuratorValueHash(fixture.proposal),targetFullHash:fixture.context.targetFullHash});const html=renderToStaticMarkup(<IdentityPromotionPrivateReview review={review}/>);assert.match(html,/Vacío sintético conservado/);assert.match(html,/creencia propia/);assert.match(html,/testimonio recibido/);assert.match(html,/Resolución de contradicciones/);assert.doesNotMatch(html,/SECRET_PRIVATE_OTHER_MEMORY|SECRET_OTHER_PREPARATION|SECRET_PRIVATE_PLACE/);
 }finally{fixture.close();}
});


test('applied identity comparison describes the source and applied version without claiming it remains pending',()=>{
 const html=renderToStaticMarkup(<IdentityCoreDiff before={before} after={{...before,selfConcept:'Escucha con paciencia'}} applied/>);
 assert.match(html,/Identidad en el corte fuente y versión aplicada, según el recibo del journal/);assert.doesNotMatch(html,/todavía no aplicado|<th>Propuesta<\/th>/);assert.match(html,/<th>Versión aplicada<\/th>/);assert.match(html,/Agente que aprende/);assert.match(html,/Escucha con paciencia/);
});
