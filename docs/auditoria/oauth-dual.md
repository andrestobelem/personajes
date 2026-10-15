# Login OAuth para OpenAI Codex y Anthropic

Corte local del 15 de octubre de 2026. El producto exige que el operador pueda iniciar sesión con la cuenta de OpenAI o la de Anthropic, conforme al proveedor del perfil elegido. La interfaz, el transporte HTTP y el broker ahora cubren ambos proveedores. Este corte no acredita login de una cuenta real, entitlement, inferencia live ni cumplimiento integral de P18 o de los 77 requisitos.

## Flujo y seguridad

- OpenAI Codex conserva el flujo device-code del SDK: el panel muestra el código público temporal y abre la página oficial. El usuario completa allí la autorización.
- Anthropic sigue el flujo OAuth `copy_code` del SDK: el panel abre el enlace oficial permitido (`https://claude.ai/oauth/authorize`) y recibe el código manual en un campo efímero. El enlace debe ser HTTPS y usar el host, puerto, ruta y forma esperados; una URL diferente se rechaza.
- El código manual se entrega una sola vez al trabajo de login que lo solicitó. El desafío tiene vencimiento, UUID y alcance de sesión local; el endpoint de respuesta exige CSRF. Una segunda sesión no puede leer ni responder ese desafío. Cancelar el trabajo aborta la espera y elimina el desafío.
- El código no se incluye en el DTO del job, recibos idempotentes, journal, SQLite ni logs de contenido. El navegador lo limpia al enviarlo o al cambiar el desafío y no usa almacenamiento persistente. Las claves API no forman parte del flujo de conexión de producto.
- Estado, inicio y desconexión conservan el proveedor elegido. El perfil de acceso mostrado corresponde a Codex/Sol 6.1 low o Anthropic/Opus 5.5 medium. Preflight y la comprobación de acceso exigen OAuth para ambos; una API key del entorno o del SDK no reemplaza el login. Un bloqueo de ejecución OAuth es global porque ambos proveedores comparten el archivo de credenciales del ModelRuntime.
- El operador inicia sesión una vez por proveedor en el host. Cada personaje conserva una instancia/sesión Pi propia y usa la credencial OAuth del proveedor que indique su perfil; las instancias no comparten conversación, historial Pi ni contexto de sesión. El SDK y el ModelRuntime del host comparten el almacén de credenciales, por lo que no se repite el flujo OAuth por personaje.

## Persistencia y compatibilidad

La migración de journal v40 amplía el proveedor de jobs OAuth y conserva los registros históricos, incluidos los bytes de sus payloads y el replay/idempotencia de Codex. Para solicitudes históricas de Codex se mantiene el hash de petición anterior; Anthropic recibe una identidad idempotente distinta. El índice de exclusión es global para evitar escrituras concurrentes sobre el almacén compartido.

Los backups con journal v39 o v40 se validan con las variantes DDL locales conocidas. La validación compara el esquema de origen y nunca ejecuta SQL recibido desde el archivo. La cobertura incluye restauración desde v39 con la migración del journal destino.

## Verificación

- `tests/pi-anthropic-oauth-broker.test.ts`: desafío de un uso y aislamiento, cancelación y rechazo de URL ajena.
- `tests/pi-dual-oauth-ui-http.test.ts`: proveedor exacto en el selector, login Anthropic y envío HTTP del código con CSRF/alcance, sin exponerlo en la respuesta.
- `tests/pi-dual-oauth-journal.test.ts`: preservación e idempotencia histórica v39, serialización y persistencia de ambos proveedores.
- `tests/external-backup-validation.test.ts`: aceptación de DDL v39 histórico y migración de la copia validada.
- [Captura del panel Anthropic](evidencias/c55-oauth-anthropic.png): demuestra proveedor/perfil seleccionados y estado sin credencial en el host de QA; no se inició un login real.
- Verificación focal comunicada por los responsables: 14/14 pruebas de puerto/broker OAuth, 22/22 pruebas HTTP/UI, 8/8 pruebas OAuth de journal/broker, y 9/9 pruebas de migración; la suite externa de backups cubre DDL v39 y v40 con ICM real en la verificación global. Las pruebas de gate verifican que una API key Anthropic se bloquea antes de transporte y que OAuth continúa pasando.
- La verificación global final aprobó TypeScript y 1.167 pruebas, con cero fallos y una omitida; `npm run build` también pasó. La corrida se hizo con ICM 0.11.4 real.

## Límites

No se introdujeron credenciales reales ni se ejecutó login externo. Las pruebas usan el SDK Pi instalado con respuestas controladas, ICM local y rutas HTTP locales; verifican la orquestación y la protección de datos, no la autorización de una cuenta. Después de elegir proveedor, el operador aún debe iniciar el login, realizar la comprobación explícita de acceso y verificar que el modelo concedido coincida con el perfil.
