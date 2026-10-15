# Diálogo sobre restauración desde un backup — corte 47

Intercambio real entre `/root/restore_interviewer` (entrevistador) y `/root/restore_custodian` (custodio), coordinado por el integrador. Se leyeron las skills locales [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md), [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) y el [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Las [respuestas conservadas del custodio](restauracion-respuestas.md) distinguen requisito, regla derivada y propuesta. Ninguna respuesta delegada es una elección humana ni prueba de implementación.

## Fuentes y problema comprobado

Se contrastaron README, índice, constitución, glosario, [PRD](../PRD.md) (MEM-08, NFR-03, P14), [S02](../specs/02-persistencia-e-icm.md), [S04](../specs/04-api-y-autoridad.md), [ADR 0011](../adr/0011-publicacion-de-fork-y-base-dramatica.md), [operación de bifurcaciones](operacion-de-bifurcaciones.md), `src/domain/backup.ts` y `src/application/backup-service.ts` del comienzo de este corte.

El servicio inicial verifica los archivos del backup, pero su puerto de restauración no está compuesto en producción. El preview recibe sólo manifest y modo, sin selección de corrida ni acceso al journal del bundle. El flujo marca `used=1` antes de `apply` y sólo guarda el resultado al finalizar: una interrupción intermedia produce `RESTORE_INTERRUPTED_REQUIRES_INSPECTION` sin operación reanudable enlazada. Además, la verificación exige la misma lineage del host. Estos hechos justifican la entrevista; no acreditan una restauración realizada.

## Ronda 1 — fuente, selección y frontera coherente

**Pregunta efectivamente enviada.** Si el backup guarda R@15 y el host ya no contiene R o conserva R@40 divergente, ¿el fork debe partir exclusivamente del journal y los estados privados del backup? Se recomienda seleccionar `sourceRunId` explícitamente para no confundir corridas de un bundle múltiple, y un destino nuevo. ¿Qué se excluye? En recover, ¿cómo se conservan los hechos posteriores y qué implica un destino ausente?

**Respuesta del custodio.** La fuente es el corte exacto verificado del bundle: journal, checkpoint privado, configuración y estructura. La existencia o el avance de R vivo no cambia R@15 guardado. No se consulta su memoria ICM actual para suplir vacíos ni incorporar conocimiento posterior. Se importa sólo experiencia accesible al corte con procedencia, IDs scoped nuevos y bases privadas separadas; no cruzan sesiones/checkpoints Pi, jobs, claims, inbox sin consumir, reservas, secretos o entregas pendientes. Selección obligatoria de `sourceRunId` y destino generado por el host son propuestas de contrato coherentes con estas reglas.

Recover no puede descartar hechos posteriores. Ante avance incompatible corresponde conflicto y cero cambios. Aceptar avance compatible exige verificar integralmente journal, memorias y sesiones; una igualdad de lineage o snapshot no alcanza. Si falta el destino, se requiere recuperar offline el conjunto coherente con ownership exclusivo, drain y cierre de handles, staging validado y publicación controlada. Insertar una corrida aislada en un journal distinto no demuestra recover.

**Caso de comprobación.** Max desconoce un secreto en R@15 y lo aprende en R@40. El fork desde backup R@15 no aprende ese secreto desde el host vivo. Recover sobre R@40 tampoco sustituye su memoria por la antigua.

## Ronda 2 — admisión, interrupción y operación gráfica

**Pregunta efectivamente enviada.** El claim `used=1` sin resultado deja una operación no reanudable. Se recomienda persistir el job antes de efectos, ligado a principal, operación, backup/hash, selección, modo y destino reservado; el token breve confirma diff y fingerprint, mientras que el replay del job admitido sobrevive a la expiración. ¿Qué cambios invalidan el preview? ¿Cómo cumple una GUI funcional la exclusión offline: reinicio administrado con trabajo durable o ejecutor offline separado?

**Respuesta del custodio.** El claim del preview y la creación/enlace durable del job deben ser atómicos. El replay exacto devuelve la misma operación incluso después de expirar el token; consultar nunca inicia ni reintenta. El token vincula principal, bundle, selección, modo, diff y fingerprint. Para fork, avance o borrado de la fuente viva no es divergencia: la fuente es el bundle. Sí lo son alteraciones del bundle/contrato validado o un destino ajeno. Los archivos de la misma operación se reconcilian mediante marker, paquete y recibos, sin regenerar IDs.

Para recover, el fingerprint debe abarcar lineage, estado relevante, inventario/identidad de archivos y sesiones y exclusión de writers. Se revalida bajo ownership antes de publicar; las modificaciones posteriores al preview bloquean. La propuesta para cumplir el recorrido gráfico completo es solicitud durable, estado que requiere reinicio, cierre/drain, helper offline y reinicio administrado con consulta del mismo job al volver. Si eso no se implementa, un preview con blocker explícito es honesto pero no acredita restauración; un CLI aislado puede demostrar motor, no cerrar la aceptación gráfica. No se debe mostrar reinicio ni éxito ficticios.

**Comprobación del entrevistador.** Se subrayó que PRD §1 y §4 exigen recorrido habitual sin comandos. También se preguntó si lineage distinta debe admitirse para fork validado y conservarse como restricción de recover, sin habilitar paths o manifiestos aportados por el cliente como autoridad.

## Ronda 3 — lineage y pruebas que demostrarían el resultado

**Pregunta efectivamente enviada.** Se propone probar backup real de R@15 con dos actores, experiencias, episodios y actos; avanzar o eliminar la fuente viva; operar preview y admisión por API/GUI; interrumpir tras recibo ICM y rename/publicación antes de respuesta; reiniciar y verificar misma operación, destino y ULIDs, sin memorias duplicadas ni llamadas a modelos. ¿Qué fronteras faltan? ¿Se excluyen los jobs staging ajenos del bundle al bifurcar sólo una corrida publicada y se conservan en recover offline?

**Respuesta del custodio.** Ese plan es válido si exige checkpoint privado exacto, manifest y configuración verificados, sin backfill actual. Debe preservar conocimiento desconocido, negación y revisión; escena nula y personajes preparados ausentes; identidad humana y canales remapeados sin inventar presencia; y derivación sonora sin reutilización de bindings no acreditada. La revalidación final de publicación debe usar la evidencia congelada autorizada del bundle y no volver a exigir `readForkSource` del host vivo. Los jobs staging ajenos no cruzan restore-fork; recover offline sí conserva sus recibos e identidad para reconciliar la misma operación.

La prueba debe usar CLI ICM real y verificar que fuente y backup permanecen sólo de lectura, incluidos sidecars: SQLite en modo `readOnly` junto a WAL puede crear SHM; si hace falta, se lee una copia privada en vez del backup. Se añaden interrupciones antes/después del claim y publicación; replay con token expirado; lectura por principal ajeno, CSRF, ETag, confirmación/hash inválidos y archivos manipulados, enlaces simbólicos/duros y traversal. Un resultado JSON igual por sí solo no demuestra continuidad privada ni independencia de sesiones.

**Aclaración sobre lineage.** Recover exige la misma lineage. Fork puede conceptualmente partir de otra lineage verificable con continuidad nueva, pero el sistema actual sólo registra backups locales de la lineage del host. Se recomienda conservar esa frontera en esta entrega: eliminar la comprobación no equivale a implementar importación. Admitir bundles externos requiere cuarentena/importación, registro host e integridad/autenticidad permitida; rutas o hashes aportados por cliente no otorgan autoridad. No hace falta una preferencia humana nueva para avanzar con backups locales registrados.

## Resultado y límites

Quedó resuelto el contrato de restore-fork desde una corrida explícita del backup, independiente de su estado vivo, con publicación privada durable y recuperación por la misma operación. Las elecciones concretas de DTO, selector obligatorio y reserva host son propuestas técnicas del intercambio; no se atribuyen al usuario.

No surgieron preguntas humanas materiales. El integrador puede avanzar con las decisiones vigentes. Debe mantener recover offline, intercambio externo y reinicio gráfico como pendientes mientras no existan implementación y evidencia suficientes. Este diálogo no acredita que se haya ejecutado restore, ni sustituye pruebas de disco, CLI, API y recorrido gráfico. El estado verificable debe figurar en la auditoría de implementación correspondiente.
