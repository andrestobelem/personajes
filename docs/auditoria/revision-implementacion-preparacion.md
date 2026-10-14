# Revisión adversarial de preparación de personajes

Revisión del 14 de octubre de 2026 contra S01 v1.0, S03 v1.0, la skill `typescript-best-practices`, el contrato disponible de World y los tests existentes. Alcance de edición: `src/domain/preparation.ts`, `src/application/prepare-character.ts` y `tests/preparation.test.ts`. No se modificó World ni se ejecutó inferencia o I/O externo.

## Hallazgos corregidos

### Corte de recuerdos con igual instante ficticio podía incluir secuencia futura

`PreparedCharacterSchema` ya limita cada experiencia inicial por el `worldSeq` y el instante de su propio corte. Sin embargo, `compilePrivateActorPrompt` sólo comparaba `throughFictionalAt` con el momento actual antes de compilar esas experiencias. En una misma corrida, un evento de secuencia 5 al mismo instante ficticio que la secuencia 4 pasaba ese control y podía entrar en el prompt de la secuencia 4. El orden de secuencia es autoritativo aunque varios eventos tengan duración cero.

La compilación ahora rechaza un corte inicial cuyo `throughWorldSeq` supere el solicitado cuando ambos pertenecen a la misma corrida; mantiene la comparación temporal para cortes de otra corrida, cuyos números de secuencia no comparten espacio. Se agregó un caso donde ambas experiencias tienen instante 40 y el corte futuro usa secuencia 5. `tests/preparation.test.ts` lo verifica.

### Excepción de conocimiento sin contenido admitido enlazado

`character-knowledge-adaptation` registraba tema, motivo e ID de adaptación, pero no identificaba qué antecedente transmite ese conocimiento. La preparación podía aceptar una excepción sin contenido para el actor, o una declaración desvinculada de cualquier antecedente curado con esa adaptación. El texto de la política es administrativo y no debe convertirse por sí solo en un hecho diegético.

La variante ahora exige `antecedentIds`. `PreparedCharacterSchema` comprueba que cada ID exista, sea único en esa excepción y apunte a un antecedente curado con `explicit-adaptation` y el mismo ID. También rechaza IDs duplicados dentro de la preparación, para que los enlaces sean unívocos. El compilador incluye el antecedente permitido por la ruta normal de antecedentes; no entrega al actor el motivo administrativo. El test nuevo comprueba tanto el caso enlazado como el caso rechazado sin antecedente.

## Límites de cobertura documental

La preparación demuestra que cada antecedente incluido aplica al corte de continuidad elegido y tiene procedencia; no demuestra por sí sola que se hayan revisado todos los hitos relevantes del expediente. `antecedents` admite una lista vacía declarada y no existe un registro de cobertura que clasifique cada hito o dato fuente como admitido, no pertinente, no establecido o reservado. S01 exige curación y cobertura de antecedentes pertinentes, pero también prohíbe inferirlos automáticamente del Markdown. Por eso el schema puede certificar consistencia de lo declarado, no exhaustividad semántica del expediente. La aceptación de canon/continuidad debe conservar una revisión humana de cobertura; no se añadió una clasificación automática ni una decisión de producto nueva.

`source-not-established` se conserva como política de preparación y no se pasa como una lista de nombres desconocidos al actor. El prompt mantiene la regla general de que una ausencia contextual no equivale a amnesia. Las adaptaciones que conceden conocimiento sí requieren ahora antecedente explícito, evitando convertir una etiqueta de política en recuerdo.

## Diferencias de integración con World

El contrato que consume `compilePrivateActorPrompt` es `ActorViewProjection`: metadatos de actor/corrida/continuidad/corte y una lista plana `entries[{kind, content}]`. El puerto `projectForActor` es abstracto y retorna `unknown`; en el repositorio no hay un adaptador que lo conecte con `buildActorWorldView`. Ese builder devuelve `{view, knowledge}` con `kind:'actor-world-view'`, revisión/reloj, lugar/escena, entidades, inbox, ofertas y handles opacos, y también muta/retorna conocimiento de handles host-side. Los dos DTO no son asignables ni tienen la misma granularidad. Los tests de preparación usan un puerto sintético, así que comprueban validación del corte, no la conexión real.

La vista plana que el compilador incorpora pierde handles de entidad/canal/oferta, posiciones, capacidades operativas, IDs de operación de dispositivo y el estado suficiente para construir intentos de tools. `ActorWorldView` sí tiene handles y capabilities, pero sus operaciones de dispositivo sólo muestran `id` y `label`; el DTO no expone duración/efecto de operación ni rutina del actor, y la vista de `self` no contiene su disponibilidad. Tampoco lleva por sí sola `runId`, continuidad o `atWorldSeq`. No se debe resolver pasando el snapshot global ni IDs internos al prompt.

La adaptación debe ser explícita en el host: validar que el snapshot y el conocimiento correspondan al actor, corrida, continuidad y corte solicitados; invocar el builder de World; y entregar al actor un DTO validado de vista de actor junto con el contexto mínimo de tools que preserve los handles opacos y los campos operativos necesarios. El host mantiene los bindings; el compilador no crea ni deduce handles. Una adaptación de texto puede servir para lectura, pero no reemplaza los datos tipados que requieren las tools. No hay casts estructurales seguros entre estos contratos.

Hay además dos modelos de metas incompatibles con el mismo concepto nominal. Preparación usa `GoalId` slug y `Goal` con `goalId`, dueño/participantes, `desiredOutcome`/`sharedOutcome`, motivación propia, condiciones de revisión, `achieved` y referencias de evidencia. World usa UUID v4 para su `GoalId`; `ActorGoal` tiene `id`, descripción, prioridad, `proposed|active|suspended|completed|abandoned`, revisión e historial, y metas compartidas llevan participantes sin incluir al propietario en la lista. No son intercambiables. El adaptador del host deberá mapear IDs mediante una tabla/constructor persistente, convertir estados de forma explícita, mantener la motivación compartida privada por actor y conservar condiciones/evidencia en el componente que las aplique. No convertir strings con casts ni descartar campos silenciosamente.

## Verificación

- Los tests importan y ejecutan los cambios de preparación; `npm run typecheck` global ahora falla sólo en `src/adapters/icm.ts:430` (`string` no asignable al ID marcado `IcmMemoryId`), fuera de este alcance. La verificación previa a ese cambio concurrente pasó.
- `node --import tsx --test tests/preparation.test.ts`: 10/10 pasaron, incluidos los dos casos nuevos.
- La corrida global más reciente, `npm test`: 55 pasaron, 0 fallaron y 3 pruebas ICM reales fueron omitidas por falta de `PERSONAJES_ICM_TEST_BINARY`.

Ningún resultado de tests unitarios certifica el enlace live entre World, el host de sesión Pi, la memoria o el producto completo.
