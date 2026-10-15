# Preparación verificable de una bifurcación

Fecha: 15 de octubre de 2026. Corte 44, continuación del [corte privado 43](cortes-privados.md). Es implementación interna previa al job durable; no hay operación de fork publicada ni una nueva representación Ready creada por este flujo.

## Alcance y autoridad

La fuente debe ser un corte exacto del journal, no una copia del presente: snapshot, configuración Ready hash-verificada y checkpoints privados de todos los personajes. El transformador valida que corrida, revisión, secuencia, hash del snapshot y revisión/hash de configuración coincidan. No mezcla cortes ni completa archivos antiguos con memoria actual. Los datos de procedencia identifican origen; no conceden al personaje acceso al resto de la base fuente.

El registro compartido de identidades genera UUID v4 para entidades, puertas, canales, escenas, ofertas, metas operativas, experiencias y referencias a eventos/percepciones; conserva un manifiesto de correspondencias. Las referencias históricas mapeadas no se publican como eventos nuevos del destino. Los handles opacos se regeneran por propietario: una misma cadena conocida por dos personajes no crea una identidad compartida. Las continuidades obtienen identificadores nuevos. CharacterId, HumanParticipantId, PlaceId y los IDs editoriales de metas, inventario, capacidades y condiciones conservan su significado bajo el nuevo RunId. Los textos y sourceRefs documentales no se buscan ni reemplazan.

La transformación del mundo recorre campos tipados, incluyendo inventario sostenido/consumido, ofertas abiertas y terminales, historias de metas y relaciones, creencias, reconocimiento, presencias, escenas cerradas y entidades reservadas por plantillas. Conserva reloj, secuencia causal y revisiones adquiridas de objetos/ofertas; la nueva historia de snapshots comienza en revisión cero. Mantener secuencia es necesario: reiniciarla a cero puede invalidar objetos del catálogo que ya aparecieron. Un estado entre escenas conserva todas sus escenas cerradas y activeSceneId null.

Cada experiencia propia importada recibe ID y RunId nuevos, y `forkOrigin` con corrida/personaje/ExperienceId/hash del payload original y commit/revisión/secuencia/hash del snapshot fuente. El envelope canónico y su hash se recalculan; contenido, confianza, fechas, negaciones y fuentes documentales se conservan. La procedencia inmediata de un fork anterior permanece comprobable mediante el payload hash del padre, sin anidar una historia ilimitada en cada envelope.

Las referencias internas se resuelven únicamente sobre el archivo propio admitido y los antecedentes externos explícitamente curados en PreparedCharacter.initialExperience. Estos últimos conservan sus IDs y su corrida original; no se materializan como experiencias actuales ni se usa la sección curada de 10.000 elementos para truncar un archivo mayor. Se rechazan experiencias posteriores al reloj, IDs ambiguos entre personajes, colisiones con antecedentes conservados, contenido modificado y referencias huérfanas. Ausencia histórica de conocimiento sigue siendo ausencia, no conocimiento vacío.

El resultado `prepared-fork-state` es un paquete interno de mundo y estado privado con correspondencias restaurables. No es una configuración Ready ni un permiso de ejecución. No copia sesiones, trabajos, leases, inboxes, reservas o secretos. Restaurar el manifiesto reproduce las identidades del paquete; esto todavía no constituye recuperación durable de un job.

## Revisión y pruebas

Una revisión independiente de los agentes comprobó los campos de identidad y reprodujo tres defectos: IDs de experiencias compartidos por actores distintos, colisión de una identidad restaurada con un antecedente externo y una historia de relación sin experiencia admitida. Los tres se corrigieron con rechazo explícito y regresiones. El orden del manifiesto usa comparación léxica estable, sin depender del locale del host.

El gate ICM ejecuta el CLI 0.11.4 y SQLite reales: guarda un recuerdo en origen, materializa sólo el archivo seleccionado en otra base por `projector.store`, comprueba reintento con el mismo memoryId, recupera exclusivamente recuerdos scoped al destino y compara byte por byte la base origen sin cambios. Usa receipts de proyección controlados; no acredita que exista publicación durable del fork ni actuación Pi. No se llama a modelos.

La lectura `readForkSource` usa una transacción SQLite de sólo lectura y comprueba snapshot exacto, configuración inicial y contextos originales, sin exigir que todo personaje ausente tenga un contexto preparado. Recupera todos los archivos privados y rechaza el lote completo si falta o falla uno. Doce pruebas de fuente comparan todas las tablas antes/después, conservan el resultado tras memoria tardía y reapertura, comprueban el intervalo entre escenas y rechazan datos alterados/legados sin checkpoint. El transformador recibe esa fuente, sin publicar el destino.

Verificación integral: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` terminó correctamente con TypeScript, **738 pruebas: 737 aprobadas, cero fallidas y una omitida exclusiva de Linux**. `npm run build` y `git diff --check` correctos. Son 24 pruebas nuevas entre fuente, transformador, identidades, experiencias e ICM. No hubo GUI nueva, inferencia externa ni operación de fork publicada en este corte.

## Brechas que siguen abiertas

- Registro del target con configuración y contextos preparados recalculados, nueva continuidad completa y hashes coherentes; todavía se conserva la configuración fuente como evidencia.
- Alta Ready, validación y start compatibles con un estado entre escenas. El camino ordinario exige escena activa y no puede reutilizarse inventando una. El registro inicial ordinario también crea conocimiento vacío; debe incorporar semillas privadas antes del checkpoint cero conservando indisponibilidad histórica.
- Traslado o procedencia de episodios/actos, cuyos ledgers están fuera de WorldSnapshot. No se infieren copiando escenas.
- Remapeo de presencias humanas y vinculación sonora en la configuración destino; copiar una referencia de voz no acredita validación local nueva.
- El lector de fuente abre su propia transacción; no debe anidarse dentro de la futura transacción de publicación. Falta medir el costo de verificar archivos privados de obras largas.
- Job durable staging/ready/failed, manifiestos/hashes de staging, proyección y receipts persistentes, conciliación journal/archivos y recuperación idempotente ante caída.
- API autenticada, GUI operativa de bifurcación/restauración y recorrido integral padre/hijo, sin mutación del origen ni inferencia implícita.

Estas brechas no se trasladan al usuario como decisiones nuevas ni se consideran bloqueos para continuar implementando. Los 77 requisitos mantienen pendiente su aceptación integral.
