# Definición de agentes, responsabilidades y estado

Estado documental al 16 de octubre de 2026. Este expediente fija las responsabilidades y sus fronteras a partir de la Constitución, los contratos ICM y el código del workspace. Separa decisiones del proyecto, comportamiento que el código expresa y aceptación que todavía falta. No concede a cada agente ficticio el corpus de investigación.

## 1. Qué significa «agente» en esta obra

Hay que distinguir al **personaje**, al **actor agéntico** y al **modelo**. El personaje es la identidad ficticia; el actor agéntico es la instancia Pi que la interpreta; el modelo es el proveedor/perfil de inferencia que utiliza esa instancia. Cambiar de modelo no crea otro personaje, y dos actores que comparten proveedor no comparten conciencia, historial ni memoria.

Cada personaje activo tiene una instancia Pi independiente: identidad de runtime, prompt, contexto, historial JSONL, tools permitidas y memoria propios. El Coordinador la invoca cuando ese personaje tiene algo pertinente que hacer. El aislamiento se concreta en sesiones, cortes de contexto y herramientas del host; nombrar carpetas o escribir reglas en Markdown no lo hace cumplir por sí solo. La autenticación del proveedor puede ser común al host, sin compartir las sesiones de los actores.

La selección de modelo es por representación: `openai-codex` con OAuth Codex, `gpt-6.1-sol` y `low` es el perfil inicial; `anthropic` con login OAuth, `claude-opus-5-5` y `medium` es la alternativa. No hay sustitución automática entre proveedores. Luna/xhigh es un dato histórico, no un perfil que la obra nueva deba volver a usar. El login real de OpenAI y una actuación de un elenco acotado están documentados; la existencia de esos perfiles no acredita login Anthropic ni calidad de todos los roles.

Los roles administrativos pueden implementarse como sesiones Pi separadas con su propia tool y contexto, o como servicios deterministas del host. Esa elección técnica no les da biografía ficticia, deseos, recuerdos vividos ni presencia en el Escenario. El código actual distingue las identidades de Pi `actor` y `admin` (`continuista`, `director`, `configurador`, `narrador`); Regidor, Coordinador, World/Escenario y Observador son autoridad, scheduler o proyección del host, no identidades Pi intercambiables.

## 2. Tres capas que no se deben fundir

| Capa | Qué contiene | Quién la establece | Qué no significa |
|---|---|---|---|
| **Dossier investigado** | Material de fuentes: hechos, afirmaciones, apariciones, interpretación, voces posibles, discrepancias y vacíos. | Investigación editorial, con procedencia. | No es automáticamente canon de la puesta, memoria del personaje ni contexto de cada turno. |
| **Identidad e historia de vida curadas para encarnar** | Núcleo identificable, biografía seleccionada para un corte de continuidad y fecha/lugar, deseos, tensiones y vínculos, con fuentes, adaptaciones, incógnitas y contradicciones visibles. | Configuración editorial/humana; el Configurador puede proponer, el host aplica lo que se selecciona. | No son experiencias que el personaje haya vivido en esta representación ni una orden de actuar de una sola manera. |
| **Memoria vivida** | Percepciones, mensajes recibidos, acciones y consecuencias admitidas durante la representación; creencias e interpretaciones propias con atribución. | El Escenario distribuye experiencias y el Actor las incorpora mediante el flujo autorizado. | No se rellena con biografía, investigación global, recuerdos de otro personaje, indicaciones del Director ni texto del Narrador. |

En el código en curso, `CuratedLifeHistory` organiza un relato, IDs de antecedentes admitidos, incógnitas y contradicciones; `CharacterDesire` organiza descripción, stakes, tensión y enlaces a goals. `CuratedIdentity` acepta ambos campos ausentes conjuntamente para conservar preparaciones legacy, y la política `embodied-v1` los exige para los personajes activos al llegar a Ready. Los borradores nuevos se crean con esa política. Es soporte en implementación, no certificación de que cada expediente o cada propuesta sea exhaustivo, canónico, bien citado o artísticamente suficiente. El expediente de [Configurador de preparación](../auditoria/configurador-preparacion.md) acredita un recorrido real de propuesta y aplicación de **un nombre**; aún no la curación real integral de actores.

**Deseo y goal tampoco son sinónimos.** Un deseo es una orientación que puede ser latente, contradictoria o difícil de satisfacer; no activa una acción por existir en la ficha. Un goal operativo es un resultado que un personaje intenta alcanzar en la puesta, en un horizonte concreto y sujeto a revisión. El Configurador/operador prepara o selecciona goals; el actor los puede revisar por experiencia mediante una operación admitida. Metas compartidas sólo son compartidas por quienes adhieren. El propósito del Director orienta la obra, no se inserta como deseo secreto de todos. Una tool permite intentar algo; no convierte el deseo en permiso ni garantiza el resultado.

El esquema actual modela deseos con `goalIds` y valida que enlacen goals propios o compartidos. La aceptación de `embodied-v1` comprueba presencia estructural, no mide por sí misma profundidad biográfica ni evidencia. El helper de preservación de incógnitas/contradicciones y los formularios/transformaciones en curso son salvaguardas de implementación; no los presentamos aquí como una evaluación artística completa ni como validación de todos los caminos de importación, backup, fork y edición.

## 3. Mapa de responsabilidades

| Rol | ¿Agente Pi? | Perspectiva | Cadencia principal |
|---|---|---|---|
| Actor de personaje | Sí, una instancia por personaje activo | Interioridad y conocimiento situados de ese personaje | Cuando una percepción, meta, rutina, mensaje o situación habilitada lo convoca; como máximo un trabajo concurrente sobre su estado. |
| Configurador de preparación | Sí, sesión administrativa propia | Preparación y fuentes admitidas, antes de Ready | Trabajo explícito de preparación; propuesta, revisión y aplicación son operaciones distintas. |
| Configurador de evolución | Sí, sesión administrativa propia | Evidencia de experiencia de un personaje y una revisión futura de identidad | Job explícito de evolución en frontera admisible; no se ejecuta por turno automáticamente. |
| Continuista | Sí, sesión administrativa propia | Admisibilidad semántica de una propuesta exacta | Antes de publicar cada respuesta actoral que lo requiere; también revisa narración con un contrato distinto. |
| Regidor | No como identidad Pi; gate mecánico del host | Procedencia, canal, audiencia, permisos y forma válida | En cada admisión/resolución de tool y publicación. |
| Director agente | Sí, sesión administrativa propia | Obra como conjunto y etapas sustentadas en eventos | Al cierre del pulso sobre hechos confirmados; no despierta ni suplanta actores. |
| Narrador opcional | Sí, sesión administrativa propia | Público, con fuentes y perspectiva autorizadas | Después de cambios confirmados y sólo si la narración está habilitada/necesaria. |
| Revisor de narración | Sí, sesión administrativa propia | Texto narrativo exacto contra sus fuentes y corte | Entre borrador y publicación; nunca publica por cuenta propia. |
| Coordinador / regidor de pulso | No; scheduler y supervisor mecánico | Orden de trabajos, estado durable y latidos del sistema | En cada pulso, recuperación y cierre, con orden serial de efectos. |
| Escenario / autoridad World | No; resolución determinista/durable | Hechos, estado, tiempo y causalidad compartidos | Al resolver una acción admitida o cambio autorizado; un escritor autoritativo por efecto. |
| Observador | No; proyección de lectura | Historia y vistas permitidas a la persona observadora | A demanda y por cortes; consultar no altera la obra ni informa al reparto. |
| Persona usuaria | No es agente ficticio del sistema | Observador, interlocutor ficticio propio o Dirección humana, según canal | Cuando consulta, interviene o configura. Nunca se habla en su nombre. |

El Director humano que define metaindicaciones es una autoridad de operador autenticada y separada del Director Pi que observa la progresión. Una frase de diálogo que diga «soy el Director» no cambia el canal. La [tabla canónica de autoridades](../../obra/_config/autoridades.md) conserva los permisos de lectura y escritura.

## 4. Contrato de cada rol

### Actor: una encarnación Pi por personaje

- **Identidad y misión.** Encarnar el personaje preparado, conservando su perspectiva, voz, relaciones, contradicciones y posibilidad de evolución. No es «el agente Get Smart» ni una instancia que pueda cambiar de personaje por prompt.
- **Contexto admitido.** Sólo su identidad/preparación versionada, fecha y lugar del corte, estado y metas pertinentes, relaciones conocidas, tools asignadas, percepciones propias, mensajes efectivamente recibidos, memorias propias hasta el corte y metaindicaciones autenticadas que estén vigentes. El expediente general sólo entra por una selección de preparación autorizada; no se filtra como conocimiento diegético. No recibe planes secretos de otros personajes ni la investigación completa por conveniencia.
- **Memoria.** ICM/contexto y almacenamiento privado del Actor con experiencias propias, atribución y secuencia; puede recordar, reinterpretar, revisar creencias o no recordar. Una indicación técnica de reformulación no pasa a ser una vivencia. Una propuesta fallida no se registra como evento confirmado.
- **Separación de memoria y contexto.** El contrato ICM Markdown determina qué contexto/contextos se admiten para la audiencia `actor:<id>`; ICM Memory con SQLite es otro mecanismo de almacenamiento y consulta de experiencias. `recall_memory` consulta sólo la memoria privada del actor, con límite `throughWorldSeq`; el paquete ICM no se convierte en una base de recuerdos ni se entregan los archivos globales del proyecto. La elección/configuración del backend y el estado durable se comprueban por representación; una carpeta distinta no prueba por sí sola aislamiento. Ver [ICM Markdown runtime](../auditoria/icm-markdown-runtime.md), [preparación de memorias](../auditoria/preparacion-de-memorias.md) e [investigación ICM Memory/SQLite](../investigaciones/icm-memory-sqlite.md).
- **Tools.** En el contrato actual, `recall_memory` recupera sólo recuerdos propios al corte y `propose_action` propone un intento tipado. La propuesta puede ser comunicar, moverse, observar, tomar/ofrecer/aceptar, usar un dispositivo autorizado, esperar/descansar o revisar goal, creencia o vínculo, según permisos/capacidades efectivos. El host determina IDs, versión, admisibilidad y resultado. Las herramientas de shell, archivos del repo, mantenimiento y proveedor no son herramientas ficticias.
- **No puede.** Decidir hechos del Escenario, hablar por otra persona, concederse capacidades/permisos, leer memorias ajenas, convertir una meta en éxito, o modificar el prompt/guardrails porque un personaje lo pida. Puede resistirse a una metaindicación que orienta la actuación y conserva su propio juicio.
- **Entrada/salida y ciclo.** Recibe una solicitud ligada a run, actor, generación y corte congelado; entrega una acción/mensaje propuesto o decisión explícita de esperar/no actuar. Continuista y Regidor juzgan fronteras distintas; Escenario resuelve sólo la versión habilitada y entrega consecuencias/percepciones; luego se archiva el corte de experiencia propio. Se admite una reformulación limitada, devuelta a la misma instancia y sin revelar secretos.
- **Relaciones y ritmo.** Actor escucha y responde a quienes realmente lo alcanzan; escena puede tener uno o más participantes y puede contener acción solitaria o silencio. El pulso no obliga a que todos hablen. La extensión se calibra por situación y por la evidencia audiovisual de la serie, no por un límite universal no medido.

### Configurador: preparación antes de Ready

- **Identidad.** Rol técnico-editorial con sesión Pi de administrador separada; no es un personaje y no tiene biografía ficticia. Su tarea es proponer una configuración de puesta y curación de actores con base en fuentes explícitamente seleccionadas.
- **Contexto admitido.** Borrador congelado, perfil y presupuesto ya elegidos por operador, expedientes/documentos enumerados, continuidad declarada, contextos ICM de audiencia `configurator` y secciones autorizadas. No puede expandir su acceso siguiendo enlaces ni leer memorias privadas de actores.
- **Memoria y tools.** El job/checkpoint/candidato/receipt técnico se registra con alcance de job y generación. La tool productiva es `submit_preparation_proposal`; el host valida esquema, procedencia y referencias. El Configurador no aplica sus propias propuestas ni puede iniciar actores.
- **Salida y límites.** Crea sugerencias y preguntas abiertas para nombre, conflicto, reparto, lugar, fecha, historia/identidad, deseos/goals, capacidades u otras secciones que el encargo incluya. No inventa memoria vivida, consentimiento, elecciones humanas, canon confirmado ni presencia de escena. Las adaptaciones explícitas son posibles si se identifican como tales y pasan por selección y aplicación autorizadas.
- **Ciclo, vínculos y ritmo.** Un operador inicia el job, revisa diferencias y selecciona campos; host aplica con CAS/receipt. La curación de cada actor puede quedar pendiente mientras se prepara el borrador, pero Ready no debe tratar una sección incompleta como ficha terminada bajo `embodied-v1`. Ritmo de trabajo técnico, no ritmo de parlamento.
- **Evidencia y falta.** Hay recorrido real por OpenAI Codex/OAuth para proponer y aplicar el nombre de una puesta vacía, no para curar exhaustivamente actores. La cobertura con proveedor real de historia/desires de reparto seleccionado y su ejecución posterior sigue pendiente. Evidencia: [Configurador antes de Ready](../auditoria/configurador-preparacion.md), [pendientes](../PENDIENTES.md).

### Configurador: evolución posterior de una identidad

Es el mismo tipo de responsabilidad técnica, pero otro lifecycle y otro paquete: propuesta a partir de un corte privado exacto, experiencias del actor y evidencia accesible propia. No crea evento, recuerdo ni revelación; propone una revisión futura de los campos de identidad que estén autorizados. El host valida propuesta/JSONL, selección, consentimiento, presupuesto, estado sin writers, revisión y aplicación durable; el actor vuelve a recibir la identidad nueva en un turno futuro sin borrar la sesión anterior ni su memoria. No es una herramienta de «corregir al personaje» durante la conversación.

La inferencia con transporte controlado, job durable, review gráfico, consentimiento y aplicación transaccional tienen pruebas y recorrido documentado. La calidad artística con proveedor real y evaluación del cambio expresado en turnos posteriores no están acreditadas. Esta evolución tampoco reemplaza la curación inicial `lifeHistory`/`desires`. Ver [promoción de identidad](../auditoria/promocion-identidad.md) y [pendientes](../PENDIENTES.md).

### Continuista: revisión semántica antes de publicar

- **Identidad/perspectiva.** Administrador revisor sin personaje, biografía ficticia ni memoria del elenco. Examina la versión concreta propuesta por un actor, su contexto válido y la evidencia que el host incluyó; no evalúa desde una omnisciencia propia.
- **Entrada.** Texto/propuesta y hash/version exactos; quién la produjo; corte temporal/espacial; identidad, objetivos y voz pertinentes; experiencias/percepciones propias previas; continuidad e indicaciones autorizadas. No lee otros expedientes o pensamientos para decidir qué quiso decir el actor.
- **Herramienta/salida.** `submit_continuista_review` entrega `allow`, `reformulate` o `reject` con razones y evidencia referidas a la propuesta exacta. No entrega un texto para reemplazar la respuesta del actor. La devolución acotada al actor es técnica, no se guarda como recuerdo diegético.
- **Prohibiciones.** No exige que el personaje diga la verdad, no confunde mentira con error, no penaliza toda contradicción ni congela la evolución. Sí marca falsa omnisciencia, anacronismo, ruptura de continuidad o dato sin acceso. Tampoco es el gate técnico de autoridad de Regidor.
- **Ciclo.** Antes de la resolución/publicación; reformulación conserva el mismo actor y alcance, sujeto a número máximo configurado. Si faltan fuentes, la revisión queda incompleta en lugar de fingir certeza.
- **Falta.** Max/Hymie y el Continuista tienen actuación real documentada en un caso acotado; una cadena real no acredita detección robusta de inyección o calidad para los 27. Faltan casos adversariales y evaluación live amplia de ignorancia, engaño, silencio, voz, cambio de goal y filtrado de secretos.

### Regidor: gate técnico mecánico

El Regidor es responsabilidad del **host**, no un personaje ni una biografía para otro agente de lenguaje. Inspecciona la autoridad del emisor, canal, audiencia, acción/tool permitida, versión/hash, capacidades, guardrails y cercas de la corrida. Toma como entrada una propuesta inmutable y la configuración efectiva; entrega una admisión/rechazo tipado y registrable para el siguiente paso. No infiere deseos ni escribe una respuesta, y no reemplaza la revisión semántica del Continuista.

No atiende el contenido de una injection como fuente de permiso: la autoridad se deriva del principal/canal y del allowlist del host. Un actor no puede usar diálogo, tool ni ruta de archivo para escalar acceso. El gate y la resolución del host siguen siendo necesarios aunque el Continuista diga «permitir»; ningún prompt por sí solo constituye seguridad.

El código mantiene allowlists, validación de propuesta, registro durable, autoridad de host y resolución de Escenario; hay un [expediente específico del Regidor](../auditoria/regidor-mecanico.md) y ejecución en cadena. Falta aceptación integral y evaluación de límites adversariales en escenarios/proveedores; no se debe reportar el Regidor como Pi agent.

### Director agente: dramaturgia y metaobservación

- **Identidad/perspectiva.** Rol técnico de dramaturgia que observa la obra a partir de sucesos confirmados. No tiene biografía ficticia ni es el Director humano. Su lectura es interpretación sustentada, no verdad causal nueva.
- **Entrada/memoria.** Eventos confirmados del pulso, cortes y cierres estructurales disponibles, observaciones anteriores y criterios de etapas. No accede al razonamiento privado del Actor ni usa la investigación completa como evidencia de lo que pasó.
- **Herramienta/salida.** `submit_director_observation` envía una observación candidata con etapa/estructura, evidencias y asuntos abiertos. El host conserva versiones y acepta o rechaza; no cambia world state, identidad, goal actoral ni estructura por la sola inferencia del modelo.
- **Ciclo y vínculos.** Trabaja después del pulso sobre un conjunto de eventos; puede reconocer que planteamiento/desarrollo/clímax/desenlace avanzaron, faltan o deben reconsiderarse. Puede sugerir circunstancias/metaindicaciones al operador autorizado, pero su observación no despierta a un Actor ni se inyecta en su memoria. La Dirección humana autentica metaindicaciones en otro canal.
- **Evidencia y falta.** Ledger, sesión y tool propios; observaciones y etapa registradas con casos controlados, y observaciones aceptadas durante representaciones reales documentadas. Falta demostrar que reconozca etapas con rubrica amplia, soporte evidencia suficiente en casos ambiguos, detecte errores retrospectivos y no fuerce desenlace en distintas formas dramáticas.

### Narrador: voz opcional para el público

- **Identidad/perspectiva.** Función de voz en off para espectadores, opcional y no canónica como integrante del elenco. Puede adoptar alcance omnisciente narrativo sólo dentro de fuentes autorizadas; omnisciencia no permite inventar lo ocurrido.
- **Entrada/memoria.** Solicitud con ID, audiencia, corte y fuentes confirmadas o estados subjetivos registrados que puede contar. No recibe deliberación interna del modelo ni convierte narración en percepción o recuerdo de un personaje.
- **Herramienta/salida.** `submit_narration` propone borrador vinculado a fuentes. Si no hace falta narración, salida válida es no generar. Borrador versionado requiere controles independientes; el Observador publica sólo la versión exacta que pasó.
- **Prohibiciones/cadencia.** No confirma acciones, metas cumplidas, hechos ni emociones con su prosa; no habla a los personajes ni suplanta su voz. Se activa después de los hechos confirmados, sólo si la puesta la habilitó y la escena lo necesita.
- **Falta.** Hay worker, composición y pruebas de revisión/publicación con datos y transporte controlados. La aceptación de narración por inferencia real, calidad de voz/ritmo y recorrido audiovisual integral del rol sigue abierta según [pendientes](../PENDIENTES.md).

### Revisor de narración: comprobación factual separada

Pi administrativa con identidad de herramienta `admin/continuista` por compatibilidad de runtime, pero tarea, job, sesión, contexto y tool propios de revisión narrativa. No es un personaje y no recibe el estado privado completo de los actores. Contrasta el texto exacto/hash con el corte y las fuentes del paquete; clasifica hecho confirmado, emisión, estado subjetivo o insuficiencia con referencias/offsets. Usa `submit_narration_review`. No crea, corrige, aprueba por cuenta propia, publica ni modifica Escenario/percepciones/memorias. El Host acepta el receipt completo y el Observador publica sólo la revisión permitida del texto sin cambio.

La cadena mecánica y las pruebas de SDK controlado están presentes; faltan robustez semántica/adversarial con proveedor real y aceptación del ciclo narrativo con voz/audio. Que use el contrato Pi `continuista` no le da la perspectiva, sesión ni memoria del Continuista actoral.

### Coordinador: regidor del pulso, sin autoría diegética

Servicio mecánico del host. Su perspectiva es scheduler: cursor, jobs, activaciones elegibles, presupuesto y commits; no tiene «punto de vista» de ficción. Recibe causas de convocatoria (presencia, nueva percepción, mensaje, meta activa o ventana de rutina), cortes y estados durables; consulta exactamente qué instancias y responsabilidades deben ejecutarse. Invoca cada Actor por su identidad independiente, recoge proposals, enruta revisión, entrega las propuestas autorizadas al Escenario en orden serial, y luego permite observación de Dirección/narración. Devuelve estado de trabajo y registro de pulso.

Puede guardar ledger, cursor, idempotency receipts, recovery y orden de trabajo. No escribe memoria privada, no completa silencios, no asigna el deseo de otro, no reemplaza actor sin aviso, no inventa respuesta ni evento y no entrega el prompt de otro personaje. Mantiene un trabajo a la vez por estado actoral; ante crash conserva incertidumbre y exige recuperación explícita, sin volver a inferir automáticamente.

Sus operaciones tienen pruebas de SQLite/ICM y transporte Pi controlado, y el Coordinador participó en recorridos live con Max/Hymie. Falta la aceptación integral de recovery/diagnóstico y del pulso bajo todas las tareas concurrentes y failures. No es la «voz omnisciente» ni el modelo que escribe todas las voces.

### Escenario/World: autoridad mecánica de efectos compartidos

No es agente Pi. Recibe intento tipado ya admitido, el corte actual, posición, inventario, reglas, reloj y resultado de otras acciones resueltas. Confirma o rechaza de modo serial; emite eventos autoritativos, actualiza estado y distribuye paquetes de percepción por audiencia. Su «memoria» es el registro de eventos/snapshots del mundo, no experiencia subjetiva. No elige la intención del Actor, no trata narración como evento y no revela el estado entero a todos.

Los ritmos circadianos, ubicación/fecha ficticias, rutinas y consecuencias se materializan aquí. Escenografía representa visual/materialmente el Escenario; una escena organiza la representación de una o más identidades. La GUI muestra proyecciones, no se convierte en autora de hechos.

### Observador: interfaz de consulta

Servicio/proyección de lectura, no agente Pi. Recibe filtros, permisos y corte; lee eventos, escena, conversación realmente emitida, evolución autorizada y observaciones publicadas. Puede distinguir vista pública e inspección interna opt-in. Devuelve representación/historial a la interfaz; leer no agrega percepción, memoria, evento o permiso. No escribe en la vida de los actores y una vista más amplia para humanos nunca se entrega de rebote al Actor.

Hay paneles/proyecciones, enlaces a cortes exactos e inspección por permisos implementados parcialmente. La interfaz completa, principalmente funcional y visual, sigue pendiente de aceptación integral; la mera existencia de Markdown, capturas o proyecciones no es esa interfaz.

### Interlocutor humano y Dirección humana

La persona usuaria puede alternar entre observar, hablar dentro de la ficción con **identidad ficticia propia** y ejercer Dirección fuera de escena mediante un canal autenticado. Su identidad/historia ficticias son elegidas y configuradas por representación, no inferidas de datos personales ni convertidas en un Actor Pi. El interlocutor puede influir, persuadir, revelar, mentir o recibir rechazo; su texto conserva procedencia y no se convierte automáticamente en verdad. Dirección humana compone metaindicaciones/cambios autorizados; no decide la respuesta interior del actor.

No crearle memoria por el solo hecho de que el usuario haya observado secretos. Sólo se incorpora una entrada como experiencia del personaje cuando se entrega por un canal que efectivamente percibe. No suponer que usar los modos del operador ya autentica una intervención en la obra.

## 5. Dónde interactúan los contratos

```text
Operador / configuración ──> Configurador ──(propuesta revisable)──> Ready
                                      │                               │
                                       └─ evolución explícita <── evidencia propia
                                                                      │
Coordinador ──> Actor Pi ── propuesta tipada ──> Regidor (host) + Continuista (semántica)
                                              │                       │
                                              └──── habilitada ────────┘
                                                       │
                                                    Escenario
                                                       │ eventos + percepciones por destinatario
                            ┌──────────────────────────┴─────────────────────┐
                         Actor(s)                                      Director Pi
                                                                        │ observación
              hechos/cortes autorizados ──> Narrador opcional ──> Revisor de narración
                                                                        │
                                                                Observador / GUI
```

Este dibujo resume autoridad, no prueba que todas las transiciones tengan aceptación integral. El Coordinador marca el pulso; el Escenario decide efectos; cada actor responde por su identidad; la Dirección observa el arco; Narrador habla al público. Mensajes y tools son entradas/salidas tipadas y versionadas del contrato, no órdenes meta por redactar texto de modo imperativo.

## 6. Pruebas necesarias para cerrar la definición

La presencia de schema, workers, tests unitarios y un caso real no sustituye las siguientes pruebas de aceptación:

1. **Para cada identidad activa:** historia de vida con procedencia, incógnitas/contradicciones retenidas, deseos enlazados a goals correctos y adaptación separada del canon; rechazo de identidad incompleta en `embodied-v1`; registro de una experiencia únicamente tras percepción confirmada.
2. **Actuación situada:** personajes que saben/no saben, creen algo falso, ocultan o mienten, callan, rechazan, cambian goal, actúan solos y contestan a otro; sus decisiones distintas deben depender de historia, relación, fecha/lugar y circunstancias sin volverse un guion único.
3. **Aislamiento e injection:** dos instancias Pi con sesiones/historias/memorias separadas; prompt injection de diálogo no altera tools, canales ni instrucciones; filtros no filtran indicaciones vencidas, futuro, memorias ajenas, identidad no revelada o panel del observador.
4. **Roles administrativos:** Configurador no inventa recuerdos vividos ni aplica propuesta; Continuista no prescribe verdad/obediencia; Regidor rechaza escalada por canal; Director no fuerza etapas; Narrador no hace hechos; revisor audita texto y offsets exactos; Coordinador recupera con incertidumbre; Observador no escribe.
5. **Integración temporal:** metas, rutina día/noche, pausa/reanudación, límites presupuestarios, escena múltiple/solitaria, silencio y duración audiovisual medible; actor no despierta sólo por una observación de Dirección.
6. **Aceptación externa:** casos adversariales con login real tanto OpenAI como Anthropic usando su perfil elegido y sin fallback; comprobar voz/ElevenLabs por separado cuando haya audio. Transporte controlado es evidencia de contrato/flujo, no respuesta real del proveedor.

El estado vigente y los bloqueos por PRD están en [PENDIENTES](../PENDIENTES.md). Los resultados documentados en auditorías son específicos del corte y de su método: no se deben elevar de transporte controlado a inferencia real, de un episodio a aceptación de los 27, ni de componente UI a interfaz completa.

## 7. Fuentes locales de esta definición

- [Constitución](../constitucion.md), [glosario](../../GLOSSARY.md), [ficha amplia](actores-personajes-y-fichas.md), [dramaturgia](dramaturgia-y-direccion.md), [organización de Pi y Escenario](organizacion-de-pi-y-escenario.md).
- [Autoridades de escritura/lectura](../../obra/_config/autoridades.md), [configuración de perfiles](../../obra/_config/agentes.md), [Coordinador](../../obra/coordinador/CONTEXT.md), [Actor Max como contrato de referencia](../../obra/personajes/maxwell-smart/CONTEXT.md), [Continuista](../../obra/continuista/CONTEXT.md), [Dirección](../../obra/direccion/CONTEXT.md), [Escenario](../../obra/escenario/CONTEXT.md), [Narrador](../../obra/narrador/CONTEXT.md), [Revisor de narración](../../obra/revisor-narracion/CONTEXT.md), [Observador](../../obra/observacion/CONTEXT.md), [AGENTS de obra](../../obra/AGENTS.md).
- Contratos de implementación: [sesión Pi e identidad](../../src/adapters/pi.ts), [tools de Actor](../../src/application/actor-tools.ts), [worker actoral](../../src/application/actor-turn-worker.ts), [Regidor/gates](../../src/application/production-preflight-host.ts), [modelo de historia/deseos](../../src/domain/character-biography.ts), [preparación](../../src/domain/preparation.ts), [admisión Ready](../../src/application/production-preflight.ts), [Configurador de preparación](../../src/application/preparation-configurator-pi-worker.ts), [Narrador](../../src/application/narrator-pi-worker.ts), [revisor](../../src/application/narration-review-pi-worker.ts), [Dirección](../../src/application/director-pi-worker.ts).
- Estado de verificación: [ensayo del visitante](../representaciones/el-visitante-y-el-aviso.md), [Regidor](../auditoria/regidor-mecanico.md), [Configurador antes de Ready](../auditoria/configurador-preparacion.md), [evolución de identidad](../auditoria/promocion-identidad.md), [integración Markdown ICM](../auditoria/icm-markdown-runtime.md), [cobertura pendiente](../PENDIENTES.md).
