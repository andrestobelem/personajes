# Restauración: respuestas del custodio — corte 47

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, conforme al [procedimiento](../diseno/procedimiento-grill-with-docs.md). Las recomendaciones técnicas de los agentes no constituyen elecciones expresas del usuario ni prueban una restauración ejecutada. El integrador debe contrastarlas con código y resultados antes de actualizar el estado de implementación.

## Fuentes y autoridad

Se leyeron README, índice documental, constitución, glosario, skills locales grill-with-docs/grilling/domain-modeling, procedimiento delegado, PRD (MEM-08, NFR-03, P14), specs [S02](../specs/02-persistencia-e-icm.md), [S04](../specs/04-api-y-autoridad.md), [S05](../specs/05-interfaz.md), [ADR 0011](../adr/0011-publicacion-de-fork-y-base-dramatica.md), auditorías [backup](backup-e-intercambio-cloud.md) y [operación de fork](operacion-de-bifurcaciones.md), y `src/domain/backup.ts`/`src/application/backup-service.ts` del estado inicial del corte.

**Requisito expreso del concepto:** memorias, perspectiva y Pi independientes; interfaz funcional para entender y operar la obra. **Reglas documentadas del producto:** P14 y S02/S04 exigen recuperar una frontera coherente, conservar posteriores, distinguir recover de fork, no sobrescribir silenciosamente, y crear continuidad y memorias separadas al bifurcar. Los detalles operativos que siguen son reglas derivadas o propuestas, según se indica.

## Ronda 1 — fuente, selección y continuidad

**Pregunta efectivamente recibida.** El entrevistador propone seleccionar `sourceRunId` en el bundle, destino nuevo y corte del journal validado del backup; pregunta si debe funcionar cuando la fuente desapareció o avanzó en el host. También pregunta si recover debe conservar eventos posteriores y si una corrida ausente exige recuperación offline del conjunto, con qué barrera de consistencia.

**Respuesta del custodio.**

- **Regla derivada de S02/S04/P14:** el origen del fork es el corte verificado del bundle, incluidos journal, estados privados, configuración y estructura del mismo corte. Si el backup contiene R@15 y el host no tiene R o conserva R@40, el nuevo destino parte de R@15. El estado vivo no sustituye la evidencia guardada ni completa sus vacíos. No se consulta la memoria ICM actual de R para reconstruir el pasado.
- **Regla documentada:** destino con run/continuidad nuevos y remapeo scoped. Se importan sólo experiencias accesibles al corte; no se transfieren sesiones/checkpoints Pi, jobs, claims, inboxes no consumidos, reservas, secretos ni entregas pendientes. ADR 0011 conserva procedencia y publicación final tras verificar memorias privadas independientes. No se llama a un modelo para restaurar.
- **Propuesta de contrato:** `sourceRunId` selecciona una corrida del backup; exigirlo siempre simplifica y elimina ambigüedad. Inferirlo únicamente cuando hay una corrida sería una alternativa válida, no una preferencia expresada por el usuario. El cliente no elige `targetRunId`: lo genera el host y lo devuelve, como en el fork existente.
- **Regla documentada de S04:** recover no descarta eventos posteriores. Un mismo `lineageId` no autoriza retroceder ni mezclar ICM vieja con journal nuevo. Si el destino avanzó, rechazar conservadoramente con divergencia y cero cambios cumple la prohibición de pérdida; no demuestra recuperación completa. Aceptar un avance compatible requiere verificar de manera integral journal, memoria y sesiones; sólo un no-op realmente verificado puede afirmar que ya está recuperado.
- **Regla derivada de P14/S02:** recuperar un destino ausente exige el conjunto coherente offline, no insertar una corrida aislada en otro journal. Ownership exclusivo, cese y drain de todos los writers, cierre de handles SQLite y verificación en staging deben preceder a la publicación. Una copia de archivos o un puerto de prueba no acredita ese flujo.

**Caso de límite conservado.** R@15 guardado contiene un secreto que Max aún no recibió; R@40 vivo sí lo conoce. La bifurcación restaurada de R@15 no adquiere ese secreto por consultar el presente del host. Recover sobre R@40 tampoco sustituye su memoria por la copia R@15: preserva el estado o informa divergencia.

**Abierto tras esta ronda.** Mecanismo operacional de recover offline (proceso auxiliar o reinicio administrado), reconciliación portable de rutas y leaves Pi, e identidad durable/reintentos de la restauración. Son trabajo de diseño e implementación, no elecciones delegadas al usuario por defecto.

## Ronda 2 — admisión, interrupción y operación gráfica

**Pregunta efectivamente recibida.** El entrevistador identifica que `used=1` antes de `apply`, sin resultado persistido, deja `RESTORE_INTERRUPTED_REQUIRES_INSPECTION`. Propone un job durable previo a efectos y pregunta por el fingerprint, la expiración del preview, la recuperación de staging y cómo conciliar GUI con ownership offline; considera reinicio administrado o CLI explícitamente offline.

**Respuesta del custodio.**

- **Regla derivada de S04 y ADR 0011:** persistir antes de efectos una operación vinculada a principal, modo, backup/hash, corrida/corte fuente y destino reservado. La confirmación reclama el token y registra el job de manera atómica. Un token usado sin vínculo recuperable a esa operación no demuestra continuidad durable.
- **Regla derivada:** el preview breve habilita una admisión; debe ligar principal, bundle/manifest, selección, modo, diff y fingerprint. Después de admitir, el replay exacto resuelve la misma operación aunque haya vencido el preview, conserva IDs y no llama modelos. La consulta no inicia ni reintenta trabajo. Una petición nueva no sustituye una operación ya iniciada.
- **Regla derivada para fork:** el fingerprint parte del bundle inmutable, no del avance o borrado del origen vivo. Cambios de integridad, versión, corte, configuración fuente, autoridad o reserva del destino invalidan la aplicación. Un destino aparecido y ajeno es conflicto; un destino perteneciente a la misma operación se reconcilia mediante marcador, paquete y recibos, según ADR 0011.
- **Regla derivada para recover:** el fingerprint debe cubrir lineage, estado relevante de destino e inventario/identidad de sus archivos y sesiones, además de la exclusión de writers. Comparar sólo el hash del snapshot no comprueba la frontera entre stores. Revalidar dentro de la exclusión antes de publicar; un destino divergente requiere otro preview sin perder lo anterior. El staging de la propia operación permite retomar sin IDs nuevos.
- **Propuesta para cerrar el producto:** GUI crea la solicitud durable y muestra que requiere reinicio; un ejecutor del host drena/cierra workers y conexiones, mantiene ownership, realiza la operación offline y vuelve a arrancar de manera administrada. La interfaz recupera el estado del mismo job al volver.
- **Alternativa segura como avance parcial:** GUI permite preview/diff y muestra blocker explícito para recover mientras falta ejecutor. Una CLI offline real y verificada puede aportar progreso; no cierra por sí sola la interfaz gráfica completa ni autoriza presentar una operación online ficticia. Si este corte sólo implementa restore-fork, recover y su operación gráfica permanecen pendientes.

**Límite de autoridad.** Confirmar el diff es parte del contrato S04 ya documentado. No implica pedir una nueva aprobación humana por cada paso técnico reversible. Tampoco se debe anunciar reinicio administrado ni restauración ejecutada hasta tener código y resultados que lo acrediten.

## Aclaración — lineage e intercambio de bundles

**Pregunta efectivamente recibida.** El entrevistador observa que PRD exige recorrido habitual sin comandos y que la verificación actual exige lineage local. Pregunta si fork puede aceptar otra lineage mediante registro y validación explícitos, manteniendo fuera rutas o manifests aportados como autoridad por el cliente.

**Respuesta del custodio.** Recover exige la misma lineage. Una bifurcación podría conceptualmente partir de otra lineage verificada y producir una continuidad nueva; esa portabilidad es distinta de la capacidad actual de restaurar backups locales registrados. **Propuesta:** conservar en esta entrega la frontera de backup local registrada; quitar la comprobación de lineage no constituye implementar importación. Bundles externos necesitan un flujo host de importación/cuarentena/registro, validación de integridad y política de aceptación de procedencia. El cliente no elige rutas privadas ni certifica un paquete aportando su propio hash. CLI sola sigue sin cerrar el recorrido gráfico exigido. No aparece una preferencia humana imprescindible para avanzar con backups locales.

## Ronda 3 — evidencia, alcance y cierre de la entrevista

**Pregunta efectivamente recibida.** El entrevistador propone backup real con dos actores, experiencias y estructura editorial; cambiar o eliminar el origen vivo; admisión HTTP/GUI, interrupciones después de recibo ICM y después de traslado/publicación, y reinicio con los mismos IDs/ULIDs. Pregunta si jobs staging ajenos deben excluirse al restaurar un fork de una corrida publicada, pero conservarse en recover offline.

**Respuesta del custodio.** El plan concuerda con P14 con estas comprobaciones adicionales:

- Corte privado exacto, hashes de manifest/configuración y cierre de referencias comprobados. Si faltan, bloquear sin rellenar el pasado con el estado actual. Preservar negaciones, revisiones y conocimiento desconocido, no sólo comparar cantidades.
- Conservar base dramática entre escenas, personajes preparados ausentes y procedencia; remapear identidad humana/canales sin inventar presencia. El audio queda con derivación explícita y bindings pendientes, sin atribuir reutilización validada.
- Fuente y backup permanecen sin cambios, incluidos sidecars. SQLite abierto en lectura puede requerir SHM junto al WAL; inspeccionar y recuperar desde una copia privada verificada evita escribir sobre el bundle. La prueba debe inspeccionar archivos además de filas.
- Inyectar fallos antes y después de reclamar preview/registrar job, así como en proyección, traslado y publicación. Replay admitido sobrevive a la expiración del preview, devuelve el mismo recibo y permite consultar estado actual; no crea otro destino.
- Probar principal ajeno, CSRF, ETag, token/hash cambiados y rutas con symlink/hardlink/traversal. No permitir que el cliente aporte paquete privado o recibos.
- La transacción final de publicación debe verificar la evidencia autorizada del bundle, no volver a depender de `readForkSource` del origen vivo. De lo contrario, el ensayo de origen ausente no acredita el contrato.

**Acuerdo derivado:** restore-fork de una corrida publicada sólo importa esa fuente y el contexto privado accesible al corte. No importa jobs staging ajenos ni copia el journal completo a la nueva continuidad. Recover offline sí conserva esos jobs, paquetes y recibos originales para conciliarlos con las mismas identidades, sin inferencia.

**Cierre.** No se detectó una pregunta humana material necesaria para este alcance. Permanecen como entregas por demostrar recover offline, su operación gráfica/reinicio administrado e intercambio de bundles extranjeros. Si el corte 47 implementa únicamente restore-fork local, esos puntos deben continuar abiertos. Esta entrevista resuelve fronteras de diseño; los tests, código y recorrido reales determinan qué capacidad está ejecutada.
