import React from "react";
import type { RunStageView } from "../domain/run-observation.ts";

/** Presentation only. The host DTO adapter supplies each confirmed location. */
export type StageMapEntity = {
  id: string;
  label: string;
  kind: "character" | "object" | "device" | "human";
  location: { placeId: string; position: { x: number; y: number } } | null;
  status: string;
  details: string;
};
export type StageMapData = {
  dayNightPhase?: RunStageView["dayNightPhase"];
  places: RunStageView["places"];
  connections: RunStageView["connections"];
  doors: RunStageView["doors"];
  entities: StageMapEntity[];
};
const entityLabels = {
  character: "Personaje",
  object: "Objeto",
  device: "Dispositivo",
  human: "Participante humano",
};
const lightingLabels = {
  dark: "Oscuro",
  dim: "Luz tenue",
  normal: "Luz normal",
  bright: "Luz intensa",
};
const doorLabels = { open: "Abierta", closed: "Cerrada", locked: "Bloqueada" };
export function StageMap({ data }: { data: StageMapData }) {
  const [placeId, setPlaceId] = React.useState(data.places[0]?.id ?? "");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const place =
    data.places.find((candidate) => candidate.id === placeId) ?? data.places[0];
  const selected = data.entities.find((entity) => entity.id === selectedId);
  const titleId = React.useId();
  const descriptionId = React.useId();
  function choose(entity: StageMapEntity) {
    setSelectedId(entity.id);
    if (entity.location) setPlaceId(entity.location.placeId);
  }
  const presentEntities = data.entities.filter(
    (entity) => entity.location?.placeId === place?.id,
  );
  const symbolSize =
    place === undefined ? 1 : Math.max(place.width, place.height) / 30;
  return (
    <section className="stage-map-panel" aria-label="Escenografía confirmada">
      <h2>Escenario</h2>
      {data.dayNightPhase !== undefined && <p aria-label="Fase del ciclo editorial">{data.dayNightPhase === "day" ? "Día" : "Noche"} · fase del corte observado; no modifica la iluminación física.</p>}
      <p>
        Ubicaciones y estados confirmados. La cámara y la selección sólo cambian
        esta vista.
      </p>
      <div className="stage-toolbar">
        <div>
          <label htmlFor={`${titleId}-place`}>Lugar visible</label>
          <select
            id={`${titleId}-place`}
            value={place?.id ?? ""}
            onChange={(event) => {
              setPlaceId(event.target.value);
              setZoom(1);
            }}
          >
            {data.places.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
          disabled={zoom >= 3}
        >
          Acercar
        </button>
        <button
          onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          disabled={zoom <= 1}
        >
          Alejar
        </button>
        <button onClick={() => setZoom(1)}>Centrar plano</button>
      </div>
      {place === undefined ? (
        <p>No hay un lugar confirmado para representar.</p>
      ) : (
        <>
          <p>
            {lightingLabels[place.lighting]} · Plano {place.width} ×{" "}
            {place.height}
          </p>
          {place.environment !== undefined && place.environment.length > 0 && (
            <section aria-label={`Condiciones confirmadas de ${place.name}`}>
              <h3>Condiciones del lugar</h3>
              <ul>
                {place.environment.map((condition, index) => (
                  <li key={`${condition.label}:${index}`}>
                    <strong>{condition.label}</strong> · {condition.modality === "visual" ? "Visual" : "Auditiva"}: {condition.detail}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="stage-map-viewport">
            <svg
              className="stage-map"
              role="img"
              aria-labelledby={`${titleId} ${descriptionId}`}
              viewBox={`${-symbolSize * 2} ${-symbolSize * 3} ${place.width + symbolSize * 4} ${place.height + symbolSize * 6}`}
              style={{ width: `${zoom * 100}%` }}
            >
              <title id={titleId}>{`Plano de ${place.name}`}</title>
              <desc id={descriptionId}>
                Personajes como círculos, objetos como cuadrados y dispositivos
                como rombos. Las ubicaciones corresponden al estado confirmado.
                La lista de entidades ofrece la misma información y selección.
              </desc>
              <rect
                className="place-outline"
                x={0}
                y={0}
                width={place.width}
                height={place.height}
              />
              {presentEntities.map((entity) => {
                const point = entity.location?.position;
                if (!point) return null;
                const chosen = selectedId === entity.id;
                return (
                  <g
                    key={entity.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${entityLabels[entity.kind]} ${entity.label}, ${entity.status}, posición ${point.x}, ${point.y}`}
                    aria-pressed={chosen}
                    onClick={() => choose(entity)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose(entity);
                      }
                    }}
                    transform={`translate(${point.x} ${point.y})`}
                  >
                    <title>{`${entity.label}: ${entity.status}`}</title>
                    {entity.kind === "character" || entity.kind === "human" ? (
                      <circle className="character-mark" r={symbolSize} />
                    ) : entity.kind === "object" ? (
                      <rect
                        className="object-mark"
                        x={-symbolSize}
                        y={-symbolSize}
                        width={symbolSize * 2}
                        height={symbolSize * 2}
                      />
                    ) : (
                      <path
                        className="device-mark"
                        d={`M 0 ${-symbolSize} L ${symbolSize} 0 L 0 ${symbolSize} L ${-symbolSize} 0 Z`}
                      />
                    )}
                    {chosen && (
                      <circle
                        r={symbolSize * 1.4}
                        fill="none"
                        stroke="#b05c32"
                        strokeWidth={symbolSize / 4}
                      />
                    )}
                    <text
                      y={-symbolSize * 1.6}
                      fontSize={symbolSize * 0.8}
                      textAnchor="middle"
                    >
                      {entity.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
      <p className="stage-caption">
        Leyenda: ○ Personaje · □ Objeto · ◇ Dispositivo. Un objeto llevado por
        alguien se describe en su inventario; no se inventa una posición
        independiente.
      </p>
      <h3>Lugares conectados y puertas</h3>
      {data.connections.some((connection) => connection.from === place?.id) && (
        <>
          <p className="stage-caption">
            Esquema de conexiones: muestra rutas y estado de puertas, sin
            asignarles posiciones físicas en el plano.
          </p>
          <svg
            role="img"
            aria-label="Esquema de conexiones y puertas"
            viewBox={`0 0 500 ${data.connections.filter((connection) => connection.from === place?.id).length * 65}`}
            className="stage-map"
          >
            <title>Conexiones confirmadas del lugar visible</title>
            {data.connections
              .filter((connection) => connection.from === place?.id)
              .map((connection, index) => {
                const door = data.doors.find(
                  (candidate) => candidate.id === connection.doorId,
                );
                return (
                  <g
                    key={`${connection.to}:${index}`}
                    transform={`translate(0 ${index * 65})`}
                  >
                    <rect
                      x="5"
                      y="10"
                      width="145"
                      height="32"
                      rx="5"
                      fill="#edf2e7"
                      stroke="#637666"
                    />
                    <text x="77" y="30" textAnchor="middle" fontSize="12">
                      {place?.name}
                    </text>
                    <path
                      d="M150 26 H340 M330 20 L340 26 L330 32"
                      fill="none"
                      stroke="#637666"
                    />
                    {door && (
                      <rect
                        x="238"
                        y="12"
                        width="15"
                        height="28"
                        fill={door.state === "open" ? "#fff" : "#b97742"}
                        stroke="#637666"
                      />
                    )}
                    <text x="245" y="57" textAnchor="middle" fontSize="11">
                      {door
                        ? `${door.label}: ${doorLabels[door.state]}`
                        : "Sin puerta"}
                    </text>
                    <rect
                      x="345"
                      y="10"
                      width="145"
                      height="32"
                      rx="5"
                      fill="#edf2e7"
                      stroke="#637666"
                    />
                    <text x="417" y="30" textAnchor="middle" fontSize="12">
                      {data.places.find(
                        (candidate) => candidate.id === connection.to,
                      )?.name ?? connection.to}
                    </text>
                  </g>
                );
              })}
          </svg>
        </>
      )}
      {data.connections.filter((connection) => connection.from === place?.id)
        .length === 0 ? (
        <p>No hay salidas configuradas desde este lugar.</p>
      ) : (
        <ul>
          {data.connections
            .filter((connection) => connection.from === place?.id)
            .map((connection, index) => {
              const door = data.doors.find(
                (candidate) => candidate.id === connection.doorId,
              );
              return (
                <li key={`${connection.from}:${connection.to}:${index}`}>
                  {data.places.find(
                    (candidate) => candidate.id === connection.to,
                  )?.name ?? connection.to}
                  :{" "}
                  {door
                    ? `${door.label}, ${doorLabels[door.state]}`
                    : "Conexión sin puerta"}{" "}
                  · traslado {connection.durationMs} ms{" "}
                  <button
                    onClick={() => {
                      setPlaceId(connection.to);
                      setZoom(1);
                    }}
                  >
                    Ver lugar conectado
                  </button>
                </li>
              );
            })}
        </ul>
      )}
      <h3>Índice accesible de entidades</h3>
      <ul className="stage-entity-list">
        {data.entities.map((entity) => (
          <li key={entity.id}>
            <button
              aria-pressed={selectedId === entity.id}
              onClick={() => choose(entity)}
            >
              <strong>
                {entityLabels[entity.kind]} · {entity.label}
              </strong>
              <br />
              {entity.location
                ? `${data.places.find((candidate) => candidate.id === entity.location?.placeId)?.name ?? entity.location.placeId} · posición ${entity.location.position.x}, ${entity.location.position.y}`
                : "Sin posición independiente"}{" "}
              · {entity.status}
              <br />
              {entity.details}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <section aria-label="Entidad seleccionada">
          <h3>{selected.label}</h3>
          <p>
            {entityLabels[selected.kind]} · {selected.status}
          </p>
          <p>{selected.details}</p>
          <p className="muted">
            Lectura de estado operativo. Seleccionar no crea percepción ni abre
            memoria privada.
          </p>
        </section>
      )}
    </section>
  );
}
