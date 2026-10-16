import { z } from 'zod';
import { CatalogCharacterSummarySchema, type CatalogPage } from '../domain/http.ts';
import { ContinuityContextSchema } from '../domain/preparation.ts';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema, WorldPreparationCandidateSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { ProposalIdSchema } from '../domain/values.ts';

export const PreparationPresetSchema = z.enum(['blank', 'fibonacci', 'control-ensemble']);
export type PreparationPreset = z.infer<typeof PreparationPresetSchema>;

/** Suggestions for the operator only; these are never actor knowledge or assigned goals. */
export const PREPARATION_PRESETS = [
  { id: 'blank', label: 'Puesta en blanco', buttonLabel:'Empezar en blanco', description: 'Definí las circunstancias desde cero.', goalSuggestions: [] },
  { id:'control-ensemble',label:'CONTROL · un informe, tres versiones',buttonLabel:'Proponer puesta Max, 99 y Jefe',description:'Una propuesta editable sin Fibonacci: Max, 99 y el Jefe deben decidir qué hacer con un aviso sin confirmar. Sus motivos pueden entrar en tensión; las respuestas y el resultado quedan abiertos.',goalSuggestions:[
    'Para Max: conseguir que valoren su iniciativa sin confundir una suposición con una prueba; puede reconocer, defender o revisar su interpretación.',
    'Para 99: esclarecer qué saben y qué falta comprobar, conservando autonomía profesional y su vínculo con los compañeros.',
    'Para el Jefe: decidir responsablemente con información incompleta, atendiendo seguridad, recursos y confianza en sus agentes.',
  ]},
  { id: 'fibonacci', label: 'Ensayo de conocimiento · Max y Hymie', buttonLabel:'Proponer ensayo Max y Hymie', description: 'Adaptación sintética editable: una pregunta sobre Fibonacci permite explorar voces y conocimiento situado. No documenta un episodio ocurrido ni atribuye habilidades canónicas.', goalSuggestions: [
    'Para Max: decidir cómo responder a una pregunta que pone a prueba su seguridad.',
    'Para Hymie: decidir cómo interpretar y responder la pregunta desde los saberes que se admitan en su curación.',
  ] },
] satisfies readonly { id: PreparationPreset; label: string; buttonLabel:string; description: string; goalSuggestions: string[] }[];

/** Build a local candidate only. No dossier, memory, credentials or runtime is accessed. */
export async function createPreparationPreset(input: {
  preset: PreparationPreset; runId: string; catalog: CatalogPage['items']; uuid: () => string;
}): Promise<RunConfigurationDraft> {
  const preset = PreparationPresetSchema.parse(input.preset);
  const draft = RunConfigurationDraftSchema.parse({ ...createEmptyRunConfigurationDraft({ runId: input.runId, revision: 0 }), icmWorkspace: { kind: 'empty' } });
  if (preset === 'blank') return draft;
  const catalog = z.array(CatalogCharacterSummarySchema).parse(input.catalog);
  function select(slug: string) {
    const candidates = catalog.filter((entry) => entry.characterId === slug || entry.avatarRef.slug === slug);
    const candidate = candidates[0];
    if (candidates.length !== 1 || candidate === undefined) throw new Error(`El preset requiere exactamente un personaje ${slug} en el catálogo; encontrados: ${candidates.length}.`);
    if (candidate.characterId !== slug || candidate.avatarRef.slug !== slug) throw new Error(`La identidad y el slug de ${slug} no coinciden; revisá el catálogo.`);
    return candidate;
  }
  const allocated = new Set<string>([draft.runId]);
  function nextId() {
    const id = ProposalIdSchema.parse(input.uuid());
    if (allocated.has(id)) throw new Error('El generador de identificadores repitió un UUID.');
    allocated.add(id);
    return id;
  }
  function proposed<T>(value: T) { return { kind: 'proposed', proposalId: nextId(), source: 'template', value } satisfies { kind: 'proposed'; proposalId: ReturnType<typeof ProposalIdSchema.parse>; source: 'template'; value: T }; }
  if(preset==='control-ensemble'){
    const cast=['maxwell-smart','agente-99','jefe'].map(select);
    const fictionalAt=Date.parse('1966-06-20T09:00:00-04:00');
    const continuityCore={continuityId:`control-informe-${draft.runId}`,revision:0,kind:'adaptation',
      label:'Situación editorial sintética de CONTROL: un aviso de alarma sin confirmar. No recrea un episodio emitido ni admite automáticamente matrimonio, hijos o revelaciones futuras. Fecha, lugar y relaciones requieren revisión.',milestones:[],inclusions:[]};
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(continuityCore)));
    const contentHash=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
    const continuity=ContinuityContextSchema.parse({...continuityCore,contentHash});
    const sceneId=nextId(),paperId=nextId(),maintenanceId=nextId();
    const world=WorldPreparationCandidateSchema.parse({schemaVersion:1,runId:draft.runId,revision:0,seq:0,
      clock:{instant:fictionalAt,convention:{kind:'fixedOffset',offsetMinutes:-240,label:'Convención editorial UTC−04:00'}},
      places:[{id:'oficina-control',name:'Oficina de CONTROL en Washington D. C. · adaptación',description:'Lugar editorial de reunión. No reproduce un decorado canónico ni acredita un episodio ocurrido.',width:12,height:9,lighting:'normal'},
        {id:'pasillo-control',name:'Pasillo de CONTROL · adaptación',description:'Espacio de circulación entre la oficina y el Archivo. Permite separarse y elegir a quién buscar.',width:8,height:4,lighting:'normal'},
        {id:'archivo-control',name:'Archivo de CONTROL · adaptación',description:'Sala de documentación accesible desde el pasillo. Sus documentos no se conocen automáticamente desde otras salas.',width:10,height:8,lighting:'normal'}],
      doors:[],connections:[
        {from:'oficina-control',to:'pasillo-control',durationMs:2000,arrivalPoint:{x:1,y:2},doorId:null},
        {from:'pasillo-control',to:'oficina-control',durationMs:2000,arrivalPoint:{x:2,y:2},doorId:null},
        {from:'pasillo-control',to:'archivo-control',durationMs:2000,arrivalPoint:{x:2,y:2},doorId:null},
        {from:'archivo-control',to:'pasillo-control',durationMs:2000,arrivalPoint:{x:7,y:2},doorId:null},
      ],perceptualPaths:[],
      channels:[{kind:'speech',id:nextId(),label:'Conversación en la oficina',enabled:true,maxRange:20,scope:'broadcast',placeIds:['oficina-control','pasillo-control','archivo-control']},
        {kind:'gesture',id:nextId(),label:'Gestos visibles en la oficina',enabled:true,modality:'visual',maxRange:20,scope:'broadcast',placeIds:['oficina-control','pasillo-control','archivo-control']}],
      entities:[{kind:'object',entityId:paperId,label:'Aviso sin firma',description:'Hoja con el texto visible: «Prueba de alarma: resultado sin confirmar». La hoja contiene una afirmación, no una prueba de que sonó una alarma ni de su causa.',portable:true,collisionRadius:0,blocksMovement:false},
        {kind:'object',entityId:maintenanceId,label:'Registro de mantenimiento',description:'Documento editorial con el texto: «Circuito de prueba desconectado para revisión. Reposición pendiente de registrar». Es un registro sin fecha ni firma: no acredita el estado actual del circuito ni quién escribió el aviso de la oficina.',portable:true,collisionRadius:0,blocksMovement:false}],
      inventory:[{objectEntityId:paperId,location:{kind:'atPlace',placeId:'oficina-control',position:{x:6,y:4.5}},revision:0},
        {objectEntityId:maintenanceId,location:{kind:'atPlace',placeId:'archivo-control',position:{x:6,y:4}},revision:0}],scenes:[{id:sceneId,label:'Un informe, tres versiones · propuesta',lifecycle:{kind:'open',startedAt:fictionalAt},placeIds:['oficina-control','pasillo-control','archivo-control']}],activeSceneId:sceneId,offers:[],
      actionDurations:{observeMs:0,speechMs:1000,gestureMs:500,takeMs:500,offerMs:0,acceptOfferMs:500,maxWaitMs:1000,maxRestMs:10000,offerValidityMs:60000,interactionRange:2},
    });
    // The paper's wording establishes a document, never a confirmed alarm.
    return RunConfigurationDraftSchema.parse({...draft,characterDefinitionPolicy:{kind:'embodied-v1'},name:proposed('CONTROL: un informe, tres versiones'),fictionalAt:proposed(fictionalAt),continuity:proposed(continuity),
      worldSnapshot:proposed(world),roster:proposed({eligibleCharacterIds:cast.map(actor=>actor.characterId),activeCharacterIds:cast.map(actor=>actor.characterId),preparedCharacters:[]}),
      dramaticLine:proposed({purpose:'Explorar iniciativa, responsabilidad y confianza frente a información incompleta. Las decisiones del reparto determinan el curso de la escena.',question:{kind:'formulated',text:'¿Pueden acordar qué hacer con un aviso sin confirmar sin sacrificar precisión ni confianza?'},conflict:{kind:'formulated',statement:'La iniciativa de Max, el criterio de 99 y la responsabilidad del Jefe pueden chocar al interpretar el mismo aviso. No se establece una alarma real, un culpable, una reacción obligatoria ni un desenlace.'}}),
      circadianPolicy:proposed({kind:'manual-only'}),spanishVariety:proposed({kind:'proposed',label:'Doblaje latinoamericano en español · propuesta editorial sin calibración audiovisual',source:'editorial-proposal'})});
  }
  switch(preset){case 'fibonacci':break;default:{const exhaustive:never=preset;throw new Error(String(exhaustive));}}
  const max = select('maxwell-smart');
  const hymie = select('hymie');
  // Editorial fictional date, independent of wall time or a broadcast date.
  const fictionalAt = Date.parse('1966-06-15T10:00:00-04:00');
  const continuityCore = {
    continuityId: `ensayo-fibonacci-${draft.runId}`, revision: 0, kind: 'adaptation',
    label: 'Ensayo sintético de conocimiento: Max y Hymie. Fecha, lugar y encuentro propuestos; sin hechos de episodios importados ni habilidades matemáticas canónicas afirmadas.',
    milestones: [], inclusions: [],
  };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(continuityCore)));
  const contentHash = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const continuity = ContinuityContextSchema.parse({ ...continuityCore, contentHash });
  const sceneId = nextId();
  // Actors are placed only after curating them. Omitted candidate fields remain
  // incomplete rather than claiming a prepared actor or creating a placement dead end.
  const world = WorldPreparationCandidateSchema.parse({
    schemaVersion: 1, runId: draft.runId, revision: 0, seq: 0,
    clock: { instant: fictionalAt, convention: { kind: 'fixedOffset', offsetMinutes: -240, label: 'Convención editorial UTC−04:00' }, dayNight: { dayStartsAtMinute: 420, nightStartsAtMinute: 1200, disambiguation: 'compatible' } },
    places: [{ id: 'sala-ensayo', name: 'Sala de ensayo en Washington D. C. · adaptación', description: 'Espacio sintético para el encuentro. No se identifica como un decorado canónico de la serie.', width: 10, height: 8, lighting: 'normal' }],
    doors: [], connections: [], perceptualPaths: [],
    channels: [{ kind: 'speech', id: nextId(), label: 'Conversación de la sala', enabled: true, maxRange: 8, scope: 'addressed', placeIds: ['sala-ensayo'] }],
    inventory: [], scenes: [{ id: sceneId, label: 'Ensayo de una pregunta · propuesta', lifecycle: { kind: 'open', startedAt: fictionalAt }, placeIds: ['sala-ensayo'] }],
    activeSceneId: sceneId, offers: [],
    actionDurations: { observeMs: 0, speechMs: 0, gestureMs: 0, takeMs: 0, offerMs: 0, acceptOfferMs: 0, maxWaitMs: 1000, maxRestMs: 10000, offerValidityMs: 1000, interactionRange: 2 },
  });
  return RunConfigurationDraftSchema.parse({ ...draft,
    name: proposed('Ensayo de conocimiento: Max y Hymie · adaptación sintética'),
    fictionalAt: proposed(fictionalAt), continuity: proposed(continuity), worldSnapshot: proposed(world),
    roster: proposed({ eligibleCharacterIds: [max.characterId, hymie.characterId], activeCharacterIds: [max.characterId, hymie.characterId], preparedCharacters: [] }),
    dramaticLine: proposed({ purpose: 'Explorar diferencias de voz, tácticas y conocimiento situado ante una pregunta sobre Fibonacci, sin exigir una respuesta matemática ni un desenlace.', question: { kind: 'formulated', text: '¿Cómo responde cada personaje cuando se le pregunta si conoce el algoritmo de Fibonacci?' }, conflict: { kind: 'not-formulated' } }),
    circadianPolicy: proposed({ kind: 'manual-only' }),
    spanishVariety: proposed({ kind: 'proposed', label: 'Doblaje latinoamericano en español · propuesta editorial sin calibración audiovisual', source: 'editorial-proposal' }),
  });
}
