# ADR 0006 — Convocatorias técnicas y rutinas

Estado: decisión de implementación aprobada; runtime v32 implementado y verificado localmente. La aceptación integral de ritmo y audio sigue pendiente.

## Problema

El coordinador sólo encuentra causas enlazadas a percepciones entregadas. Una escena sin mensaje humano no permite todavía que actores con metas propias inicien una actuación. Crear una percepción, un intento actoral o un commit de mundo ficticios para despertar una instancia falsearía el conocimiento y la continuidad.

## Decisión

Mantener un ledger técnico de convocatorias separado de hechos y percepciones. Una causa inicial agrupa los actores elegibles de la escena activa con metas activas; cada actor conserva su instancia, conocimiento, contexto y decisiones. Una causa de rutina agrupa los actores pertinentes al mismo límite ficticio, con deduplicación propia por actor y ventana. Una convocatoria no obliga a actuar: espera y silencio siguen siendo decisiones actorales.

Las causas se admiten bajo un control `start`, `resume` o `step` con preflight fresco y cuotas disponibles. Su identidad durable impide que cada reanudación repita el coste de la iniciativa inicial. Recuperar el host no crea convocatorias ni inferencia. El paso único consume un pulso, que puede contener varios participantes, y vuelve a pausa.

La causa técnica referencia configuración, identidad y corte confirmado, incluido el corte inicial con commitIndex cero, mediante una relación propia. No se crea un `world_commit` falso para satisfacer una FK. Al reclamar un job se congela el corte confirmado vigente y se revalida identidad, escena, metas y disponibilidad. Una causa incompatible se omite o bloquea con evidencia; no se reintenta indefinidamente ni se inventa percepción para justificar un cambio de contexto.

El reloj ficticio nunca deriva de latencia, reloj del equipo ni duración fuera de línea. `manual-only` no avanza por rutinas. `advance-while-running` permite un comando de sistema durable e idempotente al siguiente límite, con delta limitado por `maxAdvanceMs`, sólo durante ejecución autorizada. Un avance confirmado causado por una acción también puede cruzar límites de rutina. Los despertares requieren deduplicación y no forman un ciclo ocupado que consuma inferencia sin otra circunstancia.

## Coste y límites

Actor, Continuista y roles administrativos reservan el mismo presupuesto de pulso, corrida, tiempo de inferencia y concurrencia. Agrupar actores no concede una cuota individual adicional. La elección de agrupar convocatorias y la política de deduplicación son decisiones de implementación aprobadas en la delegación; no se atribuyen como una nueva preferencia expresa de la persona usuaria.

## Evidencia y estado

`src/domain/actor-activation.ts` implementa el planner puro de metas y límites ficticios. El journal v31 agregó el ledger durable de convocatoria inicial por metas. En v32, la migración amplía ese ledger para ventanas de rutina y crea recibos de avance del reloj. Un avance autorizado confirma en una sola transacción el snapshot, el evento `clockAdvanced`, el commit y las invitaciones deduplicadas por límite ficticio. El runtime sólo avanza un Escenario habilitado y en ejecución con política `advance-while-running`; respeta `maxAdvanceMs`, no deriva tiempo del reloj del equipo y no avanza durante la recuperación. `manual-only` permanece inmóvil. Un commit actoral que cruza una ventana también admite la convocatoria correspondiente. Las invitaciones se vuelven jobs con inbox vacío; se revalidan contra identidad, configuración, disponibilidad, presencia y escena, y el prompt identifica con precisión si la causa fue una meta inicial o una ventana de rutina. Ninguna de estas operaciones inventa percepciones.

`tests/actor-activation.test.ts`, `tests/world-journal.test.ts`, `tests/representation-runtime.test.ts` y las pruebas de migración cubren límites, pausa, replay tras reabrir SQLite, activaciones por ventana y cruces causados por acciones. Con ICM local, la suite completa terminó con 565 pruebas: 564 aprobadas, cero fallidas y una omitida por requerir Linux; `npm run build` y `git diff --check` pasaron. No se contactó a proveedores reales. Las ventanas siguen siendo intervalos absolutos y no se repiten solas: faltan recurrencia/calendario de día y noche y calibración audiovisual de Get Smart. El corte 37 posterior acredita el recorrido rutinario actor→Continuista→conversación con transporte controlado. La aceptación integral de los 77 requisitos sigue pendiente.


### Revisión integrada posterior (corte 37)

El coordinador sólo solicita avance cuando ha agotado las causas procesables en el instante actual; descarta convocatorias agotadas dentro de la misma transacción antes de concluir que no hay trabajo. El paso sin causa puede alcanzar la siguiente rutina autorizada antes de finalizar. Una convocatoria técnica válida permite aceptar un turno con inbox vacío; los turnos por percepción conservan el requisito de entradas asignadas. El journal rechaza avances nuevos mientras hay pulsos o jobs en vuelo, preservando replay de recibos existentes.

La disponibilidad se calcula por transiciones efectivas: volver al estado predeterminado disponible al terminar una ventana no disponible puede convocar al actor; dos intervalos contiguos disponibles no lo convocan dos veces. Un avance del reloj invalida las ofertas abiertas que vencieron, con eventos y snapshot en la misma transacción; el fallo revierte todo el avance. La invalidación de presentación incluye todos los eventos del commit.

Las pruebas integradas utilizan ICM local y el SDK Pi con transporte controlado, y verifican publicaciones en la lectura de conversaciones, turnos consecutivos, respuesta humana antes del descanso y retorno a pausa tras un único pulso. No acreditan inferencia de proveedor real, recorrido visual ni fidelidad audiovisual. Ver [progreso y validación](../auditoria/implementacion-progreso.md).
