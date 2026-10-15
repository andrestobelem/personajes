import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DEFAULT_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { DirectorContextSchema, DirectorObservationSchema } from '../src/domain/admin-roles.ts';
import { validateDirectorContext, validateDirectorObservation } from '../src/application/director-context.ts';
import { createDirectorObservationTool } from '../src/application/director-tools.ts';

function fixture() {
  const runId = randomUUID(); const eventId = randomUUID();
  const context = DirectorContextSchema.parse({
    kind:'director-context',schemaVersion:1,role:'director',
    scope:{runId,pulseId:randomUUID(),jobId:randomUUID(),generation:0,lifecycleRevision:2,configurationRevision:0,worldRevision:1,throughWorldSeq:1,fictitiousAt:100,profile:DEFAULT_INFERENCE_PROFILE},
    dramaticLine:{purpose:'Examinar confianza',question:{kind:'absent'},conflict:{kind:'not-formulated'}},
    participantCharacterIds:['maxwell-smart'],previousAnnotations:[],
    confirmedEvents:[{kind:'humanIntervention',id:eventId,runId,seq:1,fictitiousAt:100,durationMs:0,
      origin:{kind:'human',participantId:'visitante',interventionId:randomUUID()},speakerDisplayName:'Visitante',placeId:'sala',position:{x:0,y:0},channelId:randomUUID(),content:{kind:'speech',text:'La misión terminó, dicen.'},requestedAudience:['maxwell-smart'],effectiveAudience:['maxwell-smart']}],
  });
  const observation = DirectorObservationSchema.parse({kind:'director-observation',stage:'planteamiento',assessment:{kind:'sufficient',reason:'Aparece una afirmación discutible.',evidenceEventIds:[eventId]},affectedCharacterIds:['maxwell-smart'],openQuestions:['¿Es fiable el testimonio?'],revision:{kind:'initial'}});
  return {context,observation};
}

test('Director no recibe actorId, recuerdos, propuestas ni perfiles alternativos no autorizados',()=>{
  const {context} = fixture();
  for (const extra of [{actorId:'director'},{memories:['oculto']},{proposals:[]}]) assert.equal(DirectorContextSchema.safeParse({...context,...extra}).success,false);
  assert.equal(DirectorContextSchema.safeParse({...context,scope:{...context.scope,profile:{...DEFAULT_INFERENCE_PROFILE,model:'otro'}}}).success,false);
  assert.throws(()=>validateDirectorContext({...context,confirmedEvents:[{...context.confirmedEvents[0],runId:randomUUID()}]}));
  assert.throws(()=>validateDirectorContext({...context,scope:{...context.scope,throughWorldSeq:0}}));
});

test('las referencias clásicas llegan sólo al contexto administrativo como orientación, conservando compatibilidad histórica',()=>{
  const {context} = fixture();
  assert.equal('dramaticReferences' in context, false);
  const references = [
    { tradition: 'greek-tragedy', author: 'Sófocles', work: 'Antígona', focus: 'Decisión y ley de la ciudad.' },
    { tradition: 'old-comedy', author: 'Aristófanes', work: 'Las aves', focus: 'Efectos de llevar una propuesta al extremo.' },
  ];
  const directed = validateDirectorContext({ ...context, dramaticReferences: references });
  assert.deepEqual(directed.dramaticReferences, references);
  assert.deepEqual(directed.dramaticLine.conflict, { kind: 'not-formulated' });
  assert.equal(directed.confirmedEvents.length, context.confirmedEvents.length);
  assert.equal(DirectorContextSchema.safeParse({ ...directed, dramaticReferences: [{ ...references[0], extra: 'instrucción' }] }).success, false);
  assert.equal(DirectorContextSchema.safeParse({ ...directed, dramaticReferences: Array(13).fill(references[0]) }).success, false);
});

test('etapa suficiente exige hechos referidos y rectificación identificada; no admite decisiones actorales',()=>{
  const {context,observation} = fixture();
  assert.deepEqual(validateDirectorObservation({context,observation}),observation);
  assert.throws(()=>validateDirectorObservation({context,observation:{...observation,assessment:{...observation.assessment,evidenceEventIds:[randomUUID()]}}}));
  assert.throws(()=>validateDirectorObservation({context,observation:{...observation,assessment:{...observation.assessment,evidenceEventIds:[]}}}));
  assert.throws(()=>validateDirectorObservation({context,observation:{...observation,revision:{kind:'rectification',supersedes:randomUUID(),reason:'Otra lectura'}}}));
  assert.equal(DirectorObservationSchema.safeParse({...observation,characterDecision:'obedecer'}).success,false);
  const insufficient={...observation,assessment:{kind:'insufficient',reason:'No hay evidencia para un giro',evidenceEventIds:[]}};
  assert.equal(validateDirectorObservation({context,observation:insufficient}).assessment.kind,'insufficient');
});

test('tool Director candidata idempotente y aislada; texto final no publica y cancelación tardía bloquea',async()=>{
  const {context,observation} = fixture();
  const created=createDirectorObservationTool({context,checkEligibility:()=>({kind:'active'})});
  const first=await created.tool.execute('a',observation);
  assert.deepEqual(await created.tool.execute('b',observation),{...first,details:{...first.details,status:'existing'}});
  const candidate=created.readCandidate();assert.ok(candidate);
  candidate.observation.openQuestions.push('cambio externo');
  assert.equal(created.readCandidate()?.observation.openQuestions.includes('cambio externo'),false);
  await assert.rejects(()=>created.tool.execute('c',{...observation,openQuestions:['otra']}));
  const controller=new AbortController();
  const canceled=createDirectorObservationTool({context,signal:controller.signal,checkEligibility:()=>{controller.abort();return {kind:'active'};}});
  await assert.rejects(()=>canceled.tool.execute('d',observation));
  assert.equal(canceled.readCandidate(),undefined);
});
