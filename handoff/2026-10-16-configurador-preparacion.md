# Continuación: Configurador previo a Ready

Fecha: 16 de octubre de 2026 UTC. Rama `main`, base `3892c0b`; numerosos cambios locales de esta entrega y de cortes anteriores, sin commit/push en este turno. Revisar `git status` y preservar todos los cambios.

Objetivo vigente del usuario, sin recorte:

> 7 - implementar hasta terminar
> 8- revisar y volver a 7 hasta terminar
>
> Usar subagentes cuando corresponda

El objetivo continúa activo. Este documento no lo considera completado ni pausado. Prioridad: poder preparar y ver una representación entera, intervenir y exportar su resultado. La aceptación ampliada de importaciones/transferencias permanece en V2.

## Entregas conservadas

[El paquete equivocado](../docs/representaciones/el-paquete-equivocado.md) es una función corta completa, textual y sin Fibonacci. Su guion Fountain está en `docs/output`; la exportación gráfica fue verificada contra las once réplicas de la interfaz. No fue preparada por el nuevo Configurador. [Handoff anterior](2026-10-16-paquete-y-guion.md).

## Implementación nueva

[Auditoría del Configurador](../docs/auditoria/configurador-preparacion.md) y [diseño](../docs/diseno/configurador-preparacion.md). Journal v44: presupuesto antes de Ready y conservación del consumo; jobs/leases/paquetes/checkpoints/candidatos/pruebas Pi; operaciones create/start/cancel/apply con recibos durables. Las tablas históricas mantienen su semántica.

API/cliente/panel permiten registrar sin inferir, iniciar explícitamente, consultar/cancelar, revisar motivos/diferencias/fuentes y aplicar sólo campos elegidos. Actor nuevo puede conservar secciones curadas en `roster.preparationDrafts`; no actúa hasta que `prepareCharacter` publique contexto completo. Cambiar de archivo fuente completo exige recurar las nueve secciones. Perfil, presupuesto, ICM e identidad humana no son salida del modelo.

Composición en `production-host.ts` y `preparation-configurator-runtime.ts`; cierre, recuperación inerte, gate de reconfiguración y respaldo conectados. Las sesiones JSONL necesarias se incluyen en el respaldo; recuperación valida v44 sólo en world.sqlite, no exige tablas del host a las bases ICM actorales.

## Verificación y estado operativo

El host local ya está migrado y compuesto; la verificación global posterior a las correcciones de navegador está aprobada. Pruebas focales acreditan HTTP + SDK/JSONL/SQLite reales con transporte controlado → propuesta → aplicación → Ready, conservando llamadas y tiempo. Hay React montado, cancelación, CAS obsoleto, rollback, replay con sesión física ausente y revisión independiente. No equivalen a proveedor real.

Antes de modificar el host vivo se creó una copia SQLite privada en el directorio hermano `Personajes-migration-snapshots`, y una copia temporal pasó migración v44 con cero errores de claves foráneas. No copiar credenciales a Git. El estado final del servidor y los resultados globales se registran a continuación.

## Continuar después

Consultar [PENDIENTES](../docs/PENDIENTES.md), manteniendo el alcance integral. Completar aceptación visual y con proveedor del nuevo workflow; ampliar fidelidad/ritmo, memoria/evolución y audio/voz sin atribuir a las pruebas capacidades no ejecutadas. Usar login OAuth de OpenAI Codex o Anthropic según el perfil; una sesión Pi independiente por personaje y rol. No reiniciar inferencias al leer, reabrir o recuperar.

## Aceptación real de este corte

En `http://127.0.0.1:4182/`, host v44, se creó y guardó por GUI el borrador `6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f`. Configurador con ICM propio y OpenAI Codex OAuth `gpt-6.1-sol/low`: job `78a7b962-4df4-4c78-a28c-47715eafa024` aceptado, dos requests, 6653 ms medidos, cero spans pendientes. Se revisó y aplicó únicamente el nombre «CONTROL: el sello extraviado», revisión 1, sin WorldRun ni actores. Fecha, reparto y continuidad siguen pendientes. No es una función nueva ejecutada ni aceptación de curación completa.

Dos problemas detectados en navegador quedaron corregidos con regresiones: base nula de sesiones Pi nuevas aunque ya tengan metadatos, y proyección pública de la revisión sin principal privado. La propuesta aceptada sobrevivió al reinicio y se leyó/aplicó sin inferencia adicional. El intento previo bloqueado con cero llamadas permanece en la historia.

Servidor activo al cierre de esta comprobación: PID `51681`, sesión de herramienta `3867`, log privado `/private/tmp/personajes-preparation-live-server-final.log`. Confirmar su vigencia antes de operar; no reiniciar el puerto 4173. La base y OAuth son privados del host y no viajan con Git. El snapshot previo a v44 está en `Personajes-migration-snapshots`, al lado del directorio privado de la aplicación.

## Verificación final

`npm run verify` con `PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4` y `TMPDIR=/private/tmp`: **1448 pruebas, 1447 aprobadas, cero fallos, una omitida por plataforma**. Log `/private/tmp/personajes-preparation-global-after-live.log`. Build y typecheck aprobados; aviso de chunk mayor de 500 kB conservado. La revisión del historial privado confirma cambios sólo en nombre/revisión. Screenshots de propuesta y aplicación en la auditoría enlazada. Objetivo activo, sin commit/push; la aceptación integral del producto continúa pendiente.
