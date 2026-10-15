# Restauración como bifurcación — corte 47

El corte conecta backups locales registrados con una restauración como representación nueva. Incluye fuente respaldada exacta, intención de confirmación durable, preparación de ICM independiente, API, GUI y recuperación de la misma operación. Se preservan las ocho partes del objetivo; recuperar el host completo offline e incorporar backups de otra lineage siguen pendientes.

La [entrevista](dialogo-restauracion.md), las [respuestas del custodio](restauracion-respuestas.md) y [ADR 0012](../adr/0012-fuente-de-restauracion-y-confirmacion-durable.md) separan requisitos, reglas derivadas y decisiones técnicas delegadas. No se atribuyen esas decisiones al usuario ni se inventa una recuperación offline ejecutada.

## Fuente y frontera de autoridad

El operador elige explícitamente `sourceRunId` dentro del backup; no aporta un destino, experiencias ni un paquete. El host verifica manifiesto, archivos y corte. `readBackupForkSource` comprueba el journal contra su hash, rechaza sidecars no declarados y rutas enlazadas y crea una copia privada temporal; el lector y las migraciones actúan sólo sobre esa copia. El bundle original no se abre con SQLite. Su snapshot, configuración Ready, estructura y lote privado se leen mediante los mismos validadores exactos que una fuente viva. La ausencia de checkpoint bloquea: no se completa desde conocimiento o memoria actuales.

La migración v37 agrega `fork_backup_sources`. La fuente canónica y su hash se guardan junto al job en una transacción. `backupOrigin` identifica backup, lineage, manifiesto y journal, sin rutas ni recuerdos. Publicación, retry y recuperación validan esa fuente congelada; el padre puede estar ausente o haber avanzado. La solicitud idempotente distingue origen vivo y origen de backup. Continúan los remapeos de identidad, aislamiento de ICM, conocimiento desconocido, escenas cerradas/ausentes, antecedentes y procedencia editorial de los cortes anteriores.

Sesiones, trabajos de otros forks incompletos, reservas, secretos, permisos de sesión y preflight no cruzan esta restauración. El destino Ready necesita su propia admisión antes de actuar; los bindings sonoros requieren vinculación y comprobación. No hay inferencia por crear, leer o recuperar el trabajo mecánico.

## Revisión, confirmación y recuperación

La revisión tiene operación estable, principal privado, selección, hash del manifiesto, diferencias y fingerprint. Devuelve sólo su DTO público. Se conserva antes de efectos y sólo la confirmación explícita cambia su marca de uso. Una caída después de confirmar y antes de crear el fork deja una intención reanudable; no un token consumido sin ruta de salida. El replay y `recoverRestores` vuelven a admitir la misma operación, incluso después de vencer la revisión ya confirmada. Una revisión sin confirmar no se aplica automáticamente y sí expira. Las llamadas concurrentes a la misma confirmación comparten el trabajo en vuelo.

La capa HTTP reanuda respuestas inciertas sólo de preview/restore, mediante los contratos idempotentes del servicio. Otras operaciones interrumpidas no se reinterpretan como reintentables. Propietario, selección, path, hash y body siguen comprobándose antes del replay. Un fallo de importación queda en el job existente y su retry conserva destino y fuente.

El launcher compone el puerto real, recupera sólo intenciones confirmadas al arrancar y espera restauraciones admitidas antes de cerrar forks, journal y ownership. La verificación de un backup con WAL ahora también usa copias privadas: ningún `quick_check` abre el SQLite original del bundle ni crea allí SHM. Restaurar no cambia ni degrada la barrera global de backup.

## API y GUI

- `GET /backups/{id}/sources` verifica el bundle y devuelve sólo sus cortes públicos; no paths ni estados privados.
- `POST /backups/{id}/restore-preview` recibe `{mode:"fork",sourceRunId,name,reason}`. La clave idempotente conserva token y operación; el principal proviene del host.
- `POST /backups/{id}/restore` exige CSRF, clave, ETag del backup, token y confirmación del diff. Devuelve 202 `ForkJobView`, ETag del job y Location. Consulta y retry usan las rutas de fork existentes.

El panel crea/consulta un backup, obliga a elegir un origen, presenta diferencias y exige marcar la revisión antes de confirmar. Guarda el intento antes del envío; recargar consulta por GET y mantiene claves y operación. Un rechazo comprobado por expiración permite preparar otra revisión; una respuesta incierta conserva la anterior. Los retries no se reutilizan entre restauraciones y se limpian al confirmar Ready. El destino abre su preparación preservando la protección de edición heredada.

QA contra el launcher, SQLite y CLI ICM 0.11.4 reales, con datos sintéticos:

1. Crear un backup con cinco representaciones y elegir un corte estructurado de una bifurcación anterior.
2. Revisar fuente y diferencias; renovar una revisión que venció antes de admitirse, sin crear un destino para ella.
3. Confirmar, consultar Ready y abrir la representación restaurada con su nombre y editor conservado.
4. Recargar y recuperar por GET la misma operación `f1ea2ef6-5d8b-45a9-acb1-52f7b905637e` y destino `86ba8c87-09b7-4801-ab52-23e9a4f6fdd8`.
5. Comprobar en SQLite un solo job para esa operación, corte de destino cero/secuencia 8, procedencia respaldada y cero sesiones Pi. Los 22 archivos del backup conservaron sus hashes; no se crearon sidecars en el bundle.

Captura local de evidencia: `.runtime/restauracion-publicada.png`, fuera de Git. La puesta y sus datos son sintéticos; no sustituyen decisiones artísticas del usuario ni prueban acceso live a modelos o voces.

## Correcciones y verificación

La revisión independiente encontró un retry residual en la GUI que podía bloquear una restauración posterior; se limpia al reiniciar y al confirmar Ready, con protección adicional contra otras operaciones. QA mostró además colisión de cookies entre hosts de localhost: cada puerto ahora tiene nombre de cookie propio y no acepta la heredada ni la de otro puerto. Dos servidores reales con un jar compartido comprueban sesiones, CSRF y logout independientes. No se amplían permisos ni se debilitan Origin, SameSite o CSRF.

Las pruebas nuevas incluyen HTTP completo con fuente viva avanzada e ICM real; receptor sin padre vivo con memorias reales y conocimiento no disponible; fuente congelada, hashes, atomicidad, cortes incompletos y alteraciones; claim interrumpido, expiración, propietario, concurrencia y replay; y bytes, permisos e inventario de los bundles intactos. El receptor sin padre ejercita el puerto interno trusted: **no demuestra admisión externa por HTTP**. Verificación integral final: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` aprobó TypeScript y **858 pruebas**, con cero fallos y una omitida exclusiva de Linux (859 totales). `npm run build` terminó correctamente. La pestaña y el host temporales de QA se cerraron al terminar.

## Pendientes preservados

- Recuperación offline del conjunto completo bajo ownership, sin sobreescribir historia posterior y con reconciliación de sesiones y archivos; la GUI lo declara pendiente y la API mantiene blocker explícito.
- Importación/cuarentena/admisión de backups de otra lineage. Se conserva la exigencia de backup local registrado; no se elimina el control de lineage para simular una capacidad de importación.
- Edición derivada autorizada, evolución completa, calibración de voces/ritmo, servicios reales, accesibilidad e invalidaciones de todas las superficies y aceptación de los 77 requisitos.
