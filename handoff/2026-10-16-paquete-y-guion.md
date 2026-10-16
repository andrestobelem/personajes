# Handoff · El paquete equivocado y exportación a guion

16 de octubre de 2026 UTC. `main`, base `3892c0b`; numerosos cambios locales, sin commit ni push de este corte. Preservarlos. Goal activo: implementar hasta terminar, revisar y volver a implementar hasta terminar, con subagentes cuando corresponda. No está completado ni pausado. Último pedido: nueva función sin Fibonacci, forma gráfica de exportar el resultado como guion y guardarlo en docs/output, y acelerar. Estos pedidos concretos ya tienen evidencia; el alcance integral no está cerrado.

## Resultado visible

[El paquete equivocado](../docs/representaciones/el-paquete-equivocado.md): run `4e8078b0-ef8a-4506-bf75-8433258c862c`, configuración 0; once emisiones reales, desenlace, escena cerrada commit 13 y episodio cerrado commit 14; detenida, mundo 14, secuencia 11. Cuarenta llamadas, 149.970 ms medidos, cero reservas. El asistente interpreta al mensajero. Datos iniciales reutilizados y recurados mediante API desde configuración inicial, sin historia vivida ni memorias heredadas; memorias, sondeo/preflight, inicio, interlocución y cierre mediante GUI. No Fibonacci ni giro precargado como conocimiento de actores.

El botón Exportar guion Fountain en vivo/Escenario guardó el [guion completo](../docs/output/control-el-paquete-equivocado-4e8078b0-ef8a-4506-bf75-8433258c862c-c14-2c27252d9e1585ad.fountain), con once réplicas cotejadas contra la UI y descarga HTTP exacta. [Auditoría](../docs/auditoria/exportacion-guion.md). Archivo 2943 bytes, SHA-256 `2c27252d9e1585ad27c83cf8cddb2801ba7c599077c992c974f5a341747c6b3f`. Escena/diálogos/acciones públicas, sin pensamientos ni prompts. Corte fijo, todas las páginas, recuperación idempotente, rutas host fijas y sin sobrescritura de contenidos diferentes. Recibos privados de exportación no integrados en backup portable vigente.

## Otros avances de este corte

[Inspector ICM y base de Configurador](../docs/auditoria/inspector-icm-y-base-configurador.md): API/GUI privada paginada por rol/actor/job, configuración/corte históricos, corrupción legible y retiro por revocación/reset, sin textos de prompts. GUI verificó los 29 paquetes de la función anterior, filtros Director7/Max6/job1 y revocación. El inspector no certifica todas las relaciones entre jobs/sesiones/terminales ni una inferencia del proveedor.

Configurador anterior a Ready: tres módulos/pruebas nuevos de contratos/compilación/revisión proposed-only, con conocimiento adaptado y contradicciones explícitas, y proyección que no entrega contratos Markdown ajenos. Ocho pruebas nuevas, dieciséis focales. **No hay todavía workflow ejecutable**: presupuesto/autoridad/paquetes antes de world_runs, ledger, tool, worker, API y GUI permanecen pendientes. [Diseño completo](../docs/diseno/configurador-preparacion.md).

## Verificación

Global final: **1396 tests, 1395 aprobados, cero fallos, una omisión exclusiva de Linux**. Typecheck y build aprobados; aviso conocido de tamaño de chunk. `git diff --check` limpio. Entorno: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4 npm run verify`. Logs locales `/private/tmp/personajes-script-export-global-final.log`, `/private/tmp/personajes-script-export-combined-final.log`; los temporales no viajan por Git. No repetir sin cambios o motivos concretos.

## Host y continuidad

App 4182, último PID observado `36137`, confirmar con lsof; no tocar 4173. Log `/private/tmp/personajes-script-export-live-server.log`. Datos privados `/Users/andrestobelem/Library/Application Support/Personajes`; CLI ICM `/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`. Backend y frontend incluyen exportador; ninguna representación estaba en ejecución al reiniciar. Las representaciones, sesiones Pi, memorias y login OAuth no viajan por Git. La app permite leer las funciones detenidas sin volver a actuar. Reanudar requerirá verificar/reabrir memorias y preflight cuando corresponda. Autenticar OpenAI Codex o Anthropic por login en otra máquina, sin sustituir por API keys.

Continuar con [PENDIENTES](../docs/PENDIENTES.md), conservando la prioridad de obra observable y funcional. La preparación nueva y la función completa ya están probadas; no volver a bloquearlas con importación ampliada, que permanece en V2. Siguiente hueco central: Configurador anterior a Ready completo, luego ampliar aceptación de calidad/ritmo, operación, memoria e interfaz según las specs. Audio, Anthropic real y los 77 criterios integrales conservan evidencia pendiente. No declarar goal completo por estos ensayos.

Leer AGENTS, índice, constitución, GLOSSARY y skills aplicables. TypeScript best practices en cambios TS. Si hace falta una nueva ronda grill-with-docs, entrevistador y custodio separados; no reabrir preferencias resueltas. Todos los agentes de este corte están congelados al entregar.
