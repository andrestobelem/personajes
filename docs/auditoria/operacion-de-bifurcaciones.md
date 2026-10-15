# Operación de bifurcaciones — corte 46

Continúa el [núcleo de publicación del corte 45](publicacion-de-bifurcaciones.md). La bifurcación ya está compuesta en el launcher local, con rutas autenticadas, panel gráfico, recuperación mecánica al arrancar y barrera de backup. Esto no cierra la aceptación integral del PRD ni implementa restauración pública.

## Autoridad y operación

El operador local autenticado puede seleccionar un corte confirmado, nombre y motivo. Su modo ficticio no concede ni limita autoridad administrativa sobre esta operación; no se exige activar Dirección en la ficción. El host fija el principal y crea destino, continuidad, identidades y paquete. El cliente nunca aporta memorias, recibos, manifiestos ni un RunId destino.

- `POST /runs/{runId}/forks`: CSRF, clave idempotente y `If-Match` exacto `"fork-source:<runId>:c<commitIndex>:w<worldRevision>:s<worldSeq>"`; body estricto con esos tres números, `operationId`, `name` y `reason`. Devuelve 202, Location y ETag del trabajo. El corte puede ser histórico: no exige que siga siendo el presente.
- `GET /forks/{operationId}`: sólo principal propietario; devuelve estado y ETag sin iniciar ni reintentar trabajo. Sigue disponible cuando falta el runtime ICM.
- `POST /forks/{operationId}/retry`: CSRF, clave nueva y `If-Match` `"fork:<operationId>:r<revision>"`; body vacío. Sólo un fallo admite transición a staging. El replay exacto devuelve el recibo original aun si el trabajo terminó después; GET consulta el estado actual.

El DTO público incluye fuente, destino, estado, revisión, fechas, nombre/motivo y derivación sonora. Excluye principal, clave idempotente, paths, paquete y recuerdos. Credenciales, preflight y bindings de voz no se aprueban por publicar un fork. Sin runtime configurado, iniciar/reintentar responde 503 seguro; consultar no llama proveedores.

La migración v36 agrega `fork_job_retries`, con request/resultado y hashes, sin modificar fuentes ni checkpoints históricos. El cambio de job y su recibo se confirman en una transacción. Claves usadas para otras operaciones o distintos IDs/payloads se rechazan; también los replays conservan la comprobación de propietario. El scheduler relee el estado durable al agendar: un recibo viejo o callback diferido no vuelve a abrir ICM después de Ready.

## Host y backup

El launcher crea el runtime sólo cuando está configurado el binario ICM, instala handlers de apagado antes de recuperar staging y cierra/drena fork antes de cerrar representación/journal/ownership. Recuperar no inicia actores ni cambia el perfil elegido. La suspensión propia bloquea begin/retry/recover y deja terminar los escritores mecánicos admitidos.

Backup adquiere primero admisión HTTP y después la suspensión de fork, antes de enumerar las representaciones. Así incluye también destinos publicados mientras se drenaba. El inventario deriva exclusivamente de jobs, paquetes y recibos registrados. Las bifurcaciones incompletas conservan main SQLite y WAL byte a byte, metadata canónica, marcador y configuración ICM; regenerar SQLite podría alterar el hash de artefactos ya congelado. Las publicadas usan el snapshot SQLite habitual. Se comprueban rutas cerradas, directorios, sidecars, enlaces y correspondencia exacta entre recibos, IDs y contenido almacenado. Un recuerdo recibido ausente impide declarar un backup válido.

Dos pruebas copian un bundle a un host offline de ensayo y recuperan interrupciones durante memoria y después del traslado, preservando destino, IDs y recibos. Esto acredita coherencia del bundle con recuperación mecánica; **no acredita un endpoint ni una interfaz pública de restauración**.

## Interfaz y recorrido ejecutado

El panel fija el corte al elegirlo y lo conserva al navegar al presente. Un intento mantiene operación y clave ante respuesta incierta; sessionStorage guarda el intento validado por corrida y, tras recargar, sólo consulta por GET. No vuelve a enviar POST automáticamente. Permite consultar, repetir el mismo envío, reintentar el mismo destino fallido y abrir el destino publicado. Si el navegador impide guardar el intento, lo informa. No se promete conservarlo después de cerrar definitivamente la pestaña o borrar el almacenamiento de sesión.

La preparación heredada expone `editability=fork-published`; el editor ordinario queda de sólo lectura y explica la historia conservada. Los controles estructurales de un Ready derivado permiten declarar episodios y escenas explícitos antes de iniciar. La vista distingue bases editoriales heredadas y cortes de origen de nuevas aperturas locales.

Recorrido en navegador contra el launcher real, SQLite e ICM 0.11.4, con datos sintéticos y sin inferencia:

1. Elegir commit 1, volver al presente commit 2 y comprobar que el intento conserva commit 1/revisión 5/secuencia 7.
2. Crear, consultar Ready y abrir el destino; comprobar la preparación protegida y sus botones ordinarios deshabilitados.
3. Recargar, reabrir la fuente y recuperar por GET el mismo ID de operación y destino.
4. Cerrar la escena de la fuente, bifurcar commit 3 entre escenas, abrir el destino Ready y declarar episodio y escena nuevos con un personaje y lugar explícitos.
5. Bifurcar nuevamente ese episodio, completar el intento conservado después de reiniciar el host y expandir la base dramática heredada para ver fuente/apertura originales y base local cero.

No se ejecutó una representación con proveedor real ni se generaron voces. La primera operación y destino de este recorrido son sintéticos; no constituyen una puesta elegida por el usuario.

La prueba gráfica detectó un defecto que los fixtures anteriores no cubrían: episodios y actos creados por HTTP usan UUID determinísticos v5, mientras el registro de fork exigía v4 para todas las fuentes. Ahora el manifiesto discrimina episode/act y acepta exactamente el contrato UUID de esos dominios, generando destinos v4; las otras familias conservan su restricción v4. La regresión abre episodio, escena y actos por HTTP real y después los bifurca con ICM real. También se conservan los nombres de escenas heredadas desde la proyección pública del corte, sin sustituirlos por UUID ni consultar estado futuro.

## Verificación y límites

La suite incluye ahora archivos `*.test.ts` y `*.test.tsx`; las pruebas de interfaz del fork participan en la verificación integral. Se agregaron regresiones de HTTP/CSRF/ETags, privacidad del DTO, idempotencia y recuperación del retry, suspensión de admisiones, callback tardío tras Ready, backup de trabajo incompleto, persistencia local del intento, procedencia editorial y editor protegido. `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` aprobó TypeScript y **815 pruebas**, con cero fallos y una omitida exclusiva de Linux (816 totales). `npm run build` terminó correctamente. Una lectura SQLite posterior al recorrido confirmó cuatro trabajos Ready (tres operados por GUI y uno adicional de depuración), sus cuatro semillas heredadas y cero sesiones Pi actorales. La pestaña y el host temporales de QA se cerraron al terminar. Captura local de evidencia: `.runtime/fork-herencia-verificada.png` (fuera de Git).

Pendientes: edición derivada autorizada de preparación/perfiles, restauración pública offline/fork, reutilización validada de audio, calibración de voces/ritmo, navegación e invalidaciones integrales y aceptación de los 77 requisitos. El objetivo completo sigue activo.
