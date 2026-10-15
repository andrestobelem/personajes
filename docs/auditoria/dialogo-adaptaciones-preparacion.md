# Diálogo sobre adaptaciones guardadas y fuentes de preparación — corte 52

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, coordinado por el integrador según [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md), [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) y el [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Las respuestas de agentes no constituyen elecciones expresas del usuario ni capacidad ejecutada.

Se contrastaron [PRD](../PRD.md) CAT-02/CAT-05/CAT-06/CAT-08/P24, [constitución](../constitucion.md), [S01](../specs/01-dominio-y-catalogo.md), [S02](../specs/02-persistencia-e-icm.md), [S04](../specs/04-api-y-autoridad.md), [S05](../specs/05-interfaz.md), `dossier-exchange.ts`, `catalog.ts`, `preparation.ts`, `production-preflight.ts` y los compiladores de contexto del Configurador.

## Estado comprobado al comenzar

La importación aplicada guarda una adaptación inmutable por principal/importId, pero su servicio no ofrece selección de esas fuentes mediante list/read. La preparación registra revision y contentHash del Markdown. Ese par no distingue todos los cambios de alias, vacíos, contradicciones o metadatos que pueden compartir Markdown. El Configurador de evolución recibe un dossier original de catálogo; debe poder conservar la fuente exacta elegida sin sustituir una adaptación por el original más reciente.

`importDossier` crea un nuevo adaptationId, fecha, revisión incrementada y metadata. Por eso el hash del archivo recibido y el del dossier materializado guardado tienen significados diferentes. Conservar el primero no acredita que la preparación esté usando el segundo exacto.

## Ronda 1 — identidad de fuente, hash completo y propiedad

**Pregunta efectivamente enviada.** ¿Una fuente discriminada entre catálogo original y adaptación guardada, con referencia host, hash completo y snapshot congelado, debe acompañar preparación/Ready? ¿Quién resuelve owner/ACL? ¿El checksum de selección corresponde al archivo importado o a la adaptación materializada? ¿Qué hace inequívoca una fuente aunque comparta revision y Markdown con otra?

**Respuesta del custodio.** CAT-02/CAT-05/CAT-06/P24 y la constitución preservan originales, adaptación explícita, versiones, fuentes, vacíos y contradicciones. La regla derivada es calcular el hash completo sobre el serializador canónico `exportDossier` del dossier materializado exacto: incluye todos sus campos, no sólo Markdown. Payloads diferentes con el mismo Markdown son fuentes diferentes.

El hash del archivo recibido se conserva como procedencia de importación; el hash de la adaptación guardada identifica la fuente seleccionable. Se conservan ambos y sus vínculos a importación y adaptación. La propuesta técnica es una fuente discriminada catálogo/adaptación guardada con referencia host, checksum completo y snapshot congelado en configuración para historia y restore. El principal propietario pertenece al registro privado; el cliente sólo elige una referencia y hash esperado. El host resuelve ACL, identidad del personaje e integridad y estampa la fuente, sin aceptar rutas ni un owner aportado por el cliente.

List/read se filtran por principal y personaje; no revelan contextos privados de actores. La selección debe ser explícita: aplicar una importación no cambia automáticamente la puesta ni selecciona la adaptación más reciente. Ready, preflight y Configurador comparten el mismo archivo inmutable elegido. El actor recibe únicamente las secciones curadas autorizadas, no la biblioteca o dossier global. No falta preferencia humana material para avanzar.

## Ronda 2 — historia, fallback y continuidad

**Pregunta efectivamente enviada.** Una preparación antigua sólo conserva revisión y hash Markdown; si el catálogo cambió o no está la adaptación, ¿debe bloquearse el uso que necesita fuente completa en vez de inventar un snapshot desde el presente? ¿Cómo viaja la fuente congelada a forks y backups extranjeros sin un importId local? ¿Cambiar la selección invalida curaciones y una promoción core puede sustituir el dossier?

**Respuesta del custodio.** Un par antiguo revisión/Markdown no prueba el payload completo. No corresponde backfill desde el catálogo actual ni reescribir Ready, hashes o contextos históricos. Las lecturas de historia, snapshots y contextos guardados conservan sus bytes. Los gates que necesiten una fuente exacta ausente deben informar `source-unavailable`; esto no significa bloquear indiscriminadamente un contexto antiguo que no lea el dossier. La documentación debe identificar qué operación necesita esa prueba.

Las nuevas configuraciones llevan snapshot congelado, procedencia y checksum verificados. Fork y backup extranjero lo transportan como evidencia autocontenida, sin consultar el importId en el receptor ni heredar permisos de un principal remoto. El operador y ACL locales gobiernan acceso a la nueva corrida; el registro de origen es procedencia, no autoridad ni canon. Ni ausencia ni fallo transitorio autorizan fallback silencioso al original o a la última adaptación.

La selección de adaptación no autoriza conocimiento futuro o ajeno ni inventa experiencias iniciales. Al cambiar la fuente de un borrador, los campos curados vinculados a la anterior deben quedar explícitamente obsoletos o resetearse para una nueva curación; no se rebasa autoría/procedencia automáticamente. Se conserva historia y diff. La promoción core de la misma corrida mantiene la fuente congelada vigente y modifica sólo sus cinco campos preparados mediante evidencia propia. Cambiar esa fuente durante una corrida requiere un flujo distinto con frontera, diff y epochs, no queda implícito en promoción de identidad. No faltan preferencias humanas materiales.

## Ronda 3 — edición integral, interfaz y aceptación

**Pregunta efectivamente enviada.** ¿La biblioteca debe abrir y editar el dossier completo —Markdown y secciones, alias, intérpretes, fuentes, vacíos, contradicciones, voz, avatar y adaptaciones— conservando versiones inmutables, antes/después, autor, motivo y fecha? ¿Guardar usa revisión/diff del editor o importación existente y seleccionar una fuente es una acción normal con CAS? ¿Qué pruebas distinguen edición completa de un patch arbitrario o transferencia automática a memoria?

**Respuesta del custodio.** CAT-02/CAT-06/P24/UI-10 requieren conservar todos los campos y originales, no limitarse a Markdown. La propuesta de editor integral es compatible. Cambiar Markdown exige reparsear y normalizar en el host, explicar cambios de secciones y recalcular contentHash; raw y secciones estructuradas no pueden ser dos verdades inconsistentes. El schema de dossier y sus validadores deben ser estrictos: se editan datos, no paths administrativos libres ni HTML ejecutable. Fuentes, licencias y procedencia de referencias de voz y avatar se conservan. La metadata nueva de admisión queda separada del contenido y no borra sus padres.

Guardar crea una nueva adaptación mediante diff y confirmación del editor/importación existentes. Seleccionar esa fuente es una acción explícita normal con CAS, no otra entrevista ni consentimiento ritual. Ready exige validar preparación; elegir adaptación no vuelca investigación al actor ni la transforma en canon. GET comprueba ACL y hash completo, Configurador usa la fuente congelada y todas las etapas deben evitar sustituciones entre revisión y uso.

Las pruebas deben comparar todos los campos y metadata original tras editar/exportar/importar; si la admisión agrega IDs o procedencia explícitos, no se afirma identidad byte a byte de ese nuevo envelope. Deben cubrir mismo Markdown con alias o vacíos diferentes, principal ajeno, personaje/hash incorrectos, manipulación, recarga del selector, cambio del catálogo posterior, fork/backup extranjero sin registro de origen local, prompt actoral sin investigación ajena y curación obsoleta sin rebase automático. Se añaden mismo hash con referencias y ACL diferentes, referencias anidadas inválidas, alias que no crean otro personaje, continuidad/perfil incompatibles y gates del siguiente turno tras promoción de identidad.

## Resultado y límites

Se recomienda selección explícita de una fuente completa e inmutable, resuelta por el host y congelada con su hash íntegro. La autoridad de la preparación no depende del catálogo más reciente, de un importId remoto ni sólo del Markdown. El editor integral, la selección de fuente y la curación de contexto son operaciones distintas; ninguna convierte investigación en memoria vivida.

No se detectaron preferencias humanas materiales ausentes. Las recomendaciones son decisiones técnicas delegadas y deben cotejarse con código y pruebas. Este documento conserva tres rondas efectivamente intercambiadas; no acredita que la edición, selección o aceptación integral estén implementadas.
