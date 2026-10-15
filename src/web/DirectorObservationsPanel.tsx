import type { z } from 'zod';
import { DirectorObservationListSchema } from '../domain/run-observation.ts';

type Progress = z.infer<typeof DirectorObservationListSchema>;
const stageLabels: Record<Progress['items'][number]['observation']['stage'], string> = {
  planteamiento: 'Planteamiento', desarrollo: 'Desarrollo', climax: 'Clímax', desenlace: 'Desenlace',
};

export function DirectorObservationsPanel({ progress, historical = false, onSelectEvidence }: {
  progress: Progress | null;
  historical?: boolean;
  onSelectEvidence?: (reference: { worldSeq: number; commitIndex: number }) => void;
}) {
  return <section className="dramatic-structure-panel director-progress" aria-label="Seguimiento del Director">
    <h2>Seguimiento del Director</h2>
    <p>Lecturas del conflicto basadas en eventos confirmados. Son interpretaciones revisables: no deciden respuestas, no cierran escenas y no crean hechos ni recuerdos.</p>
    {progress === null
      ? <p role="status">Leyendo observaciones del Director…</p>
      : <>
        {historical && <p className="muted">Lectura retrospectiva: cada observación indica el commit al que se refiere y cuándo fue aceptada. La fecha de aceptación no forma parte del tiempo ficticio ni implica que el Director la hubiera producido en ese corte.</p>}
        {progress.items.length === 0
          ? <p>Todavía no hay observaciones aceptadas para el commit {progress.throughCommitIndex} de esta representación.</p>
          : <>
            <p className="muted">Corte observado: commit {progress.throughCommitIndex}, secuencia {progress.throughWorldSeq} · {progress.items.length > 20 ? `últimas 20 de ${progress.items.length}` : `${progress.items.length} observaciones`}</p>
            <ol className="director-observations">{progress.items.slice(-20).map((item) => <li key={item.annotationId}>
              <h3>{stageLabels[item.observation.stage]} · {item.observation.assessment.kind === 'sufficient' ? 'evidencia suficiente' : 'evidencia insuficiente'}</h3>
              <p>{item.observation.assessment.reason}</p>
              <p className="muted">Se refiere al commit {item.commitIndex} · Escenario {item.worldRevision}, secuencia {item.worldSeq} · aceptada el <time dateTime={new Date(item.acceptedAt).toISOString()}>{new Date(item.acceptedAt).toISOString()}</time></p>
              {item.observation.assessment.evidenceEventIds.length > 0 && <details><summary>Eventos citados ({item.observation.assessment.evidenceEventIds.length})</summary><ul>{item.observation.assessment.evidenceEventIds.map((eventId) => {
                const reference = item.evidenceEventReferences.find((candidate) => candidate.eventId === eventId);
                return <li key={eventId}><code>{eventId}</code>{reference !== undefined && onSelectEvidence !== undefined && <> · <button type="button" onClick={() => onSelectEvidence(reference)}>Ver evento · secuencia {reference.worldSeq} · commit {reference.commitIndex}</button></>}</li>;
              })}</ul></details>}
              {item.observation.affectedCharacterIds.length > 0 && <p>Personajes considerados: {item.observation.affectedCharacterIds.map((id) => <code key={id}>{id} </code>)}</p>}
              {item.observation.openQuestions.length > 0 && <details><summary>Preguntas abiertas ({item.observation.openQuestions.length})</summary><ul>{item.observation.openQuestions.map((question, index) => <li key={`${item.annotationId}:${index}`}>{question}</li>)}</ul></details>}
              {item.observation.revision.kind === 'rectification' && <p>Rectifica <code>{item.observation.revision.supersedes}</code>: {item.observation.revision.reason}</p>}
              <details><summary>Identificador de la observación</summary><code>{item.annotationId}</code></details>
            </li>)}</ol>
          </>}
      </>}
  </section>;
}
