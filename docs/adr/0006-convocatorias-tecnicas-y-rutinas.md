# ADR 0006 — Convocatorias técnicas y rutinas

Estado: decisión de implementación delegada aprobada para desarrollo; aceptación del runtime pendiente.

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

`src/domain/actor-activation.ts` implementa el planner puro de metas y límites ficticios. El journal v31 agrega un ledger durable de causa e invitaciones iniciales, las admite con `start`, `resume` o `step`, y relaciona cada invitación con un job actoral sin crear percepción ni commit ficticios. El coordinador revalida al abrir el pulso y reclamar el job, conserva el corte de admisión como procedencia y congela el corte actual; pause/resume y recuperación no duplican la causa. Cerrar la corrida terminaliza las invitaciones y jobs técnicos pendientes. `tests/actor-activation.test.ts`, `tests/world-journal.test.ts`, `tests/representation-runtime.test.ts` y las pruebas de migración verifican elegibilidad, ausencia de percepciones fabricadas, ausencia de mutación, pausa/reanudación, replay, recuperación, cuotas y cierre. Esto acredita sólo la convocatoria inicial por metas; la convocatoria por ventanas, el avance durable del reloj ficticio y la inferencia repetida por rutinas siguen pendientes.
