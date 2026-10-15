# C56: posesiones en el Escenario y el Inspector

## Problema

El render SVG y el índice accesible ya admitían objetos en posesión sin inventarles coordenadas, pero `projectRunStage` sólo proyectaba objetos ubicados en un lugar. El Inspector opt-in mostraba el estado mental del personaje, pero omitía las posesiones materiales del snapshot consultado.

## Cambio

La proyección pública del Escenario incluye un objeto `heldBy` sólo cuando su portador es un personaje presente en la escena y en un lugar visible. Conserva `placeId:null`, `position:null` y el identificador del portador para que el índice accesible indique la posesión sin fingir una posición física. Los objetos de personajes ausentes no se incluyen. La proyección no publica la descripción subjetiva que pudiera conservar un actor.

El Inspector deriva las posesiones del mismo `WorldSnapshot` confirmado que selecciona para el corte actual o histórico. Devuelve atributos materiales del objeto y, en un campo separado, el nombre/descripción subjetivos registrados por el personaje seleccionado. No lee el dueño actual para reconstruir el pasado y no combina la memoria de otro actor.

## Evidencia

`tests/run-inspector.test.ts` abre un journal SQLite, confirma una acción `take` y compara el corte inicial con el presente. La prueba acredita la posesión histórica previa, la posesión actual posterior, la separación del conocimiento subjetivo y el aislamiento frente a un objeto de otro personaje. Sobre el snapshot actual, ejecuta el productor real `projectRunStage`: muestra los objetos llevados por un personaje visible y omite el objeto de un personaje ausente. También renderiza el Inspector privado y comprueba sus secciones. `tests/run-stage-ui.test.ts` conserva una prueba separada del contrato de renderizado SVG/índice.

El cambio mejora evidencia para ESC-02, MEM-02 y UI-05. No se marca ninguno como completo: todavía falta la aceptación visual integral del mapa e interacciones y la aceptación completa del producto.

## Límite

El dominio actual no representa si un objeto llevado está oculto dentro de un bolsillo o recipiente. La proyección trata como visible la posesión de participantes visibles; una futura distinción entre llevado y visualmente expuesto requiere un dato de dominio explícito y pruebas de percepción.

## Verificación

`npm run verify` pasó: TypeScript, 1.168 pruebas aprobadas, cero fallidas y una omitida por requerir Linux. `npm run build` pasó con 473 módulos transformados. La prueba focal de `tests/run-inspector.test.ts` también pasó de forma aislada.
