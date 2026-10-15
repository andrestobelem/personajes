# Cortes privados exactos: respuestas del custodio

Fecha: 15 de octubre de 2026. Entrevista delegada entre `fork_contract_audit` (entrevistador) y `fork_icm_audit` (custodio), coordinada por el agente integrador. Este registro conserva intercambios reales. Las respuestas son propuestas y reglas derivadas de los documentos; no son preferencias artísticas ni decisiones nuevas atribuidas a la persona usuaria.

## Fuentes y problema comprobado

- [Constitución](../constitucion.md): memoria propia, conocimiento situado y consulta del pasado sin incorporar hechos futuros.
- [S02: persistencia e ICM](../specs/02-persistencia-e-icm.md): fork desde corte confirmado, memoria privada, IDs y bases de destino separados; sesiones y trabajo pendiente no se heredan.
- [S05: inspector e historia](../specs/05-interfaz.md): distingue estado actual y corte histórico; el último estado mental no sustituye al pasado.
- [Procedimiento de entrevista](../diseno/procedimiento-grill-with-docs.md): dos agentes, clasificación de autoridad y conservación del diálogo real.
- Código observado antes de esta implementación: `completeWorldDelivery` almacena experiencias sin crear otro commit del Escenario; `actor_knowledge` conserva estado actual, sin versiones históricas. `readExperiences` limita por secuencia del evento, no por el momento de aceptación de la entrega. Por tanto, leer tablas actuales con `worldSeq <= corte` no reconstruye por sí solo una memoria histórica exacta.

## Ronda 1: límites de admisión

### Pregunta 1: entrega posterior al commit

**Entrevistador.** Si el commit C confirma una frase o evento y la entrega al actor se acepta luego, antes de C+1, ¿bifurcar C excluye esa entrega aunque tenga una secuencia menor o igual a C? Recomienda un checkpoint al final de la misma transacción del commit, sin actualizarlo tras la entrega.

**Respuesta.** Sí. El checkpoint C excluye la experiencia aceptada después de finalizar su transacción, aunque su evento causal sea anterior. En C+1 podrá aparecer si entonces ya quedó aceptada. Si no hay C+1, no se modifica C para simular un recuerdo pasado.

**Clasificación.** Preservar conocimiento situado y no mezclar memoria futura es una regla derivada de los requisitos. El checkpoint inmutable al final de la transacción es una propuesta técnica. El corte no equivale a todas las recepciones que eventualmente causará el evento.

### Pregunta 2: dos fuentes de experiencias propias

**Entrevistador.** La tabla `experiences` y `snapshot.mind.experiences` pueden contener experiencias propias distintas, incluidas experiencias aún no proyectadas en ICM. ¿Se admite su unión por `ExperienceId`, cotejando payload y hash cuando un ID se repite?

**Respuesta.** Sí, exclusivamente dentro de la transacción de captura y para ese mismo personaje y representación. Se une la tabla de experiencias propias persistidas con las experiencias subjetivas tipadas del snapshot exacto. Un ID repetido exige el mismo envelope canónico y hash; una discrepancia aborta la transacción completa. No se elige silenciosamente una fuente. Al consultar después, se usa el conjunto congelado, sin volver a unirlo con tablas vivas.

Un receipt ICM no condiciona la existencia subjetiva: la experiencia durable y su proyección para búsqueda son capas distintas. Un retraso de indexación no borra lo vivido ni autoriza importar datos adicionales.

**Clasificación.** La memoria propia es requisito; integridad y aislamiento son reglas derivadas; el mecanismo de unión y rechazo transaccional es propuesta técnica.

### Pregunta 3: estado vivo sin nuevo commit

**Entrevistador.** ¿El estado que cambia sin otro commit se ofrece solamente como inspector actual, y un fork solicitado «ahora» elige el último checkpoint fijo o crea un fence administrativo explícito?

**Respuesta.** El inspector actual puede mostrar estado vivo con ese rótulo. Un fork desde commit sólo puede elegir un checkpoint fijo acreditado y debe mostrar el corte, su fecha real y que excluye incorporaciones posteriores. No se etiqueta la memoria viva como si perteneciera al commit pasado. Crear otro tipo de fence requiere un contrato posterior explícito; esta implementación no lo inventa ni reemplaza un commit por un timestamp.

**Clasificación.** Separar presente e historia es regla derivada; seleccionar el último checkpoint acreditado con corte declarado es propuesta técnica. No hay una preferencia humana nueva pendiente para conservar esa separación.

## Ronda 2: cobertura, integridad y legado

### Pregunta 4: personajes fuera de escena

**Entrevistador.** ¿Se captura cada personaje del snapshot, aunque no esté en escena o preparado, con conocimiento discriminado como disponible o no disponible?

**Respuesta.** Sí. Ausentarse de una escena no borra su vida propia. Se conserva su mente y conjunto propio; eso no lo convierte en preparado ni lo convoca. El conocimiento está disponible sólo si existe una fila canónica válida. Una fila realmente vacía es distinta de no disponer del registro. Si el personaje no existe en el snapshot, no se inventa su mente ni un checkpoint.

**Clasificación.** Preservar identidad y memoria es requisito; no fabricar conocimiento es regla derivada; la cobertura por todos los personajes y el resultado discriminado son propuestas técnicas.

### Pregunta 5: manifiesto y antecedentes de otra representación

**Entrevistador.** ¿El corte usa una lista determinista de IDs y hashes de experiencias, revisión/hash de conocimiento y hash del snapshot, en lugar de un máximo de secuencia? ¿Toda referencia debe cerrar sobre experiencias propias admitidas? ¿Qué ocurre con experiencias iniciales curadas de otra representación?

**Respuesta.** Sí al manifiesto explícito y a validar dueño, temporalidad e integridad. Una secuencia máxima no demuestra qué recuerdos se habían aceptado. Las experiencias corrientes del conjunto deben pertenecer al personaje y representación del corte, con secuencia y fechas ficticias no futuras. Las referencias `basedOn`, `predecessor` e historias de la mente se comprueban contra el conjunto propio admitido, incluidos los antecedentes iniciales autorizados cuando corresponda. Una inconsistencia no se resuelve eliminando contenido silenciosamente.

`PreparedCharacter.initialExperience` ya admite un `run-cut` curado con procedencia de otra representación. Ese antecedente válido se conserva separado, como preparación inicial inmutable con sus hashes y límites; no se mezcla bajo la etiqueta de experiencia nacida en la representación corriente. Una referencia a ese antecedente propio autorizado no se rechaza sólo por su `runId` de origen. La lectura debe respetar la distinción que ya hace la compilación del contexto actoral.

**Clasificación.** La memoria propia y la procedencia son requisitos; cierre de referencias y exclusión del futuro son reglas derivadas; formato del manifiesto y representación de hashes son propuestas técnicas. No se propone una excepción para recuerdos ajenos o antecedentes sin autorización.

### Pregunta 6: datos heredados sin checkpoint

**Entrevistador.** ¿Los cortes antiguos sin checkpoint quedan explícitamente no disponibles, mientras nuevos commits de una representación heredada capturan el estado que existe realmente entonces?

**Respuesta.** Sí. Una migración no rellena el pasado con memoria o conocimiento actuales. Los checkpoints de commits nuevos podrán acreditar el conjunto observado en su propia transacción; los anteriores siguen no disponibles. El corte cero se captura al completar un alta nueva y su conocimiento inicial, no al migrar una representación que ya actuó. Una preparación editable anterior a la actuación necesita mantener coherencia con su nueva configuración, sin confundir esa operación con un backfill histórico.

**Clasificación.** No inventar el pasado es regla derivada; la política de alta y ausencia explícita es propuesta técnica compatible con ese límite.

### Pregunta 7: autoridad de lectura

**Entrevistador.** ¿La lectura comprueba snapshot, entrada de personaje y conjunto de experiencias contra fuentes inmutables, sin requerir sesiones ni ICM actuales? ¿Puede ICM corroborar sin convertirse en autoridad?

**Respuesta.** Sí. Los hashes del snapshot, personaje, conjunto ordenado y conocimiento deben ligar el registro a su fuente exacta. La lectura es de sólo consulta y no necesita abrir sesiones Pi, ejecutar modelos o mutar la fuente. La memoria ICM actual del padre nunca determina pertenencia al corte; una corroboración opcional no puede agregar miembros ni convertirse en una dependencia que altere el pasado.

**Clasificación.** Aislamiento y consulta histórica fiel son reglas derivadas; la estrategia de verificación es propuesta técnica.

## Precisión de fuentes

La memoria y el conocimiento situado están en el **apartado 5** de la constitución; el apartado 4 trata agencia y objetivos. Los casos de comprobación temporal están en el apartado 12. Esta precisión corrige una referencia inicial enviada durante la coordinación, sin cambiar las respuestas.

## Estado del acuerdo

Estas respuestas definen semántica de checkpoints privados y no acreditan un fork implementado, una reconstrucción de bases ICM históricas ni una restauración ejecutada. El integrador debe verificar los cambios y mantener visible cualquier capacidad pendiente.
