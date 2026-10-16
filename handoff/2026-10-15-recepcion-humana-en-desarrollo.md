# Handoff · recepción humana en desarrollo

Fecha: 15 de octubre de 2026. Rama comprobada: `main`. Último commit comprobado: `3892c0b` (`docs: add handoffs for continuing work across machines`). Hay cambios locales de código, tests y documentación, incluidos archivos nuevos. Este documento describe ese trabajo local; para recibirlo en otra máquina primero debe quedar confirmado y publicado en Git.

## Objetivo y contexto

El objetivo general continúa abierto: revisar toda la documentación, corregir inconsistencias, completar PRD/specs, implementar y verificar el alcance acordado. Conservar la trazabilidad de los 77 criterios. El pedido inmediato es disponer de esta carpeta para continuar desde otras máquinas.

Leer [AGENTS.md](../AGENTS.md), [pendientes](../docs/PENDIENTES.md) y el [corte anterior](2026-10-15-cierre-y-preflight.md). Este último contiene la evidencia del episodio real cerrado, las correcciones de preflight y los nombres de escenas históricas.

## Trabajo local posterior

Se implementó recepción humana dirigida: presencia pública mínima en el mundo, handles humanos situados para los actores, audiencia humana solicitada/efectiva en eventos y bandeja consultada según la identidad interlocutora de la sesión. La incorporación ocurre en un nuevo corte al iniciar o intervenir; las representaciones históricas conservan sus datos originales. Una recepción humana no equivale a lectura ni crea memoria ICM humana.

El diseño está en [ADR 0017](../docs/adr/0017-recepcion-humana-situada.md) y su [entrevista de diseño](../docs/diseno/dialogo-recepcion-humana.md). Incluye cambios en dominio, journal, fork, HTTP y GUI. Los tests nuevos incluyen `human-reception-world`, `human-reception-journal` y `human-reception-ui`.

La revisión independiente no encontró bloqueos de autoridad, aislamiento A/B, historia o fork. Detectó un límite de rendimiento: la bandeja consulta toda la historia cada dos segundos; conviene lectura incremental.

## Estado de verificación

**Corte posterior en desarrollo:** la prueba real reveló recuperación omitida de una activación sin inbox y un pulso humano posterior ocupado. Se está implementando journal v42 y sus regresiones, además de diagnósticos seguros del Continuista y layout responsive. Los resultados globales siguientes corresponden al corte anterior; todavía no certifican estos cambios posteriores. Leer [la ronda de recuperación](../docs/diseno/dialogo-recuperacion-causas.md) y revisar la verificación más reciente antes de migrar el host privado o reanudar el ensayo.

La verificación global posterior a las correcciones terminó con **1265 tests: 1264 aprobados, cero fallos y una omisión por plataforma**, con ICM real. Typecheck y build aprobados. La ejecución usó `TMPDIR=/private/tmp` y el ejecutable ICM 0.11.4 local. El log temporal del host original es `/private/tmp/personajes-human-final-verify.log`; no viaja por Git. Los dos fallos anteriores eran expectativas desactualizadas y están corregidos.

El navegador real se reinició con este build. La puesta detenida permite elegir «Visitante del ensayo» y consultar la bandeja después del cierre; permanece vacía porque sus eventos históricos no registraban audiencia humana, y el envío sigue bloqueado. La [auditoría de recepción](../docs/auditoria/recepcion-humana-situada.md) conserva evidencia y límites. Un corte posterior ejecutó [El visitante y el aviso](../docs/representaciones/el-visitante-y-el-aviso.md) con OAuth real: dos emisiones de Hymie llegaron al visitante, incluida la respuesta a su consulta. La representación quedó detenida en commit 4/secuencia 3 tras detectar recuperación omitida de Max, cuyo job inicial no tenía inbox. Consultar ese documento para eventos, audiencias y límites.

La presencia en escena ya permite recibir gestos visuales por otro canal compatible; la remota conserva su enlace. La selección de identidad para la bandeja histórica está separada de los ocupantes del mapa. La consulta usa incrementos por secuencia y deduplicación por evento.

Se agregaron después dos regresiones, sin cambios en producción: paginación con recepciones y frontera inclusiva sin duplicación, y respuesta tardía de A tras activar B. Cliente y React pasaron 13/13; typecheck global aprobado. La suite global indicada arriba precede a estas dos incorporaciones.

## Próximas acciones

1. Inspeccionar `git status` y el diff completo, preservando los cambios locales. Revisar los tests focales posteriores a la ejecución global si se agregaron nuevas regresiones.
2. Completar y verificar la recuperación explícita de convocatorias por meta/rutina sin inbox; el ensayo nuevo ya acredita recepción dirigida real, pero Max quedó bloqueado. Revisar código/migración/pruebas posteriores antes de reanudar. Mantener los datos viejos sin backfill.
3. Completar el recorrido de intervención durante trabajo activo, que todavía puede exigir recuperación manual; preservar agencia, época, CAS y memoria.
4. Continuar los pendientes de alcance completo y la correspondencia requisito → spec → evidencia. Actualizar este índice al producir el próximo handoff.

Permanecen abiertos otros puntos del objetivo: intervención durante turnos activos, ruteo ICM Markdown al runtime, evolución e inspección histórica, aceptación completa de GUI, accesibilidad, calibración audiovisual y acceso real Anthropic/ElevenLabs. Consultar el documento de pendientes para el alcance completo.

## Arranque y transferencia entre máquinas

Instalar la versión de Node exigida por `package.json` y dependencias con `npm ci`. Usar los scripts de ese archivo para verificar, construir y arrancar. Configurar una raíz privada persistente mediante `PERSONAJES_PRIVATE_DATA_ROOT` y el puerto con `PERSONAJES_PORT`; el host anterior usaba el puerto 4182.

Configurar en la aplicación el ejecutable local ICM 0.11.4 y realizar el login del proveedor en destino. Cada personaje mantiene su instancia Pi y memoria separadas. Conservar los perfiles de inferencia definidos en AGENTS.md y los límites de llamadas, tokens y duración acordados con el usuario.

Código y documentos viajan por Git. Datos durables, sesiones, memorias SQLite y credenciales requieren el procedimiento de transferencia enlazado en el [índice](README.md). Guardar credenciales fuera del repositorio. Las rutas privadas y procesos del host original no son portables.

Para continuar con otro agente:

> Leé AGENTS.md y handoff/README.md. Retomá el objetivo abierto y el trabajo local descrito en el handoff vigente. Verificá primero rama, commit, cambios presentes y pruebas pendientes; después continuá la recepción humana y el alcance restante, conservando la trazabilidad de evidencia.
