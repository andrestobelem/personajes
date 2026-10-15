# Fuentes exactas de preparación — fundamento del corte 52

El corte añade lectura de adaptaciones guardadas y contratos de fuente documental exacta. Es un fundamento construido, todavía sin selector gráfico. Incluye admisión host al guardado y lectura de fuentes en Configurador/preflight; falta el recorrido completo de selección. No se declara selección funcional completa ni aceptación integral. La [entrevista](dialogo-adaptaciones-preparacion.md) y las [respuestas del custodio](adaptaciones-preparacion-respuestas.md) conservan requisitos y propuestas, sin atribuirlas al usuario como elecciones nuevas.

## Biblioteca de adaptaciones guardadas

`dossier-exchange.ts` ofrece list/read de adaptaciones aplicadas, verificando sellos de import y adaptación, identidad, estado applied, revisión/ID, metadata y linaje exacto. No consulta el catálogo para reparar un registro dañado. La lista queda limitada al principal y personaje solicitados, con paginación estable mediante watermark y cursor ligados al alcance; leer no selecciona, modifica, importa ni llama modelos.

El resultado distingue `importedArchiveHash` del `archiveHash` materializado: el primero identifica el archive recibido, el segundo `exportDossier(importedDossier)` después de agregar la adaptación y nueva revisión. Se comprueba que retirar esa adición y restaurar la revisión parental recupera exactamente el archive de entrada. Alias, vacíos, contradicciones y demás metadata forman parte del hash completo; igual Markdown no significa mismo dossier.

GET `/dossier-adaptations?characterId=...&limit=...&cursor=...` devuelve página del principal autenticado; limit predeterminado 25, máximo 100. GET `/dossier-adaptations/{adaptationId}` devuelve la adaptación completa con ETag `"dossier-adaptation:<id>:<archiveHash>"`. No acepta principal, owner ni path del cliente; rechaza UUID/query/cursor inválidos y campos o parámetros duplicados. Las rutas sólo leen y no cambian ninguna preparación.

## Referencia y fuente congelada

`domain/dossier-source.ts` discrimina `catalog-original` y `saved-adaptation`. La referencia seleccionable incluye personaje, revisión, contentHash y fullArchiveHash; adaptación agrega importId/adaptationId. La fuente resuelta agrega `frozenDossier` y, para adaptación, importedArchiveHash. Los schemas de preparación draft/prepared admiten ese campo opcional y contrastan personaje/revisión/contentHash. La transformación de borrador a preparación lo conserva y contrasta el snapshot completo recibido, incluidos metadatos; esta comparación segura para navegador no acredita por sí sola procedencia host.

Esos schemas son estructurales: aceptar JSON no acredita el hash completo ni autoridad de admisión. `validateFrozenDossierSource` realiza la verificación host con el serializador canónico y comprueba linaje. `createDossierSourceRepository.resolveSelection` sólo resuelve una referencia exacta desde catálogo del host o adaptación propiedad del principal, compara todos los campos esperados y devuelve el snapshot validado. No acepta un dossier cliente como fuente, ni elige automáticamente la última versión.

Una fuente congelada ya admitida es autocontenida: validarla no requiere que su importId siga en otro host ni concede acceso a su biblioteca privada. Los IDs son procedencia, no capabilities. Un actor no recibe el expediente congelado: las pruebas de la proyección actoral y del Continuista comprueban que esa metadata no entra en sus paquetes.

`readPreparedDossierSource` distingue fuente válida de `legacy-source-unavailable`. Ausencia legacy no se rellena desde el catálogo presente, aunque coincidan revisión y Markdown; leer historia no reescribe hashes ni inventa metadata. Preflight verifica las fuentes presentes al cargar los contextos. El Configurador usa el snapshot congelado y rechaza una fuente presente inválida sin sustituirla por catálogo; la ausencia legacy conserva el comportamiento previo. Las pruebas acreditan el contexto recibido por un SDK controlado, no una propuesta aceptada ni inferencia externa.

## Evidencia disponible y trabajo restante

Las suites nuevas cubren biblioteca guardada con paginación y sellos, trasplantes/alteraciones, rutas autenticadas readonly, resolución por principal/personaje/hash, mismo Markdown con metadata distinta, fuentes autocontenidas, ausencia legacy y exclusión de investigación en prompts. La verificación global se registra al final. Las pruebas no sustituyen un recorrido gráfico completo del selector ni aceptación integral.

El journal comprueba fuentes nuevas o cambiadas dentro de la transacción de create/update, después de replay, lifecycle y CAS y antes de escribir. El host instala una sola vez la admisión: resuelve catálogo o adaptación del principal y exige igualdad completa, incluso ante un hash falsificado consistente. Una fuente previamente admitida e idéntica no consulta catálogo ni biblioteca extranjera; un reintento confirmado no vuelve a resolverla. Sin admisión configurada se rechazan borradores con fuente. Quitar la fuente mientras permanece el actor se rechaza; quitar el actor completo está permitido. La compatibilidad admite ausencia legacy, incluso en entradas todavía no migradas: esto no acredita que toda curación nueva exija fuente.

Falta conectar selección explícita desde GUI a este guardado con CAS y resolución exacta, invalidando curaciones de otro source sin rebase automático. También faltan edición integral de todos los campos con nueva adaptación inmutable, compatibilidad histórica integrada, fork/backup/restauración entre hosts con el nuevo campo y aceptación visual completa. La promoción de identidad debe mantener constante la fuente seleccionada. Los 77 criterios y el objetivo completo siguen pendientes de aceptación integral.

Verificación C52: TypeScript y build aprobados; **1.146 pruebas aprobadas, cero fallos y una omitida exclusiva de Linux** (1.147 totales), con ICM real. La revisión independiente comprobó 40 pruebas distintas de fuentes, admisión, Configurador y preflight sin bloqueantes. No se ejecutó inferencia externa ni QA gráfico del selector, todavía pendiente.
