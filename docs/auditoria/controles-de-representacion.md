# Brecha de lifecycle y controles de representación

Auditoría histórica anterior al corte 29 del 14 de octubre de 2026. Los faltantes enumerados abajo describen ese momento, no el código actual. El corte 29 ya compuso RunView/ETag, API de controles, gate fresco de preflight, CAS y cancelación por corrida. La continuación Cloud se registra en [evidencia de Cloud](continuacion-cloud.md). Ninguna de estas integraciones acredita por sí sola una representación operada ni acceso live a un proveedor.

## Qué ya existe

- Preparaciones durables con validación/promoción a `ready` y preflight con resultado durable ligado a la configuración y el perfil.
- Un journal SQLite con snapshot del Escenario, revisión propia de lifecycle, `closedAt` y operaciones de control idempotentes (v23). V24 añade época de lifecycle a cada pulso y job actoral.
- Un modelo puro de transiciones y un comando CAS idempotente: start/resume comprueban preflight aprobado, vigente, mismo perfil, configuración, snapshot, secuencia y reloj. Pruebas SQLite cubren bloqueo, start, pause, close, replay y reapertura.
- Un ledger v22 que reserva y mide tiempo acumulado de requests de Actor y Continuista; el preflight consulta este ledger.
- Un coordinador durable de pulsos y un `createRepresentationRuntime` que compone Actor, Continuista, entregas y coordinación cuando el launcher recibe una ruta ICM.
- Entrega durable de intervenciones y trabajos actorales encolados. La API de intervención acepta un testimonio, pero no equivale a respuesta publicada de un actor.

La evidencia y límites de estos componentes están en [progreso de implementación](implementacion-progreso.md), [preflight durable](preflight-durable.md) y [S02](../specs/02-persistencia-e-icm.md).

## Qué impedía operar el lifecycle antes del corte 29

1. **No hay caso de uso ni rutas de control.** El host aún no expone `GET /runs/{id}`, `POST /runs/{id}/start` ni `POST /runs/{id}/controls` conforme S04; tampoco hay SSE del run. El `GET` existente de corrida devuelve la preparación/borrador. La GUI termina en edición y preflight y mantiene “Sin representación activa”.
2. **La autoridad durable ya está a medio camino.** `applyRunLifecycleCommand` persiste revisión de lifecycle, resultado idempotente y timestamp de cierre, y gatea start/resume dentro de una transacción SQLite. Falta que la aplicación use esta operación como única vía de control; `setWorldLifecycle` sigue siendo una primitiva interna usada por fixtures/compatibilidad y no debe conectarse a la GUI.
3. **Falta gate verificable al reanudar y recuperar.** El preflight ya se puede crear en estado paused/stopped y el journal compara el receipt con el corte/perfil vigentes. El caso de uso todavía debe comprobar la lectura vigente del broker (incluida la credencial actual) y evitar que recuperación de `running` convoque actores antes de un gate fresco.
4. **La cerca durable de efectos ya está en el journal; falta conectarla al control operativo.** Cada pulso/job captura la revisión de lifecycle. Las escrituras nuevas de Actor y Continuista, checkpoints, propuestas, receipts, revisiones y commits comparan esa época; pausar invalida los claims activos y la reanudación rebasa sólo trabajo queued/accepted. Una llamada ya despachada puede liquidarse para conservar el tiempo real medido, pero no publicar efectos del turno interrumpido. El supervisor aborta y espera por corrida. Falta que el caso de uso coordine el CAS durable con esa cancelación, y que recovery espere un gate fresco.
5. **`step` no equivale a un pulso todavía.** El supervisor normal drena trabajo causal hasta quedar ocioso. Hace falta una operación durable acotada que abra exactamente un pulso desde pausa y vuelva a pausa al completarlo o bloquearse.
6. **No está resuelto el primer disparador sin inventar ficción.** Iniciar debe activar la puesta y convocatorias justificadas por rutina/meta, sin crear una conversación, acción o evento de mundo para dar la impresión de que arrancó.

## Orden recomendado en aquella auditoría

1. Terminar la capa de aplicación host-owned para start, pausa, resume, un solo pulso, stop y close; gatear por lectura vigente del broker y coordinar con runtime/cancelación por corrida.
2. Exponer `RunView`, ETag, rutas de control y seguimiento de jobs. Mantener autenticación local, CSRF e idempotencia durable; reintentar una respuesta incierta con la misma clave.
3. Implementar `step` como un pulso durable exacto y conectar la cancelación por corrida después del CAS para que el host detenga workers al confirmar pausa/stop/cierre.
4. Hacer que recuperación active sólo corridas con gate fresco y evitar convocatorias sin causa dramática/operativa autorizada.
5. Conectar la vista de representación y barra persistente con estado confirmado por el host, no por anticipación del clic. Incluir controles accesibles durante inferencia y presupuesto actual.

## Verificación que debe cerrar el corte

Con SQLite real y transporte determinista local, comprobar: transiciones completas y prohibidas; start sin gate produce cero despachos; receipt obsoleto o de otro perfil queda bloqueado; replay devuelve el mismo resultado; ETag obsoleto pierde carreras; pausa/stop durante request descartan callbacks tardíos (la cerca durable por época ya está probada); `step` procesa un solo pulso y vuelve a pausa; close conserva hechos/outbox y es terminal; reinicio de `running`, `paused` y step pendiente no llama al proveedor antes del gate fresco. Después, recorrer en navegador preparación → preflight → start → pause → step → resume/stop → close.

No usar la transición interna actual como atajo para saltar estas verificaciones. No se requiere login ni inferencia de proveedor para comprobar la orquestación determinista; una prueba live de cuenta es un gate distinto.
