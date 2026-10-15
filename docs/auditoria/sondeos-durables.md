# Sondeos de acceso durables y panel administrativo

Corte v20, 14 de octubre de 2026. El objetivo completo y los 77 criterios integrales siguen pendientes. Actualización posterior: desde el [corte de OAuth dual](oauth-dual.md), el panel permite login OAuth tanto de OpenAI como de Anthropic. Este corte es anterior: cualquier mención a que Anthropic no tenía login desde GUI o aceptaba API key describe sólo el estado histórico y ya no es el requisito vigente.

## Implementación

El launcher comparte el ModelRuntime del host con el broker de sondeos. Construirlo y abrir el panel sólo recupera/consulta metadata local. El sondeo requiere la acción explícita del operador y un perfil seleccionable completo, Sol low u Opus medium. La interfaz informa que la solicitud mínima puede consumir cuota o generar un cargo; no envía personajes, memoria, tools ni contexto de la obra y no crea una sesión actoral persistente.

El journal v20 conserva `pi_access_jobs`, historia, operaciones y resultados privados. Claim y completion están ligados a revisión, owner y lease; los hashes privados de completion permiten reconocer el mismo callback tras reiniciar sin aceptar otro resultado. Claves idempotentes comparten namespace con borradores y OAuth. El recibo de inicio es inmutable; GET devuelve el estado actual con ETag aparte. Reabrir recupera estados sin lanzar otra sonda. Cancelación, fallo, aborto e incertidumbre permanecen separados de acceso aprobado.

El broker espera al transporte real incluso cuando el puerto ya devolvió timeout/ambiguity; conserva la exclusión y el ownership hasta su asentamiento. No adopta una aprobación tardía de ese intento. La repetición de una operación recupera el mismo recibo y no realiza un retry nuevo al proveedor.

`pi/auth/access-fingerprint.salt` permanece en el almacenamiento privado, con permisos y ownership verificados. El lector de credenciales calcula HMAC del secreto efectivo y su proveedor; consultar metadata no refresca OAuth ni ejecuta comandos de configuración. No se publican huellas privadas, sal, tokens OAuth, claves, rutas, errores SDK ni texto del sondeo. El resultado público aprobado sí muestra perfil efectivo y contadores de uso reales, enteros seguros; una respuesta con modelo/esfuerzo incongruente se rechaza.

GET status liga su evidencia al job exacto, proveedor, perfil, huella actual y vigencia. No combina un recibo aprobado antiguo con el payload de un trabajo posterior. Sin credencial actual, una comprobación anterior no acredita acceso: el job conserva su diagnóstico y el status permanece cerrado.

## HTTP y GUI

- POST `/api/v1/integrations/pi/access-check`: perfil cerrado, Origin/cookie/CSRF y clave idempotente; 202 con recibo inicial y Location.
- GET `/api/v1/integrations/pi/access-check/jobs`: página acotada de metadata pública; no crea trabajos.
- GET `/api/v1/integrations/pi/access-check/jobs/:id`: job actual y ETag fuerte `pi-access:<id>:r<revision>`.
- DELETE de ese job: petición cooperativa con CSRF, CAS y clave propia; no finge rollback de una ejecución ya confirmada.

La GUI consulta y recupera trabajos, sigue estados y solicita cancelación. Una respuesta perdida conserva el mismo intento y clave; un 4xx confirmado se distingue de un resultado incierto. Al salir del panel se cancelan las lecturas del navegador, no el trabajo durable. En el corte v20, el panel OAuth todavía administraba sólo OpenAI y no configuraba Anthropic; el corte dual posterior corrigió esa limitación (ver [OAuth dual](oauth-dual.md)).

## Verificación

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` aprobó TypeScript y **334 pruebas**, cero fallos y cero omisiones; log `/tmp/personajes-access-v20-verified.log`. Build aprobado, 392 módulos, con aviso de bundle mayor de 500 kB; log `/tmp/personajes-access-v20-visual-build.log`. La revisión independiente ejecutó 30 pruebas focales; el ajuste posterior de contadores enteros seguros quedó cubierto por el gate global.

La prueba HTTP integrada usa broker, SQLite y SDK reales con un store vacío: POST crea el trabajo, la falta de credencial produce auth-required antes del transporte, GET/ETag/lista/replay y 404 funcionan, con cero transportes al proveedor. Las pruebas positivas de Sol/Opus siguen usando credenciales sintéticas y fetch/SSE controlados; no acreditan acceso de una cuenta real.

En navegador real, host temporal `/tmp/personajes-access-v20-final-jZ4yk1`, puerto 52945: se confirmó ausencia de OAuth, se inició una comprobación de Sol y se mostró failed/auth-required. Tras reiniciar se recuperó ese mismo resultado por lectura, sin nuevo sondeo. SQLite confirmó un job, tres versiones de historia, una operación y un resultado; cero WorldRuns, eventos, sesiones actorales/Continuista, jobs actorales y jobs OAuth. Captura: `/tmp/personajes-access-v20-final-jZ4yk1/comprobacion-recuperada.jpg`.

La verificación también detectó un hash de biblioteca desactualizado tras modificar la investigación Pi para documentar los nuevos perfiles. Se actualizó sólo el hash de ese archivo en el manifest; se conserva la validación de integridad y las pruebas de catálogo pasan.

## Pendientes

Faltan acceso live aprobado, configuración de credencial Anthropic desde interfaz, adaptadores host y receipts durables del preflight, inicio/control de representación, tiempo acumulado, escena/conversación visibles, Director/narrador, voz/ritmo, replay/backups/restauración y aceptación de los 77 requisitos. Este corte no acredita una actuación real ni reduce el alcance del producto.
