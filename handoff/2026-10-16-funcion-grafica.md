# Handoff · función gráfica completa

Corte: 16 de octubre de 2026 UTC, noche del 15 en Argentina. Rama `main`, base `3892c0b`. Hay numerosos cambios locales y archivos nuevos de cortes anteriores y actuales; **sin commit ni push nuevos**. Preservarlos. El objetivo integral sigue abierto; la prioridad del usuario es ver una representación completa de principio a fin. No retomar importación como camino crítico.

## Entrega comprobada

Se corrigieron inicio y recuperación de sesión en `RunControlsPanel.tsx`: mensajes de progreso, separación de errores de lectura, reconexión explícita ante 401/403 y conservación de la misma clave para recuperar un control de resultado incierto. La reconexión no reenvía acciones. Cinco pruebas React montadas con SQLite/lifecycle reales cubren los casos principales; revisión independiente sin nuevos bloqueos. [Auditoría](../docs/auditoria/inicio-y-recuperacion-de-sesion.md).

**1340 tests: 1339 aprobados, cero fallos, una omisión exclusiva de Linux**. Typecheck, build final y whitespace pasan. Verificación con `TMPDIR=/private/tmp` y `PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`. No repetir la suite amplia sin cambios nuevos o motivos concretos.

Se ejecutó íntegramente desde la GUI [«El cartel sospechoso»](../docs/representaciones/cartel-sospechoso-funcion-grafica.md): continuidad independiente desde la apertura anterior al diálogo, memorias propias, sondeo OAuth, preflight, botón Iniciar, vista en vivo, tres intervenciones del visitante, respuestas actorales, desenlace observado, cierre de escena y episodio y detención. **12 intervenciones, 46 llamadas, 198.602 ms medidos y cero reservas activas**. Llamadas y tiempo acumulado sin tope. El visitante fue interpretado por el asistente. Es un ensayo textual corto; no un episodio televisivo con audio ni aceptación integral.

Representación `cac84cae-a5dc-4750-85a7-967507d44262`: detenida, commit 14, secuencia 12, Escenario 14, estructura 2. Escena cerrada commit 13 y episodio commit 14. Queda pendiente en ficción comprobar el origen escolar del cartel. La GUI muestra el cierre y conserva la conversación. El [ensayo previo](../docs/representaciones/funcion-completa.md) permanece intacto.

## Host actual

Se reinició ordenadamente el servidor sin corridas en ejecución. **4182 carga ahora código v43**, PID observado `17203`, log `/private/tmp/personajes-live-v43-server.log`. Confirmar PID antes de operarlo; no tocar 4173. Raíz privada `/Users/andrestobelem/Library/Application Support/Personajes`. ICM configurado `/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`; OAuth OpenAI presente. Estos datos, memorias y sesiones no viajan por Git. La función conserva ausencia histórica de selección ICM Markdown y no acredita inferencia real con esos paquetes.

## Siguiente acción

Facilitar el mismo recorrido desde **preparación nueva**, con curación del reparto y selección ICM explícita hasta Ready. El Configurador previo a Ready sigue pendiente; no confundirlo con el Configurador de evolución ya conectado. Conservar los restantes límites de [PENDIENTES](../docs/PENDIENTES.md) y el [handoff anterior](2026-10-15-continuidad-entre-maquinas.md). La aceptación extensa de importación/transferencia queda en V2.

La expiración de sesión y CSRF se verificaron con React montado y transporte controlado; el navegador verificó el inicio normal real. No afirmar que se reprodujo y probó una expiración natural en navegador. La causa exacta del clic fallido histórico no quedó demostrada. El cierre tuvo una validación de longitud rechazada y corregida desde la propia GUI, descrita en el registro de la función.
