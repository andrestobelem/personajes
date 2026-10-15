# Diálogo sobre cortes privados exactos

Fecha: 15 de octubre de 2026. Entrevista real entre los agentes `fork_contract_audit` (entrevistador) y `fork_icm_audit` (custodio), coordinada por el integrador. Sigue el [procedimiento grill-with-docs](../diseno/procedimiento-grill-with-docs.md) y las skills locales [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md) y [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md).

Las respuestas delegadas no son elecciones nuevas del usuario. El requisito preservado es conocimiento situado y memoria propia con procedencia; la materialización mediante checkpoints por commit es una propuesta técnica de los agentes. Este registro no acredita su implementación ni el fork completo.

El custodio conserva sus [respuestas y clasificación](cortes-privados-respuestas.md) por separado.

## Fuentes y problema comprobado

- [Constitución](../constitucion.md), §§5 y 12: memoria situada, procedencia y ausencia de conocimientos futuros.
- [S02](../specs/02-persistencia-e-icm.md), contrato de fork: estado confirmado, memoria privada admitida hasta un corte y nuevas bases ICM.
- [S05](../specs/05-interfaz.md), §§8.1–8.2: inspector histórico y reconstrucción de cortes exactos.
- [ADR 0007](../adr/0007-estructura-episodica-y-bifurcacion.md): bifurcación con continuidad nueva y fuente inmutable.
- Código inspeccionado: `src/adapters/journal.ts`, `src/adapters/icm.ts`, `src/domain/experience.ts`, `src/domain/world-schema.ts` y `src/domain/preparation.ts`.

La lectura de experiencias por `worldSeq` no distingue su aceptación posterior a un commit que conserva esa misma secuencia. Las entregas y el conocimiento de handles pueden cambiar sin crear un commit del Escenario. Por eso leer los stores actuales para reconstruir una mente pasada no demuestra fidelidad temporal.

## Ronda 1 — Qué pertenece al corte

**Pregunta 1.** Si el commit C confirma una frase y su entrega se acepta después, antes de C+1, ¿bifurcar C excluye esa entrega aunque tenga secuencia menor o igual a C? La recomendación fue fijar el checkpoint al final de la misma transacción del commit, sin actualizarlo después. Su costo es que C no representa toda recepción que eventualmente producirá su frase.

**Respuesta del custodio.** Sí: la entrega posterior queda excluida. La ausencia de conocimiento futuro es una regla derivada de la constitución y S05; el checkpoint al final de la transacción es una propuesta técnica. Si aún no existe C+1 no se finge ese recuerdo en C.

**Pregunta 2.** ¿Se admite unir por `ExperienceId` las experiencias propias persistidas y las de `actor.mind.experiences` del snapshot, únicamente dentro de la transacción de captura? La recomendación fue comparar envelope canónico y hash para los IDs repetidos y abortar si difieren. Un receipt ICM no sería condición de admisión.

**Respuesta del custodio.** Sí: unión de experiencias propias aceptadas en esa transacción y de la mente del snapshot, con igualdad exacta para duplicados. Una discrepancia aborta toda la transacción. Memoria propia es requisito; integridad es una regla derivada; la unión y captura son la propuesta de implementación. La experiencia durable y su proyección indexada en ICM son capas diferentes. La lectura posterior del checkpoint no vuelve a consultar experiencias vivas para completarlo.

**Pregunta 3.** Si cambió la memoria sin commit nuevo, ¿el inspector muestra ese estado como presente vivo mientras el fork usa el último checkpoint acreditado, o debe inventarse un fence adicional? La recomendación fue mantener el corte fijo y declararlo claramente.

**Respuesta del custodio.** El inspector presente puede mostrar el estado vivo. El fork utiliza un checkpoint fijo acreditado y muestra el corte y la exclusión de aceptaciones posteriores. Un fence adicional sería otro diseño, todavía no adoptado; no se inventa ni se usa un timestamp para simular que hubo commit.

**Precisión de fuentes.** La respuesta inicial mencionó el §4 constitucional; el entrevistador comprobó que la sección pertinente a memoria es el §5. El §4 trata agencia y objetivos. Esta corrección no cambia el acuerdo.

## Ronda 2 — Completitud, procedencia y legado

**Pregunta 4.** ¿El checkpoint abarca a todos los personajes del snapshot, aunque estén fuera de escena o sin preparar? Si falta su fila de conocimiento, ¿se registra `unavailable` en lugar de inventar bindings vacíos?

**Respuesta del custodio.** Sí. Ausencia de escena o preparación no elimina la vida propia del personaje ni lo habilita para actuar. Se conserva su mente y sus experiencias propias. Conocimiento disponible requiere una fila canónica validada; un conjunto de bindings realmente vacío se distingue de la falta de evidencia. Si el personaje no existe en el snapshot, no se fabrica un corte para él.

**Pregunta 5.** ¿Un manifiesto determinista de IDs y hashes de experiencias, revisión/hash de conocimiento y hash de snapshot puede probar la admisión, en lugar de un simple máximo de secuencia? ¿Cómo se tratan temporalidad, dueño, duplicados y referencias transitivas?

**Respuesta del custodio.** Sí. El máximo de `worldSeq` no acredita pertenencia al corte. Deben validarse dueño, temporalidad y referencias respecto del conjunto admitido, incluyendo la preparación inmutable autorizada. Una experiencia actual de otro actor, un dato futuro o payload distinto bajo el mismo ID no se elimina silenciosamente para continuar: corresponde diagnosticar y abortar la captura transaccional incompatible.

**Repregunta y precisión.** `PreparedCharacter.initialExperience` puede contener legítimamente un `run-cut` de otra corrida. El entrevistador comprobó esa posibilidad en `src/domain/preparation.ts` y en `compileCharacterContext`. El custodio confirmó que esa preparación se conserva en su sección original, con hash y procedencia. No se mezcla con las experiencias del run actual ni se rechaza una configuración válida por tener ese antecedente. Una referencia `basedOn` a un antecedente inicial autorizado debe verificarse como tal; no se exige que todos los antecedentes hayan nacido en la corrida corriente.

**Pregunta 6.** Para corridas anteriores sin checkpoints, ¿se informa que el corte privado histórico no está disponible, aunque exista un snapshot físico? ¿Un commit nuevo puede capturar el estado que realmente existe entonces sin rellenar el pasado?

**Respuesta del custodio.** Sí. No se hace backfill desde el presente. Los nuevos commits de una corrida heredada pueden guardar el estado real de ese momento, mientras los cortes anteriores permanecen no disponibles. El commit inicial cero se captura sólo en una nueva alta o sustitución de configuración editable que todavía no actuó; no se genera retrospectivamente durante una migración.

**Pregunta 7.** ¿La comprobación enlaza el hash del snapshot fuente con cada entrada actoral y con el conjunto ordenado del checkpoint, sin consultar sesiones Pi o memoria ICM actuales? ¿Puede ICM fuente añadir experiencias al conjunto?

**Respuesta del custodio.** La lectura es inmutable y verifica esos enlaces. Pi e ICM actuales no son requisitos de lectura ni autoridades del corte. Una corroboración opcional con ICM nunca agrega miembros, modifica el origen ni sustituye la admisión registrada. El requisito es memoria propia y conocimiento situado; integridad y ausencia de futuro son reglas derivadas; el formato concreto de hashes y la captura por commit son propuestas técnicas.

## Resultado y límites

La entrevista tiene dos rondas efectivamente intercambiadas. Se acordó distinguir **estado privado vivo** de **corte privado confirmado**, y distinguir **conocimiento vacío acreditado** de **conocimiento no disponible**. El integrador debe incorporar esos términos al glosario cuando adopte el modelo; este documento conserva la conversación y no modifica otros artefactos por su cuenta.

La captura debe ejecutarse después de todos los efectos de la transacción, incluida la inserción del conocimiento inicial. Un trigger ejecutado al insertar `world_commits` antes de terminar esos efectos no satisface esa condición. Debe cubrir productores de commits actorales, humanos, de reloj, estructurales y de circunstancias; las migraciones históricas no son productores nuevos de recuerdos.

Este acuerdo no implementa bifurcación, remapeo, nuevas bases ICM ni sesiones Pi. Tampoco decide un nuevo mecanismo para congelar el presente entre commits. Para acreditar fork completo siguen haciendo falta manifiesto de procedencia, transformación de IDs y referencias, importación soportada a bases privadas independientes, publicación recuperable, API, interfaz y pruebas integrales.

La evidencia requerida para los cortes incluye: entrega aceptada después de C con la misma secuencia excluida en C y disponible en un corte posterior; conocimiento cambiado después de C ausente de C; experiencia sin receipt ICM incluida si ya era durable; ID duplicado con contenido discrepante rechazado sin commit parcial; personaje fuera de escena conservado; ausencia de conocimiento y legado diagnosticados; preparación válida de otro run preservada; lectura histórica que no usa stores actuales; y manipulación de hashes detectada.
