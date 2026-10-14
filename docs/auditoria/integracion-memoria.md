# Integración durable journal–ICM

Fecha: **14 de octubre de 2026**. Alcance: migraciones explícitas del journal v1 a v4, outbox de experiencias, worker de proyección por corrida/personaje, receipts durables y recuperación al abrir el host exclusivo. La evidencia ejecuta la CLI ICM 0.11.4 compilada desde el commit auditado en [`ejecucion-icm.md`](./ejecucion-icm.md); no demuestra el runtime completo ni cierra P12.

## Contrato implementado

`openJournal` migra explícitamente hasta v4 en transacciones SQLite; la migración crea `memory_outbox` y `memory_receipts`, añade al outbox las experiencias v1 preexistentes y conserva las migraciones de propuesta/revisión y de entrega World. Una versión futura se rechaza antes de modificar el archivo. `recordExperience` valida y vuelve a congelar el envelope completo, compara la cadena canónica y su SHA-256, y escribe experiencia y outbox en la misma transacción. Un `experienceId` no admite otro payload; llamar de nuevo con la misma cadena devuelve `existing` y no crea una segunda proyección si ya hay receipt.

`createProjectMemoryWorker` toma la siguiente experiencia pendiente de un único `runId` y `actorId`, en orden de `worldSeq` e ID. Una cola en proceso serializa workers del mismo actor. El worker genera tokens host para owner y claim, registra el claim durable y envía al projector el `FrozenExperience` reconstruido y validado desde el journal. Sólo después de que `store` devuelve su ULID, una transacción inserta el receipt y elimina el outbox. El token de claim vigente es necesario para confirmar; un claim antiguo no puede completar uno reasignado.

El journal asume el lock de writer exclusivo de S02 en el nivel host. La recuperación no ocurre por cambiar `ownerToken` ni al abrir `openJournal` directamente: `openLocalHost` adquiere ownership, abre el journal y ejecuta `recoverAbandonedMemoryProjectionClaims()` en una transacción antes de devolver el host y habilitar workers. El lock garantiza que el propietario anterior ya no mantiene un worker activo; la recuperación limpia los tokens de claims pendientes y conserva payload, contador de intentos y outbox. Si falla la recuperación, el journal se cierra y se libera ownership, y el host no se publica. Mientras un host siga activo, otra apertura falla con `ALREADY_OWNED` y no puede resetear sus claims. No se decide vigencia por lease ni por hora local. El worker no hace retry infinito: un fallo o cancelación termina esa llamada de `drain`, limpia el claim si aún le pertenece y guarda sólo `projection_failed` o `cancelled`. Un límite de 1–100 elementos por llamada acota el trabajo. Errores de CLI, rutas y payload no se persisten ni devuelven con texto o contenido sensible.

El receipt sólo almacena `experience_id` (FK), ULID, token de ack, estado y fecha operativa. `findReceipt` hace join con la experiencia, vuelve a validar JSON canónico y hash y deriva `experienceId`, `runId`, actor, corte, payload y hash del registro referenciado. Comprueba que el ID dentro del envelope coincide con la FK. El ULID es único en el ledger. La lectura ICM requiere además que coincidan owner, corrida, hash y corte temporal.

## Ventana entre SQLite y journal

No hay transacción distribuida. Una caída después del commit ICM y antes del receipt deja el outbox pendiente. Al reabrir el journal, el worker reenvía exactamente la cadena canónica congelada, incluido el UUID de experiencia; el índice SQLite de ICM 0.11.4 reconoce el mismo `(topic, summary)` normalizado y devuelve el ULID existente. Dos experiencias con la misma frase pero UUID distintos producen summaries distintos y conservan ULIDs separados. Ésta es entrega al menos una vez con efecto idempotente por contenido; no es exactly-once por API ni una garantía nativa de ICM basada en ID externo.

El límite de deduplicación sigue siendo la configuración auditada: SQLite, `--no-embeddings`, mismo topic y envelope sin cambios, sin consolidar ni borrar la fila antes del receipt. La normalización de ICM a minúsculas y espacios colapsados podría unir JSON que sólo varíe en esos aspectos; la aplicación evita reserializar cambiando bytes y conserva el canonical payload. El journal sigue siendo autoridad si se altera o pierde la base ICM. La recuperación no consulta `recall` para demostrar ausencia.

## Evidencia ejecutada

Binario: `/tmp/personajes-icm-0.11.4-audit/install/bin/icm`, reporta `icm 0.11.4`, commit fuente `5f402434919e514109a95c6cf504427fbcef851f`, SHA-256 local `c9cb593e21ffd72fd1d408cf0f6fef6f2dfcf256ef9b280eab467f0df5c21806`. No se usó login, OAuth, proveedor de modelos, embeddings ni voz.

El gate de integración pasó 13/13 con:

```sh
PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm \
  node --import tsx --test tests/journal.test.ts tests/memory-projection.test.ts tests/icm.test.ts tests/local-host.test.ts
```

Las pruebas migran una base v1 con experiencia real, rechazan schema futuro sin mutarlo, proyectan dos experiencias con la misma frase a dos memorias SQLite, reabren journal y base, y simulan la ventana tras un `store` real y antes del ack: el host nuevo adquiere ownership exclusivo, recupera el claim antes de publicar el journal y reejecuta el worker sobre el payload congelado. También verifican que un segundo host no puede abrir mientras el primero conserva ownership. No matan el proceso ni simulan un corte eléctrico. Tras recuperar el claim, el replay devuelve el mismo ULID, inserta el receipt y permite validar el envelope por el ledger durable. `npm test` completo pasó **114/114** con el binario ICM fijado y `PERSONAJES_ICM_TEST_BINARY`; el gate específico del journal–ICM–host pasó **13/13**. Al actualizar este informe, `npm run typecheck` queda bloqueado por `src/application/production-preflight.ts:9` (declaración `NarrationMode` sin uso), fuera de este alcance.

Esto acredita el límite de integración journal–ICM ejercitado con el binario fijado y la recuperación en la composición `openLocalHost`. No acredita que el servidor ejecute el worker en producción, login, runtime Pi, UI, backups ni P12 integral.
