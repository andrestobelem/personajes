# Cobertura del Regidor mecánico

Auditoría local del 15 de octubre de 2026. Esta revisión contrasta la responsabilidad definida en [S03](../specs/03-pi-y-coordinacion.md) y las fronteras de [S04](../specs/04-api-y-autoridad.md) con código y pruebas ejecutadas. No introduce un rol LLM ni cierra la aceptación integral de ACT/NFR.

## Responsabilidad y realización

El Regidor comprueba origen, canal, capacidad, tipos, autor, base/revisión y herramientas permitidas. Es una responsabilidad mecánica distribuida entre fronteras del host, adaptador Pi, journal y resolución del Escenario. La ausencia de una clase o sesión denominada «Regidor» no implica que falten esos controles. Continuista conserva la revisión semántica de contenido comunicativo exacto; su aprobación no confirma por sí sola hechos ni recepción.

| Frontera | Implementación inspeccionada | Evidencia ejecutada |
| --- | --- | --- |
| Origen y autoridad HTTP | [http.ts](../../src/server/http.ts): bootstrap local, Host/Origin, sesión, CSRF y modo interlocutor ligado a run. La intervención obtiene `participantId` de la sesión, nunca del body. | `tests/http.test.ts`: «HTTP loopback bloquea Host, Origin, Sec-Fetch cross-site y mutaciones sin Origin canónico», «HTTP no admite lecturas privadas sin cookie ni escrituras sin CSRF» y «HTTP limita la intervención al interlocutor configurado y conserva reintentos del Escenario». |
| Tipos e identidad del autor | [actor-tools.ts](../../src/application/actor-tools.ts): schemas cerrados; rechaza `attemptId`, `runId`, `actorId`, `expectedRevision` aportados por el modelo y los fija desde el contexto host. [interaction-schema.ts](../../src/domain/interaction-schema.ts) cierra el payload humano. | `tests/actor-tools.test.ts`: «propose_action rechaza campos de autoridad aportados por el modelo» y «el SDK Pi valida las variantes publicadas y rechaza acciones abiertas o con autoridad»; `tests/interaction.test.ts`: «la intervención no admite autoridad ni identidad de emisor desde el cliente». |
| Base, versiones, autor y lease | [journal.ts](../../src/adapters/journal.ts), `registerWorldProposal`: exige lifecycle running, revisión actual, actor preparado en escena, fence de identidad/continuidad, job/generación/lease cuando existe job durable, época vigente, versión/slot y hash exactos. Reintentos idénticos recuperan el registro; un payload distinto no reemplaza su versión. Reformulación exige revisión completa de la versión previa. | `tests/world-journal.test.ts`: «sólo el lease vigente de un job actoral puede registrar una propuesta nueva», «aceptar un job valida lease y corte exacto, consume asignaciones de forma atómica y recupera el receipt», «reformulación usa slots durables, no habilita una versión con revisión incompleta y conserva el mismo payload al reintentar». |
| Canal, capacidad y destinatarios | [world.ts](../../src/domain/world.ts), `resolveWorldAttempt` y resolución humana: validan run, revisión, escena abierta, actor disponible, capacidades, handles conocidos y reglas del canal. La recepción se calcula por alcance, percepción y disponibilidad; no deriva de la lista deseada solamente. | `tests/world.test.ts`: «la revisión exacta habilita emisión, pero la audiencia efectiva depende de canal y alcance», «un canal broadcast define la audiencia solicitada y no acepta selección dirigida», «la intervención no se aplica con destinatarios fuera de escena, canal ajeno al perfil o revisión obsoleta» y pruebas de capacidades efectivas. |
| Allowlist efectiva de tools | [pi.ts](../../src/adapters/pi.ts), `verifyToolPolicy`, `createPiSession`, `assertSessionProfile`: actor exactamente `recall_memory` y `propose_action`, tools directas, nombres cerrados sin herramientas incorporadas; SDK con `noTools: 'all'`, sin recursos ambientales. Compara herramientas activas e invocables con la allowlist. | `tests/actor-tools.test.ts`: «crea sólo las dos capacidades del actor y acota recall al corte y memoria propios»; `tests/pi.test.ts`: «el SDK Pi activo expone sólo las dos tools directas del actor, sin llamar al modelo». |
| Separación revisión/confirmación | [journal.ts](../../src/adapters/journal.ts) y [world.ts](../../src/domain/world.ts) ligan aprobación a versión, revisión y contenido exactos; el Escenario confirma efectos y entregas. | `tests/world-journal.test.ts`: «Continuista sólo habilita la propuesta exacta y speech no se publica sin receipt», «una reformulación no cambia la revisión base después de que otra propuesta avanzó el Escenario» y «fallo SQL revierte snapshot, resolución, evento, percepción y delivery juntos». |

## Ejecución reproducible

Se ejecutaron estos comandos sobre el árbol actual:

```sh
node --import tsx --test tests/actor-tools.test.ts tests/interaction.test.ts tests/interaction-review.test.ts tests/world.test.ts tests/world-journal.test.ts tests/http.test.ts
node --import tsx --test tests/pi.test.ts
```

Resultado: **98 + 20 = 118 pruebas aprobadas**, cero fallos, cero omitidas. El primer grupo usa dominio, HTTP local, SQLite y puertos de memoria según cada fixture. El segundo usa SDK Pi instalado y transporte controlado; no demuestra acceso real al proveedor. Esta ejecución no necesitó invocar el binario ICM ni acredita su comportamiento por sí sola.

## Límites y pendientes reales

La evidencia demuestra controles locales concretos, no calidad dramática, resistencia semántica exhaustiva ni comportamiento live ante cualquier inyección. No acredita una representación completa, sus invalidaciones gráficas ni funcionamiento con cuentas reales. Tampoco convierte todo campo de procedencia en una capacidad de autoridad.

`registerWorldProposal` conserva una vía host interna sin job durable cuando no hay job activo y no se aporta lease; no es un endpoint de actor y no debe confundirse con una identidad HTTP o permiso para que un cliente elija autor. La composición productiva actoral emplea el job/lease y la época. Cualquier nueva frontera de entrada debe conservar esa distinción y volver a probar los controles pertinentes.

Sigue pendiente la aceptación integral durante una puesta real: intervención humana, actor, Continuista, commit, recepción situada y recuperación bajo controles operativos. No hay fundamento documental para añadir un Regidor LLM sólo para satisfacer un nombre de rol: el perfil seleccionable aplica a los componentes que efectivamente infieran.
