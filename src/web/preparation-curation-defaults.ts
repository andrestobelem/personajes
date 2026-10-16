import { z } from 'zod';
import type { PreparationConfiguratorChoicesSchema } from '../domain/preparation-configurator-http.ts';
import type { RunConfigurationDraft } from '../domain/production.ts';

export const PreparationCurationDefaultScopeSchema = z.enum(['next-pending', 'whole-cast']);
export type PreparationCurationDefaultScope = z.infer<typeof PreparationCurationDefaultScopeSchema>;

/** Local suggestions only, using sources already offered by the host. */
export function recommendCharacterCuration(input: {
  draft: RunConfigurationDraft;
  choices: z.infer<typeof PreparationConfiguratorChoicesSchema>;
  scope: PreparationCurationDefaultScope;
}) {
  const { draft, choices } = input;
  if (choices.runId !== draft.runId || choices.draftRevision !== draft.revision) return { kind: 'unavailable', reason: 'Actualizá las fuentes de la revisión guardada.' } as const;
  if (draft.roster.kind !== 'configured') return { kind: 'unavailable', reason: 'Confirmá y guardá el reparto antes de preparar sus personajes.' } as const;
  const roster = draft.roster.value;
  const pending = roster.activeCharacterIds.filter(id => !roster.preparedCharacters.some(actor => actor.characterId === id));
  const selectedIds = input.scope === 'whole-cast' ? roster.activeCharacterIds : pending.slice(0, 1);
  if (selectedIds.length === 0) return { kind: 'unavailable', reason: 'No hay personajes pendientes. Podés elegir revisar todo el reparto.' } as const;
  const sources: typeof choices.actorSources = [];
  for (const id of selectedIds) {
    const existing = roster.preparedCharacters.find(actor => actor.characterId === id) ?? roster.preparationDrafts?.find(actor => actor.characterId === id);
    const prior = existing?.dossierSource;
    const candidates = choices.actorSources.filter(choice => choice.reference.characterId === id && (prior === undefined
      ? choice.reference.kind === 'catalog-original'
      : choice.reference.kind === prior.kind && choice.reference.fullArchiveHash === prior.fullArchiveHash));
    const choice = candidates[0];
    if (candidates.length !== 1 || choice === undefined) return { kind: 'unavailable', reason: 'Revisá la fuente de ' + id + '; no hay una selección inequívoca para recomendar.' } as const;
    sources.push(choice);
  }
  return {
    kind: 'recommendation',
    actorSourceHashes: sources.map(source => source.reference.fullArchiveHash),
    documentIds: [],
    instructions: [
      'Prepará o revisá íntegramente sólo estos personajes: ' + selectedIds.join(', ') + '. Respetá las circunstancias y la continuidad admitidas del borrador; si falta una elección, señalala sin inventarla. No modifiques settings ni escribas una trama.',
      'Para cada personaje proponé las nueve secciones de preparación: identidad con historia de vida narrativa amplia y deseos propios; voz; antecedentes; Goals; relaciones; capacidades; inventario; experiencia inicial; tratamiento de vacíos. Conservá lo ya admitido y justificá cada revisión. Los deseos y Goals permiten iniciativa, contradicción, cambio de táctica y conversaciones que trasciendan una tarea instrumental. No impongas respuestas, cooperación, chistes, secuencia de escenas, duración ni desenlace.',
      'Actuación del Método: preparar circunstancias, trayectoria, escucha, vínculos, valores, tensiones y tácticas con evidencia, sin inventar infancia, traumas, recuerdos sensoriales o canon para aparentar exhaustividad. Declarar hipótesis editoriales como adaptación. La biografía no es memoria vivida. Respetá el corte temporal, sin revelaciones futuras no admitidas ni interioridad ajena. La narración actoral contiene antecedentes admitidos; unknowns y contradictions documentales se conservan íntegros como metadatos curatoriales en el actor y lifeHistory.',
      'Usá exclusivamente IDs sourceRefs admitidos del expediente propio, no URLs, hashes ni nombres de archivo. lifeHistory.antecedentIds y desires.goalIds enlazan antecedentes y Goals propios. contradictionTreatments sólo explica contradicciones de una identidad PREVIAMENTE curada que se eliminan; sin eliminaciones usar [].',
      'No crees recuerdos iniciales: initialExperience none para un actor nuevo; preserve-existing cuando corresponde conservar una preparación previa. Capacidades y objetos sólo los que admite el Escenario, sin shell ni mantenimiento. Si falta ubicación, proponé una posición válida sin colisiones en la escena inicial; preservá ubicaciones admitidas. Voz distintiva en el español de doblaje elegido, sin convertir a todos en explicadores técnicos ni reducirlos a muletillas. Proponé receta de voz; no inventes voice IDs o audio generado.',
      'Entregá una propuesta tipada mediante la tool, con razones, procedencia y preguntas abiertas. No actúes personajes ni anticipes diálogos.',
    ].join('\n\n'),
  } as const;
}
