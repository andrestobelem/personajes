# Configuración gráfica del ejecutable ICM

15 de octubre de 2026. Implementación y verificación local completadas para este corte; no acredita login ni inferencia real de proveedor.

El panel «Memoria ICM del host», en Configuración → Acceso a Pi, acepta una ruta absoluta del ejecutable ya instalado y ofrece aplicar o desactivar explícitamente. La selección local prevalece sobre la configuración inicial por entorno; null guardado sigue desactivado después de reiniciar aunque exista `PERSONAJES_ICM_BINARY`.

La selección y sus trabajos viven fuera de los backups de representaciones, bajo `<privateDataRoot>-runtime`. Los recibos son inmutables, el historial pertenece al principal autenticado y la revisión controla escrituras concurrentes. Un resultado incierto se recupera con la misma clave, ruta y revisión. Consultar o reiniciar no aplica trabajos pendientes. [Decisión de persistencia y exclusión](../adr/0016-configuracion-local-del-runtime-icm.md).

El trabajo responde antes de obtener la barrera de mantenimiento. Valida el CLI 0.11.4 con proceso acotado, comprueba inactividad y recompone sobre la misma raíz sin recover, actores, inferencia ni audio. Conserva credenciales y archivos de sesión; sólo confirma la selección estable después de aplicar. Las consultas del control local permanecen disponibles durante la recomposición. No elimina SQLite de actores al desactivar.

Evidencia inicial: prueba del launcher real con HTTP e ICM nativo aprobada; verifica configuración, preparación de SQLite vacía desde la composición nueva, desactivación, reinicio, precedencia sobre entorno y bytes OAuth sintéticos intactos, sin eventos, experiencias, sesiones actorales ni solicitudes de modelo. Las pruebas del panel y rutas verifican sesión, CSRF, precondición, idempotencia, lectura sin aplicación, recuperación de resultado incierto y cancelación de lecturas al desmontar.

La revisión independiente detectó y pidió corregir apertura de SQLite antes de verificar enlaces y permisos, timeout de descendientes del proceso de validación y exclusión del control local después de SIGKILL. Los dos errores reproducidos se corrigieron y sus regresiones pasaron. El helper de exclusión fue probado con dos procesos, SIGKILL y reacquisición; conserva sidecars o registros legados inesperados y los rechaza sin borrarlos. Esto sólo acredita el control local: el ownership del host de la obra mantiene su política de recuperación explícita. La aceptación integral de la obra y el acceso real por OAuth siguen pendientes.

El recorrido de navegador verificó configuración inicial sin entorno, aplicación de ICM nativo, ruta canónica y revisión guardadas, reinicio real, historial y recuperación del resultado sin nueva aplicación. Evidencia visual local: `/private/tmp/personajes-icm-configuracion-guardada.png`. No se conectó ninguna cuenta de proveedor.

Verificación global final con ICM real: **1.229 pruebas aprobadas, cero fallos y una omisión exclusiva de Linux** (1.230 totales); typecheck y build correctos (482 módulos). Revisión independiente: 24 pruebas aprobadas antes del caso adicional de conservación de sidecar; el helper final pasó siete pruebas y la suite global incluye ese caso. Log: `/private/tmp/personajes-icm-configuration-full-verify.log`.
