# Backups externos: respuestas del custodio — corte 49

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, según el [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Estas respuestas delimitan diseño; no acreditan transporte, admisión ni restauración ejecutados. Las propuestas de los agentes no se atribuyen como elecciones expresas del usuario.

## Fuentes

Conversación heredada: identidad, memoria y perspectiva privadas, una instancia Pi independiente por personaje y GUI funcional. PRD UI-10, MEM-07/MEM-08, P14 y P24; S02 persistencia/backup y S04 importación/exportación/backup. Estado consultado: [restauración como fork](restauracion-como-bifurcacion.md), [recover offline](recuperacion-offline.md), [ADR 0013](../adr/0013-recuperacion-offline-y-control-externo.md), `backup-service.ts`, `backup-fork-source.ts` y rutas exchange. Al iniciar este corte verify admite backups locales registrados con la misma lineage y el lector deriva una ruta local desde el ID original; esa frontera no constituye importación externa.

## Ronda 1 — identidad de admisión, privacidad y procedencia

**Pregunta recibida.** El entrevistador propone registro externo con ID nuevo del host separado del `manifest.backupId`, checksums sin autenticidad atribuida, no overwrite ante colisión, recover externo bloqueado y explicación gráfica del carácter privado del paquete. Pregunta cómo listar fuentes y conservar procedencia del backup original al bifurcar sin padre vivo.

**Respuesta.**

- **Requisitos y reglas documentadas:** privados de actor y sesiones independientes; PRD/S04 conservan originales, tratan importaciones como datos y excluyen credenciales. Fork obtiene continuidad, memorias y sesiones nuevas. Export portable y backup son artefactos distintos: el primero excluye sesiones Pi y rutas host.
- **Regla derivada:** el transporte de backup completo es privado y sensible; puede contener memorias, JSONL, medios, rutas y estado del operador. La GUI debe explicar el contenido al descargar/admitir. Descargar no publica ni exige por sí mismo otra aprobación ritual no pedida. La exclusión técnica de credenciales del paquete debe comprobarse, no inferirse de una etiqueta.
- **Regla derivada:** SHA-256 y manifest prueban correspondencia/integridad, no autor ni veracidad del contenido. La indicación «integridad verificada, origen no autenticado» es compatible mientras no haya firma/verificación explícita. Un payload válido no se convierte en canon ni en instrucciones administrativas.
- **Propuesta de identidad:** ID de importación/registro generado por el host, separado del ID de backup original. Conservar ambos, hashes de manifest/journal/archivo recibido, principal y fecha. No reescribir manifest para adaptarlo al namespace local ni sustituir un backup existente.
- **Alternativa evaluada:** rechazar IDs originales coincidentes evitaría sobrescritura, pero impediría admitir respaldos válidos con coincidencias de nombre. Un registro separado permite conservar ambos sin trasladar autoridad del emisor al namespace host.
- **Regla derivada de idempotencia:** misma operación, hash y principal recuperan la misma admisión; deduplicar bytes entre principales no concede ACL ni revela registros ajenos.
- **Regla derivada:** listar sólo fences públicos desde el bundle registrado y validado; fork usa journal/configuración/estructura/cortes privados del mismo bundle, sin padre vivo requerido. La procedencia del destino debe enlazar ID/lineage/hash originales y una referencia de registro local separada, sin alterar evidencia fuente.
- **Regla preservada:** recover extranjero continúa bloqueado. No debilitar las condiciones de misma raíz, lineage e igualdad integral del corte 48 para simular portabilidad.

No aparece una preferencia humana material imprescindible en esta ronda.

## Ronda 2 — transporte acotado, cuarentena y SQLite externo

**Pregunta recibida.** El entrevistador contrasta bodies actuales de 24 MiB y respuesta binaria de 32 MiB con archivos de backup de hasta 256 MiB. Propone índice/versión y partes con hash/tamaño, transferencias por Blob/stream sin base64 global, límite total explícito y estados durables. Pregunta por validación SQLite previa a `openJournal`, migraciones antiguas y cuándo habilitar fuentes.

**Respuesta.**

- **Regla derivada del alcance gráfico:** no presentar un transporte limitado al body actual como solución general para backups cuyos archivos permitidos exceden ese límite. Índice versionado, partes acotadas, selección por índice/offset validado por el host, tamaños/hashes y CAS/idempotencia constituyen una propuesta compatible. No unpack de rutas arbitrarias del cliente ni base64 del paquete entero en memoria.
- **Propuesta de límites iniciales:** 256 MiB por archivo y 1 GiB total son valores técnicos posibles, no preferencias expresas. Deben exponerse antes de transferir. Si el productor actual permite más, alinear creación/export/admisión o identificar rechazos legacy con diagnóstico preciso; nunca truncar ni atribuir compatibilidad universal. Un tamaño por archivo no acredita soporte del agregado.
- **Propuesta durable:** estados receiving/validating/registered/failed, operación/principal/hashes persistidos y partes retomables. Repetir el mismo chunk no produce otra admisión; una colisión con contenido distinto falla.
- **Regla derivada:** el archivo externo es dato hostil. Validar versión, catálogo de esquema y límites en copia privada antes de abrir un journal con migraciones. `trusted_schema=OFF`, deshabilitar extensiones y límites explícitos complementan el catálogo cerrado; no convierten cualquier SQLite en confiable.
- **Rectificación técnica necesaria:** rechazar toda tabla virtual del paquete impediría admitir backups ICM reales con FTS/vec0. El journal puede exigir catálogo cerrado sin views/triggers/virtuales desconocidos; para ICM hace falta validar el esquema fijado y sus tablas de respaldo sin cargar extensiones nativas arbitrarias. El fork reconstruye memorias desde experiencias congeladas del journal en nuevas bases ICM, sin ejecutar esquema externo ni adoptar sesiones JSONL.
- **Propuesta de versión:** inicialmente admitir sólo la versión actual cuyo esquema completo esté aprobado; versiones anteriores únicamente con catálogo permitido y migración host explícita, probada sobre copia privada. No anunciar migración compatible por el mero hecho de que `openJournal` la intente.
- **Regla derivada de la cuarentena:** antes del registro ofrecer sólo diagnóstico, versión, integridad y datos públicos obtenidos bajo validación segura; no permitir fork ni adoptar fuente. Registro y listado autorizado requieren archivos/hashes/SQLite/fences, configuración y cortes privados completos y ACL host. Un checkpoint ausente no se completa desde el host vivo.

El transporte puede preservar JSONL como archivo privado del respaldo, pero la restauración como fork no ejecuta su contenido ni lo convierte en una sesión Pi del destino.

## Ronda 3 — finalización, aplicación y aceptación completa

**Pregunta recibida.** El entrevistador propone registro inmutable mediante CAS, replay de recibos aun si el estado avanzó, preview de restore ligado al registro y ausencia de efectos en GET. Pregunta si la admisión íntegra necesita otra confirmación, y propone pruebas entre dos hosts, chunks, interrupciones, esquema hostil, ICM real, round-trip y GUI hasta fork.

**Respuesta.**

- **Regla derivada:** upload y finalización pueden validar y registrar automáticamente lo que el operador eligió admitir. No hay requisito de otra confirmación para esa admisión que no aplica cambios a la obra. Preview y confirmación de fork sí conservan la revisión visible previa a crear nueva continuidad. Registrar no autentica al autor del paquete.
- **Propuesta durable aceptada para diseño:** operación/principal, inventario inmutable, hashes de manifest y bytes recibidos, transición CAS y recibo idempotente. GET no valida, publica ni reintenta. Registered no cambia por modificar archivos de cuarentena: alteración invalida integridad, no sustituye el registro ni un backup coincidente.
- **Regla derivada:** preview enlaza registro, hashes, fuente/corte, principal, selección, diff y token. La intención confirmada sobrevive interrupciones y retoma el mismo destino. Foreign recover se bloquea por el tipo y procedencia del registro, incluso si un manifest no autenticado afirma el mismo root/lineage local.
- **Evidencia propuesta:** además de la lista del entrevistador, comprobar límites de recursos para SQLite malformado, esquemas desconocidos y archivos no admitidos; paths de auth prohibidos, JSONL tratado sólo como bytes, medios sin reproducción automática; descarga con ACL, no-store y filename seguro sin ruta privada.
- **Regla de evidencia de paquete completo:** comparar manifest original y TODOS sus archivos con tamaños/hashes: journal, todas las ICM, WAL de staging declarado, sesiones actorales y administrativas/forenses, metadatos de fork incompleto y medios registrados. Una prueba que sólo importe journal no acredita backup completo. Usar respaldo real con dos actores, memorias, sesiones, medios y una operación staging para acreditar las familias pertinentes.
- **Diferencia de efectos:** download transporta bytes privados exactos. El fork importa únicamente el corte escogido y sus experiencias permitidas, conocimiento y base dramática; crea IDs propios y nuevas bases, no reutiliza ICM ni ULIDs originales como si fueran almacenamiento de destino. Sesiones y trabajos ajenos no cruzan.
- **Alcance explícito:** descargar un registro extranjero podría ser compatible con ACL y bytes originales, pero no se presupone implementado si el corte sólo habilita descargar backups locales. Límites agregados, versiones y compatibilidad legacy deben conservarse como decisiones técnicas verificables, sin prometer soporte universal.

**Cierre.** No se detectan preguntas humanas materiales necesarias. Los ensayos de dos hosts con IDs originales coincidentes, paquetes mayores a 32 MiB, chunking adversarial, caídas, SQLite hostil e ICM real, round-trip completo, rechazo de recover extranjero y recorrido gráfico determinan qué capacidad puede declararse ejecutada. El objetivo completo y la aceptación integral del producto permanecen abiertos.
