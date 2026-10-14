# Resultado de la corrección de gates de preflight

Desde esta corrección, `ReadyRunConfiguration` significa que la preparación pasó la validación de configuración; por sí sola no autoriza la ejecución. Un `PreflightReport` sólo es `passed` cuando todos sus checks son `passed`. Si un check queda `deferred`, bloqueado o no disponible, el reporte es `blocked`.

La prueba de acceso a Pi debe estar vigente y corresponder a la misma cuenta y perfil. Si falta, venció o no se puede leer, el reporte conserva el motivo como `deferred` y bloquea el inicio. Preflight sólo lee el recibo: no realiza autenticación, inferencia ni una prueba live implícita. La prueba vigente aprobada permite `passed` cuando todos los demás gates también pasan.

La verificación focal fue `node --import tsx --test tests/production.test.ts` (23/23) y `npm run typecheck` (0 errores). Las pruebas comprueban recibo vigente aprobado, acceso ausente, acceso expirado y gates diferidos de disponibilidad/voz. No verifican una ruta HTTP ni un inicio durable; esos siguen fuera de este cambio.

Este resultado reemplaza la afirmación anterior de [implementación de la puesta](implementacion-puesta.md) que permitía iniciar con acceso no probado o con otros checks diferidos.
