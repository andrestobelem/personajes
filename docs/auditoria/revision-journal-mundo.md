# Revisión adversarial del journal y los commits de mundo

Fecha: **14 de octubre de 2026**. Revisión independiente contra S01–S03 y los límites de autoridad de S04. Código revisado: `src/adapters/journal.ts`, `src/domain/world-journal.ts`, `src/application/commit-world-attempt.ts` y los tests de journal/mundo. La revisión se amplió, con autorización del integrador, a la composición de recuperación en `src/application/local-host.ts`, su prueba y la integración journal–ICM. No se llamaron modelos ni proveedores remotos.

## Dictamen

La ruta verificada persiste resolución, revisión, evento, snapshot, percepciones planificadas y entregas en una transacción, y sólo crea experiencia/outbox al completar la entrega autorizada. El journal v4 conserva la idempotencia de propuestas y commits y rechaza CAS obsoletos. Se corrigió además la reapertura del outbox: el worker no roba un claim que podría seguir activo; la recuperación se realiza al inicio de un host nuevo, después de adquirir ownership exclusivo y antes de exponer el journal a los workers.

No hay bloqueo adicional en las transacciones probadas. La integración Pi todavía tiene un bloqueo: falta el cursor durable que confirme qué inbox recibió cada actor ya incorporado a su checkpoint aceptado. No se afirma integración end-to-end del runtime.

## Hallazgos y correcciones

**Cortes históricos mezclaban estado de revisiones posteriores.** Lecturas por `worldSeq` podían resolver a un snapshot posterior cuando varias revisiones compartían secuencia; el corte de actor también corría riesgo de combinarlo con conocimiento actual. El journal ahora selecciona la primera frontera durable de esa secuencia para la lectura histórica, y `loadActorWorldCut` sólo acepta la revisión actual exacta que pide el puente. El CAS de conocimiento vuelve a verificar revisión y secuencia World actuales, además de continuidad y revisión subjetiva. La prueba mantiene el mismo `worldSeq`, avanza varias revisiones/metas, comprueba el historial y rechaza proyección/CAS obsoletos.

**El actor podía autoaprobar una propuesta o reutilizar una revisión fuera de scope.** Las propuestas quedaron ligadas a actor, escena, revisión base, corrida, generación, slot de job, versión e hashes canónicos. La review del Continuista debe corresponder a la versión y hash exactos y ser la última propuesta pendiente en su scope; una reformulación conserva la revisión base y exige review completa de la versión anterior. La aprobación llega al resolver como receipt host-side y se revalida dentro del commit. El receipt no autentica al Continuista por sí solo: el caller host debe construirlo desde el registro durable validado.

**Una resolución podía repetirse o dejar un commit parcial.** El journal deduplica por el origen de intento; la misma resolución devuelve el resultado guardado y el mismo origen con otro contenido falla. Cuando una resolución agrega eventos, verifica secuencias contiguas y escribe resolución, eventos, snapshot, percepciones y entregas en la transacción común. La revisión añade un caso de rollback SQL y casos para resolución obsoleta, repetición e idempotencia.

**Entrega planificada podía confundirse con percepción recibida o memoria.** Una percepción `planned` no entra en la vista del actor ni crea outbox. El claim serial de entrega no se roba mientras existe otro claim. `completeWorldDelivery` vuelve a comprobar run, owner, evento, percepción, destinatario, corte y payload; confirma entrega y vincula Experience/outbox en la misma transacción. La emisión con recepción vacía/parcial conserva esa diferencia. La proyección posterior a ICM usa payload congelado, receipt y ULID validados.

**El claim de memoria quedaba atascado al reabrir tras un crash.** El primer guard devolvía `busy` para cualquier token, incluso uno abandonado después de un `store` ICM real y antes del receipt. Se mantiene `busy` para un claim existente durante la operación normal. Al abrir, `openLocalHost` adquiere primero el lock exclusivo, abre el journal y ejecuta la limpieza transaccional de los tokens pendientes antes de publicar el host. La transacción conserva experiencia, payload, contador y outbox; sólo libera el derecho a repetir el store idempotente. Si falla, cierra journal y libera ownership sin devolver un host listo. La prueba confirma que un segundo host no puede abrir en paralelo, simula el cierre entre store y ack y prueba que el nuevo host repara el receipt con el mismo ULID. `openJournal` directo no realiza esa recuperación.

## Bloqueo de integración Pi: consumo de inbox

El journal acredita que una percepción fue entregada, y `loadActorWorldCut` puede incluir las percepciones entregadas del actor dentro del corte. No existe todavía un cursor durable ligado a la sesión Pi que indique cuáles de esas percepciones ya fueron incorporadas en el checkpoint aceptado. `ActorKnowledge` conserva bindings y conocimiento privado; no confirma consumo de inbox.

Sin ese cursor, después de una caída el host puede compilar de nuevo una percepción que ya está en el historial Pi y volver a anexarla al contexto. También puede ocurrir lo contrario si el host marca consumo al entregar o al construir una proyección que nunca llegó a un checkpoint aceptado: se perdería del contexto recuperado. La integración debe identificar el conjunto exacto de IDs de percepción (o un cursor monotónico equivalente que no salte huecos) que entró en cada request.

El punto durable correcto es la misma transacción host que acepta el `terminal-candidate`, guarda el resultado/propuesta de esa request y avanza `actor_sessions.committed_leaf_id`: allí se registra el consumo exacto del inbox asociado al input de esa request. Antes de esa transacción, una caída debe reabrir desde el leaf anterior y volver a incluir las percepciones; después, el leaf y el cursor deben recuperarse juntos para no reinyectarlas. Un candidato capturado por Pi, la entrega World, el `store` de ICM o la construcción de `ActorWorldProjection` no bastan como confirmación. Esta correlación es una tarea pendiente del ledger/integración Pi y no se simula en el journal actual.

## Verificación y límites

Con ICM 0.11.4 fijado, el gate `tests/journal.test.ts`, `tests/memory-projection.test.ts`, `tests/icm.test.ts` y `tests/local-host.test.ts` pasó **13/13**. El conjunto completo `npm test` pasó **114/114** al ejecutar con `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm`. El typecheck consultado en esta revisión quedó detenido por `src/application/production-preflight.ts:9`, que declara `NarrationMode` sin usar; es una edición fuera de los archivos revisados. No hubo login OAuth, inferencia live, server de producto, interfaz, voz ni prueba de crash eléctrico.

Hashes SHA-256 del código al cierre de este informe:

| Archivo | SHA-256 |
|---|---|
| `src/adapters/journal.ts` | `2979acae9b9b6e7932aa991ea1b783b8a55f2544a3f46ca86ae9e566e9b3a4ec` |
| `src/domain/world-journal.ts` | `04483db39dd164d3c5e4d39ec9f9b150c87a518d2fa1051ffc4b019a88f3d3b5` |
| `src/application/commit-world-attempt.ts` | `b04b568d386807014d2fbadb137863b69b8f0cc2af036b2afedc08c248a911c7` |
| `src/application/local-host.ts` | `941927108861467bf66986136c64bcab1fc4eca492b09088c2d57a614aaf416a` |
| `tests/world-journal.test.ts` | `7470e291827c89463a2795ce6ae60a50762ed1cbe72d1f70731385b1f2372477` |
| `tests/journal.test.ts` | `41abaa31aecfd5fbee940aa3a9b0c6e894efe2952207dda1045003c1cc037d5c` |
| `tests/memory-projection.test.ts` | `e0809141fda8434299c422c357def988a6d757bb106a0aacd785e2981ec7fd60` |

La verificación de componente no acredita el worker lanzado por el servidor ni las transacciones conjuntas entre journal y checkpoint Pi. El cursor de consumo descrito arriba debe resolverse antes de afirmar recuperación de contexto Pi sin duplicados.
