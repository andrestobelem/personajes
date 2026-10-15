# Adaptaciones en preparación: respuestas del custodio — corte 52

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, según el [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Las propuestas técnicas no se atribuyen como preferencias expresas del usuario ni prueban implementación.

## Fuentes y estado leído

Concepto: ficha/identidad/historia exhaustivas, conocimiento situado e instancias independientes. PRD CAT-02/CAT-05/CAT-06/CAT-07 y P24; Constitución §2/§11; preparación, preflight, exchange de dossiers y Configurador. Al comenzar C52, exchange guarda adaptaciones independientes por principal/importId pero no ofrece selección/list/read integrados. Prepared liga revisión y hash Markdown, insuficientes para cambios de metadata con el mismo texto. El compiler Configurador y manager C51 resuelven el catálogo original; no acreditan usar una adaptación seleccionada.

## Ronda 1 — fuente exacta y dos hashes distintos

**Pregunta recibida.** El entrevistador propone fuente discriminada original investigado/adaptación guardada, referencia host y fullArchiveHash, con snapshot congelado; selección explícita y ACL sin owner/path/JSON cliente como autoridad. Pregunta qué incluye el hash y cómo distinguir payload recibido de adaptación materializada por importDossier.

**Respuesta.**

- **Requisito y regla documentada:** CAT-02/CAT-05/CAT-06/P24 preservan original, campos completos, fuentes, vacíos y contradicciones; adaptaciones explícitas y continuidad permitida. Importar no hace canon ni transmite todo el expediente a actores.
- **Regla derivada:** hash del archivo canónico `exportDossier(Dossier)` materializado debe incluir todos los campos: aliases, secciones, normalizedMarkdown, fuentes, vacíos, contradicciones y metadata de adaptaciones. Mismo Markdown no prueba misma fuente completa.
- **Distinción necesaria:** hash del archive recibido acredita bytes/procedencia de la entrada. `importDossier` agrega ID/metadata de adaptación; el hash de ese dossier guardado es otra identidad y es la seleccionada por preparación/preflight/Configurador. Conservar ambos y sus vínculos a import/adaptation, sin intercambiarlos.
- **Propuesta:** `dossierSource` discriminado entre original investigado y adaptación guardada, con referencia host, hash completo y snapshot canónico congelado en configuración o registro enlazado verificable. Evitar depender del catálogo mutable al leer historia/restaurar.
- **Regla de autoridad:** el cliente elige referencia y hash esperado; el host resuelve principal/ACL, identidad y snapshot, verifica checksum y estampa metadata. Owner, path o JSON de dossier cliente no prueban esa fuente.
- **Regla de selección:** GET list/read sólo para el principal autorizado y personaje correcto; no exponer paths ni contexto privado actoral. Import/apply no selecciona automáticamente la última adaptación ni cambia una preparación. Ready, preflight y Configurador consumen la misma fuente inmutable; el actor sigue recibiendo únicamente curación accesible.

No se detecta una preferencia humana material ausente en esta ronda.

## Ronda 2 — historia, disponibilidad y cambio de selección

**Pregunta recibida.** El entrevistador plantea legacy sin fuente congelada, cambios del catálogo y registros ausentes, no backfill del presente, transporte autocontenido en fork/backup extranjero y curaciones ligadas al source anterior. Pregunta por privacidad, continuidad y promoción de identidad.

**Respuesta.**

- **Regla derivada:** revisión y hash Markdown legacy no acreditan metadata completa; no inventar snapshots antiguos desde el catálogo actual. Conservar historia, snapshot/contexto y hashes Ready ya guardados. Un nuevo preflight/Configurador/promoción que exija la fuente exacta informa indisponibilidad y bloquea; no confundir ese gate concreto con prohibición de toda lectura histórica.
- **Regla de fallo:** fuente ausente, error transitorio o checksum no verificable no habilitan fallback silencioso al original o la última adaptación. Migración no rellena hashes como si hubieran sido conocidos en el pasado.
- **Propuesta de transporte autocontenido:** nuevos snapshots congelados contienen dossier completo, hash y procedencia. Fork/backup extranjero los preservan sin resolver importId en el host emisor ni revalidar ACL de un principal remoto. La referencia externa es procedencia, no permiso ni canon; la autoridad de lectura de la nueva corrida la establece el host receptor. No conceder acceso público por ser transportable.
- **Regla de conocimiento:** seleccionar adaptación no concede información futura, mente ajena ni experiencias iniciales automáticas. Continúan aplicándose continuidad, unknownPolicy y curaciones por actor; el expediente global no se entrega al intérprete.
- **Regla derivada al cambiar source en draft:** conservar historial pero invalidar/resetear campos curados ligados a la fuente anterior, o marcarlos obsoletos hasta revisión explícita. Mostrar el cambio; no reescribir autor/procedencia para aparentar re-curación automática. Elegir source no rellena todas las secciones globales como saber del personaje.
- **Regla derivada de C51:** promoción de identidad mantiene constante la fuente seleccionada congelada. Cambia los cinco campos del núcleo preparado y la versión futura con evidencia propia; no sustituye dossier por catálogo original. Cambiar la fuente de un actor ya vivido es un flujo distinto con frontera, diff y epochs, no una consecuencia implícita de promover identidad.

No se requiere una nueva elección humana para preservar estas fronteras.

## Ronda 3 — edición integral, selección y aceptación

**Pregunta recibida.** El entrevistador propone biblioteca de adaptaciones por personaje/principal, lectura/edición de todos los campos, nueva adaptación inmutable con before/after, selector host-resolved con CAS, uso congelado en Configurador y pruebas de round-trip, ACL, metadata con igual Markdown e historia/restauración. Pregunta por confirmación de guardado/selección y por evitar JSON Patch libre.

**Respuesta.**

- **Requisito y regla documentada:** CAT-02/CAT-06/P24/UI-10 exigen conservar todos los campos, originales y autor/motivo/fecha/antes-después. Edición integral no se reduce a Markdown. Guardar crea otra adaptación, no muta el import anterior ni declara canon.
- **Propuesta de consistencia editorial:** editar raw Markdown requiere normalizar/reparsear y explicar el cambio de secciones; el hash se calcula en host. Secciones y texto no pueden convertirse en dos verdades incompatibles. Alias, intérpretes, fuentes, vacíos, contradicciones, receta de voz, referencias visuales y adaptaciones son datos con procedencia y licencias conservadas.
- **Regla de frontera:** schema de dossier estricto y validadores de identidad/referencias, sin JSON Patch libre que alcance paths, roles o configuración administrativa. El contenido no se ejecuta como HTML/instrucciones. Un alias nuevo no crea otro personaje ni amplía su identidad operativa automáticamente.
- **Regla de interacción:** reutilizar el review/diff y confirmación del editor/import para guardar la adaptación. Seleccionar source es una acción explícita normal con CAS/hash; no exige otra entrevista ni aprobación ritual. Ready sigue validando preparación y continuidad, sin volcar investigación en memoria actoral.
- **Regla de lectura:** GET comprueba ACL y hash completo; Configurador consume la fuente congelada del prepared. Cambio de catálogo posterior no sustituye esa fuente. Principal remoto, referencia repetida o mismo hash no otorgan permiso de acceder a otro registro.
- **Regla de round-trip:** comparar todos los campos, incluidos metadatos originales; metadata/ID nuevos de admisión se declaran por separado. No prometer igualdad byte a byte del dossier materializado cuando se agregó una adaptación nueva.
- **Evidencia propuesta adicional:** misma fuente/hash bajo referencias con ACL distintas; referencias rotas anidadas en unknownPolicy/provenance; invariantes del par Markdown/secciones; continuidad/perfil/fuente obsoletos; nuevo turno tras promoción mantiene la fuente seleccionada. Se suman a los casos del entrevistador: same Markdown distinto alias/vacío, actor incorrecto/tamper, recarga, catálogos cambiados, fork/backup extranjero sin registro original, prompt sin investigación ajena y selección stale sin rebase.

**Cierre.** No se detecta una preferencia humana material ausente. La edición y selección integrales forman parte del alcance requerido; avanzar por etapas no autoriza declarar completo el producto antes de ejecutarlas y verificarlas. Las respuestas describen diseño y requisitos, no resultados de implementación.
