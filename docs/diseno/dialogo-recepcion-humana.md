# Diálogo de diseño: recepción humana situada

Fecha: 15 de octubre de 2026. Ronda real entre los subagentes `human_reception_interviewer` (entrevistador) y `human_reception_custodian` (custodio), coordinados por el integrador. Se conserva el contenido de las preguntas y respuestas intercambiadas, condensado para lectura. Las decisiones técnicas posteriores del integrador se identifican aparte; las respuestas delegadas no son preferencias expresas de la persona usuaria.

## Alcance y evidencia

El requisito es poder conversar con los personajes e influir en ellos desde una identidad ficticia propia. La [constitución](../constitucion.md), el [glosario](../../GLOSSARY.md), el [PRD, secciones 4.2 y 4.7](../PRD.md), y las [specs de autoridad](../specs/04-api-y-autoridad.md) e [interfaz](../specs/05-interfaz.md) distinguen emisión, recepción, entrega y observación; el humano no tiene una instancia Pi ni memoria ICM controlada por un actor.

El código revisado antes de la implementación mostraba una brecha: `requestedAudience` en `src/domain/world.ts` sólo resolvía handles de entidades de tipo personaje. Los perfiles humanos estaban separados y podían originar `HumanIntervention`, pero los actores no podían seleccionarlos como destinatarios de `communicate`. Esto es evidencia del estado inspeccionado, no una definición deseada del producto.

Se aplicó el [procedimiento de grill-with-docs](procedimiento-grill-with-docs.md). No se reabrieron identidad ficticia, login ni las fronteras de privacidad ya acordadas.

## Ronda

| Pregunta y recomendación del entrevistador | Respuesta del custodio y clasificación |
| --- | --- |
| **1. ¿Representar al humano mediante una entidad nueva del Escenario o mantener una lista separada con destinatarios tipados?** Se recomendó un mínimo durable en el snapshot, con `HumanParticipantId` distinto de `CharacterId`, sin Pi ni memoria. Caso: Max propone una respuesta y el visitante sale antes del commit. | **Regla derivada:** identidad separada y resolución contra un corte confirmado preservan el concepto de perfil humano y el conocimiento situado. **Propuesta técnica:** entidad mínima o lista persistida son alternativas válidas, no una preferencia del usuario. Un cambio de presencia necesita revisión durable; no puede resolverse contra configuración mutable ajena al corte. Fuentes: glosario, PRD 4.7 y MEM-05. |
| **2. ¿Un perfil configurado pero nunca percibido se vuelve conocido automáticamente?** Se recomendó que no: una intervención efectivamente percibida puede vincular un handle al hablante y su nombre público; una observación situada puede descubrir presencia. | **Regla derivada:** no revelar el perfil íntegro. El testimonio adquirido puede proporcionar el handle y el nombre público de la emisión. **Propuesta:** una observación sin conversación descubre presencia, pero no un nombre no perceptible ni previamente conocido. El alias de un testimonio no autentica la identidad verdadera. Fuentes: constitución, conocimiento situado y D09 de la [matriz de decisiones](decisiones-abiertas.md). |
| **3. ¿Recibir exige navegador conectado o UI abierta?** Se recomendó recepción diegética por presencia, canal y corte; entrega humana como proyección durable sin Pi/ICM y sin afirmar lectura. | **Regla derivada:** recepción no equivale a lectura y la memoria ICM pertenece a los actores. **Propuesta técnica:** la recepción independiente de conexión es coherente; los documentos no exigen vincular presencia ficticia al navegador. Un acuse de lectura requeriría una acción verificable que hoy no debe inventarse. |
| **4. ¿Broadcast incluye humanos presentes que todavía no hablaron?** Se recomendó que sí, si son accesibles por las reglas del canal, sin volverlos conocidos automáticamente para el actor. | **Regla derivada del canal:** sí, cuando existe presencia explícita accesible. Observar no inserta al humano en la ficción; configurar su identidad por sí solo tampoco. **Propuesta técnica:** registrar durablemente esa presencia permite resolver el caso. |
| **5. ¿La recepción humana cubre sólo habla o también gestos compatibles?** Se recomendó admitir `CommunicationContent` compatible con modalidad y capacidad, sin ampliar incidentalmente ofertas ni relaciones a humanos. | **Requisito:** poder hablar. **Extensión coherente:** gesto compatible con canal y capacidad existentes. No inventar anatomía ni capacidades perceptivas especiales. No ampliar `offer` o relaciones como efecto lateral de este trabajo. |

El custodio añadió una precisión al primer caso: si la salida quedó confirmada antes del commit, la propuesta antigua debe resultar obsoleta/reintentable conforme a la revisión. Una resolución válida posterior puede conservar emisión sin recepción, o recepción parcial, separando audiencia solicitada y efectiva. La vista del observador no equivale por sí sola a la bandeja del participante, pero tampoco corresponde prohibir al operador autorizado información que el contrato vigente le permite consultar.

## Challenge y respuesta

**Pregunta:** una alternativa mínima usa campos opcionales de audiencia humana en `communicated`, bindings tipados y una lista humana en el snapshot. En una representación antigua hubo una intervención humana, pero su snapshot nunca incorporó esa presencia. ¿Conservar el replay sin añadir recepción humana pasada y sólo incorporar presencia en una operación futura?

**Respuesta del custodio:** sí, como **regla derivada de conservación histórica**. No rellenar audiencias ni fabricar acontecimientos retrospectivos. La ausencia del campo histórico significa soporte o confirmación ausentes; no prueba retrospectivamente que el humano no estuviera allí. Una incorporación futura necesita un nuevo corte durable. Fuentes: constitución, PRD 4.3 y MEM-09. El uso de campos opcionales es una **propuesta técnica de compatibilidad**.

**Pregunta:** el mismo operador controla las identidades A y B; está en modo B y existe un mensaje privado dirigido a A. ¿Separar sus bandejas y permitir lectura ligada al participante autenticado, manteniendo el inspector autorizado como capacidad explícita distinta?

**Respuesta del custodio:** sí para la separación de bandejas: B no recibe lo dirigido a A por compartir operador. El endpoint ligado a representación/participante y modo es una **propuesta técnica coherente**. **Matiz:** `addressed` no significa secreto automáticamente. Si las reglas del canal permiten observación legítima, no suprimirla; si el contenido es privado según canal/permisos, no convertirlo en conversación pública. No hace falta una pregunta humana para preservar esos contratos. Una política artística nueva de privacidad sería una elección distinta que esta ronda no atribuye al usuario.

## Decisión del integrador y cierre

Tras recibir estas respuestas reales, el integrador eligió `snapshot.humanParticipants` opcional con identidad pública mínima (`participantId`, `label`, `presence`), bindings humanos tipados y audiencias humanas solicitadas/efectivas separadas de las de personajes. La elección y sus alternativas se registran en el [ADR 0017](../adr/0017-recepcion-humana-situada.md).

La presencia se admite durablemente al iniciar una nueva representación desde los perfiles configurados. Una intervención futura de una representación legada puede incorporar al emisor en el snapshot resultante; jamás modifica el pasado. La bandeja se consulta por modo e identidad, sin confundir recepción con lectura. Esta es una decisión técnica del integrador dentro del requisito existente, no una preferencia expresa del usuario.

La ronda no deja preguntas humanas materiales pendientes para implementar ese alcance. No acredita por sí sola código, pruebas, GUI ni una respuesta actoral ejecutada: esas evidencias deben registrarse después de obtenerse.
