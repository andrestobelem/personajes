# Notificaciones públicas SSE en Cloud

14 de octubre de 2026. El corte implementa **invalidación de lecturas**, no el ledger append-only `stream_entries` completo de S02/S04.

`GET /api/v1/runs/{runId}/events/stream` usa los mismos gates de Host/Origin y sesión local que los demás endpoints. Emite `event: run.refresh` con únicamente `runId`, `configRevision`, `worldRevision`, `lifecycleRevision` y `lastWorldSeq`; el schema compartido es `src/domain/run-refresh.ts`. No transmite configuración/contexto de actuación, propuesta, revisión, experiencia, diálogo ni razonamiento. La GUI debe volver a consultar las vistas HTTP autorizadas; el stream no confirma un hecho ni modifica el Escenario.

Un scheduler compartido consulta cada corrida una vez por tick y no solapa consultas. Hay techo global y por sesión de conexiones, salida acotada y cierre de clientes con backpressure. Desconectar, logout, expiración y cerrar el servidor eliminan listeners/conexiones y liberan el timer cuando no quedan clientes. Los comentarios heartbeat no llaman `requireSession` ni renuevan el vencimiento. Una lectura async vuelve a comprobar sesión/expiración antes de emitir.

El ID `rf1.<runId>.c<C>.w<W>.l<L>.s<S>` identifica revisiones leídas, **no** un stream offset. `Last-Event-ID` se valida por gramática, enteros seguros y ámbito de corrida; un corte por delante del actual requiere refresco. La conexión y reconexión entregan el corte público actual. No existe replay de notificaciones perdidas ni garantía de observar cada transición técnica: jobs/deliveries sin cambios de esos campos todavía necesitan polling. Reconectar no llama Pi, tools, ICM-write ni voz. La GUI conserva polling de respaldo.

Validación ejecutada en sockets loopback reales:

```sh
node --import tsx tests/http-run-refresh.test.ts
```

**2/2 pruebas aprobadas, sin fallos ni omisiones**, usando escalación autorizada para `listen` loopback (el sandbox de Cloud devuelve EPERM). Cubren sesión ausente y Origin ajeno, cursor inválido/de otra corrida, techo de clientes, payload público exacto, cambio de revisión, reconexión al corte actual, ausencia de comandos, logout, shutdown y expiración tras heartbeat sin renovación. `npm run typecheck` pasó después del cambio. La prueba de scheduler usa un puerto de lectura controlado sobre una fixture SQLite real; no acredita SSE durable completo ni inferencia del proveedor.
