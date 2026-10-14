# Integración de la vista World con el contexto privado del actor

Revisión e implementación de puente del 14 de octubre de 2026. Alcance de código: `src/domain/preparation.ts`, `src/application/actor-world-projection.ts`, `src/application/prepare-character.ts`, `tests/actor-world-projection.test.ts` y los tests existentes de preparación. El dominio World no se modificó. Esta entrega implementa y prueba un adaptador puro de aplicación; todavía no acredita que un host o runtime lo invoque.

## Contrato implementado

`ActorWorldProjectionRequest` conserva actor, versión de identidad preparada, corrida, referencia versionada de continuidad, `atWorldSeq` y `fictionalAt`. Su schema vive en el dominio browser-safe de preparación y no importa `world.ts` ni `node:crypto`.

`createActorWorldProjectionPort` carga desde un puerto del host un `actor-world-host-cut`: snapshot World, continuidad, revisión de conocimiento privado del actor y percepciones cuya entrega durable el host ya haya confirmado. El puente rechaza una corrida, secuencia, instante ficticio, continuidad, identidad preparada, destinatario o percepción duplicada que no coincida con la solicitud. También rechaza percepciones con momento posterior al corte cuando el tipo de percepción lo declara.

Con el snapshot ya comprobado, llama al `buildActorWorldView` de World. El actor sólo recibe la vista para la que ese builder aplica escena, posición, modalidades y bindings opacos; no recibe el snapshot ni el mapa host de handles a IDs globales. El DTO final se deriva de `ActorWorldViewSchema`: conserva lugar actual y accesible, capacidades, canales, entidades perceptibles, metas propias, vínculos propios, ofertas e inbox. Elimina `self.beliefs` y `self.experiences` de esa vista para que el compilador use únicamente las experiencias propias que recibe por su entrada separada.

Los UUID de metas que el builder entrega en `self.goals` se conservan como referencias privadas de las metas del propio actor. No son IDs de entidad ni referencias a metas ajenas; el builder obtiene esas metas de `observer.mind.goals`. S01 requiere que `reviseGoal` identifique la meta propia. La resolución de comandos aún debe validar propiedad y estado actuales en el host.

Antes de devolver la vista, el puente manda los bindings nuevos al host junto con CAS sobre revisión World, `worldSeq`, continuidad y revisión de conocimiento. Un conflicto detiene la compilación y no entrega handles que no quedaron durables. La respuesta `stored` debe avanzar exactamente una revisión. El puerto y su almacenamiento concreto permanecen por implementar.

El compilador serializa únicamente `projection.world` en el prompt, después de contrastar sus metadatos de actor, corrida, continuidad y corte. No añade `actorId`, `runId`, IDs de entidad, snapshot ni bindings host. El límite aplicado es 160.000 caracteres; si se excede, falla con diagnóstico y conserva el texto íntegro, sin truncamiento.

## Preparación frente al estado operativo

El prompt conserva identidad, voz, antecedentes admitidos, aptitudes preparadas y experiencias iniciales/actuales propias. Las aptitudes preparadas no incluyen el `deviceId` de catálogo; la vista World delimita qué capacidades, canales y operaciones están disponibles para actuar en ese corte. La memoria privada que venga dentro de World no reemplaza ni complementa silenciosamente la entrada de experiencias del compilador.

Metas y vínculos se leen de la vista del Escenario en curso, no se vuelven a adjuntar desde `PreparedCharacter`. El estado de metas en World es mutable; repetir a la vez la curación inicial como si siguiera vigente produciría metas duplicadas u obsoletas. `PreparedCharacter.goals` debe sembrar las metas al crear la corrida mediante una conversión explícita y persistida del host. Hoy `preparation.GoalIdSchema` es un slug y `world.GoalIdSchema` es UUID; no hay contrato de mapeo de identidad, participantes, condiciones, evidencias, estado o revisiones entre ambas formas. El puente no convierte esos IDs ni borra la fuente preparada.

La relación curada, capabilities e inventario preparados tampoco se concatenan como estado actual duplicado. La inicialización de World debe recibirlos o registrar explícitamente sus vacíos/adaptaciones. La vista World actual no contiene inventario propio, rutina/disponibilidad del actor ni duraciones de acciones; el snapshot sí los contiene en otra forma. El puente no los inventa ni expone el snapshot para suplirlos. S01 especifica metas/capacidades/inventario y S03 exige circunstancias y affordances actuales; falta completar esos campos actor-facing en World y/o un contrato de inicialización host. El dueño de World indicó que extenderá el builder por separado; hasta entonces esta limitación sigue vigente.

El compilador recibe experiencias como argumento validado, pero esta ruta no las obtiene de ICM ni persiste/actualiza conocimiento subjetivo. La recuperación y escritura por actor/corrida pertenecen a los puertos host/ICM de S02. `ActorKnowledge` del puente sólo conserva bindings de handles y no sustituye memoria narrativa. La confirmación/consumo de inbox tampoco la realiza: el host debe correlacionar entrega y evento durable, definir cuándo una percepción deja de estar pendiente y evitar reinyectar eventos ya representados en el contexto recuperado.

## Obligaciones del host que siguen abiertas

- `loadActorWorldCut` debe leer snapshot y continuidad coherentes con el mismo corte; no basta consultar el snapshot más reciente si no coincide con `atWorldSeq` y `fictionalAt`.
- Debe pasar sólo percepciones de esta corrida y actor cuya entrega durable esté confirmada, hasta el corte pedido, y no reintroducir las ya consumidas. World no certifica entrega. Las percepciones de oferta no traen `fictitiousAt`, así que la pertenencia temporal de esas entregas sólo puede garantizarla el host mediante journal/deliveries.
- `compareAndSwapActorKnowledge` debe persistir `ActorKnowledge` en una clave privada de actor y corrida, impedir escritura desde cliente o tool y comprobar conjuntamente revisión World/seq, continuidad y revisión de conocimiento. Un CAS fallido no puede enviar la proyección a Pi.
- Los `ids` inyectados deben producir handles impredecibles y sin relación con IDs globales. El test sólo prueba valores sintéticos, no entropía, aislamiento entre actores ni almacenamiento.
- El bootstrap debe declarar cómo las metas, vínculos, capacidades e inventario curados alimentan por primera vez el Escenario y cómo se versiona esa adaptación. No debe mantener en el prompt dos fuentes contradictorias.
- Al resolver `reviseGoal`, el host debe comprobar que el UUID pertenece al actor remitente y que revisión/evidencias siguen vigentes. La vista no da acceso a metas ajenas.
- El worker de memorias debe controlar deduplicación/delivery conforme a S02. El puente no es idempotencia del journal y no reclama ejecución de ICM.

## Evidencia y límites

`node --import tsx --test tests/preparation.test.ts tests/actor-world-projection.test.ts`: 17/17 pruebas pasan. Los casos verifican corte exacto, concordancia de versión de identidad/continuidad, rechazo de percepciones fuera de destinatario/corte y de conflicto CAS, persistencia de bindings del lado host, proyección de canal/mensaje, aislamiento frente a memorias ajenas y propias incluidas accidentalmente en el view, ausencia de IDs globales de entidades, selección de metas runtime sobre metas preparadas sin duplicación y rechazo de prompt demasiado grande.

`npm test` completo: 72 pasan, 7 fallan fuera de este alcance y 5 pruebas reales de ICM se omiten por no tener `PERSONAJES_ICM_TEST_BINARY`. Cinco fallos de journal/local-host abortan con `near ")": syntax error`, otro test de journal no detecta el rechazo de schema futuro y un test Pi observa secuencia 7 donde esperaba 4. La comprobación global `npx tsc --noEmit` sigue bloqueada por errores concurrentes fuera de estos archivos en `src/adapters/journal.ts` y `src/domain/world-journal.ts` (imports/declaraciones sin uso y schemas de IDs ausentes). No aparecen errores de los archivos de este puente en la salida de compilación. No se ejecutaron Pi, OAuth, ICM, proveedores, GUI ni escenas live; estas pruebas no acreditan integración end-to-end.
