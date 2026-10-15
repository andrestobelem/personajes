# Rutinas diarias y ciclo de día y noche

Corte 41, 15 de octubre de 2026. Implementa recurrencia local y fase editorial configurables; no constituye aceptación integral de TIM-01 ni una puesta real del reparto de Get Smart.

## Contrato y autoridad

La [entrevista](dialogo-rutinas-diarias.md) y las [respuestas del custodio](rutinas-diarias-respuestas.md) conservan preguntas efectivas, propuestas y alternativas. [ADR 0009](../adr/0009-rutinas-locales-y-ciclo-editorial.md) registra la elección técnica. No se eligieron horarios canónicos, una fisiología detallada ni un calendario astronómico del amanecer.

La variante `daily` conserva estado por defecto, política `compatible` explícita y ventanas de minutos locales. Inicio pertenece a 0..1439, fin a 0..1440; intervalos semiabiertos, fin menor que inicio cruza medianoche, igualdad inválida y 0→1440 cubre un día entero. Los solapes se rechazan también a través de medianoche. El ciclo opcional `clock.dayNight` tiene dos inicios distintos y la misma política explícita. Ningún campo nuevo se agrega por defecto a snapshots anteriores; no hay migración de filas ni recanonicalización histórica.

El motor comparte resolución entre preflight, acciones, percepción y admisión. Soporta offsets fijos y zonas IANA mediante `@js-temporal/polyfill` 0.5.1. `compatible` elige la primera ocurrencia repetida y desplaza una hora inexistente por el salto. Intervalos resueltos nulos/invertidos se omiten con diagnóstico; si ventanas distintas colisionan al desplazarse, se omiten las afectadas con diagnóstico en vez de elegir una arbitrariamente. La preparación muestra los diagnósticos en torno a la fecha elegida y bloquea zona/rango no soportados. El barrido de fronteras evita convocaciones redundantes por ventanas contiguas o disponibilidad continua. Las ventanas absolutas conservan sus extremos históricos, incluso un extremo redundante, por compatibilidad del ledger.

La próxima frontera usa sólo personajes preparados, presentes y activos con disponibilidad explícita y escena abierta, o el ciclo editorial configurado. Requiere ejecución, ausencia de trabajo en vuelo y máximo por salto; no usa el reloj del equipo ni recupera tiempo fuera de línea. Se convoca únicamente por el período disponible efectivo vigente: no se recuperan turnos de ventanas perdidas. IDs usan frontera UTC absoluta, diferenciando días sin duplicar replay. Cuotas y tiempo reservado no se reinician al cambiar el día.

Un ciclo sin fronteras actorales futuras puede avanzar una vez por operación de agenda y quedar idle; no genera infinitos días vacíos en un bucle. La fase se deriva al corte observado para la interfaz y no cambia luces, crea parlamentos ni produce percepciones. La revisión independiente descubrió que el reloj del actor heredaba la configuración editorial: se corrigieron proyección y schema estricto, y una regresión exige vistas idénticas con/sin ciclo editorial.

## Verificación

- [Calendario puro](../../tests/routine-calendar.test.ts): medianoche, nocturnidad, DST 23/25 horas, hora repetida/inexistente, día colapsado, fecha civil omitida, límites y diagnósticos.
- [Contrato de mundo](../../tests/daily-world-contract.test.ts): solapes, invariancia legada, disponibilidad coincidente preflight/percepción y exclusión del ciclo editorial del actor.
- [Journal real](../../tests/daily-routines-journal.test.ts): tres días, replay/reapertura, disponibilidad tras una acción, pausa/escena cerrada/límite, presupuesto y fase sin iluminación inventada.
- [Runtime](../../tests/representation-runtime.test.ts): rutina diaria→Actor→Continuista→conversación con SQLite/ICM reales y Pi SDK de transporte controlado; recuperación sin duplicar. Otra prueba asegura que ciclo sin estímulos termina tras un avance sin abrir sesiones ni consumir inferencia.
- [Preparación](../../tests/daily-calendar-ui.test.ts): edición/remoción del ciclo, preservación al cambiar fecha, horas humanas, política explícita y selección inicial de rutina sin ocultar sus campos.

El navegador integrado configuró el ciclo 06:00/18:00 en una preparación sintética, lo guardó y luego creó una rutina con descanso 22:00→07:00. Se eligió `compatible` explícitamente para ambos. El borrador se guardó y validó Ready en revisión 2; la reapertura conservó las cuatro horas. La primera prueba detectó el bloqueo de la variante diaria antes de elegir política; se corrigió el selector y se agregó regresión. [Captura de rutina validada](evidencias/rutina-diaria-20261015.png).

Una segunda corrida sintética tenía dos avances confirmados antes de abrir el navegador. El presente mostró noche y luz normal; al abrir el commit 1 mostró día y mantuvo luz normal. [Captura de fase histórica](evidencias/fase-historica-20261015.png). El launcher visual no tenía ICM ni proveedores configurados; la cadena de actuación corresponde a la prueba independiente, no a esa captura.

Gate final: TypeScript y **671 pruebas: 670 aprobadas, cero fallidas y una omitida por requerir Linux**. Build de 443 módulos y `git diff --check` correctos. No se contactaron proveedores reales.

## Fuentes y límites

Se consultaron las [APIs y reglas de desambiguación de Temporal](https://tc39.es/proposal-temporal/docs/zoneddatetime.html) y el [polyfill oficial](https://github.com/js-temporal/temporal-polyfill), además de Context7 como índice de sus fuentes. El polyfill queda fijado en el lockfile; la base de zonas IANA depende de Intl/ICU del entorno. No se acredita replay idéntico de proyecciones recalculadas entre versiones distintas de esa base: los eventos/fronteras ya guardados conservan sus instantes y recibos. Fijar y acreditar el entorno de replay IANA entre hosts sigue siendo una limitación operativa visible.

Faltan aceptación temporal completa, recorrido con servicios reales, calendario/zonas elegidos para la primera puesta y calibración audiovisual. No se cierra ninguno de los 77 requisitos por sumar este corte.
