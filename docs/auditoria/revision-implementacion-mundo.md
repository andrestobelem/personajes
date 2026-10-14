# Revisión adversarial de la implementación del mundo

Revisión del 14 de octubre de 2026 contra S01–S03 v1.0, S04 como límite de autoridad, y la skill local `typescript-best-practices`. Alcance de código: `src/domain/world.ts` y `tests/world.test.ts`. La ruta asignada `src/application/world-resolver.ts` todavía no existe; el resolver y el builder están juntos en `world.ts`. No se editaron otros archivos ni se ejecutaron proveedores, Pi o escenas.

## Hallazgos corregidos

### Observar producía una excepción de schema

`WorldPerceptionSchema` exige `attemptId` para una percepción de observación, pero el branch `observe` no lo escribía. Resolver una observación que superaba sus guards terminaba en `ZodError` en lugar de una resolución tipada. Ahora la percepción conserva el ID del intento. El caso cubre observación visual y escucha por canal.

### El actor podía declarar su propia aprobación

El DTO de `communicate` aceptaba `approval:{kind:'approved',exactContentHash}` y el resolver sólo comparaba ese hash con el cuerpo recibido. Un actor podía calcular el mismo SHA-256 y afirmar que Continuista había aprobado el texto. La aprobación salió del schema actor-facing y ahora entra como receipt host-side estricto, con `proposalId`, versión, corrida, actor, revisión de estado y hash exacto. El resolver exige corrida/actor/revisión actuales y contenido idéntico; no aplica la emisión si falta o no coincide. Tests comprueban que el campo inyectado en el argumento del actor se rechaza, que un receipt de otra revisión se rechaza y que el receipt válido sólo habilita el contenido revisado.

El receipt es un límite de confianza, no una prueba criptográfica del ledger: la aplicación debe construirlo sólo después de comprobar en el registro durable que `proposalId`, versión, estado completo de Continuista y hash corresponden a esa propuesta. Ese vínculo no puede verificarse desde el estado puro del mundo.

### Vista y observación aceptaban entidades fuera de escena

La proyección recorría cualquier entidad con camino perceptivo, incluso personajes ausentes/no participantes y entidades situadas fuera de `scene.placeIds`. Un handle recordado permitía además volver a observar un objetivo que ya no pertenecía a la escena. Ahora la vista exige ubicación dentro de escena; para personajes también exige presencia y participación vigentes. El schema rechaza una presencia activa situada fuera de los lugares de esa escena. `observe` y los objetivos de `point` vuelven a comprobar pertenencia actual a escena. Tests cubren personaje ausente, objeto visible por una puerta abierta pero fuera de escena y handle antiguo.

### Una percepción sólo auditiva revelaba identidad y ubicación

El DTO de entidad incluía identidad, coordenadas y handle de lugar cuando el personaje sólo era audible. El detalle de `observe` también devolvía nombre y lugar al escuchar. La lista de entidades ahora requiere percepción visual; la escucha conserva el intento y comunica explícitamente que no confirma una emisión audible en ese corte, sin revelar nombre o lugar. Para observar auditivamente se aceptan tanto canales de habla como canales gestuales de modalidad auditiva. Tests cubren ausencia de identidad/coordenadas y el canal animal-auditivo.

### Rango y lugares de canal no se revalidaban en todos los trayectos

La escucha entre lugares comprobaba camino y alcance, pero no que ambos lugares pertenecieran al canal. La percepción visual ignoraba oscuridad del lugar de origen/destino y el `maxRange` del canal de gestos. Ahora los canales audio exigen ambos lugares, los trayectos y las distancias configuradas; la ruta visual considera oscuridad y, al resolver una comunicación visual, también el rango del canal.

### La oferta aparecía antes de estar entregada

El builder recorría todas las ofertas abiertas de `WorldSnapshot` y añadía handles/ofertas al contexto del destinatario aunque todavía no se hubiera entregado una percepción. La vista ahora deriva la oferta recibida de una percepción `kind:'offer'` dirigida al actor y coteja handle, destinatario y vigencia contra la oferta abierta. La aceptación sigue requiriendo el binding del handle recibido. El test crea una oferta abierta sin percepción y verifica que el actor no la vea ni pueda aceptarla; la ruta con percepción entregada continúa funcionando.

Este builder recibe percepciones pendientes ya filtradas por el host y no consulta el ledger de entregas. La app debe pasar sólo percepciones cuya entrega esté confirmada y verificar el `eventId` contra el evento durable antes de proyectarlas; el snapshot actual no contiene historial con el que el dominio pueda certificarlo.

### Señalar un objetivo podía revelarlo a quien no lo veía

La emisión de un gesto `point` copiaba `targetEntityId` a cada percepción del gesto, aunque el receptor viera al emisor pero no el objetivo. Al proyectar esa percepción, el receptor obtenía un handle y referencia de una entidad no perceptible. Ahora la audiencia efectiva de ese gesto se limita a receptores que pueden ver el objetivo por el canal/rango vigentes. Se conserva la emisión confirmada con audiencia efectiva vacía cuando nadie en la audiencia solicitada puede ver el objetivo. Un caso comprueba que el evento no crea percepciones ni bindings para ese receptor.

### Audiencia de broadcast era inconsistente

Un canal `broadcast` ignoraba la lista de handles suministrada para calcular receptores, pero la guardaba como `requestedAudience`; el evento podía afirmar que se había solicitado una persona mientras el efecto se difundía a todos. Broadcast ahora requiere selección vacía y registra como solicitada la audiencia implícita de participantes distintos del emisor; la audiencia efectiva continúa filtrada por presencia, disponibilidad, canal, lugar y percepción. Test cubre el caso correcto y rechaza mezclar una selección dirigida.

## Diferencias de integración que quedan abiertas

`ActorViewProjectionPort.projectForActor` de preparación recibe `{actorId, runId, continuity, atWorldSeq, fictionalAt}` y debe devolver `ActorViewProjection` con esa misma identidad/corrida/continuidad/corte y `entries`. `buildActorWorldView` recibe el snapshot que le entregue el host y percepciones pendientes, devuelve `{view:ActorWorldView,knowledge}`, y no recibe ni devuelve continuidad, `atWorldSeq` o un corte solicitado. Sus DTOs tampoco son asignables. El adaptador deberá reconstruir el snapshot y las percepciones hasta el corte durable pedido, mantener los bindings de actor en el host, validar el corte y traducir a entradas autorizadas; no se puede conectar el puerto mediante cast ni pasarle el snapshot global al compilador.

S02 define journal de resoluciones idempotentes, eventos, percepciones y entregas. `resolveWorldAttempt` es una función pura sin ledger: el mismo intento no se deduplica aquí y puede volver a generar IDs/percepciones si el host repite la llamada con el mismo snapshot. La aplicación debe buscar la resolución por corrida/origen antes de ejecutarla, confirmar snapshot/eventos/percepciones en la transacción indicada y manejar la entrega/outbox por su estado durable. El test unitario del resolver no demuestra esos contratos.

El `ActorKnowledge` se recibe como parámetro ordinario y la forma de `EntityHandle` valida sólo texto opaco de hasta 120 caracteres; ni el schema ni el ID source prueban aleatoriedad, no colisión con IDs globales o almacenamiento actor/corrida. El adaptador debe generar handles no derivables, persistir bindings por actor y corrida, y nunca aceptar ese objeto desde el browser o una tool del actor. El test de schemas no prueba el secreto del handle en producción.

La observación auditiva ahora no inventa una frase, identidad o lugar, pero tampoco tiene una fuente de emisión/evento confirmado dentro de la función. El worker debe usar eventos/percepciones auditivas confirmadas para describir algo oído; el resultado actual sólo puede comunicar que la inspección no confirmó una emisión en el corte. La capacidad de detectar audio en escena real requiere integrar el ledger de emisiones y su canal.

## Verificación

- `node --import tsx --test tests/world.test.ts`: 12/12 pasaron; no se llamó a Pi ni a proveedores.
- `npx tsc --noEmit`: pasó.
- `npm test`: 64 pasaron, 0 fallaron y 5 pruebas reales de ICM quedaron omitidas por falta de `PERSONAJES_ICM_TEST_BINARY`.
- SHA-256 al cierre: `src/domain/world.ts` `b75578f62cff9e0a1d7a4c2631dfffddb865f315f6cf8235e6dfd5c2fb71851c`; `tests/world.test.ts` `5b5dc6a29e10ff886604fead5f768e0bc4be1d4c5b04cf1e17adc0774fdd9b96`.

Estas pruebas verifican funciones del dominio y contrato de types; no acreditan persistencia, auth del receipt, aislamiento de handles en el host, delivery durable ni integración de `ActorViewProjectionPort`.
