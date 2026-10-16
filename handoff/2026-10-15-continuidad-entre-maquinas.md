# Handoff · continuidad entre máquinas e integración ICM

Fecha: 15 de octubre de 2026, America/Argentina/Buenos_Aires. Rama `main`; base del corte anterior `3892c0b`. Hay cambios locales de código, pruebas y documentos, incluidos archivos nuevos: todavía no están publicados. Antes de cambiar de máquina, revisar `git status`, hacer commit y push; después comprobar el mismo commit en destino. Este archivo no certifica que se haya publicado ese trabajo.

## Estado y alcance

El [corte de recepción y recuperación verificadas](2026-10-15-recepcion-y-recuperacion-verificadas.md) conserva los resultados ejecutados, las pruebas y las limitaciones del producto. El objetivo integral sigue abierto: este handoff no declara terminada la implementación ni la aceptación.

Después de ese corte se completó la entrevista entre agente entrevistador y custodio para la [admisión de ICM Markdown al runtime](../docs/diseno/dialogo-icm-runtime-admision.md) y la [fundación de contratos, lector y admisión](../docs/auditoria/icm-markdown-fundacion.md). El trabajo local posterior incorpora la migración v43: paquetes ICM persistidos por job y generación antes de inferir, ligados a la audiencia, configuración y corte autorizados por el journal. Actor, Continuista, Director, Narrador, Revisor de narración y Configurador usan el contexto congelado mediante `icm-session-context.ts`. Si falta un paquete después de dejar evidencia durable de ejecución, se bloquea su regeneración y despacho.

También hay endpoints de fuentes y preview, selección por audiencia en la preparación gráfica, validación de hashes y fuentes al guardar, y compatibilidad del esquema v43 en backup/restauración. El preflight exige capacidad efectiva del runtime cuando hay selección ICM; la ausencia histórica conserva el camino legacy. Estos cambios están en el árbol local: no asumir que el servidor que ya estaba abierto los haya cargado.

El [corte de integración v43](../docs/auditoria/icm-markdown-runtime.md) pasó verificación global (1335 tests, 1334 aprobados, cero fallos, una omisión exclusiva de Linux), typecheck y build; incluye ICM CLI real y transporte Pi controlado. También se verificó seleccionar/previsualizar/guardar nueve fuentes desde la GUI en una instancia aislada, sin inferencia. El importador externo ahora audita los paquetes contra su configuración/corte, incluso con manifest recalculado. La siguiente acción es completar estos pendientes del [plan ICM](../docs/diseno/plan-icm-markdown-runtime.md):

- Verificar el corte posterior de obligatoriedad: altas por API y presets guardan ICM pendiente; ausencia histórica se conserva. Las pruebas HTTP cubren bloqueo de Ready y reemplazo desde cliente antiguo.
- Implementar el job de Configurador anterior a Ready; el flujo conectado actualmente es el de evolución.
- Completar inspección de paquetes por rol/job y el flujo visual integral; selección, preview y guardado básico ya se verificaron en navegador.
- Acreditar backup/restauración entre máquinas con paquetes poblados y relaciones históricas con jobs/checkpoints/sesiones. La auditoría nueva ya verifica consistencia interna, fuentes, preparación y contrato contra la configuración/corte.
- Verificar comportamiento con proveedor real antes de declarar una representación ejecutada con este nuevo contexto. Las pruebas focales usan SDK controlado y no acreditan inferencia real.

Las decisiones nuevas incluyen selección exacta de secciones por rol/personaje, snapshot congelado, paquetes persistidos antes de inferir y hash ICM separado del contexto preparado. Configurador necesita admisión del borrador antes de Ready. Los registros históricos conservan la ausencia de ICM; corrupción nunca habilita un fallback al árbol vivo. El Markdown no concede filesystem, tools ni autoridad adicional.

Al cambiar de conversación o máquina no asumir que los subagentes actuales siguen disponibles. Releer sus decisiones guardadas; verificar los archivos existentes antes de delegar o implementar para evitar duplicaciones.

## Prioridad indicada posteriormente por el usuario

La importación recibió demasiado esfuerzo respecto del uso central. Concentrarse en preparar la puesta, ejecutarla, verla en vivo y conversar con los personajes. La aceptación exhaustiva de transferencia/importación permanece pendiente en V2; no es el siguiente bloqueo de la alpha.

## Arranque en destino

1. Leer [AGENTS.md](../AGENTS.md), este índice y el corte anterior. Consultar [PENDIENTES](../docs/PENDIENTES.md) para el alcance restante completo.
2. Comprobar rama y cambios locales antes de traer `origin/main`. Usar Node compatible con `package.json` —actualmente `>=24.18.0`— e instalar con `npm ci`.
3. Preparar una raíz privada de datos propia mediante `PERSONAJES_PRIVATE_DATA_ROOT`. Ejecutar `npm run build` y `npm start`; configurar `PERSONAJES_PORT` si se necesita otro puerto. La instancia del host original usa 4182.
4. Hacer login del proveedor en destino y configurar el ejecutable ICM Memory de esa máquina. No reutilizar rutas absolutas del host original como si fueran portables.
5. Para retomar representaciones existentes, exportar/restaurar mediante el flujo de backup de la aplicación, según el [índice](README.md). Git no transporta journal, memorias, sesiones ni credenciales. Verificar restauración, acceso y memorias antes de ejecutar.

Verificación histórica de la fundación ICM, anterior a la integración v43 actual: **1306 tests, 1305 aprobados, cero fallos y una omisión exclusiva de Linux**, con CLI ICM real; `npm run verify` incluye typecheck. Build, revisión independiente, enlaces y whitespace pasan. La primera pasada detectó una dependencia `node:crypto` en el contrato del navegador; se corrigió separando schemas estructurales y validación criptográfica del host, con regresiones de corrupción y frontera de imports. La segunda pasada global acredita el corte corregido. Logs del host: `/private/tmp/personajes-icm-foundation-global-green.log` y `/private/tmp/personajes-icm-foundation-final-build.log`; no viajan por Git.

## Prompt de continuidad

> Leé AGENTS.md y handoff/README.md. Verificá que el commit recibido contenga los cambios del corte vigente. Retomá el objetivo integral abierto y la integración ICM Markdown a partir del plan y del diálogo de admisión. Conservá el aislamiento de cada instancia Pi, la autoridad del host, las memorias y la compatibilidad histórica. No confundas diseño documentado con runtime implementado ni Git con transferencia de datos privados.

## Siguiente entrega priorizada: función completa

El usuario reiteró que quiere ver una representación entera de principio a fin; preparar/ejecutar/observar/cerrar tiene prioridad sobre más trabajo de importación. Se creó desde la apertura (commit 1, secuencia 0) de `5c94e829-ceb5-4568-a1ed-6b553c717386` una función independiente, `c0c398bc-7a5a-4e47-b20d-abf6db19c735`, nombre «CONTROL: la alarma de los números · función completa». Operación `caa6a224-4890-4ede-bb46-259ef09cfe09`, publicada Ready. Las memorias propias se reabrieron mediante trabajo `0c5a4b62-91b8-4c40-b608-79938a27cd29`, sin copiar diálogos futuros. El primer preflight pasó todas las dependencias excepto vigencia del sondeo de acceso; se solicitó un sondeo nuevo desde la GUI. Consultar su resultado actual antes de iniciar. El host habitual sigue en 4182 con el runtime anterior: esta función hereda configuración histórica sin ICM Markdown; no usarla como aceptación de la integración v43.

El corte de obligatoriedad de nuevas altas pasó typecheck, build y verificación global con 1334 aprobados, cero fallos y una omisión exclusiva de Linux. Falta publicar todos los cambios locales.

### Resultado de la función priorizada

La función nueva concluyó: [transcript, capturas y límites](../docs/representaciones/funcion-completa.md). Once intervenciones reales, desenlace observado por el Director, cierre de escena commit 14 y episodio commit 15, secuencia 11, Escenario 13. Estado final detenido, 52 llamadas, 233.926 ms medidos y cero reservas activas. La consulta escolar permanece como intención. El visitante fue interpretado por el asistente. No es aceptación de ICM v43 ni de una duración televisiva estándar. La fricción del inicio en una pestaña antigua se sorteó con vista nueva y API autenticada, sin repetir el inicio; corregir ese recorrido gráfico es prioridad concreta sobre importación. Pestaña entregable: la función en el host 4182.
