# Inicio gráfico y recuperación de sesión

Corte del 16 de octubre de 2026. La prioridad del usuario es poder ver una representación de principio a fin. Esta corrección atiende el inicio y los controles del recorrido principal.

## Problemas reproducidos y corrección

La interfaz conservaba la promesa de sesión local después de recibir 401/403. «Actualizar estado» repetía la lectura sin renovar esa sesión. Además, un error de sincronización podía seguir visible después de recuperar una lectura correcta. No se pudo demostrar que estos defectos fueran la causa exacta del clic sin efecto observado en el ensayo anterior.

El panel de controles ahora ofrece «Restablecer sesión local» ante rechazos de autenticación o CSRF. Usa el mecanismo existente de reconexión y después consulta el estado. La reconexión no envía controles ni restituye permisos privados automáticamente. Los errores de lectura desaparecen al confirmar una lectura nueva; los mensajes de operaciones se conservan por separado. Iniciar informa inmediatamente la verificación de requisitos y el envío de la solicitud.

Una respuesta perdida puede ocultar un inicio ya aplicado. Incluso si su recuperación recibe 401/403, se conserva el mismo intent y su clave. Después de reconectar, «Recuperar el mismo control» confirma esa operación sin crear otra. Los resultados tardíos de un preflight abortado no alteran una representación nueva.

## Verificación

Cinco pruebas React montadas usan journal SQLite y lifecycle reales con transporte controlado: error transitorio de lectura; sesión vencida y posterior inicio; inicio aplicado con respuesta perdida seguido de 401 y recuperación; CSRF de otra pestaña; y progreso visible con bloqueo de doble clic. No consumen inferencias ni fabrican emisiones.

La revisión independiente no encontró bloqueos adicionales en este alcance. Verificación global: **1340 tests, 1339 aprobados, cero fallos y una omisión exclusiva de Linux**, con ICM CLI real; incluye typecheck. Build final y `git diff --check` también pasaron. Logs locales: `/private/tmp/personajes-start-session-global.log` y `/private/tmp/personajes-start-session-build-final.log`.

El host real 4182 se reinició ordenadamente, sin corridas en ejecución, y cargó el código v43. Desde la GUI se publicó una función independiente desde el corte inicial sin diálogos de la puesta anterior, se reabrieron sus memorias, se renovó el sondeo OAuth y pasó el preflight. El botón «Iniciar» confirmó **En ejecución** y la vista en vivo mostró las intervenciones reales de Hymie y Maxwell Smart. Se completaron **12 intervenciones**, desenlace observado por el Director, cierre de escena y episodio y detención, sin inicio ni controles por API o comandos. [Transcript, capturas y límites](../representaciones/cartel-sospechoso-funcion-grafica.md).

Esto no acredita aún la expiración natural de sesión en navegador, la preparación nueva desde cero, ni una puesta con selección ICM Markdown: la continuidad elegida conserva su configuración histórica sin esa selección.
