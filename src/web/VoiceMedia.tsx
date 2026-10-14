import type { VoiceArtifact } from "../domain/voice.ts";
export function VoiceMedia({
  artifact,
  onEnded,
}: {
  artifact: VoiceArtifact;
  onEnded?: () => void;
}) {
  return (
    <section aria-label="Audio y texto del artefacto">
      <p>
        Artefacto {artifact.artifactId} · {artifact.modelId} ·{" "}
        {artifact.durationSeconds === null
          ? "Duración sin medir"
          : `${artifact.durationSeconds} segundos`}{" "}
        ·{" "}
        {artifact.state === "available"
          ? "Disponible"
          : "Archivo no disponible"}
      </p>
      {artifact.state === "available" && (
        <audio
          controls
          preload="none"
          src={`/api/v1/voice-artifacts/${artifact.artifactId}/media`}
          onEnded={onEnded}
        >
          Tu navegador no puede reproducir este formato de audio.
        </audio>
      )}
      <p className="voice-sample-text">{artifact.text}</p>
      {artifact.subtitles.kind === "verified" ? (
        <details>
          <summary>Subtítulos con tiempos verificados</summary>
          <ol>
            {artifact.subtitles.cues.map((cue, index) => (
              <li key={`${index}:${cue.startSeconds}`}>
                {cue.startSeconds.toFixed(2)}–{cue.endSeconds.toFixed(2)} s ·{" "}
                {cue.text}
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p>
          La transcripción permanece visible; la alineación de subtítulos no
          está verificada.
        </p>
      )}
      <p className="muted">
        Reproducir usa el archivo almacenado. No llama al modelo ni vuelve a
        sintetizar el texto.
      </p>
    </section>
  );
}
