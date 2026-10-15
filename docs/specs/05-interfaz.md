# S05 — Interfaz funcional y visual

**Versión 1.0 — 14 de octubre de 2026.** Esta especificación define la interacción gráfica del producto completo. Es una propuesta documental derivada del [PRD 1.0](../PRD.md) y de [S01](01-dominio-y-catalogo.md), [S02](02-persistencia-e-icm.md) y [S03](03-pi-y-coordinacion.md); no afirma que la GUI exista o que sus recorridos hayan sido ejecutados. La autoridad funcional sigue en el PRD.

La aplicación se opera desde la GUI local en navegador, con React/Vite y un escenario SVG 2D según las decisiones de implementación del [README de specs](README.md). La interfaz presenta proyecciones del dominio y envía comandos autenticados al host; no resuelve acciones, escribe eventos, compone permisos ni mantiene una segunda verdad. Los endpoints, DTO, sesión local, errores y transporte de eventos corresponden a [S04](04-api-y-autoridad.md). La UI respeta sus permisos y precondiciones sin reproducir autoridad de dominio en el cliente.

## 1. Límites e invariantes de interacción

- **Escenario, Escenografía y Escena son distintos.** El Escenario conserva estado y consecuencias; el SVG muestra una proyección de la Escenografía; la Escena puede contener una o varias personas, acciones o silencio. Zoom, selección, filtros y disposición visual no modifican el Escenario.
- **Los datos de lectura proceden del host.** La UI puede mantener borradores de formulario y estado efímero de navegación, pero no afirma una ubicación, emisión, recepción, memoria o cambio de identidad hasta recibir el estado confirmado correspondiente.
- **La autoridad llega por el canal autenticado.** El contenido de un mensaje no activa Dirección ni eleva permisos. El host deriva actor, operador y origen; la UI sólo envía la intención, el destinatario elegido y el canal visible.
- **Inspeccionar no es intervenir.** Ver una ficha, un evento o una memoria no crea percepción ni cambia el contexto de un actor. No se envían paneles del observador al prompt.
- **No se confunden hechos y estados técnicos.** Propuesta, revisión, publicación, emisión, recepción, entrega y proyección aparecen como estados distintos. Espera/error/cancelación no se representan como silencio del personaje.
- **Una apariencia no confirma un hecho.** En la escena pública una acción propuesta sólo puede aparecer como indicador técnico neutral (estado e ID), sin texto, destino propuesto ni feedback privado; una proyección técnica interna requiere opt-in autorizado. Ninguna propuesta altera posición/posesión: el cambio operativo aparece sólo cuando el host confirma el evento.
- **La biblioteca no se inyecta en el reparto.** La búsqueda global de dossiers/investigaciones es de investigador/configuración. El contexto de actuación usa `PreparedCharacter` curado y validado, no el expediente global completo.
- **No se exige un permiso humano turno por turno.** La UI muestra estados de revisión y las operaciones administrativas explícitas que exige el PRD; la moderación rutinaria corresponde a los componentes de S03.
- **La UI conserva configurabilidad.** No fija fecha, localización, conflicto, reparto, variedad regional, narrador, voz ni política de reloj a nombre de la persona. Las propuestas prellenadas siempre se identifican como propuestas editables.

## 2. Navegación y componentes

La navegación se organiza por tareas. Los nombres de destinos son etiquetas conceptuales, no rutas de URL. El estado de corrida activa —identidad, momento ficticio, lifecycle y revisión— permanece identificable al cambiar de sección. El acceso técnico del host se indica por separado del tiempo ficticio.

| Componente | Responsabilidad y datos visibles | Operaciones de la UI |
|---|---|---|
| **Shell de aplicación** | Navegación a Biblioteca, Representaciones, Escenario, Historia, Voces y Diagnósticos; corrida seleccionada y estado de conexión/perfil sin mostrar secretos. | Cambiar de sección; volver a una corrida; abrir estado de acceso del host. No inicia inferencias por navegar. |
| **Biblioteca y fuentes** | Catálogo versionado, 27 identidades individuales del corte actual, familia, apéndice multipartes, aliases, intérpretes, avatar y procedencia; índice de investigaciones, paper, bibliografía y límites de lectura. | Buscar/filtrar; abrir dossier o investigación; comparar fuentes. Ningún resultado crea una instancia Pi ni activa una persona. |
| **Expediente y curador** | Markdown íntegro y secciones normalizadas: ficha, biografía, relaciones, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos, discrepancias, adaptaciones y revisiones. Cada dato de evidencia conserva referencia/clase/incertidumbre. | Leer, editar una adaptación/version nueva, ver diff, registrar motivo y procedencia, importar/exportar dossier versionado. No sobrescribir el original investigado. |
| **Asistente de puesta** | Borrador de `Run`/`config_versions`, elegibilidad y preparación por personaje, validación de campos, contexto previsto, episodio/escena iniciales, mapa y reglas de percepción. | Crear/guardar borrador, editar configuración curada, revisar propuestas del Configurador, ejecutar preflight e iniciar si está listo. Guardar borrador no crea episodio/escena activa, evento, memoria ni sesión de actuación. |
| **Barra de estado y controles** | Nombre/ID de corrida, fecha ficticia, hora, zona/convención, revision/seq, lifecycle, pulso técnico, trabajos pendientes, presupuesto y estado del perfil. | Iniciar, continuar, pausar, paso, detener, cerrar y abrir diagnósticos con las semánticas de §7. |
| **Escenario SVG 2D** | Lugar y conexiones, áreas, puertas, objetos, personajes, posiciones, poses y estado operativo confirmados que pertenecen a la vista actual; momento y transición confirmada. | Seleccionar entidad, centrar/zoom/desplazar cámara, inspeccionar leyenda y cambiar de lugar. No arrastrar objetos/personajes para modificar el mundo. |
| **Índice accesible de entidades** | Lista textual sincronizada con el SVG: nombre/handle permitido, tipo, ubicación, estado, acceso/percepción que la vista puede mostrar. | Recorrer con teclado/lector, filtrar, seleccionar y llevar foco al elemento en mapa. Es alternativa equivalente al canvas, no resumen incompleto. |
| **Conversación pública** | Mensajes publicados/emitidos por escena/personaje/canal/fecha; origen, hablante, destinatarios, audiencia, momento ficticio y recepción/entrega. Una propuesta no emitida sólo muestra estado técnico e identificador, nunca su contenido ni feedback privado. | Filtrar, abrir detalle de recepción, copiar/exportar texto publicado autorizado y saltar al evento relacionado. No expone borradores, thinking ni contenido oculto. |
| **Selector de modo y compositor humano** | Modo actual: Observar, Interlocución o Dirección. Interlocución muestra identidad diegética, destinatario/canal/audiencia y ubicación; Dirección muestra corrida, alcance autorizado y revisión de Escenario, sin pedir una identidad ficticia al operador. | Cambiar modo de forma visible; redactar una intervención diegética o un comando tipado de Dirección por su formulario separado, con corrida, precondición/ETag y operación idempotente de S04. Los campos de autor/privilegio los fija el host. |
| **Inspector privado opt-in** | En pestañas separadas, estado interno autorizado del personaje y contenido/feedback técnico de propuestas no emitidas, siempre con origen, IDs y corte temporal. | Activar explícitamente el modo interno para la sesión, elegir personaje/corte o propuesta y consultar. Muestra aviso persistente de privacidad/no emisión; la lectura no produce percepción, publicación ni cambio de contexto. El cierre de sesión revoca la vista. |
| **Panel de Dirección** | Observaciones aceptadas: etapa, suficiencia, explicación, eventos citados, personajes considerados, preguntas abiertas y rectificaciones; metaindicaciones privadas con destinatarios, alcance e historial. | La UI consulta el registro durable en el `commitIndex` exacto del Escenario y presenta sólo la interpretación tipada aceptada. Cada lectura muestra el commit citado y su `acceptedAt` real; en cortes históricos aclara que una lectura puede ser retrospectiva y no existía necesariamente en ese momento ficticio. Los eventos citados abren su commit exacto. El panel separado habilita modo Director, permite enviar indicaciones de corrida/escena y muestra su vigencia derivada. No muestra prompt/contexto ni convierte interpretaciones en hechos. Revocación, cambios de circunstancia y filtros por etapa siguen pendientes. |
| **Estructura dramática** | Episodio actual y anteriores, actos opcionales, escenas y estado; cortes de apertura/cierre, consecuencias y líneas abiertas con sus eventos de evidencia. Separa forma de representación de la lectura de etapas del Director. | El panel permite leer cortes y referencias de evidencia, abrir/cerrar escenas y episodios y agrupar escenas del episodio abierto con comandos autenticados, CAS e idempotencia. En replay muestra una reconstrucción inmutable al corte confirmado, incluidos los actos vigentes entonces; el registro estructural se limita al mismo `commitIndex`. Cada cambio estructural permite saltar a su commit exacto. Recomendaciones de cierre, metadatos completos de escena y fork siguen pendientes. «Cerrar episodio», «cerrar corrida» y «crear bifurcación» son acciones distintas. |
| **Historia y evolución** | Timeline de eventos y de estructura, mensajes y cambios visibles en el corte seleccionado. Percepciones y entregas privadas sólo se consultan en el Inspector autorizado; la vista pública respeta permisos y audiencia. | Ir a un evento o cierre, reproducir por corte/`commitIndex`, comparar antes/después con evidencia, revisar adaptación/promoción. La vista histórica no lee el último estado mental como si ya existiera entonces. |
| **Panel de voz** | Receta por identidad, política de extensión/pausas/interrupciones/silencios, variedad confirmada, binding, modo de audio, estado de credencial, elegibilidad de preview, artefactos de audio/subtítulos y estado del adaptador. Narrador tiene canal público separado; Fang sólo ofrece receta/efecto no verbal. | Configurar ritmo y modo de audio; elegir explícitamente voz existente compatible o solicitar Voice Design tras confirmar variedad; escuchar/seleccionar/guardar. Abrir flujo host-side de credencial; activar/desactivar audio por puesta. No inventa medidas ni crea voces automáticamente. |
| **Diagnósticos y recuperación** | Sesión local, conectividad, estado de OAuth, proveedor/modelo/esfuerzo efectivo, comprobación de acceso solicitada, jobs/errores sanitizados, ID de corrida/actor/propuesta/evento y tareas recuperables. | Restablecer sesión por el host si caduca; reautenticar; solicitar explícitamente «Probar acceso Pi» con aviso de que puede contactar/cobrar al proveedor; cancelar, reintentar una operación recuperable y volver a escena/historia. Health, preflight e inicio no lanzan esa prueba implícitamente. No muestra tokens, archivos privados ni razonamiento interno. |

### 2.1 Layout de referencia

Como decisión reversible de integración (no como preferencia atribuida al usuario), la GUI usa este layout de escritorio: navegación vertical a la izquierda; barra superior con corrida, estado y controles globales; Escenario SVG como área central dominante; Conversación en una columna lateral; e Historia, Inspector, Dirección y Diagnósticos como paneles con pestañas o paneles superpuestos. El panel seleccionado no oculta el estado de corrida ni los controles globales. La línea de tiempo puede ocupar una franja inferior o abrirse como panel de Historia, siempre que conserve acceso al evento y corte activos.

En anchos menores, la navegación lateral pasa a un menú accesible; Conversación y paneles de contexto se vuelven secciones/pestañas mutuamente seleccionables, mientras Escenario conserva el área principal y los controles de corrida permanecen disponibles. El orden por teclado sigue el orden visual y los paneles no dependen de hover. No se fijan breakpoints, paleta, tipografía o estilo de avatar como decisiones del usuario; la implementación puede ajustarlos y volver al layout de referencia sin cambiar contratos funcionales.

### 2.2 Estados vacíos

Cada pantalla vacía informa qué representa la ausencia y ofrece sólo la siguiente acción válida. El estado vacío no simula datos ni se confunde con silencio, fallo o desconocimiento del personaje.

| Vista sin datos | Presentación y acción disponible |
|---|---|
| Sin corrida seleccionada | Escenario neutro sin personajes/eventos; enlaces a crear una puesta o abrir una corrida existente. |
| Corrida sin eventos ni mensajes | Estado inicial confirmado y momento actual; se indica que aún no hay actividad. No se atribuye silencio a una decisión actoral si nadie fue convocado. |
| Sin entidad seleccionada | Instrucción accesible para seleccionar en el mapa o en el índice; no se abre inspector privado implícitamente. |
| Inspector cerrado o sin estado consultable | Panel privado cerrado por defecto; al abrir, explica permiso y corte temporal. Al cerrarlo, la vista vuelve a `stage` y elimina el contenido privado de la memoria de presentación. Si no hay registros, muestra «sin estado registrado» con fuente/corte, no un perfil inferido. |
| Línea dramática abierta/sin evidencia | Se muestra «sin propósito configurado» o «sin etapas registradas»; se permite volver a configuración. No se dibuja progreso ficticio. |
| Sin binding o receta de voz | Indica receta ausente, variedad pendiente o voz no seleccionada según el estado real; ofrece abrir configuración, sin iniciar llamadas. |
| Sin credencial o audio | Indica credencial ausente o «sin audio almacenado». El diálogo textual confirmado sigue visible y no se reemplaza por un reproductor vacío. |
| Historia sin rango previo | Distingue corrida recién iniciada de filtro que no encuentra resultados; permite limpiar filtros o volver al presente. |

## 3. Contratos de lectura y escritura de la UI

### 3.1 Lecturas

La UI consume proyecciones generadas por el host a partir de los objetos de S01 y el journal de S02 y usa los DTO, ETag y cursores de S04. Cada lectura que describa estado mutable identifica corrida, revisiones de configuración/estado del mundo, `worldSeq` o cursor de stream por separado, fecha ficticia cuando aplique y nivel de visibilidad. Las mutaciones reutilizan revisión/ETag y claves idempotentes según S04; la UI no inventa otro mecanismo de concurrencia. Los paneles muestran si una consulta es actual, histórica, incompleta o en actualización.

| Vista | Contenido mínimo |
|---|---|
| Biblioteca | Versión/hash del manifiesto; identidad y aliases; estado de elegibilidad/preparación/actividad; refs a dossier, avatar, receta e investigaciones. |
| Dossier | `schemaVersion`, `characterId`, revision/hash, Markdown completo, secciones, `SourceRef`, `unknowns`, contradicciones, adaptaciones e historial de versiones. |
| Preparación | Revisión de configuración; `PreparedCharacter` seleccionado; campos, valores y procedencia; propuestas sin confirmar; resultado y faltantes de preflight. |
| Escenario | Run/revisión/seq, momento ficticio, lugares/conexiones, entidades/posiciones, escena/presencias, eventos y canales visibles para esa vista. La identidad real/percepción privada sólo entra a la superficie autorizada. |
| Conversación pública | Sólo texto de mensajes publicados/emitidos conforme a audiencia; hablante/destinatarios/audiencia, IDs, momento y estados de recepción/entrega. Para propuestas no emitidas muestra estado técnico e ID, nunca texto, resumen del texto ni feedback privado. |
| Inspector técnico autorizado | Contenido exacto de una propuesta/revisión sólo con la capacidad de inspección interna autorizada para la sesión y opt-in explícito, conforme S04; es independiente del modo de participación. Feedback privado separado del transcript. La UI lo marca como no emitido y nunca lo presenta como parlamento, no lo envía a actores ni lo copia al replay público. El permiso no habilita cambiar el veredicto de Regidor/Continuista ni publicar. |
| Dirección | Línea dramática tipada, referencias a eventos, estado sufficient/insufficient/revised y las metas visibles al operador, sin sustituir hechos por interpretaciones. |
| Diagnóstico | Estados de autenticación, perfil, disponibilidad, llamada/job, error sanitizado, recuperación y cursor; nunca credenciales o reasoning. |
| Voces | Receta, convención de idioma/variedad elegida o propuesta, credencial disponible sí/no, modelo/voz validados, estado de preview/guardado/síntesis y artefactos publicados. Secretos se representan sólo como presencia/ausencia. |

Una actualización de una proyección se aplica por revisión/secuencia. La UI deduplica el mismo `eventId`; un evento confirmado puede tener entrega o proyección todavía pendiente. Si llegan datos fuera de orden, conserva el último corte confirmado y muestra sincronización pendiente; no muestra contenido provisional como un hecho.

### 3.2 Escrituras

Las acciones de escritura son intenciones autenticadas con `Idempotency-Key` y `If-Match`/ETag cuando S04 lo exige. La UI conserva resultado/correlación de la operación para que volver a consultar o reintentar no produzca dos eventos; una clave sólo se repite para recuperar la misma operación y el mismo cuerpo. Sólo el host enlaza origen/rol reales, valida permisos, perfil y precondiciones, resuelve, hace commit y emite el nuevo estado.

| Intención | Efecto que la UI puede afirmar |
|---|---|
| Guardar borrador/configuración | Nueva revisión versionada. No implica escena iniciada ni hecho vivido. |
| Importar dossier/configuración | Tras validar schema y mostrar diff, crea adaptación/revisión sin reemplazar el original. Una importación inválida no ejecuta instrucciones ni cambia datos. |
| Iniciar/controlar corrida | Muestra accepted/pending/failed según respuesta del host; el reloj y lifecycle cambian sólo al confirmarse el comando. |
| Interlocución | Envía una intervención como participante ya configurado por el canal de intervención. No implica que todos la reciban ni que el actor la obedezca. |
| Dirección | Envía una metaindicación por la ruta/modo de Dirección autorizado. Estado del Escenario cambia sólo con resolución confirmada. |
| Revisión/publicación | La vista pública presenta estado e identificador sin texto no emitido ni feedback privado. El Inspector autorizado puede mostrar versión/hash exactos y veredicto/completitud, bajo etiqueta de contenido técnico no pronunciado. Sólo el evento de emisión confirmado aparece en Conversación como parlamento. |
| Acceso al inspector | Lectura autorizada y de sólo lectura. Nunca inserta experiencia ni modifica el prompt. |
| Cambio de cámara/filtro/corte de replay | Estado local de presentación/consulta, sin comando ficcional ni mutación del journal. |
| Voice Design preview / guardar voz / TTS | Solicitudes administrativas separadas; requieren precondiciones de §9 y respuesta verificable del adaptador. No se lanzan por abrir pantalla o cambiar de modo. |

El host establece una sesión local para el navegador por el mecanismo de arranque de S04; la UI no pide contraseña de producto ni conserva la capacidad de arranque/CSRF más allá de lo requerido en memoria para la sesión. Muestra sesión local como estado distinto de OAuth de Pi y de la credencial ElevenLabs. El navegador no guarda tokens externos ni recibe rutas privadas de sesiones Pi/SQLite. Toda lectura/escritura respeta el origen, CSRF, modo y alcance de sesión definidos por S04. Contenido de dossier, importación, chat y respuesta del modelo se trata como dato; nunca se inserta como HTML ejecutable o configuración de privilegios.

## 4. Recorrido de biblioteca, curación e importación

1. **Explorar corpus.** La persona abre Biblioteca, busca por identidad/nombre conocido/alias y puede filtrar por continuidad y estado. La cifra 27 identifica el corte versionado, no el máximo del catálogo ni el reparto activo. Familia y apéndice multipartes se distinguen de personajes ejecutables. Cada identidad conserva su propio expediente.
2. **Leer evidencia.** Abrir un expediente presenta ficha íntegra y secciones navegables con sus fuentes, clase, alcance, incertidumbre, vacíos, contradicciones y adaptaciones. Las referencias del investigador no aparecen por ello en el contexto actoral. Investigación y bibliografía muestran límite de lectura y procedencia; se reconocen como biblioteca de preparación.
3. **Editar adaptación.** La acción «Crear adaptación» copia el valor/estructura seleccionados a una nueva revisión y exige motivo/procedencia/autorización correspondiente. El diff permite comparar original y cambio, autor, fecha y antes/después. La adaptación no se etiqueta canon. Un cambio ya vivido en una corrida pasa por historial/evidencia y promoción del Configurador; nunca reescribe retrospectivamente la ficha original.
4. **Importar.** Seleccionar archivo abre una vista previa local/host con versión de schema, identidad, procedencia, campos reconocidos/desconocidos, vacíos y discrepancias. Rechazar tipos/schema no admitidos, tamaño excesivo, refs inválidas o identidad conflictiva. La UI muestra diferencias y destino como revisión/adaptación. La confirmación no ejecuta texto importado, no sobrescribe original y no cambia una corrida ya activa. Conflicto de revisión exige volver a cargar y revisar diff.
5. **Exportar y verificar round-trip.** El usuario elige dossier/configuración/versiones a exportar y ve el manifiesto/alcance; el paquete excluye tokens, session files, memorias ajenas y datos no seleccionados. La prueba de aceptación reimporta en espacio de prueba y compara todos los campos (ficha, biografía, vínculos, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias), refs y estructura de Markdown. La UI no anuncia round-trip exitoso si hay campos perdidos o modificados.

Los cambios de edición se guardan con control de revisión esperada. Si el archivo cambió desde que se abrió, la UI conserva el borrador, muestra las versiones involucradas y exige reconciliación explícita; no aplica «última escritura gana» silenciosa.

## 5. Crear, curar y validar una representación

### 5.1 Asistente de preparación

El asistente conduce en pasos con resumen lateral de faltantes, propuestas, valores confirmados y versión. El orden de pantallas puede cambiar, pero antes de empezar cada campo queda en el estado que establece PRD §4.4:

| Grupo de configuración | Presentación y comportamiento |
|---|---|
| Identidad de corrida | ID durable generado por host; nombre editable. |
| Momento | Fecha/hora ficticias elegidas explícitamente. El reloj del equipo sólo puede informar una zona/convención derivable y nunca rellena el instante de ficción. |
| Zona/calendario | Valor derivado del lugar o declarado como convención, visible y editable; no cambia el momento ficticio elegido. |
| Lugar/mapa | Al menos un lugar operativo, conexiones/geometría y ubicación válida de cada participante; reglas de acceso, visibilidad y audibilidad explícitas. |
| Continuidad y adaptación | Selección de corte/continuidad; adaptaciones versionadas; divergencias etiquetadas. No inferir continuidad por fecha de emisión. |
| Reparto y estructura inicial | Selección de uno o más personajes elegibles/preparados, episodio inicial ordinal 1, escena abierta, presencia y posición. Actos/título son opcionales. La ficha, elegibilidad, preparación técnica, actividad en esta corrida y presencia son estados diferentes. |
| Identidad y contexto actoral | Identidad/voz/metas/capacidades, antecedentes autorizados, relaciones y memoria inicial con procedencia; se puede declarar vacío compatible. Ficha global no equivale a contexto completo. |
| Conflicto/propósito/línea | Estado explícito. Puede ser exploración abierta/sin conflicto formulado; no se exige desenlace, ganador ni meta compartida. |
| Herramientas e inventario | Capacidades permitidas, disponibilidad/inventario y reglas de la puesta. Nunca tools ficticias de shell/HTTP ni acceso a archivos privados. |
| Reloj, revisión y presupuesto | Políticas y topes configurados antes de llamadas con coste; defaults se presentan como propuestas editables y quedan registrados. Reformulación: default dos, reducible a cero/una según DP-08. |
| Ritmo de diálogo | Política configurable de extensión, pausas, interrupciones, silencios y acciones; etiquetas/métricas cualitativas con fuentes. No presentar segundos o recuentos como medidos sin audio anotado. |
| Participación humana | Observar no añade al humano a escena. Para hablar se prepara identidad/presencia, canal, destinatario y audiencia. Dirección requiere modo autorizado separado. |
| Voz, narrador y sonido | Narrador/audio configurables; español obligatorio y convención declarada. Una propuesta editorial identificada sirve para actuación textual, pero no habilita preview/síntesis hasta confirmar variedad. Receta, voz guardada y audio son estados distintos. |
| Conocimiento desconocido | Vacío, incertidumbre o adaptación explícita. No se inventan datos canónicos para satisfacer validación. |

El editor muestra para cada campo `vacío`, `propuesto`, `confirmado`, `derivado`, `incompatible` o `no inventable`, con su procedencia. Una propuesta del Configurador se puede aceptar, editar o dejar pendiente; no es una decisión ya confirmada. Se permite guardar un borrador parcial. `Preflight` muestra un resumen de faltantes/errores con enlace a su campo y un resumen de qué se pasará a cada `PreparedCharacter` (identidad, antecedente, goal, relación, capacidad y experiencia autorizada). No revela thinking ni pide al usuario escribirlo.

### 5.2 Preflight e inicio

Antes del inicio, el preflight verifica desde el host:

- campos requeridos, versión de configuración y correspondencia entre reparto, escena, mapa y posiciones;
- elegibilidad y preparación de cada personaje seleccionado, continuidad y refs de contexto;
- instancia/perfil requerido para todo rol LLM que vaya a actuar, OAuth y acceso real cuando el flujo lo requiera;
- tools/permisos y datos de memoria recuperables por actor;
- límites/presupuesto y opciones de salida seleccionadas.

Un borrador incompleto se guarda y sigue editable. `Iniciar` queda deshabilitado o devuelve un bloqueo explícito con faltantes si cualquier campo requerido es inválido; no hace llamadas Pi ni crea evento, escena o recuerdo. Si falta autenticación/perfil pero los campos están completos, la UI conserva preparación y ofrece el flujo de host; no cambia modelo ni esfuerzo. La validación de configuración puede marcar la corrida `ready`; el preflight posterior comprueba estado registrado y trabajos requeridos sin lanzar una prueba live implícita. `Iniciar` sólo cambia a `running` cuando el host confirma el comando y todos sus gates, conforme al lifecycle de S04.

## 6. Escenario SVG 2D, conversación y modos

### 6.1 Proyección visual

El panel Escenario presenta un plano vectorial 2D legible de lugares/conexiones, objetos, personajes, dispositivos y eventos confirmados. La escena visual cambia conforme a proyecciones de estado/eventos de S01/S02, no a la interpretación de una animación. La escala, cámara y estética final se precisarán en diseño visual; ninguna especificación actual prescribe ilustración 3D o sprites de producción.

- Las formas/etiquetas identifican entidad y estado. Avatar de referencia, crédito, procedencia y estado de uso no se confunden con sprite animado/licencia confirmada.
- Flechas, pose/posición, puerta, posesión y disponibilidad se actualizan sólo desde cambio confirmado. Si hay una acción propuesta no emitida, el mapa conserva el estado anterior y puede mostrar únicamente un indicador técnico neutral (estado e ID); no representa su contenido, destino ni feedback privado.
- El área de foco/cámara puede cambiar localmente; mover la cámara jamás equivale a mover un personaje. No hay arrastre que altere hechos. Una posición sólo cambia por resolución válida o comando de Dirección autorizado y confirmado.
- La vista escénica inicial expone la Escenografía, hechos públicos y conversación según audiencia/tiempo. Saber interno, identidades bajo disfraz y contenido de memoria privada se consultan sólo en Inspector opt-in. Las reglas de visibilidad/percepción del actor nunca son inferidas por lo que el usuario puede ver como operador.
- Mapa y lista accesible presentan nombres/handles autorizados; la superficie no convierte por defecto una identidad secreta en una etiqueta pública. Visibilidad de un detalle se resuelve por política de presentación del observador, sin cambiar lo que sabe el actor.
- Leyenda identifica puertas/obstáculos, límites de alcance y zonas/canales de percepción cuando estén configurados. La cámara o CSS no eliminan límites físicos.

Seleccionar una entidad abre un inspector de proyección apropiado: entidad pública, personaje o objeto. Sus datos de operador indican si son estado confirmado, propuesta, lectura editorial o presentación. El mapa tiene alternativa completa de lista/tabla para quien no pueda usar el canvas, zoom y navegación; no depende del color para estado.

### 6.2 Conversación e intervención diegética

La Conversación pública permite seleccionar escena, hablante, destinatario, canal, audiencia y rango temporal. Cada renglón de mensaje publicado/emitido presenta texto y momento ficticio, con estados separados de recepción y entrega. Si hay recepción nula/parcial, se muestran destinatarios efectivos y ausentes; no se atribuye recuerdo a toda audiencia. Para una propuesta no emitida, el panel público muestra sólo «propuesta/revisión pendiente» y un identificador técnico; no muestra texto, resumen del contenido ni feedback privado. No hay vista pública de borrador.

El operador que tenga permiso puede abrir el Inspector técnico mediante opt-in explícito para revisar el contenido exacto de una propuesta/revisión y su feedback privado disponible. El panel muestra una advertencia persistente «contenido no emitido; no forma parte de la escena» y mantiene el texto separado visual y semánticamente del transcript. La inspección no publica, no emite ni pronuncia, no crea percepción ni cambia el prompt/contexto. Copiar/exportar conversación pública excluye borradores y feedback.

El modo Interlocución requiere indicar identidad del humano, destinatario(s), ubicación/canal y audiencia preparada. El botón de envío declara «Enviar intervención a [destinatario] por [canal]»; el envío queda como testimonio/intervención con la procedencia del host. No contiene secreto del Inspector salvo que el humano lo escriba como texto, y aun entonces el actor recibe ese testimonio sin certificación de verdad. No se acepta texto como prueba de rol.

La respuesta del actor permanece en estados propios de S03: generación/trabajo, propuesta, revisión exacta, posible reformulación/rechazo/error, resolución y emisión. En la superficie pública, la UI muestra sólo estado técnico e ID de la propuesta no emitida. El contenido exacto, el veredicto y feedback sólo aparecen en Inspector técnico opt-in autorizado, siempre con etiqueta de no emitido; no se incorporan al transcript, al replay público ni a contexto de ningún actor. Versión incompleta no se muestra como publicada. Un fallo técnico ofrece estado y recuperación, no parlamento inventado. Cuando el actor elige silencio, se presenta como elección confirmada, separada de la ausencia/error de respuesta. Sólo la publicación/emisión confirmada aparece como diálogo pronunciado.

### 6.3 Modos y autoridad visible

| Modo | Qué permite | Qué no hace |
|---|---|---|
| **Observar** | Escena pública, conversación, estado operativo disponible, historia y vistas de operador permitidas. | No crea mensaje, evento, recuerdo o percepción. |
| **Inspector interno** (activación explícita dentro de observar) | Consultar estado interno del actor seleccionado con aviso de privacidad, refs y corte temporal. | No cambia el paquete de actor, no se vuelve transmisión al reparto. |
| **Interlocución** | Enviar texto como participación ficticia desde identidad/canal preparado hacia audiencia seleccionada. | No autentica Dirección, no impone acción, no revela automáticamente secretos del panel. |
| **Dirección** | Solicitar metaindicación/cambio de circunstancia con comando host, destinatarios/alcance y revisión explícitos. | No escribe deseo/decisión privada ni confirma cambio hasta que Escenario lo resuelva. |
| **Configuración/mantenimiento** | Editar puesta, revisar importación, preparar contexto, gestionar corpus y voz. | No entra al diálogo ficcional ni crea memoria de actor por abrir o modificar expediente. |

La barra de modo muestra nombre, icono/etiqueta accesible y destinatario actual antes del envío. Cambiar modo vacía o conserva de forma segura el borrador con una advertencia si el destino cambia; nunca reutiliza el mismo botón ambiguamente. Identidad del operador/cookie y alcance real son responsabilidad del API/host.

## 7. Controles de corrida, tiempo y recuperación

| Acción visible | Efecto y estado que presenta la UI |
|---|---|
| **Iniciar/continuar** | Corre sólo tras preflight y perfil válido. Indica trabajos convocados, presupuesto y hora ficticia; no etiqueta latencia como tiempo diegético. |
| **Pausar corrida** | Detiene nuevas convocatorias y congela reloj ficticio. Eventos confirmados quedan visibles; respuestas tardías quedan pendientes sin efecto. Un job en curso se distingue del actor que eligió callar. |
| **Avanzar un paso** | Disponible desde pausa con preflight pasado y vigente del corte actual; solicita un pulso acotado del ciclo percepción→actuación→revisión→resolución→entrega y termina pausado. UI muestra alcance y resultado de ese paso; no equivale a escena/acto/día. |
| **Detener** | Cancela trabajos pendientes según host, detiene nuevas convocatorias y congela reloj. Conserva confirmado/outbox; fallo de cancelación se diagnostica. Continuación requiere revalidación. |
| **Cerrar corrida** | Acción terminal separada, requiere confirmación con nombre/ID y advierte que no acepta más turnos. Conserva historia; no borra ni sobrescribe. Una nueva rama/corrida tiene ID diferente. |
| **Pausar replay/visor** | Detiene únicamente la reproducción histórica/animación; el control indica «Replay» y no afecta el runtime actual. |

Los botones permanecen utilizables durante inferencia conforme NFR-05. Una operación en curso identifica job y permite cancelación cuando aplica. El reintento usa misma operación/idempotency key sólo para recuperar resultado existente; generar nueva actuación requiere una nueva tentativa explícita, se registra como nueva versión/generación y nunca reemite un evento ya confirmado. Los workers mecánicos de entrega pueden seguir/reconstruirse en pausa o con OAuth vencido; no provocan nuevas inferencias.

Al volver a abrir una corrida, la UI carga snapshot/eventos al `eventFence` confirmado y pendientes de S02. Distingue `pending`, `interrupted`, `failed`, `cancelled`, `delivered` y `unknown` con descripción legible y ruta disponible. Si OAuth expiró, Biblioteca, configuración, historia, replay y estado confirmado siguen disponibles; iniciar/reanudar inferencias queda bloqueado hasta revalidar acceso. No se presentan contenidos de job no durable como respuesta recuperada.

### Corte implementado en Cloud

La preparación incluye controles conectados a RunView y lectura periódica del presupuesto. El host confirma los cambios de lifecycle; una respuesta incierta conserva comando, clave y corte para recuperar el mismo resultado. El paso aceptado se consulta por su job durable y se presenta separado de la finalización. El preflight se puede evaluar desde Ready, pausa o detenido sobre el corte actual. Los datos pendientes de edición impiden controlar con una configuración distinta de la guardada. Este corte no implementa aún SSE, escena gráfica, conversación, inspector, dirección, audio ni replay completos; su evidencia está en [continuación Cloud](../auditoria/continuacion-cloud.md).

## 8. Inspector, historia, evolución y dramaturgia

### 8.1 Inspector de estado interno

La vista interna no es la forma predeterminada. El operador elige explícitamente el personaje y acepta el aviso «esta vista puede revelar información que otros personajes no conocen». Una vez abierta, permite leer experiencias/recuerdos/metas/creencias propias de ese personaje, su fuente, confianza, fecha ficticia/recepción y revisión/supersedes. Etiquetas separan evento confirmado, percepción, testimonio, inferencia y creencia; estados no verificados se conservan como inciertos.

El inspector puede seleccionar el corte temporal desde historial; nunca combina evento de hoy con memoria futura para contestar por el pasado. No ofrece un botón para insertar lo inspeccionado en diálogo. Si el humano lo comunica después, el compositor crea una nueva intervención con texto/procedencia de humano y la respuesta del actor sigue libre.

### 8.2 Historia/replay y comparación

La línea de tiempo presenta `worldSeq`, `structureSeq`, `commitIndex`, hora ficticia, episodio, acto opcional, escena y tipos de evento; filtros por personaje, canal, clase, audiencia, job y estado no cambian la historia. Seleccionar un hecho o marcador estructural reconstruye el corte exacto. Cerrar una escena deja visible el intervalo sin escena activa; sus consecuencias confirmadas siguen en el Escenario y el episodio permanece abierto. El cierre de episodio conserva referencias a sus consecuencias y líneas, incluidas las que siguen abiertas. «Nuevo episodio» continúa la misma corrida y estado; «Bifurcar continuidad» crea otro run desde un corte, mientras «Cerrar corrida» es terminal. Reproducción no llama Pi, tools ni síntesis TTS; puede reproducir audio ya almacenado. Se rotula corte histórico y se proporciona un control inequívoco para «Volver al presente».

La vista de evolución permite comparar versiones/cortes de identidad estable, relación, objetivo y creencia con `before/after`, evidencia (event IDs/refs), autor, momento, motivo y grado de confirmación. El contexto de actor en presente y la ficha global se identifican por separado. Cambios vividos no reescriben ficha/canon. Promoción al núcleo requiere acción del Configurador, evidencia y diff, genera revisión nueva y recompila contexto en punto coherente; conserva historial y afecta a futuro, no al pasado.

### 8.3 Línea dramática

La pantalla Dirección incluye pregunta/propósito/conflicto como configurado o abierto; etapa interpretada por Director; evidencia enlazada; personajes afectados; momento; estado suficiente/insuficiente/revisable/rectificado y lectura superseded. Cada afirmación editorial se distingue de evento. Cada evento citado enlaza con su `worldSeq` y `commitIndex` confirmados; abrirlo lleva a ese evento en el corte histórico exacto, desde el que la persona puede volver al presente. La interfaz no representa una barra de progreso que castigue incertidumbre ni exige clímax, cierre global, tres actos o respuesta específica. El Director no ejecuta cierres ni vuelve hecho su interpretación de una etapa: puede recomendar un cierre y mostrar sus evidencias; la confirmación estructural requiere una acción aparte del operador y no genera hechos o recuerdos. La metaindicación es una entrada administrativa separada con destinatarios y alcance explícitos (`sceneId` o `runId`), filtrada por el host. Se mantiene disponible en cada turno elegible mientras ese alcance siga abierto; no despierta al actor, no crea turnos ni exige obediencia. Al cerrar su escena o corrida vence y no se entrega en escenas posteriores; la expiración se deriva del alcance al consultar, sin crear un evento ficticio de expiración. El panel muestra el alcance, destinatarios, historial y vencimiento de escena derivado de la revisión actual. La precedencia entre indicaciones simultáneas sigue abierta. Un cambio de circunstancia sólo aparece como estado del Escenario después de su resolución confirmada. El ledger, las rutas HTTP y un compositor gráfico de metaindicaciones están implementados; la revocación versionada también está implementada y se verifica con HTTP/SQLite y navegador. El panel permite editar un borrador vacío antes de habilitar el envío, conserva la misma operación ante respuesta incierta y libera el bloqueo ante rechazo definitivo. Revocar conserva el borrador siguiente y muestra original y revocación en el historial; la retirada administrativa sigue disponible en pausa. Antes de presentar la vigencia, el cliente completa todas las páginas de una misma revisión de Dirección; si el ledger cambia durante esa lectura o falta una revisión, informa el error y no presenta un historial parcial como completo. El panel de circunstancias implementa las cinco familias físicas con objetivos autorizados, revisión de mundo/Dirección, confirmación y recuperación de operación incierta.

## 9. Voces, narrador y audio

El Panel de voz presenta para cada identidad: receta escrita y estado de revisión, política de ritmo cualitativa/configurada, variedad elegida/propuesta, voz existente si la hay, provider/configuración disponibles, preview temporal, voz guardada y artefactos TTS. Receta no implica ID ni audio. Texto del diálogo sigue siendo salida canónica; subtítulo/transcripción permanece visible aun cuando haya audio. La UI no muestra cifras universales de velocidad, duración o palabras por turno sin escucha y anotación de corpus.

Flujo administrativo de voz:

1. Abrir voz de identidad desde Biblioteca/Configuración y revisar receta, variedad y binding actual. El operador elige entre asociar explícitamente una voz existente compatible o crear una nueva voz. No se generan voces para todo el corpus al abrir el panel.
2. Elegir/confirmar idioma y variedad regional para la puesta/voz. Si sólo existe propuesta editorial, la UI explica que sirve para actuación textual y deshabilita cualquier llamada de Voice Design preview o síntesis. Un operador puede volver a la configuración y confirmar una convención; no se sugiere acento exacto como elegido por el usuario. Un binding existente tampoco habilita TTS si su variedad no es compatible/confirmada.
3. Si falta credencial, abrir gestión segura de credencial de host: introducir/reemplazar, probar conexión, ver presente/ausente y eliminar. El valor guardado no vuelve a mostrarse; la credencial ElevenLabs es independiente de OAuth de Pi.
4. Para Voice Design nuevo, aportar/seleccionar de forma explícita una muestra original autorizada de texto; no precargar automáticamente diálogo del corpus, expediente o actuación. Solicitar preview como operación aparte. Antes de enviar, mostrar proveedor, variedad/voz solicitada y efecto/coste estimado si el proveedor lo entrega. Nunca enviar por apertura de vista o guardado de borrador.
5. Presentar previews identificadas como temporales; reproducir sólo tras acción explícita y junto con texto, hablante/variedad y controles de subtítulo. La selección de una preview es explícita. Resultado erróneo o audio ausente permanece como estado, no voz guardada.
6. Sólo guardar una preview elegida cuando se creó una voz: la acción guarda la voz en la biblioteca y devuelve su identidad de proveedor. Guardarla no crea un binding ni habilita TTS. Si se eligió una voz ya existente, este paso no aplica. Evitar mostrar secretos; no se produce clonación de intérpretes.
7. Crear explícitamente un borrador de binding para el personaje o narrador con una voz existente o guardada y un modelo TTS compatible. La UI conserva el slot como no enlazado hasta que el operador solicita una prueba TTS original, escucha el artefacto temporal y acepta explícitamente el resultado. Sólo la aceptación crea el binding validado y habilita el slot; guardar o seleccionar una voz no sustituye esta prueba.
8. TTS de puesta genera audio sólo para diálogo/narración publicado y con variedad/voz confirmada y binding validado. En puesta nueva el audio inicia apagado (default reversible de integración). Al activarlo, la persona elige entre síntesis automática para publicaciones futuras o solicitud manual por publicación; el aviso explica que la modalidad automática puede consumir créditos. Audio se asocia al ID publicado, hablante, configuración y estado. Fallo deja texto, evento y subtítulos intactos; «Reintentar audio» vuelve a sintetizar ese texto, sin reejecutar actor ni duplicar diálogo.
9. Replay reproduce únicamente artefacto almacenado. Si falta, se muestra «sin audio almacenado»; no llama TTS para completar la historia. Narrador opcional tiene canal público y controles propios; nunca se incorpora al contexto/percepción de actores.

La vista de Escenario incluye un panel de voz en off que consulta publicaciones aceptadas por corte de secuencia/revisión. Presenta texto, fecha real de publicación, corte de fuente e incertidumbre explícita; no muestra propuestas ni revisión privada. Cambiar de corrida o corte desmonta la consulta anterior y descarta respuestas tardías. La paginación y actualización periódica sólo leen; nunca generan inferencia o audio. El canal queda separado de conversaciones/recepciones del reparto.

S04 define las operaciones host para confirmar variedad, solicitar Voice Design, consultar operación y media temporal, seleccionar y guardar una preview, crear y probar un borrador de binding, escuchar y aceptar el test, y solicitar TTS de publicación; S06 define las uniones, estados y precondiciones del proveedor. La UI debe mantener cada transición como acción explícita: guardar una voz no la enlaza; seleccionar una voz no habilita la escena; sólo aceptar la prueba escuchada produce el binding validado. Una llamada real requiere credenciales/habilitación y evidencia live según P21. Desactivar audio en una puesta no elimina del producto el flujo de voz ni su validación global.

## 10. Diagnósticos, privacidad y autenticación

El panel de acceso separa sesión local de la aplicación y conexión OAuth Pi. Para OAuth distingue al menos `desconectado`, `conectando`, `autenticado`, `acceso no probado`, `requiere reautenticación`, `modelo/esfuerzo incompatible` y `error`; para sesión local informa activa/caducada y permite restablecerla por el flujo del host. El proceso OAuth se inicia/termina en la superficie segura del host; la UI recibe estado y guía de siguiente acción. «Probar acceso Pi» es una acción separada y explícita, con aviso previo de posible contacto/costo; health, preflight e inicio sólo consultan estado registrado. La gestión de credencial ElevenLabs permite introducir/reemplazar, probar conexión, conocer presente/ausente y eliminar en superficie protegida; la clave guardada no vuelve a mostrarse al navegador. Nunca muestra/copia token, API key o ruta privada. Acceso del proveedor, perfil configurado y prueba de inferencia son distintos estados.

Antes de una inferencia, la UI refleja si el perfil elegido para la representación (`gpt-6.1-sol`/`low` con `openai-codex` OAuth, o `claude-opus-5-5`/`medium` con Anthropic), la sesión y las tools efectivas fueron validadas. Perfil incompatible bloquea la acción y muestra causa; no cambia de proveedor, modelo o esfuerzo. Cada actor visible se asocia a su propia instancia/configuración de contexto; no expone IDs de sesión o prompt privado salvo IDs técnicos autorizados. Luna/xhigh sólo se conserva para leer historia.

Los errores se muestran como diagnóstico aparte del diálogo: clase (OAuth/proveedor, timeout/rate-limit, validación, revisión, stale, persistencia, media), operación/run/actor/proposal/event IDs disponibles, qué quedó confirmado, qué quedó pendiente y acción posible. Logs/UI omiten tokens, reasoning, rutas de memoria y texto privado innecesario. «Reintentar», «reautenticar», «recuperar entrega» y «nueva generación» no son un único botón; cada uno declara si volverá a llamar el modelo o proveedor.

## 11. Accesibilidad y operabilidad

- Cada función operable está disponible por teclado con orden de foco coherente, foco visible y nombre accesible. El foco se restaura al cerrar un panel/modal y los errores de formulario se anuncian junto al campo y en un resumen enlazado.
- Botones reales expresan acciones; controles tienen etiqueta persistente, estados disabled con razón comunicada y confirmación contextual para cierre/import destructivo.
- El estado no se representa sólo por color, movimiento, sonido o ícono. Etiquetas textuales/leyenda cubren revisión, recepción, error, pausa, propuesta, confirmado y audio ausente.
- SVG lleva título/descripción del mapa, entidades seleccionables y orden de navegación predecible. Toda acción posible en mapa tiene equivalente por índice/lista textual. El movimiento animado se puede pausar y no oculta estado estático.
- Conversación, timeline, inspector y panel de dramaturgia se pueden recorrer como listas/estructuras semánticas; mensajes y cambios nuevos anuncian un resumen sin robar foco. Latencia no bloquea navegación/configuración/pausa.
- Texto y controles conservan legibilidad al ampliar navegador; subtítulos/transcripción permanecen disponibles con sonido. No se afirma conformidad con una norma concreta hasta evaluación formal.

## 12. Estados visibles requeridos

| Dominio | Etiquetas que la UI debe distinguir |
|---|---|
| Preparación | borrador; propuesto; confirmado; derivado; vacío declarado; inválido; falta preparación; listo. |
| Run | draft; ready; running; paused; stopped; closed; con sincronización pendiente. |
| Estructura dramática | Episodio abierto/cerrado; acto opcional; escena abierta/cerrada; intervalo sin escena activa; recomendación de cierre del Director; cierre confirmado por operador; fork en staging/listo/fallido. |
| Job Pi/rol | queued; running; review; reformulating; rejected; incomplete; failed; interrupted; cancelled; completed. |
| Mensaje/acción | propuesta; revisada; resolución sin emisión; emisión confirmada; recepción nula/parcial/efectiva; entrega pendiente/fallida/confirmada; proyección pendiente/actualizada. |
| Conocimiento | hecho/evento, percepción, testimonio, inferencia, creencia, recuerdo, desconocido o adaptación; fuente y tiempos visibles. |
| Audio | apagado; no configurado; precondición de variedad pendiente; preview disponible/temporal/seleccionada; voz guardada; síntesis pendiente/lista/fallida; sin audio almacenado. |
| Acceso | sesión local activa/caducada; OAuth desconectado/login pendiente/autenticado; entitlement/acceso no probado; requiere reconexión; modelo/esfuerzo incompatible; error. |

Los estados de dominio se traducen a etiquetas legibles en español; códigos originales se conservan sólo en detalle técnico. «Calló» o «No sabe» son contenido/decisiones del actor únicamente cuando exista salida confirmada que lo sustente, nunca el fallback de un error.

## 13. Matriz de aceptación de interfaz

| ID PRD | Parte de S05 | Criterio de aceptación GUI | Ensayos PRD |
|---|---|---|---|
| UI-01 | Shell, Biblioteca, puesta, conversación, Dirección, historia y controles | El recorrido habitual completo se opera desde la aplicación; ninguna etapa normal obliga a editar Markdown o usar terminal. | P03, P23 |
| UI-02 | Escenario SVG y lista accesible | Ubicación/movimientos confirmados legibles; selección y cámara no mutan estado; mapa tiene alternativa textual, leyendas y estado sin depender sólo del color. | P09, P23 |
| UI-03 | Conversación, timeline e inspector | Mensaje muestra hablante, destinatarios, audiencia, canal, momento, emisión/recepción/entrega; filtros por escena/personaje/canal/fecha; scroll/historia conserva identidad del evento. | P05, P15 |
| UI-04 | Selector de modo y compositor humano | Intervención llega sólo al receptor efectivo; actor puede resistir/no responder; identidad/canal/origen visibles y procedencia del host. | P05 |
| UI-05 | Inspector e historia | Vista escénica inicial no abre memoria privada; opt-in permite consulta autorizada con tiempo/fuentes; comparar cortes no filtra futuro ni cambia actor. | P06, P15, P22 |
| UI-06 | Modos Observar/Interlocución/Dirección | Cambiar modo es explícito; el secreto inspeccionado no se transmite; texto «soy director» en chat no eleva privilegios; Dirección autenticada sigue canal separado. | P06, P19 |
| UI-07 | Estado y recuperación | Propuesta, revisión, silencio, espera, error, cancelación, rechazo y publicación se distinguen; rutas de reintento especifican si llaman un modelo y no duplican efectos. | P10 |
| UI-08 | Controles, campos, SVG y listas | Teclado/foco/nombres accesibles operan flujos; mapa tiene alternativa equivalente; etiquetas textuales cubren estados sin depender de color. | P23 |
| UI-09 | Configuración, preflight, diagnóstico | Preparar/continuar desde GUI; preflight bloquea faltantes sin llamada de modelo; OAuth/perfil visibles sin secretos y sin fallback. | P03, P25 |
| UI-10 | Import/export e historial | Import valida, muestra diff, conserva original y confirma overwrite donde aplique; export/round-trip no pierde campos ni crea segunda verdad. | P24 |
| UI-11 | Panel de Dirección | Línea, evidencia, etapa, personajes afectados, fecha, insuficiencia y rectificación visibles; lectura directorial no se disfraza como hecho ni fuerza desenlace. | P19 |
| ESC-10 | Estructura dramática e Historia | Cierre de escena conserva corte/consecuencias sin cerrar episodio; cierre de episodio conserva referencias a consecuencias y líneas abiertas; episodio siguiente mantiene run/continuidad; fork distingue fuente y destino y no filtra memorias privadas. | P04, P13–P15, P19 |
| CAT-01/02/09 | Biblioteca, dossier, investigación | Corpus versionado se descubre y abre íntegro; fuentes/vacíos/discrepancias navegables; imports/exports preservan cada campo; corpus global no se da a actores. | P01, P24 |
| ESC-01/02/04/05/08 | Preparación y escenario | Sin lugar/reparto/contexto no inicia; escena solitaria y múltiple se representan; percepción/recepción parcial y conflictos de posición se muestran sólo con resultados del host. | P03–P06, P09, P13 |
| ACT-01/02/03/11/12 | Diagnósticos/estado de trabajo | Perfil/OAuth y cada rol que infiere se muestran verificables; expirar bloquea inferencia sin ocultar historia; no fallback. | P17, P18, P25 |
| MEM-03/06/09/10 | Conversación, inspector e historia | Fuente/tiempos/revisión visibles; entregas parciales no se confunden con memoria; replay no llama modelos/tools/TTS ni muestra conocimiento futuro. | P06, P12, P15 |
| DIR-01/02/03, TIM-01/02/03 | Dirección, narrador, barra de controles | Etapas con evidencia revisable; dirección tiene autoridad separada; narrador sale al público; pausa congela nuevas convocatorias y paso es pulso acotado. | P16, P19, P20 |
| VOZ-01/02/03/04/05/06/07 | Panel de voz | Receta/preview/voz/audio separados; variedad debe confirmarse antes de preview/síntesis; política de ritmo configurable sin métricas no medidas; texto y subtítulos permanecen; replay reproduce sólo media almacenada. | P15, P21 |

Los ensayos PRD mantienen evidencia pendiente hasta ejecución real. Un test de componente o un servicio simulado no valida el flujo OAuth, GUI final, audio real ni comportamiento live del personaje. Las pruebas E2E se documentan en S07; S05 define lo que la GUI debe mostrar para poder observar el resultado.

## 14. Dependencias y decisiones aún abiertas

- La frontera HTTP, sesión, permisos, DTO, ETag, claves idempotentes, SSE y errores se rige por [S04](04-api-y-autoridad.md). Las vistas públicas usan los datos permitidos por defecto y solicitan datos internos sólo después de un opt-in de sesión; el stream no transporta contenido privado.
- Voice design/TTS y facturación/compatibilidad del proveedor se detallan en S06. Esta spec fija precondiciones, estados y controles visibles, pero no presume que credenciales, previews o audio estén disponibles.
- Recorridos y evidencias end-to-end se coordinan con [S07](07-verificacion.md). Los 25 ensayos y IDs de la tabla remiten al PRD 1.0 vigente.
- El layout de referencia de §2.1 es una elección reversible del integrador. Paleta, tipografía y estilo de avatares/animación siguen abiertos; SVG 2D/local browser sí es la decisión de implementación actual. La capa visual final se valida mediante prototipo/accesibilidad sin cambiar autoridad.
- No se deriva multijugador, publicación pública, cliente móvil, herramientas ficticias externas ni ejecución de voces automáticas de todo el corpus.

## 15. Fuentes

- [PRD 1.0](../PRD.md), especialmente §§1–9.
- [S01 — Dominio y catálogo](01-dominio-y-catalogo.md), [S02 — Persistencia e ICM](02-persistencia-e-icm.md), [S03 — Pi y coordinación](03-pi-y-coordinacion.md), [S04 — API local y autoridad](04-api-y-autoridad.md), [S06 — Voces y ritmo](06-voces-y-ritmo.md) y [S07 — Verificación](07-verificacion.md).
- [Glosario](../../GLOSSARY.md), [contrato funcional y visual](../diseno/interfaz-funcional-y-visual.md) y [contrato operativo de interfaz de la obra](../../obra/interfaz/references/contrato.md).
- [Trazabilidad del PRD](../auditoria/trazabilidad-prd.md) y [guía de diseño de voces](../investigaciones/elevenlabs-diseno-de-voces.md).

### Nota de implementación v19

Existen panel de acceso Pi y editores de contexto curado, continuidad, identidad humana y Escenario con colocación explícita. Se verificó en navegador el panel de metadata y el guardado de un lugar con plano; la preparación completa hasta Ready desde GUI sigue pendiente, como representación/control/conversación/audio. Ver [auditoría](../auditoria/oauth-y-preparacion.md).

### Selección de modelo por representación

El editor presenta GPT-6.1 Sol bajo, predeterminado, y Claude Opus 5.5 medio. Guarda la selección explícita con la configuración; no ofrece un proveedor/modelo arbitrario ni fallback. Una preparación histórica sin campo conserva ausencia y muestra Luna/xhigh como perfil anterior sólo de lectura. Cambiar Ready invalida readiness; activa/finalizada no se edita. Elegir Claude no realiza login OpenAI ni configura credenciales Anthropic. [Decisión posterior del usuario](../adr/0003-perfiles-de-inferencia-seleccionables.md).

### Sondeo de acceso desde GUI

El panel de acceso ofrece selección Sol/Opus, inicio explícito con aviso de cuota/coste, consulta local, estados, recuperación y cancelación. Se verificó un fallo por falta de OAuth y reapertura sin otro sondeo. La GUI de representación y el recorrido positivo live siguen pendientes. [Auditoría](../auditoria/sondeos-durables.md).

### Nota de implementación de comprobaciones v21

La preparación guardada incluye panel de requisitos de ejecución, evaluación explícita, consulta de historia, cancelación y recuperación de resultado incierto con la misma clave. Una edición invalida el corte anterior sin borrar su informe. Abrir el panel sólo consulta metadata; no inicia preflight ni inferencia. [Auditoría](../auditoria/preflight-durable.md).


### Preparación y operación de circunstancias

La preparación inicial tiene secciones tipadas para catálogo de condiciones, estados y plantillas, lugares de aparición y ambiente inicial; no es un editor de JSON o efectos arbitrarios. Aplicar el catálogo requiere confirmación explícita incluso si queda vacío. Guardar estampa procedencia y versión en el host; validar comprueba referencias y no materializa las plantillas en el Escenario.

Dirección consulta objetivos preparados y elige una de las cinco familias, su estado y, cuando corresponde, lugar y posición. La interfaz conserva la misma operación ante respuesta incierta y espera confirmación del host antes de representar un efecto. Un estado ya vigente se distingue de un cambio real. El historial administrativo se actualiza tras confirmar; la escenografía muestra luz, puertas, dispositivo, objeto y condiciones actuales del lugar, y la historia enlaza con su commit exacto. Consultar un corte anterior no incorpora condiciones futuras. El texto confirmado permanece disponible aunque audio esté apagado.

## Preparación del reloj: política explícita

Una preparación nueva puede elegir pendiente, avance manual o avance automático hacia límites de rutinas. El automático requiere un máximo por salto expresado en milisegundos enteros seguros no negativos; vacío no equivale a cero. Cero bloquea saltos automáticos. El límite no es velocidad del reloj ni presupuesto acumulado; una frontera que lo excede no se alcanza mediante avances parciales. Aplicar la sección precede a guardar y validar: un error conserva la edición e impide guardado incompleto. Reabrir conserva la política y el límite exactos; una puesta activa mantiene su configuración de sólo lectura. La UI declara que todavía no hay recurrencia diaria ni ciclo día/noche. [Evidencia del corte 40](../auditoria/reloj-y-rutinas.md).
