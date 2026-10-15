import { z } from 'zod';
import { CatalogCharacterSummarySchema, type CatalogPage } from '../domain/http.ts';
import { ContinuityContextSchema } from '../domain/preparation.ts';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema, WorldPreparationCandidateSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { ProposalIdSchema } from '../domain/values.ts';

export const PreparationPresetSchema = z.enum(['blank', 'fibonacci']);
export type PreparationPreset = z.infer<typeof PreparationPresetSchema>;

/** Suggestions for the operator only; these are never actor knowledge or assigned goals. */
export const PREPARATION_PRESETS = [
  { id: 'blank', label: 'Puesta en blanco', description: 'Definí las circunstancias desde cero.', goalSuggestions: [] },
  { id: 'fibonacci', label: 'Ensayo de conocimiento · Max y Hymie', description: 'Adaptación sintética editable: una pregunta sobre Fibonacci permite explorar voces y conocimiento situado. No documenta un episodio ocurrido ni atribuye habilidades canónicas.', goalSuggestions: [
    'Para Max: decidir cómo responder a una pregunta que pone a prueba su seguridad.',
    'Para Hymie: decidir cómo interpretar y responder la pregunta desde los saberes que se admitan en su curación.',
  ] },
] satisfies readonly { id: PreparationPreset; label: string; description: string; goalSuggestions: string[] }[];

/** Build a local candidate only. No dossier, memory, credentials or runtime is accessed. */
export async function createPreparationPreset(input: {
  preset: PreparationPreset; runId: string; catalog: CatalogPage['items']; uuid: () => string;
}): Promise<RunConfigurationDraft> {
  const preset = PreparationPresetSchema.parse(input.preset);
  const draft = createEmptyRunConfigurationDraft({ runId: input.runId, revision: 0 });
  if (preset === 'blank') return draft;
  const catalog = z.array(CatalogCharacterSummarySchema).parse(input.catalog);
  function select(slug: string) {
    const candidates = catalog.filter((entry) => entry.characterId === slug || entry.avatarRef.slug === slug);
    const candidate = candidates[0];
    if (candidates.length !== 1 || candidate === undefined) throw new Error(`El preset requiere exactamente un personaje ${slug} en el catálogo; encontrados: ${candidates.length}.`);
    if (candidate.characterId !== slug || candidate.avatarRef.slug !== slug) throw new Error(`La identidad y el slug de ${slug} no coinciden; revisá el catálogo.`);
    return candidate;
  }
  const max = select('maxwell-smart');
  const hymie = select('hymie');
  const allocated = new Set<string>([draft.runId]);
  function nextId() {
    const id = ProposalIdSchema.parse(input.uuid());
    if (allocated.has(id)) throw new Error('El generador de identificadores repitió un UUID.');
    allocated.add(id);
    return id;
  }
  function proposed<T>(value: T) { return { kind: 'proposed', proposalId: nextId(), source: 'template', value } satisfies { kind: 'proposed'; proposalId: ReturnType<typeof ProposalIdSchema.parse>; source: 'template'; value: T }; }
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
