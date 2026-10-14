# Evidencia de ejecución del adaptador ICM

Fecha: **14 de octubre de 2026**. Esta evidencia cubre el adapter CLI y SQLite de [`src/adapters/icm.ts`](../../src/adapters/icm.ts), con pruebas en [`tests/icm.test.ts`](../../tests/icm.test.ts). No demuestra que el runtime completo, el journal de recibos/outbox, Pi ni P12 estén integrados.

## Binario y revisión

No había `icm` en `PATH`; el host sí tenía Cargo/Rust (`cargo 1.99.0`, `rustc 1.99.0`) y es `Darwin arm64`. Inspeccioné primero la [API oficial de la release `icm-v0.11.4`](https://api.github.com/repos/rtk-ai/icm/releases/tags/icm-v0.11.4). Esa release publica un asset Apple Silicon con SHA-256 `af2069c9577bfa8e226d4d166b2f108870e639e1597b91f1497c6a2a13a5db11`, pero su tag apunta al commit `feb5f58bf64432da838e0eb86ec210b6c12e9908`. Para que la ejecución coincida exactamente con la revisión ya auditada, compilé desde [`rtk-ai/icm` commit `5f402434919e514109a95c6cf504427fbcef851f`](https://github.com/rtk-ai/icm/tree/5f402434919e514109a95c6cf504427fbcef851f); su [`crates/icm-cli/Cargo.toml`](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/Cargo.toml) declara `0.11.4`.

Cargo usó un `CARGO_HOME` y un prefijo `--root` privados bajo `/tmp/personajes-icm-0.11.4-audit/`; no instalé en el repo, en el `CARGO_HOME` normal ni en `PATH`. La build SQLite-only usó:

```sh
CARGO_HOME=/tmp/personajes-icm-0.11.4-audit/cargo cargo install \
  --git https://github.com/rtk-ai/icm.git \
  --rev 5f402434919e514109a95c6cf504427fbcef851f \
  --locked --root /tmp/personajes-icm-0.11.4-audit/install \
  --no-default-features --features backend-sqlite icm-cli
```

Binario usado por las pruebas: `/tmp/personajes-icm-0.11.4-audit/install/bin/icm`. `icm --version` devolvió exactamente `icm 0.11.4`; el checkout de Cargo confirmó `HEAD=5f402434919e514109a95c6cf504427fbcef851f`. El SHA-256 del binario compilado localmente es `c9cb593e21ffd72fd1d408cf0f6fef6f2dfcf256ef9b280eab467f0df5c21806` (checksum local de este ejecutable, no firma upstream). El binario y el cache quedan fuera del repositorio para permitir repetir la prueba en esta sesión.

## Contrato comprobado

`createIcmMemoryAdapter` recibe la ruta absoluta privada, `runId`, `actorId`, ruta absoluta del binario y un puerto host `ledger.findReceipt`. El adapter construye la base en `runs/<runId>/actors/<actorId>/memory.sqlite`; ninguna llamada de lectura o escritura acepta ruta, backend, identidad o topic. El directorio/configuración son privados. `ICM_CONFIG` apunta a TOML controlado por el host con `store.backup.enabled=false`, `memory.auto_consolidate_enabled=false` y `embeddings.enabled=false`. Cada proceso recibe un entorno reducido con `ICM_DB_BACKEND=sqlite`, `ICM_CONFIG` privado y directorios privados `HOME`/`TMPDIR`; no hereda `ICM_DB_BACKEND`, `ICM_READONLY`, credenciales ni configuración ambiente. El binario se fija por ruta y `checkHealth()` exige `icm 0.11.4` antes de operaciones.

La escritura valida/recalcula el `FrozenExperience` de la aplicación y envía su `canonicalPayload` completo como `--content`; el topic se deriva del tipo de experiencia (`experience-belief`, etc.). El `experienceId` UUID del envelope forma parte de `Memory.summary`. Se invoca `spawn` con argv, `shell:false`, `--db <ruta> --no-embeddings store --topic <topic> --content <payload> --importance medium`; sólo un cierre de proceso con código cero y una línea reconocida `Stored: <ULID>` confirma el resultado. La CLI puede añadir su sufijo de enlaces `(+N link[s])`; no se acepta texto de error aunque el proceso haya salido con código cero.

`actor.recall` ejecuta la búsqueda rankeada `--db <ruta> --no-embeddings --read-only recall <query> --limit <n> --format json`. `diagnostics.listForensic`, que es otra capacidad y no forma parte de `actor`, ejecuta `--db <ruta> --no-embeddings --read-only list --format json --all`. Ambas leen las memorias JSON de ICM, parsean `summary` como envelope canónico y comparan ID, propietario, corrida, hash, receipt durable y `worldSeq` contra el corte enviado al ledger host. Los resultados inválidos, ajenos, posteriores al corte o sin receipt se omiten y se cuentan; un fallo del ledger cancela la lectura completa. `recall` queda etiquetado como ranking no exhaustivo; lista forense materializa toda la DB y no se ofrece como tool del actor.

Los límites aplicados son query de hasta 2.048 bytes UTF-8, `limit` 1–20, timeout de proceso de hasta 10.000 ms, stdout+stderr combinado hasta 2 MiB para store/recall y 16 MiB para lista forense. Al abortar, exceder tiempo o bytes se termina el proceso y se descarta toda la salida; un store incierto no produce receipt y puede reintentarse con el envelope congelado. El límite de ICM de 65.536 bytes se vuelve a comprobar al congelar la experiencia. No hay llamadas a embeddings, inferencia, OAuth, proveedores ni voces.

## Pruebas ejecutadas

El gate real se ejecutó con:

```sh
PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm \
  npm test
```

La ejecución dedicada `PERSONAJES_ICM_TEST_BINARY=… node --import tsx --test tests/icm.test.ts` pasó **4/4**. Cada prueba ICM corrió sobre procesos y bases SQLite temporales reales: verificó versión y forma CLI; store de español con negación; mismo envelope reintentado devuelve el mismo ULID; experiencias con igual contenido y UUID distintos reciben ULID distintos; recuperación tras reiniciar el adapter entre store y receipt; recall y list en modo read-only; corte temporal y rechazo de receipt de otro actor/run/hash; archivo producido con cabecera SQLite y permisos; y funcionamiento aunque el proceso padre tenga backend PostgreSQL, `ICM_READONLY=1` y una `ICM_CONFIG` inválida. Los directorios de prueba se eliminaron al cerrar.

Los tests adicionales con binario fixture comprobaron que una salida de error con exit code cero no se acepta como store, que un exit code distinto de cero invalida incluso una línea `Stored: …`, y que la cancelación termina el proceso. Esos fixtures sólo verifican fallos del transporte; no sustituyen el gate de CLI real anterior. El typecheck estricto aislado de adapter y tests pasó con `skipLibCheck` para las declaraciones de dependencias externas; no cambié configuración ni dependencias del proyecto. El último `npm test` del workspace completo ejecutó 55 pruebas: **52 pasaron y 3 fallaron en `tests/world.test.ts`**, sin fallos ICM. `npm run typecheck` también notificó errores en ese archivo (TS2352 línea 199 y TS2353 línea 429); el typecheck aislado de ICM permanece limpio. Esto apareció en cambios concurrentes fuera del alcance de este informe.

La ventana “store confirmado, proceso reiniciado antes del receipt” se simuló recreando el adapter tras terminar el primer comando y antes de insertar el receipt del ledger de prueba. El replay real devolvió el mismo ULID y luego el ledger temporal permitió recuperar la experiencia. No fue un corte eléctrico ni una prueba de transacción distribuida.

El `ledger` usado por estos tests es un mapa temporal de prueba, no `memory_receipts` durable del journal. La conexión del outbox/receipt real, el worker serial, el endpoint/tool Pi y las pruebas de recuperación integradas siguen pendientes fuera del alcance de estos dos archivos. Por ello, esta evidencia no marca P12 como completa ni demuestra protección exactly-once entre SQLite ICM y el journal.
