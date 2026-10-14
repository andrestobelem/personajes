# Puerto Pi actoral y frontera de despacho

Fecha: 14 de octubre de 2026. Evidencia de código local; no se ejecutó OAuth ni inferencia.

`createActorPiRequestPort` captura identidad, corrida, pulso, job, generación y lease desde el host. Es un puerto de ejecución por claim: el modelo no puede elegir esos valores. El journal v12 añade `actor_job_request_leases` y `actor_job_checkpoints`; sus contenidos son metadata privada, no saber del personaje ni hechos ficticios.

## Invariantes implementadas

- Elegibilidad exige corrida y job `running`, pulso y lease vigentes, actor preparado y presente en escena abierta, contexto y sesión compatibles y corte World todavía vigente.
- La reserva vuelve a comprobar esas condiciones dentro de la transacción que incrementa ambos contadores. Cada reserva actoral queda vinculada al lease que la creó. Una reserva sin reconciliar o una solicitud despachada/ambigua bloquea otra invocación.
- La transición a `dispatched` repite el gate dentro de la transacción y exige tanto el checkpoint de input como el candidato Pi del mismo request, sesión, leaf y claim. Repetir `dispatched` no concede otra autorización de transporte.
- Las transiciones terminales conservan la atribución al lease original aunque el mundo se pause. Sólo una reserva demostrablemente `undispatched` devuelve cuota; una respuesta incierta conserva el gasto.
- Los checkpoints guardan payload canónico y hash. Los inputs tienen slot único por generación/request; los terminales se agregan como registros inmutables, sin sobreescribir el leaf aceptado. Un terminal `completed` necesita request confirmado y leaf.
- Las escrituras de candidatos y propuestas conservan los controles del journal. El commit de una propuesta de job exige receipt Pi aceptado para su versión y hash exactos, además de la revisión comunicativa del Continuista.

## Evidencia y revisión

[Las pruebas de journal](../../tests/world-journal.test.ts) usan SQLite durable y el puerto real: identidad ajena, pausa entre reserva y despacho, inputs faltantes, replay de despacho, respuesta ambigua, lease recuperado y reapertura de checkpoints. Otra prueba recorre intención humana, job, input Pi, propuesta, revisión exacta, aceptación y commit; el retry tras reabrir conserva un solo evento. Los datos de sesión y candidatos son fixtures explícitos: no acreditan transporte de Luna.

El agente `pi_port_review` revisó los contratos y luego el código. Su hallazgo de ausencia de inputs como precondición durable de despacho quedó corregido con pruebas negativas. Identificó además una restricción del orden de orquestación: **revisar y reformular antes de aceptar el terminal final**. `acceptActorTurn` consume percepciones y marca el job `accepted`; después ya no admite nuevas versiones actorales bajo ese claim.

## Integraciones pendientes

El launcher todavía no usa este puerto ni convoca Pi. Faltan ciclo durable de pulsos/jobs, recuperación explícita de reservas/generaciones, worker actoral, worker del Continuista, renovación de tools por versión conservando historial tentativo, entrega de percepciones entre personajes y conversación observable en API/GUI. Los roles administrativos requieren su propio puerto y ledger; este puerto sólo autoriza actores.

La factory de Pi usa el perfil elegido por representación, que se comprueba al crear la sesión y antes de cada request; Luna/xhigh se conserva sólo para historia. La aceptación frente a pausa o cambios del Escenario requiere todavía una política de worker: registrar metadata terminal no autoriza efectos ni publicación. Los 77 requisitos integrales continúan pendientes.
