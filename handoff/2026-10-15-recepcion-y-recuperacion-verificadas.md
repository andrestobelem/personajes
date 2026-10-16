# Handoff · recepción y recuperación verificadas

Fecha local: 15 de octubre de 2026. Rama `main`, base confirmada `3892c0b`. Los cambios posteriores siguen locales al escribir este corte: revisar `git status` y publicar el commit antes de esperar recibirlos con Git en otra máquina. Este documento reemplaza como estado vigente al [corte en desarrollo](2026-10-15-recepcion-humana-en-desarrollo.md), que queda como historia.

## Objetivo abierto

Se conserva el objetivo completo: leer uno por uno, corregir errores e inconsistencias, revisar iterativamente PRD exhaustivo, escribir/revisar specs e implementar/revisar hasta terminar. Usar agentes cuando corresponda. El objetivo sigue activo; este corte no cierra la aceptación de los 77 criterios ni redefine el producto como un ensayo textual.

## Resultado comprobado

- Recepción humana dirigida implementada y probada con OAuth real OpenAI Codex, `gpt-6.1-sol/low`: Max y Hymie emitieron mensajes que alcanzaron al visitante y aparecieron en su bandeja. Observación, recepción, lectura y memoria ICM siguen separadas; no se crearon entregas ICM humanas ni se reconstruyeron audiencias históricas.
- [El visitante y el aviso](../docs/representaciones/el-visitante-y-el-aviso.md) terminó con 11 intervenciones, escena cerrada en commit 15, episodio en commit 16, tres consecuencias y una línea sobre el anuncio externo aún no observado. Representación detenida: `5c94e829-ceb5-4568-a1ed-6b553c717386`, mundo revisión 14/secuencia 11. Contadores finales: 66 llamadas, 258.303 ms medidos, cero reservas. No se forzaron metas privadas.
- Journal v42 recupera explícitamente convocatorias elegibles por meta/rutina sin inbox. Conserva generaciones anteriores y aparca un pulso posterior drenado con dependencia durable; retoma el mismo ID tras completar la activación. El flujo real recuperó Max y la consulta humana pendiente; otra recuperación explícita resolvió una revisión incompleta de Hymie. Ver [auditoría de recuperación](../docs/auditoria/recuperacion-activaciones-y-diagnosticos.md).
- Continuista conserva códigos precisos y emite telemetría segura por etapa. Una limpieza fallida no invalida una revisión ya aceptada. Las etapas del callback no son un registro durable nuevo.
- GUI: bandeja disponible tras cerrar escena; polling incremental; aislamiento entre identidades; recepción humana distinta de audiencia actoral; retry desde pausa o detención. En 548 × 855, Interlocución expandida ya no se superpone con el diálogo; el footer respeta el lifecycle.

Verificación global final: **1275 tests, 1274 aprobados, cero fallos y una omisión exclusiva de Linux**, con ICM real. Typecheck, build, revisión independiente y whitespace aprobados. Logs temporales: `/private/tmp/personajes-recovery-v42-green-verify.log` y `/private/tmp/personajes-recovery-v42-final-build.log`; los documentos enlazados conservan evidencia portable. Las pruebas anteriores fallidas y sus conteos permanecen históricos.

Después se reforzó únicamente el test de parking para ejecutar el último job, completar el pulso, limpiar marcador y comprobar la generación antigua al reabrir v42. Focal posterior 43/43 y typecheck aprobados; no hubo cambios de producción después del pase global.

## Continuación concreta

1. Leer [AGENTS.md](../AGENTS.md), [PENDIENTES](../docs/PENDIENTES.md), PRD, specs y la evidencia relevante antes de modificar. Cotejar cambios locales/commit con este corte.
2. Implementar ICM Markdown al runtime según [plan revisado](../docs/diseno/plan-icm-markdown-runtime.md) y [diálogo](../docs/auditoria/dialogo-icm-markdown-runtime.md): fuentes por rol seleccionadas y congeladas, paquetes persistidos antes del despacho, GUI y conservación en recovery/fork/backup. La configuración del ejecutable ICM Memory no completa este requisito. Actor primero es orden de trabajo, no reducción del alcance de roles.
3. Resolver la experiencia de intervención durante trabajo activo, que aún puede requerir recuperación manual. Falta disposición técnica explícita para activaciones que ya no son elegibles —meta inactiva o frontera de rutina pasada— sin inventar aceptación ni bloquear indefinidamente causas posteriores.
4. Completar aceptación dramática/actoral, evolución y memoria histórica, GUI y accesibilidad, calibración audiovisual, Anthropic y ElevenLabs reales, catálogo y los 25 escenarios/77 criterios. Consultar la lista completa: los puntos anteriores no sustituyen el alcance pendiente.
5. Mantener PRD/specs/trazabilidad reconciliados. G0 permanece reabierto; hashes/cierres documentales antiguos no certifican las revisiones nuevas. La repetición semántica de respuestas y la selección de evidencia con resúmenes genéricos aún requieren aceptación de UX/ritmo.

## Otra máquina

Seguir [el índice de handoff](README.md): código/documentos viajan por Git; journal, memorias, sesiones Pi y credenciales son privados del host. Restaurar mediante el flujo de backup de la aplicación y hacer login en destino. El host original usa puerto 4182 y una raíz privada persistente; no tomar sus rutas de ejecutables como portables. Cada personaje conserva Pi/ICM independientes. Revalidar acceso y reabrir memorias existentes, conservando historia.

Prompt de continuidad:

> Leé AGENTS.md y handoff/README.md. Retomá el objetivo completo abierto. Verificá estado Git y evidencia del handoff vigente; continuá la integración real de ICM Markdown y los pendientes, preservando autoridad, memoria, historia y pruebas. No confundas el ensayo cerrado con aceptación integral del producto.
