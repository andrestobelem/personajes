# S01 — Dominio, catálogo y mensajes

Versión 1.0. Requisitos principales: CAT01–09, ESC01–10, MEM02–04/10, DIR01–04, TIM01–03, NFR01/02. Los IDs usan la grafía con guion del PRD; esta abreviación no crea otros requisitos.

## Tipos y fronteras

Una definición de runtime schema por DTO y valor persistido, con tipos derivados. Entrada HTTP/JSON/archivo/SQLite/SDK es `unknown` hasta parsearse. Los objetos internos no son bolsas de opcionales: variantes tienen `kind`. IDs de corrida, personaje, escena, propuesta, evento, percepción, recuerdo y job tienen significado distinto y validación de frontera. UUIDs de corrida no se reciclan.

Objetos compuestos: `Personaje` (núcleo/versiones), `Actor` (sesión/contexto/puertos), `Escenario` (estado/resolución/percepción), `Mensaje` (origen/canal/payload), `Objetivo`, `Capacidad`, `Memoria`, `Episodio`, `Acto`, `Escena` y `Línea dramática`. No `extends` en el dominio propio. Puertos funcionales/objetos inyectados mantienen SDK/SQL/HTTP fuera del dominio.

| Valor | Campos obligatorios y variantes |
|---|---|
| `Dossier` | schemaVersion, characterId, displayName, aliases, performers, markdown completo, secciones, sourceRefs, unknowns, contradictions, adaptations, avatarRef, voiceRecipe, revision/hash. Conserva prosa original y secciones no normalizadas. |
| `SourceRef` | id, clase documental/canon/testimonio/inferencia/adaptación/desconocido, referencia, alcance de lectura, incertidumbre; no evalúa como canon toda URL. |
| `PreparedCharacter` | characterId, dossierRevision, continuityId, identityVersion, identity/voice curadas, antecedents admitidos, goals, relationships, capabilities/inventory, initialExperience, unknownPolicy, provenance. |
| `Goal` | id, kind duradero/situado/compartido, actor propietario/participantes adheridos, resultado buscado, prioridad, condiciones de revisión, estado y evidencia. Propósito directorial separado. |
| `Experience` | id, kind percepción/testimonio/inferencia/creencia/recuerdo, actor propietario, content, sourceRefs/eventRef, fictitiousAt/receivedAt, confidence, revision/supersedes. |
| `Place` | id, nombre, geometría, conexiones, condiciones de acceso, visibilidad/audibilidad y luz; no todos los lugares son perceptibles para todos. |
| `Entity` | kind personaje/objeto/dispositivo, id, placeId/posición, estado, poseedor/inventario cuando corresponde, affordances y presentación reconocible. |
| `Episode` | id, runId, ordinal, título opcional, continuityId, estado open/closed, referencias a escenas ordenadas, apertura/cierre por eventos estructurales, consecuencias que continúan y líneas dramáticas abiertas/resueltas/transformadas con evidencia. Puede quedar sin desenlace total; aquí significa unidad narrativa moderna, no la parte formal llamada episodio en la comedia antigua. |
| `Act` | id, episodeId, ordinal y escenas ordenadas; unidad organizativa opcional y distinta de etapa dramática. Su existencia no implica que la obra tenga tres actos. |
| `Scene` | id, episodeId, participantes/presencias, lugares/canales, momento de entrada/salida, foco, condición de cierre y estado open/closed. Al menos un participante preparado; no requiere palabras. Al cerrar, quienes estaban presentes quedan fuera de escena; abrir otra escena les asigna presencia sólo mediante selección explícita. La representación puede quedar entre escenas con `activeSceneId=null`. |
| `Run` | id durable, schemaVersion, configuración versionada, continuidad, lifecycle, `structureRevision`, revision/seq, reloj ficticio, episodios/actos/escenas, Escenario, jobs/pendientes y límites. |
| `Proposal` | id base, runId, actorId ligado por host, sceneId, stateRevision, version, action, evidenceRefs autorizadas, exactContentHash y estado. |
| `ControlCommand` | id idempotente, runId, origen humano/sistema autenticado, acción y expectedRevision; no simula autoría ficticia. |
| `HumanParticipantProfile` | Identidad ficticia propia controlada por la persona usuaria: `participantId`, nombre, identidad e historia de vida redactadas por ella y presencia diegética configurada para una representación. No es un `CharacterId`, no crea una instancia Pi ni hereda memoria agéntica. |

La estructura narrativa y la estructura de puesta son dimensiones relacionadas, no intercambiables: episodio, acto y escena organizan la representación; planteamiento, desarrollo, clímax y desenlace describen una lectura posible del conflicto; prólogo, párodo, episodios en sentido griego, estásimos, agón, parábasis y éxodo pertenecen a formas teatrales concretas, no son una plantilla universal ni un número obligatorio de actos.

## Catálogo e importación

### Convenciones de schema

Schemas compartidos por servidor y cliente, independientes del SDK: validar con una biblioteca de runtime y derivar `infer` desde ella. No declarar a mano un segundo tipo DTO. El adapter Pi convierte esos schemas al formato de tool que admite el SDK, con prueba de paridad; un cast entre formatos no basta. La implementación fijará versión de biblioteca en lockfile y comprobará conversión real.

`RunId`, `ProposalId`, `EventId`, `ExperienceId`, `JobId` y `ArtifactId` son UUID lowercase con marcas distintas. `CharacterId` y `PlaceId` son slugs registrados de 1–80 caracteres `[a-z0-9-]`; no se convierten automáticamente en rutas. `EntityHandle` es opaco, ligado a actor y corrida por host, y no contiene el ID global. Revisión/seq/version son enteros seguros no negativos; una propuesta comienza en versión 1. Duración usa milisegundos ficticios finitos no negativos y límite configurado por acción. Tiempo real ISO y calendario ficticio son campos diferentes.

Objetos de comandos rechazan propiedades desconocidas que podrían alterar autoridad. Dossier/import admite contenido editorial desconocido sólo en un campo explícito de extensiones y en el Markdown conservado, nunca como argumento ejecutable. Textos diegéticos no vacíos tienen límite operativo configurado y visible; el límite no se declara medición del ritmo televisivo. Evidence refs son IDs conocidos, no URLs ni paths elegidos para lectura arbitraria.

### Variantes de acción

El discriminante `kind` define payloads cerrados, sin bolsas de campos opcionales:

| kind | Payload específico |
|---|---|
| `observe` | modalidad `visual` o `auditory`, ámbito perceptivo conocido; no selector global. |
| `move` | destinationHandle conocido; intención de desplazamiento, sin posición final afirmada por modelo. |
| `communicate` | channelHandle, audienceHandles y content exacto; audiencia solicitada distinta de receptores efectivos. |
| `take` | objectHandle; no poseedor final impuesto si hay resistencia. |
| `offer` | objectHandle y recipientHandle; oferta pendiente, sin transferencia hasta aceptación/resolución válida. |
| `acceptOffer` | offerHandle recibido; posesión y vigencia revalidadas. |
| `useDevice` | deviceHandle y operación de su catálogo cerrado; argumentos derivados del schema de esa operación. |
| `wait` | duración y modalidad `awake` o `rest`; puede terminar por percepción admitida según política. |
| `reviseGoal` | goalId propio y cambio `adopt`, `reprioritize`, `suspend`, `complete` o `abandon`, con evidencia propia; complete es evaluación subjetiva si no existe criterio mecánico. |
| `reviseBelief` | experiencia antecedente o proposición propia, confianza finita 0–1 y evidencia; no escritura de hechos. |
| `reviseRelationship` | handle conocido y cambio subjetivo propio con evidencia; no cambia reciprocidad. |

Proponer un plan se expresa como comunicación o meta propia; no es una acción compuesta que pueda saltarse revisiones. Gestos no verbales se expresan como comunicación con variante de contenido `gesture`, distinta de `speech`; Fang no obtiene speech humano. Canales verbales, gestuales y dispositivos declaran alcance y modalidad en la puesta. Los textos no comunicativos de planificación no se proyectan como palabras pronunciadas.

Una oferta confirmada crea un objeto de interacción con propietario, destinatario, objeto y revisión; la aceptación es otro intento. Interrupción o consumo del objeto invalida la oferta. Un actor no fabrica handles para aceptar ofertas no recibidas. La resolución revalida todo aunque el DTO ya haya sido parseado.

`OfferId` es UUID marcado y `OfferHandle` opaco ligado a corrida/receptor. Aggregate en snapshot más eventos `offerCreated`, `offerAccepted` y `offerInvalidated`, con offerId, objeto, dueño, destinatario, revisión de objeto y vencimiento ficticio. Vigencia `kind:'open'` / `kind:'accepted'` / `kind:'invalidated'` con causa/eventRef para terminales. Oferta reserva sólo la intención: no cambia dueño. Aceptar exige destinatario coincidente, percepción recibida, oferta abierta, objeto aún poseído y alcance; el commit transfiere e invalida otras ofertas incompatibles. Consumir/transferir objeto, caducar o retirar oferta genera invalidación; repetición de aceptación devuelve resolución guardada. Evento y snapshot se escriben en el mismo commit, sin necesidad de segunda tabla mutable de ofertas.

`CommunicationContent` usa `kind:'speech'` con `text` exacto, o `kind:'gesture'` con `gestureCode` de catálogo de puesta y parámetros del schema de ese gesto. No hay narración libre que afirme un resultado. Catálogo inicial configurable admite saludo, señalar entidad conocida, asentir/negar, postura y sonidos no léxicos de animal; el dueño/capacidad/canal visual o auditivo restringen uso. Gesto se representa con label/pose y evidencia de emisión confirmada; un código no implica obediencia ni hecho sobre intención interna. Fang sólo recibe modalidades no verbales compatibles. Descripciones editoriales del catálogo no son respuesta textual humana pronunciada.

Resultados usan `kind`: `applied` contiene IDs de eventos y cambios confirmados; `notApplied` contiene causa mecánica y ningún efecto; `stale` contiene revisión vigente y petición de repercepción. `applied` puede tener `emission.kind:'none'` o `emission.kind:'emitted'` con audiencia efectiva, independientemente de entregas técnicas. Estado de job no se infiere del resultado dramático. Cada variante se maneja exhaustivamente con `never` en reducers, serialización y proyecciones.

El manifiesto del corpus fija identidades y archivos/hash. La versión inicial tiene27expedientes, familia, apéndice y16investigaciones; el código no limita el catálogo a esas cifras. Indexar sólo archivos registrados/permitidos bajo docs; nunca aceptar ruta arbitraria enviada por actor/cliente. Resolver realpath y comprobar límites, incluidas symlinks.

Markdown se muestra como contenido sin HTML ejecutable. Conservar texto completo, campos, bibliografía y secciones desconocidas al exportar/importar. Importación requiere schemaVersion soportada, límites de tamaño, referencias válidas y vista de diferencias. No sobrescribe originales investigados: crea versión/adaptación identificada. Los campos estructurados derivados se revisan; un parser de encabezados no finge reconstruir biografía/continuidad automáticamente.

La biblioteca global pertenece al investigador/configurador. El compilador de actuación toma un `PreparedCharacter` validado, no el dossier completo. Hitos de episodios tienen condiciones de continuidad o inclusión explícita; cada antecedente admitido remite a fuente. Si falta información, configurar una adaptación o conservar el vacío; no introducir años, nombres ni competencias como canon para completar un schema.

Elegibilidad, preparación, activación y presencia son dimensiones distintas. `notPrepared` no admite sesión de actuación. Un actor activo puede estar fuera de foco; el catálogo contiene también inactivos. Los mellizos siguen documentados sin recibir por inferencia voces adultas o instancias.

## Mensajes y autoridad

### Puesta y dirección tipadas

`RunConfigurationDraft` conserva secciones editables con `kind:'empty'`, `kind:'proposed'` o `kind:'configured'` y valor estructuralmente validado: momento, lugar/mapa, continuidad, reparto/contextos preparados, episodio y escena iniciales, política temporal, capacidades, presupuesto/revisión, línea dramática, variedad y sonido. Una sección `proposed` conserva la propuesta identificada y su procedencia declarada; no equivale a confirmación humana. Una sección `configured` conserva evidencia del operador o del host. El borrador no necesita valores inventados para llenar campos. `ReadyRunConfiguration` se construye mediante validación de configuración: exige momento explícito, mapa válido, continuidad declarada, episodio inicial ordinal 1, una escena inicial abierta, al menos un personaje preparado y participante, posiciones/relaciones/metas/memoria/capacidades iniciales con procedencia o vacío declarado, políticas/budget/revisión válidos y español declarado. IDs de estructura se generan y conservan en el borrador; título y actos son opcionales. Devuelve lista de problemas por sección/campo cuando falta algo, sin lanzar inferencia. La operación validate puede cambiar draft a ready; preflight comprueba dependencias y acceso, sin realizar esa transición ni una prueba de inferencia implícita. Audio habilitado tiene su gate adicional según S06. Tipos derivados de los schemas de sección; no `Partial<ReadyRunConfiguration>` como contrato universal.

La configuración admite hasta diez perfiles humanos con IDs únicos. El default es una lista vacía explícita; no inventa la identidad del usuario. Ready valida lugar, coordenadas y canal de habla habilitado; una presencia `inScene` debe apuntar a la escena inicial abierta y a uno de sus lugares. El perfil se conserva dentro de la configuración durable de la representación. `PUT /session/mode` sólo acepta `interlocutor` si el journal devuelve una configuración íntegra y semánticamente válida que contiene ese ID.

`DirectionCommand` es un comando autenticado del host con id, runId, expectedRevision y payload cerrado. Variantes previstas: `metaIndication` (destinatarios, texto y alcance explícito `sceneId` o `runId`, sin sustituir identidad ni deseo); `changeCircumstance` (operación registrada de puesta sobre puerta, iluminación, disponibilidad de dispositivo, condición ambiental o aparición de objeto compatible); `reviseDramaticLine` (pregunta/propósito y evidencia, sin forzar decisión actoral). El ledger introducido en v30 admite `metaIndication` y su revocación administrativa `revokeMetaIndication` (`targetOperationId` y alcance exacto del original); las cinco familias físicas están implementadas mediante el contrato de [ADR 0008](../adr/0008-circunstancias-fisicas-y-percepcion.md); la revisión de línea sigue pendiente. Una metaindicación confirmada permanece disponible en el contexto administrativo filtrado de sus destinatarios durante cada turno elegible dentro de su alcance. No despierta ni convoca por sí misma a un actor y nunca obliga a obedecer. Vence al cerrar la escena indicada o al cerrar la corrida indicada; el lector la filtra fuera de turnos cuyo corte ya no está dentro de ese alcance, sin registrar un evento ficticio de expiración ni entregarla en otra escena. La revocación anticipada agrega un evento versionado y conserva el original: sólo filtra la indicación de cortes posteriores de Dirección; un turno ya reclamado conserva su revisión congelada. El destino debe ser una metaindicación de la misma corrida con alcance idéntico; una revocación no puede ser destino ni revocarse dos veces mediante operaciones diferentes. El reemplazo requiere un flujo explícito aún pendiente; la precedencia entre indicaciones simultáneas sigue abierta. Las operaciones físicas de circunstancia tienen schemas y precondiciones del catálogo; no aceptan JSON Patch libre ni path a cualquier propiedad. La metaindicación es información administrativa, no parlamento, percepción ni memoria. Un cambio incompatible con pasado vivido exige bifurcación declarada. Ninguna variante edita directamente creencias, obediencia, memoria o metas privadas de otro actor. Identidad/promoción requiere flujo de Configurador y revisión, no un comando de Dirección que escriba un campo arbitrario.

Todos los intercambios del dominio son objetos con id, runId, origen verificado, canal, destinatarios/audiencia y momento. Variantes: intervención humana, percepción, propuesta, feedback técnico, resultado, evento confirmado, metaindicación, narración y proyección. El cliente/modelo no decide su propio origen/autoridad por enviar esos campos.

El interlocutor humano usa un `HumanParticipantId` propio, separado de los `CharacterId` del reparto. Su identidad y su historia son contenido redactado por la persona usuaria; el perfil no inicia una instancia Pi. La presencia puede ser en escena o remota y referencia lugar, posición y canal. En la primera versión del contrato, el perfil y la presencia se guardan en la configuración de la representación; el evento de intervención registra el ID de ese participante como emisor sin tratar su testimonio como hecho confirmado.

La resolución de una intervención valida el corte esperado, la escena abierta, presencia y posición, canal de habla habilitado y audiencia permitida por su alcance. El Escenario determina la audiencia efectiva según disponibilidad y audibilidad desde la posición del participante. Cada receptor efectivo obtiene una percepción `testimony` con el nombre y las palabras exactas del participante; no recibe su biografía privada ni una afirmación de que esas palabras sean verdaderas. La emisión queda confirmada antes de entregas técnicas. La duración avanza el reloj ficticio e invalida ofertas que expiran durante el habla con eventos causales. El resolver, commit durable genérico, entrega y cola de intención están implementados. El supervisor host conecta la entrega mecánica; aún falta convocar Pi y llevar su propuesta por el Continuista y la resolución del Escenario.

Los handles perceptivos de entidades se vinculan al actor: no exponer un ID global que revele identidad secreta/disfraz. El host traduce handle→entidad sólo si fue conocido/percibido por ese actor. El observador autorizado puede ver identidad real sin que esa selección cambie el paquete del actor.

## Acciones y resolución

| Acción | Precondiciones y resultado |
|---|---|
| Observar/escuchar | Posición/canal y condiciones determinan el paquete; no devuelve mapa/memoria global. |
| Mover | Destino conocido y conexión alcanzable; puertas/obstáculos/tiempo revalidados. Resultado con recorrido/duración o fallo. |
| Comunicar | Capacidad y canal existentes; contenido exacto revisado cuando aplica. Emisión, audiencia efectiva y entrega separadas. |
| Tomar/entregar | Alcance/posesión/disponibilidad; aceptación de otra persona no se escribe unilateralmente. |
| Usar dispositivo | Equipo disponible, estado, competencia y autorización según puesta. Sólo efecto ficticio. |
| Esperar/descansar | Duración válida según reglas; influye en tiempo/disponibilidad. Silencio no equivale a fallo técnico. |
| Proponer colaboración/plan | Intención/comunicación; no ejecuta varios pasos ni consigue adhesión automáticamente. |
| Revisar meta/creencia/vínculo propio | Fuente propia accesible y continuidad; cambio subjetivo privado, sin editar identidad ajena o verdad global. |

Cada intento pasa por autoridad/capacidad y resolución sobre revisión actual. Resultado: `notApplied` con causa, `applied` con efectos confirmados, o `stale` que requiere nueva percepción/decisión. Aprobar texto no obliga a emitirlo. Fallo sin emisión no aparece como frase pronunciada; emisión con recepción cero/parcial conserva ese hecho y audiencia. Se registra el intento aunque no haya evento físico; un resultado terminal idempotente no se vuelve a intentar con el mismo ID.

Las propuestas del modelo no hacen HTTP arbitrario, shell o IO libre. `propose_action` registra intento; resolución host confirma efectos. No usar un resultado de tool inventado como si hubiese persuadido a otro actor.

## Tiempo, relaciones e identidad

Reloj ficticio con fecha/hora y convención derivada/declarada; representación no usa el reloj del equipo como continuidad. Duraciones finitas no negativas, rutinas por actor, día/noche/luz y disponibilidad explícitos. Pulso, latencia y etapa dramática no son unidades temporales equivalentes.

Representación inicial: calendario gregoriano, instante UTC en milisegundos ficticios seguros y convención `{kind:'fixedOffset', offsetMinutes, label}` o `{kind:'ianaZone', zone}` validada por host. La configuración admite fecha/hora local explícita y calcula instante con esa convención; horas ambiguas/inexistentes requieren elección visible de offset, no corrección silenciosa. Un calendario no soportado se diagnostica, no se interpreta como fecha del equipo. Una política de duración por acción queda versionada: mover calcula longitud/velocidad autorizadas, wait usa duración elegida, dispositivos toman duración de operación; speech/gesture/intervención/dirección usan duración configurada (puede ser cero). Esas cifras son convención operativa, no medición televisiva. Cada commit secuencial asigna start al reloj vigente y end=start+duración y actualiza reloj/eventos/revisión juntos. Intento fallido consume cero salvo regla explícita de puesta. Generaciones paralelas no reservan tiempo ficticio: revisión obsoleta repercibe antes de ejecutar. Acontecimientos de igual instante se ordenan por seq. Avance vacío por rutina es comando de sistema idempotente a siguiente límite horario, sólo si política activa y lifecycle running; no lo deduce de latencia ni cantidad de pulsos. Pausa impide ese avance.

Relaciones son asimétricas y versionadas con evidencia; comparar confianza de Max/99 no comparte memorias. Actor puede evolucionar objetivos/creencias/relaciones inmediatamente por experiencia. Promoción al núcleo estable: propuesta de Configurador, evidencia y diff → versión nueva → contexto recompilado en punto coherente; original e historia permanecen. Cambiar continuidad histórica de hechos ya vividos requiere nueva corrida/bifurcación declarada.

Línea dramática contiene propósito/pregunta/conflicto abierto, lectura de etapa, evidenceEventIds, personajes afectados, fecha, estado suficiente/insuficiente/revisada y supersedes. Actos, episodios y escenas se modelan aparte; no hay algoritmo que declare clímax por cantidad de turnos.

El cierre de una escena y el cierre de un episodio son comandos estructurales del operador autenticado; el Director puede recomendar un cierre con evidencia, pero nunca ejecutarlo ni decidir hechos. No son tools ni decisiones privadas de Actor, Director o Narrador. `sceneClosed` conserva el ID de escena y el corte confirmado; no cierra por inferencia el episodio ni declara resuelta la línea dramática. `episodeClosed` exige que sus escenas estén cerradas y que no haya trabajos con permiso de commit pendientes; se confirma con CAS e idempotencia y registra el corte, las referencias a consecuencias ya ocurridas y el estado con evidencia de cada línea dramática. Las líneas pueden seguir abiertas, transformarse o resolverse; el cierre no crea hechos ficticios ni rellena un desenlace. La coordinación no convoca actores ni avanza el reloj cuando no existe episodio abierto.

Puede abrirse un episodio siguiente dentro de la misma corrida/continuidad, con ordinal nuevo y estado confirmado continuo; los eventos referidos como consecuencias son enlaces, no copias de hechos. Un reinicio que cambie el estado vivido o una bifurcación desde un corte crea `RunId` y continuidad de representación nuevos, enlazados al `RunId`/`worldRevision`/`worldSeq`/`commitIndex` de origen y hash del snapshot, además de operador y motivo. Se reconstruye el estado del nuevo run con IDs scoped nuevos y procedencia hacia el corte fuente; se conservan sólo las experiencias de cada actor accesibles hasta ese corte, con nuevos IDs y referencias de origen. Las bases ICM se crean por separado por actor/corrida y sólo se siembran mediante export/import soportado de la memoria propia; no se comparten ni editan archivos internos de ICM. Sesiones Pi, jobs, leases, inboxes no consumidos, reservas y secretos no se copian. El comando de fork conserva el origen inmutable y registra receipt/metadata destino de forma atómica; no genera percepciones ni inferencias.

Los marcadores de cierre y fork son eventos estructurales de la representación: aparecen en historia/replay y proyecciones de operador, pero no son hechos diegéticos, no consumen tiempo ficticio y no se entregan a contextos de actuación. Los acontecimientos y consecuencias referidos por el cierre sí permanecen como hechos del Escenario, cada uno con su propio commit y procedencia.

## Pruebas de esta spec

P01–09, P11, P16, P19, P22/P24/P25. Incluyen episodio anterior a matrimonio/hijos, nombres desconocidos sin amnesia, alias/disfraz, Fang sin habla, puerta/audibilidad, intento aprobado pero no emitido, múltiples participantes, relación asimétrica y roundtrip completo del dossier.

### Nota de implementación v19

La colocación explícita de personajes preparados materializa goals, relaciones subjetivas e inventario en el estado del Escenario. ActorWorldView no entrega IDs de objetivos de origen ni condiciones de hitos de dirección; conserva circunstancias propias. La transferencia de un lote conserva cantidad/condición sin transferir conocimiento privado. Ver [ADR](../adr/0002-preparacion-y-presencia-operativa.md).


### Circunstancias físicas implementadas

`changeCircumstance` contiene `scope` y una operación cerrada: `setDoorState {doorId,state}`, `setLighting {placeId,level}`, `setDeviceAvailability {deviceEntityId,availability}`, `setEnvironment {placeId,conditionId,stateId}` o `appearObject {templateId,placeId,position}`. Nunca recibe un actor emisor, destinatarios libres, memoria, obediencia, prompt ni parche arbitrario. Puertas y lugares pertenecen al Escenario; ambiente y objetos requieren catálogo autorizado por corrida, versión y procedencia. La plantilla reserva una identidad de objeto de aparición única y los lugares permitidos. La geometría, colisión, referencias y duplicación se revalidan al resolver.

Se admiten cambios durante `running` y `paused` en un punto sin pulso/step o trabajo que conserve capacidad de commit. CAS compara mundo y Dirección. El efecto no avanza el reloj; un no-op produce recibo e historial administrativo sin mundo, evento ni percepción nuevos. La nueva percepción `circumstance` tiene lugar, modalidad, detalle y evento confirmado, sin autor ficticio. La transición usa elegibilidad sensorial pre/post; la proyección actual del ambiente se filtra al preparar el contexto, incluso si el actor llega después. Ninguna de las dos vías entrega el catálogo entero ni inventa experiencias históricas. La disponibilidad interna del dispositivo no es perceptible por mera mirada.

## Recurrencia local y fase editorial (corte 41)

`AvailabilityRoutine` admite `daily` además de las variantes históricas. Define `defaultState`, `disambiguation:'compatible'` explícito y ventanas locales semiabiertas `{fromMinute:0..1439,toMinute:0..1440,state}`. Fin anterior al inicio cruza medianoche; igualdad se rechaza; 0→1440 cubre el día completo. Se rechazan solapes circulares. Resolver por fecha local y convención del WorldClock, con idéntica expansión para disponibilidad, percepción y planificación; no repetir 24 horas UTC en zonas IANA. Compatible usa primera hora repetida y desplaza la inexistente por el salto. Intervalos resueltos nulos/invertidos o en colisión se omiten con diagnóstico determinista.

El reloj puede guardar `dayNight:{dayStartsAtMinute,nightStartsAtMinute,disambiguation:'compatible'}` con inicios distintos. Es referencia editorial opcional, sin horarios predeterminados, separada de iluminación material. Su fase se deriva al corte público; el DTO actoral excluye esa configuración. Las convocatorias conservan el inicio efectivo actual como instante absoluto, no recuperan ventanas pasadas ni duplican disponibilidad continua. Sin fronteras actorales, una agenda avanza como máximo una fase temporal y queda idle. [Decisión y límites de IANA](../adr/0009-rutinas-locales-y-ciclo-editorial.md), [evidencia](../auditoria/rutinas-diarias.md).

## Preparación futura de identidad — corte 50

La promoción comprende sólo los cinco campos de `CuratedIdentity`: autorreferencia, autoconcepto, valores, disposiciones y contradicciones. El compilador del host parte de una fuente de fork verificada y el corte privado exacto del personaje, con configuración/preparación y expediente parental coincidentes. Se distinguen experiencia percibida, testimonio, inferencia, creencia y recuerdo. Una experiencia subjetiva citada no certifica su contenido como hecho. No se incorpora mente ajena ni se fabrica un evento global accesible.

La transformación pura valida propuesta y consentimiento por hashes y prepara configuración/identidad futuras; preserva estado vivido, demás actores, capacidades, voz, memoria, secuencia y reloj. Conserva propuesta completa, padre, evidencia y aprobación como procedencia separada; no disfraza IDs de experiencia como bibliografía. No aplica cambios ni concede autorización. El workflow durable Pi, epochs, aprobación gráfica y aplicación coherente siguen pendientes según [ADR 0015](../adr/0015-promocion-futura-y-configuracion-historica.md).
