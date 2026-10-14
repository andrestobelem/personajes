# Backup e intercambio: contrato local y límites

Ejecución Cloud del 14 de octubre de 2026. Esta evidencia no acredita P14/P24 completos ni una restauración ejecutada del producto.

## Implementación local

`src/application/backup-service.ts` usa Online Backup de `node:sqlite` para el journal y memorias ICM. Copiar el archivo principal de una base abierta no sustituye esta operación: los ensayos mantienen WAL abierto y comprueban que los datos confirmados están en la copia. Los archivos adicionales provienen exclusivamente de un inventario del host con paths relativos admitidos: sesiones registradas y medios autorizados. No hay exploración recursiva de privateData ni copia de privateAuth. Cada bundle conserva versión del journal, lineage local, corte por corrida, longitudes y SHA-256; se verifica integridad SQLite además de hashes. Los jobs y previews se guardan en tablas `backup_*` de `world.sqlite` y un job abandonado se diagnostica interrupted al reabrir.

El puerto `BackupQuiescePort.acquire` es obligatorio para crear un backup. Debe impedir nuevas mutaciones y esperar el cierre de TODOS los writers del journal, ICM, Pi y media antes de entregar el inventario; la espera ocurre fuera de transacción SQLite. `release` libera esa barrera después de copiar. **En el primer corte de este servicio, la composición todavía no tenía esa barrera global demostrada; la actualización al final documenta su implementación posterior.** Por eso, sin el puerto real, la API devuelve `BACKUP_QUIESCE_UNAVAILABLE` y no declara una copia consistente. Pausar lifecycle o comprobar ausencia de jobs no basta mientras siguen writers mecánicos/audio o pueden entrar nuevas mutaciones HTTP. El test del servicio ejercita una barrera controlada y disco real; no sustituye la aceptación de la composición.

La restauración muestra corte y diff, token breve, hash de manifest/diff y fingerprint del destino. La confirmación revalida el bundle y el destino antes de reclamar el token; después de una aplicación iniciada e interrumpida no reejecuta silenciosamente. Sin `BackupRestorePort` devuelve blockers explícitos y no aplica datos. El puerto real debe controlar ownership offline, no sobrescribir journal/archivos activos, comprobar misma lineage y ausencia de divergencia para recover, y asignar nueva identidad con reescritura coherente para fork. **No hay actualmente implementación de ese puerto ni ensayo de restauración real.** Las rutas absolutas registradas de sesiones necesitan reconciliación y validación del transcript/leaf antes de reanudación. Copiar JSONL no demuestra que Pi pueda abrirlo desde otro destino. No se atribuye continuidad nueva a un journal que conserva IDs originales.

`src/application/dossier-exchange.ts` reutiliza los serializadores de catálogo: cuarentena durable, validación de UTF-8/base64/schema/hash/secciones, preview íntegro before/after, hash del diff, expiración y comprobación de revisión/hash del destino. Apply crea una adaptación independiente e inmutable y conserva el original; no convierte el contenido en un hecho ni selecciona preparación del runtime. Export conserva archivo versionado y checksum y permite download por ID/principal. Metadata y adaptaciones usan tablas `exchange_*` del mismo journal. El corte sólo admite dossiers; configuración, historia, paquete de investigaciones y proyecciones Markdown continúan pendientes. Las adaptaciones aún requieren integración con el curador/selección explícita y GUI.

`src/server/exchange-routes.ts` es un `OperatorExtension`, por lo que usa los gates de sesión local, Origin/Host y CSRF del servidor. Añade ETag/confirmación de diff e idempotencia durable antes de CAS; no expone bundleRoot ni acepta rutas de host. Import/apply y restore atan el token al ID de recurso de la ruta. Export admite el corte explícito `kind:dossier`; los tipos completos de S04 permanecen pendientes. Backup download y selecciones por corrida no están implementados: no se ofrece un filtrado incompleto del journal como backup de una selección.

## Evidencia ejecutada

Comandos desde la raíz del repositorio:

```sh
node --import tsx tests/backup.test.ts
node --import tsx tests/dossier-exchange.test.ts
node --import tsx tests/exchange-routes.test.ts
node --import tsx tests/exchange-http.test.ts
```

Resultado: **9 pruebas aprobadas, 0 fallos, 0 omisiones**. Cubren WAL abierto journal/ICM, entrega pendiente conservada, sesión registrada, exclusión de auth, hashes/tamper, traversal/symlink, ausencia de transacción durante acquire, job interrupted, preview expirado/destino divergente, confirmación y replay, round-trip dossier durable tras reinicio, original preservado, principal ajeno rechazado, ETag y denegación de backup sin barrera. La prueba HTTP abre un socket loopback real con sesión/CSRF, ejecuta el round-trip y verifica que la composición entrega un job fallido `BACKUP_QUIESCE_UNAVAILABLE` sin copiar. En Cloud requiere ejecutar fuera del sandbox que impide `listen` en loopback; la escalación para ese ensayo fue autorizada. El ensayo con `BackupRestorePort` controlado sólo comprueba el protocolo de confirmación/replay: no restauró un journal ni reabrió sesiones.

`createExchangeRuntime({host,catalog})` carga únicamente dossiers registrados y compone los servicios/rutas bajo el host propietario. El primer corte de su puerto acquire fallaba explícitamente mientras no existía barrera global; la composición posterior admite inyectar el puerto real sólo desde el launcher propietario. Close cierra sólo sus conexiones, y el launcher conserva la responsabilidad de detener workers y liberar ownership.

`npm run typecheck` no indicó errores en estos archivos; en la verificación simultánea notificó dos accesos a una fila posiblemente undefined en `tests/voice-integrity-review.test.ts`. El gate global debe repetirse tras reconciliar el trabajo concurrente. No se ejecutaron proveedores, OAuth ni síntesis de audio.

## Integridad de metadata e identidad del diff

Los registros de importación, previews, adaptaciones, exports, receipts HTTP, jobs backup y previews restore conservan checksum independiente de todos los campos persistidos, incluidos principal, operación y recurso. Cada lectura/replay verifica el checksum; filas legacy sin checksum fallan cerradas. Los ensayos alteran metadata conservando el hash de Markdown, trasplantan principal y cambian un receipt HTTP estructuralmente válido: ninguna manipulación se devuelve como éxito. Es detección de corrupción, no firma contra un writer capaz de sustituir contenido y checksum; ownership de archivos sigue siendo requisito.

El diff de dossier incluye fullBeforeHash/fullAfterHash de los snapshots completos serializados y validados, además de los hashes semánticos de Markdown. Apply comprueba el snapshot completo actual del destino, por lo que cambiar aliases con el mismo Markdown y revisión vuelve obsoleto el preview. Los schemas compartidos browser-safe están en src/domain/dossier-exchange.ts.

## Actualización: barrera real compuesta

`createHostRequestBarrier` y `createHostBackupQuiesce` incorporan la barrera de la composición. El servidor entra antes de leer bodies o llamar servicios, también para GET que pueden inicializar configuración. La creación del backup se excluye de su propio contador; acquire cierra nuevas admisiones y espera terminar las solicitudes previas sin mantener una transacción SQLite. Mientras está cerrado sólo se admite GET de metadata de backup. El scheduler SSE no consulta durante ese corte.

Después del drain HTTP, el host comprueba que los brokers OAuth, access-check y preflight estén inactivos. Si no lo están, falla con códigos que indican cancelar o reintentar antes del backup; no cancela autorizaciones ni modifica la puesta por esa comprobación. Si están inactivos, enumera todas las corridas (incluidas las running sin pulso), aplica pausa con CAS/epoch y conserva el comando, e interrumpe el paso pendiente. El runtime de representación cierra admisiones antes del await, elimina habilitaciones de inferencia, cancela los coordinadores y espera actor/Continuista/Director/Narrador, entrega, ICM y tareas de fondo. La entrega mecánica independiente y voz disponen de suspensión reversible y esperan que sus writers terminen. No se cierra el host para copiar ni se reabre inferencia al liberar la barrera; las corridas permanecen pausadas. Los errores posteriores también liberan admisión y conservan esa pausa.

El inventario recoge memorias de identidades registradas, sesiones actuales y generaciones/archivos forenses referenciados por candidatos/checkpoints, y medios registrados de voz. Valida hashes de metadata y scopes de rutas. Los medios `.bin` se admiten únicamente desde el puerto de voz que comprueba entidad, integridad y bytes. Un JSONL registrado ausente o una memoria con receipt pero sin base bloquea con diagnóstico preciso; no se atribuye restaurabilidad a archivos inexistentes. OAuth/key y pi-agent/CWD quedan fuera del inventario.

```sh
PERSONAJES_ICM_TEST_BINARY=/workspace/personajes-tools/icm-0.11.4/icm \
  node --import tsx tests/host-backup-barrier.test.ts
```

**3/3 pruebas aprobadas, 0 omisiones**, con socket HTTP loopback real, journal/ICM reales y runtime Pi local sin proveedor. Comprueban la exclusión del propio request, espera de GET previo, denegación de admisiones nuevas y lectura de estado del job; pausa CAS y drain de entrega con outbox ICM pendiente; rechazo de OAuth ocupado antes de pausar; suspensión real del runtime, conservación de receipts/memoria en Online Backup y presupuesto de inferencia sin aumento. Liberar conserva pausa y no habilita otro turno. La integración de launcher se añadió después de estos ensayos y requiere el gate global de la tarea.

Esta actualización habilita backup coherente bajo los puertos de la composición, **no restauración**. Recover/fork, reescritura de IDs y reconciliación de paths/leaves continúan bloqueados sin puerto offline real y sin ensayos de restauración ejecutados.

## Ownership de procesos zombie en Linux

`kill(pid, 0)` también tiene éxito cuando el proceso ya salió pero queda zombie sin ser recolectado. La recuperación explícita comprueba `/proc/<pid>/status` y `stat` dentro de los gates de operación: PID y estado Z deben concordar y dos lecturas conservan los mismos start ticks. Sólo entonces elimina el registro mediante los controles existentes de nonce, contenido e inode. Un proceso vivo, evidencia incompleta/discrepante o PID reutilizado conserva el lock; en otras plataformas se mantiene la prueba ESRCH. No se envían señales para matar procesos.

`node --import tsx tests/host-ownership.test.ts` aprobó **10/10** en Cloud con escalación para ensayos de procesos reales. Incluye un zombie Linux real generado por fork de una fixture y recolectado al terminar, además de nonce cambiado, PID activo, permisos, ambigüedad, corrupción y concurrencia. `npm run typecheck` pasó después del fix. La ampliación de restore offline quedó pausada para estabilizar primero el arranque; este fix de ownership no acredita restauración de datos.
