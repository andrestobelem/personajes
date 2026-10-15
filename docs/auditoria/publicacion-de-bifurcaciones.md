# Publicación durable de bifurcaciones — corte 45

Fecha: 15 de octubre de 2026. Continúa la [preparación del corte 44](preparacion-de-bifurcacion.md). Se implementó el núcleo host de publicación y recuperación; todavía no está compuesto en el launcher ni expuesto mediante API o interfaz de bifurcación. No acredita el recorrido integral ni cierra los 77 requisitos.

## Contrato contrastado

La [entrevista delegada](dialogo-publicacion-fork.md), con [respuestas reales del custodio](publicacion-fork-respuestas.md), resolvió conservar la estructura editorial heredada, distinguir publicación Ready de permiso de ejecución y no reconstruir información sonora pasada desde un almacén actual. Sus respuestas son decisiones técnicas clasificadas, no preferencias nuevas atribuidas al usuario. [ADR 0011](../adr/0011-publicacion-de-fork-y-base-dramatica.md).

## Configuración y base editorial

`prepareForkConfiguration` conserva ficha, identidad, idioma, perfil de inferencia y presupuesto configurado; crea continuidad nueva y calcula hashes/fences concordantes. Cada preparación derivada identifica su configuración/corte y hash de preparación fuente. Rebasar las referencias de continuidad no cambia autores ni inventa biografía. Los antecedentes externos admitidos conservan corrida, IDs y envelopes originales; el archivo completo importado permanece separado. Las referencias tipadas de presencia humana se remapean sin inventar presencia efectiva en una escena nueva.

La semilla editorial conserva episodios/actos/escenas abiertos y cerrados, ordinales y asociaciones. Los IDs operativos cambian. Su revisión estructural local y cortes de importación son cero; `forkOrigins` conserva los cortes y evidencias de origen, incluida la cadena de herencias anteriores. Las consecuencias importadas nunca se insertan como eventos locales. Las lecturas actuales e históricas parten de esta base y aplican sólo eventos nuevos del destino. Cerrar o continuar la representación no reabre unidades heredadas. `start` mantiene la base en vez de inventar un episodio inicial; una corrida derivada Ready permite abrir explícitamente unidades estructurales para salir del intervalo entre escenas.

La validación de continuación comprueba reparto, preparación, capacidades, lugares, canales, presencias configuradas, audio y disponibilidad también entre escenas. No salta esas comprobaciones por carecer de escena activa. Reconoce la última escena cerrada de un perfil humano como referencia configurada; no la transforma en presencia remota ni concede audiencia. Las preparaciones ordinarias siguen necesitando una escena inicial abierta. El modo administrativo comprueba además la identidad exacta de la corrida configurada.

## Sonido y procedencia

Se conserva la configuración declarada en el Ready inicial inmutable de la fuente, cuyo hash forma parte del corte. No se afirma copiar la configuración sonora efectiva de ese commit: todavía no existe su reconstrucción histórica. El job publica `audioDerivation` con esta base y esa limitación. Los slots vinculados pasan a habilitados sin vínculo, conservando modo, modelo, variedad, formato y subtítulos. El preflight debe acreditar las vinculaciones nuevas antes de ejecutar audio; no se genera voz ni se degrada a texto de manera silenciosa durante el fork.

## Journal y archivos

La migración v35 añade `fork_jobs`, `fork_job_history`, `fork_projection_receipts` y `fork_dramatic_seeds`, sin backfill de historia. El trabajo reserva operación, propietario, clave y destino, congela paquete/manifiesto y conserva hashes e historial. El mismo pedido recupera el mismo destino e identidades; reutilizar una clave para otra operación o pedido se rechaza. El estado staging no crea una fila operativa visible en `world_runs`.

`createForkRuntime` prepara únicamente archivos propios bajo `forks/<operationId>/staging`. Crea cada SQLite por una interfaz soportada de ICM, aun sin experiencias, sin inventar recuerdos de relleno. Después de cada store hace durable el archivo antes de confirmar su recibo. Comprueba todos los recuerdos mediante el lector forense y los recibos del trabajo; las bases pasan `quick_check` y se registran tamaño/hash. Un marcador de propiedad liga directorio, operación, destino y paquete. El traslado al directorio definitivo no publica la corrida: una interrupción allí conserva staging y la recuperación verifica la misma ubicación ya trasladada.

La transacción final vuelve a derivar y comprobar fuente, configuración, semilla, correspondencias y conjunto exacto de recibos. Publica configuración/continuidad, snapshot, conocimiento con su indisponibilidad original, experiencias, recibos ICM y base editorial; registra el borrador para poder listar la preparación y captura el checkpoint privado cero después de todas las semillas. Ready se confirma en esa misma transacción. Si falla, no quedan filas parciales del destino. No se copian sesiones Pi, intenciones, trabajos actorales, inboxes, reservas, secretos, permisos de sesión ni preflight aprobado. El fork no hace inferencia.

Pausar/cerrar el servicio cancela su trabajo mecánico y conserva staging. Recuperar reanuda las mismas identidades y recibos, incluso si el store ICM había terminado antes de persistir su recibo. Los fallos operativos quedan como códigos seguros; el retry explícito conserva paquete y destino. La edición ordinaria de borradores no puede invalidar un fork publicado: necesita una vía derivada explícita que preserve memoria, origen y semilla.

## Revisión y evidencia

Las pruebas nuevas usan SQLite y CLI ICM 0.11.4 reales; no transportes de modelo ni un fake de fork. Cubren publicación vacía y con recuerdos, ausencia de sesiones/eventos fabricados, fuente intacta, reintento idempotente, fork de otro fork y recuperación después de un recibo, después del traslado y entre store y receipt. La semilla se comprueba entre escenas, con episodios cerrados/abiertos, actos y orígenes heredados. Se verifica rollback del destino si falla la captura privada final.

La revisión independiente encontró y corrigió: reutilización incorrecta del mismo claim de memoria para varios recuerdos; aceptación de otro operationId bajo una clave anterior; invalidación del fork por el editor ordinario Ready; y acceso a archivos/directorios enlazados antes de comprobar su aislamiento. Los guards ICM comprueban base, sidecars, configuración y directorios antes del acceso y después de cambios de ruta; las regresiones comprueban bytes y permisos externos intactos.

La primera suite integral detectó además una carrera en el fixture de ownership: el padre veía el archivo de barrera creado pero todavía vacío. El fixture ahora publica el nonce mediante traslado atómico antes de considerarlo disponible. Esto no cambia el contrato de exclusión del host.

Verificación final del corte: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` aprobó TypeScript y **785 pruebas**, con cero fallos y una omitida exclusiva de Linux (786 totales). `npm run build` terminó correctamente. La traducción HTTP de la protección de preparación devuelve 409 `FORK_PREPARATION_READ_ONLY` en guardar y validar; sus pruebas de frontera se distinguen de las regresiones de autoridad con journal real. La revisión independiente final no encontró errores restantes en el alcance revisado. No se modificó la GUI ni se acredita un recorrido gráfico de fork en este corte.

## Lo que sigue pendiente

- Componer el runtime en el launcher, su cierre, recuperación, barrera de backup y notificaciones.
- API autenticada con CSRF, propietario, ETags y consulta/reintento seguro, sin aceptar paquetes privados o artefactos aportados por el cliente.
- Operación gráfica desde un corte, seguimiento, diagnósticos de audio, navegación al destino y representación visible de la procedencia editorial importada.
- Edición derivada autorizada de la preparación y perfiles; el editor ordinario permanece protegido.
- Reutilización validada de voces/activos y, por separado, historia de configuración sonora efectiva por commit.
- Restauración desde backup como fork, pruebas de aceptación integrales, sincronización y cargas largas. El lector forense actual tiene un límite de salida de 16 MiB por actor: supera ese límite con un rechazo, sin truncar ni publicar parcialmente. No se acredita escala arbitraria.

El estado Ready del job prueba publicación coherente de este paquete; no aprueba credenciales, ejecución de una obra, voces, fidelidad de personaje ni cumplimiento integral del PRD.
