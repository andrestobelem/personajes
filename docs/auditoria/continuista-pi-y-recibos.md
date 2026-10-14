# Continuista Pi y recibos durables

Estado del corte v15: componentes implementados y verificados localmente. El perfil Luna/xhigh que describe este corte fue reemplazado para nuevas representaciones por [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md). No demuestra OAuth activo, inferencia live ni una representación operada desde la GUI.

## Ejecución propia

`createContinuistaPiWorker` implementa el puerto de revisión del worker actoral. Construye el contexto autorizado de la propuesta exacta y crea un job administrativo hijo bajo el mismo pulso y presupuesto. Usa identidad Pi `admin/continuista`, una sesión privada por child y únicamente la tool `submit_continuista_review`. La factory por defecto sigue siendo `createPiSession`: exige `openai-codex` por OAuth y `gpt-6-luna` con `xhigh`. No hay transporte alternativo en producción.

Los contextos se serializan por corrida y journal para evitar dos sesiones administrativas simultáneas. La revisión sale por una tool estructurada; el texto final del asistente no se interpreta como veredicto. Un candidato incompleto queda registrado como diagnóstico y bloquea el child; falta de tool, cancelación o fallo no generan aprobación.

## Frontera durable

La migración v15 añade jobs, sesiones, leases de requests, checkpoints, candidatos y receipts del Continuista. Su scope conserva el actor padre, generación, propuesta, versión, contexto y pulso exactos. Los contratos y validadores de contexto viven en el dominio, compartidos por ensamblador y journal; los imports anteriores de aplicación siguen reexportando las APIs.

Cada request consume las cuotas agregadas de corrida y pulso. Despachar exige reserva `reserved` y checkpoint de entrada correspondiente a la sesión y al lease original. Repetir `dispatched` falla; no habilita un segundo transporte. Las reservas despachadas o inciertas no se reembolsan.

Aceptar una revisión exige candidato y contexto exactos, sesión registrada, terminal completado, checkpoint de entrada de la última solicitud durable, esa reserva completada y ausencia de solicitudes pendientes o ambiguas. El mismo helper repite las pruebas al leer el receipt para recuperación: rehashear un receipt con referencias a candidatos o terminales inexistentes no reconstruye autoridad. Revisión durable y aceptación administrativa se guardan en una transacción.

Una revisión ya aceptada puede recuperarse sin otra sesión o llamada del Continuista si contexto y propuesta permanecen idénticos. `openLocalHost` recupera claims administrativos abandonados después de adquirir ownership exclusivo, conservando contexto, sesiones y reservas. Una sesión tentativa encontrada no se continúa por conjetura: el worker bloquea y exige reintento explícito.

## Evidencia y límites

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify`: TypeScript y **200 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build`: correcto, 369 módulos.

- [Worker administrativo](../../tests/continuista-pi-worker.test.ts): journal real, cuota compartida, SDK Pi real con transporte controlado, tool/resultados/checkpoints, fallo, cancelación, diagnóstico incompleto y recuperación de receipt con nuevo claim parental.
- [Journal](../../tests/world-journal.test.ts) y [migraciones](../../tests/journal.test.ts): v14 poblada→v15, lease, último request, replay de dispatch rechazado, receipts alterados y retry sin refund.
- [Host](../../tests/local-host.test.ts): recuperación administrativa desde `openLocalHost`, contexto y pulso conservados, sin nuevo despacho.

Pendientes: reconciliar un terminal actoral ya completado antes de volver a generar tras restart; conectar coordinador, actores, memoria y Continuista al launcher; contabilizar tiempo operativo acumulado; completar configuración e interfaz de representación y verificar OAuth/inferencia real. Recuperar la revisión administrativa no implica que esté cerrada toda la recuperación del padre. Los 77 criterios de aceptación integral siguen pendientes.
