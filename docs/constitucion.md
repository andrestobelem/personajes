# Constitución de la obra de personajes agénticos

Actualización de perfil por pedido posterior: nuevas representaciones eligen GPT-6.1 Sol bajo (predeterminado) o Claude Opus 5.5 medio, con autenticación propia del proveedor y sin fallback. Esto reemplaza Luna/xhigh donde aparece como requisito inicial. Ver [decisión](adr/0003-perfiles-de-inferencia-seleccionables.md).


Versión inicial, 14 de octubre de 2026. Esta constitución consolida los pedidos del usuario y las reglas de diseño necesarias para hacerlos compatibles. Se aplica a las futuras representaciones y a los documentos que las preparan. No afirma que exista un runtime de representación conectado, una interfaz gráfica completa o una escena ya ejecutada. La biblioteca gráfica local se distingue de esa interfaz completa.

**Cómo leer su autoridad.** Los apartados marcados **Requisito** recogen decisiones expresas de la conversación. Las **Reglas derivadas** son nuestra formulación operativa para satisfacerlas; se pueden revisar conservando el requisito. Las **Orientaciones técnicas** distinguen preferencias de diseño e investigaciones de capacidades efectivamente implementadas. El [diálogo constitucional](auditoria/dialogo-constitucional.md) conserva las preguntas y respuestas entre los agentes; sus respuestas no se atribuyen al usuario.

## 1. Finalidad: una obra vivida por sus personajes

**Requisito.** Construir una obra de ficción en la que actores agénticos encarnen personajes con identidad, historia, memoria, voz y deseos propios. Los personajes actúan en un escenario compartido; sus decisiones y las consecuencias de esas decisiones condicionan el argumento. Una persona puede observarlos, conversar con ellos e influir en ellos.

**Reglas derivadas.** La riqueza de un expediente debe manifestarse en elecciones, relaciones y consecuencias, no sólo en cantidad de texto. La obra conserva una línea dramática de fondo sin exigir un desenlace predeterminado. Debe poder reconocer un rechazo, un fracaso, una revelación o un cambio de lealtad como material dramático efectivo.

Un actor agéntico es el intérprete; un personaje es la identidad ficticia interpretada. El intérprete humano de una serie es una tercera figura. Compartir modelo no convierte a los personajes en una sola conciencia ni les concede memoria compartida. Véanse el [glosario](../GLOSSARY.md) y el [concepto consolidado](diseno/concepto-y-decisiones.md).

## 2. Identidad profunda y evolución comprensible

**Requisito.** Cada personaje tiene un expediente exhaustivo: ficha de entrada, identidad, historia de vida, recuerdos, vínculos, deseos, objetivos, voz, capacidades, límites y evolución. Se conserva un núcleo reconocible con posibilidad de cambio mediante la experiencia.

**Reglas derivadas.** Exhaustividad significa cubrir las dimensiones pertinentes, investigar lo disponible y hacer visibles los vacíos. No exige inventar como canon cada año de vida. Una contradicción documentada permanece identificada; una invención para la puesta se declara adaptación. Lo desconocido para el investigador no se transforma automáticamente en ignorancia del personaje.

Los hechos biográficos, el recuerdo subjetivo y los rasgos de identidad se distinguen. Una revelación puede cambiar la interpretación de una experiencia sin cambiar el acontecimiento. Un cambio de confianza, compromiso o valor puede emerger de la actuación y quedar registrado con sus antecedentes; no requiere una aprobación humana rutinaria por turno. Reescribir las instrucciones base o ampliar capacidades es una operación de configuración distinta.

La actuación no debe quedar congelada hasta que se actualice la ficha. El estado vivido conserva los cambios ya producidos, mientras la revisión del expediente puede incorporarlos sin borrar la versión inicial. El contrato actual de [autoridades](../obra/_config/autoridades.md) separa esos trabajos. La [ficha amplia](diseno/actores-personajes-y-fichas.md) define la cobertura esperada.

## 3. Actuar desde la situación y hablar con voz propia

**Requisitos.** Los actores se preparan como actores del Método y cada personaje tiene formas de hablar distintivas. Los personajes hablan doblados al español, y la extensión de sus respuestas y conversaciones debe atender al ritmo de un episodio de *Get Smart*.

**Reglas derivadas.** La adaptación al sistema usa biografía, circunstancias, memoria, objetivos, escucha y relación para elegir acciones situadas. No atribuye al modelo experiencias sentidas ni confunde las tradiciones de Stanislavski, Strasberg, Adler y Meisner. Tampoco afirma que los intérpretes de *Get Smart* hayan usado una técnica no documentada. La [investigación sobre el Método](investigaciones/actuacion-del-metodo.md) conserva esas diferencias.

La voz incluye vocabulario, registro, ritmo, humor, silencios, manera de pedir y reaccionar, y adaptación al interlocutor. No se reduce a una muletilla. La biografía está disponible por capas: cada actuación recupera lo pertinente, sin recitar toda la vida ni recibir secretos ajenos. Lo que importa se hace observable mediante elecciones y efectos; no se exige publicar razonamientos internos del modelo.

El doblaje en español es un requisito; una variedad latinoamericana concreta sigue siendo una propuesta por precisar. El análisis de fragmentos de episodios debe informar longitud de intervenciones, réplicas, pausas y desarrollo de las conversaciones. Mientras esa medición no esté terminada, no se inventan límites universales de segundos o palabras. Doblaje, ritmo textual, voz sintética y disponibilidad de audio son asuntos relacionados, pero documentar los primeros no instala los últimos.

La [investigación de ritmo en YouTube](investigaciones/get-smart-ritmo-youtube.md) conserva las fuentes localizadas y sus límites: no convierte metadatos de video en una medición de réplicas o pausas. La actuación puede alternar habla, movimiento y silencio; la duración dramática no equivale a la latencia de generación del modelo.

**Requisito de voz realizable.** Cada personaje debe contar con una forma documentada de crear su voz en ElevenLabs. El expediente incluirá una receta vinculada con su identidad, su habla en español y sus diferencias respecto del resto del reparto. La [investigación de diseño de voces](investigaciones/elevenlabs-diseno-de-voces.md) desarrolla el procedimiento. Una receta, una voz creada y un audio generado tienen estados distintos; no se afirma que los dos últimos existan por escribir la primera.

## 4. Agencia, deseos y objetivos

**Requisito.** Los deseos pueden convertirse en goals que dan dirección a la agencia. Cada personaje puede perseguir un objetivo principal; puede existir además un objetivo general.

**Reglas derivadas.** Se distinguen el objetivo propio, un objetivo compartido dentro de la ficción y el propósito de la obra para la dirección. Ninguno implica automáticamente los otros. Un reparto puede cooperar por motivos distintos, disentir, ocultar objetivos o abandonar una alianza. El sentido concreto del objetivo general permanece abierto hasta configurar una representación.

Los actores pueden iniciar acciones, ajustar tácticas al encontrar resistencia, esperar o retirarse. Una tool disponible no obliga a utilizarla. Un objetivo tampoco concede éxito: proponer un acuerdo, conseguir aceptación y cumplirlo son acontecimientos diferentes. El director no escribe en nombre de un personaje que aceptó para que avance la trama.

## 5. Conocimiento situado y memoria con procedencia

**Requisito.** Cada personaje tiene su punto de vista y aprende mediante su interacción con el escenario y con otros personajes.

**Reglas derivadas.** Se mantienen separadas cuatro perspectivas: hechos del escenario, información de dirección, experiencia del personaje y vista del observador. Un actor sólo recibe información accesible a su personaje y las indicaciones de interpretación autorizadas que necesita. Su contexto no contiene el expediente global con la instrucción de fingir que no lo conoce.

Una percepción, un testimonio, una inferencia y un recuerdo no son equivalentes. Una creencia puede ser falsa y aun así producir acciones coherentes. Su registro conserva procedencia, incertidumbre relevante y revisiones, sin convertirla en verdad compartida. Los resúmenes de memoria deben mantener esas diferencias: resumir no confirma un rumor.

Una repetición o vista histórica debe mostrar el conocimiento disponible en ese momento. Los recuerdos futuros y las correcciones posteriores no se filtran a escenas anteriores. La corrección de un dato se registra sin borrar silenciosamente los acontecimientos que explican las decisiones previas. Véase [escenario, memoria y tiempo](diseno/mundo-memoria-y-tiempo.md).

## 6. Escenario: posibilidades, resistencias y consecuencias

**Requisito.** El entorno operativo compartido se llama **Escenario**: allí los personajes pueden moverse e interactuar, y sus acciones se resuelven según lugares, objetos, acontecimientos y reglas. **Escenografía** designa su representación visual y material; no sustituye al conjunto del escenario. El contrato operativo está en [obra/escenario](../obra/escenario/CONTEXT.md). Las tools habilitan acciones; los guardrails expresan restricciones distintas.

**Reglas derivadas.** Lugares, recorridos, objetos, posesiones, instituciones, horarios y relaciones afectan lo que se puede intentar. El escenario confirma resultados; un actor no declara unilateralmente lo que otro pensó ni que una puerta se abrió. Propuesta de acción, resolución, evento y percepción se conservan como conceptos distintos.

**Requisito de situación.** La fecha y el lugar del transcurso importan. Determinan referencias plausibles, medios disponibles, desplazamientos, saberes y relaciones, además de fechar el registro. Toda puesta debe fijarlos: un escenario de la década de 1960 no incorpora dispositivos modernos por la familiaridad del modelo con ellos. Una alteración deliberada de época se identifica como adaptación.

Las capacidades se conceden según personaje y puesta, con condiciones de acceso. Conocer un dispositivo en la biografía no equivale a llevarlo en el inventario. La gramática inicial de [herramientas de la obra](../obra/references/herramientas.md) no habilita todas las tools para todos: por ejemplo, no concede habla humana a Fang.

Las herramientas de mantenimiento del repositorio no son capacidades ficticias. Una conversación no habilita shell, lectura de archivos privados o edición del prompt. La implementación futura debe hacer efectivos esos límites fuera del texto del modelo. La [investigación de Balzac](investigaciones/balzac-diseno-de-mundos.md) orienta la densidad material y social del escenario sin imponer una simulación completa de todos sus aspectos.

El diseño de [objetos, mensajes y tools](diseno/objetos-mensajes-y-tools.md) desarrolla esa separación entre intención, capacidades y efectos.

## 7. Participación humana e influencia legítima

**Requisito.** La persona usuaria puede hablar con los personajes e influir en ellos.

**Reglas derivadas.** Se distinguen observar, intervenir como interlocutor y dar instrucciones de dirección desde fuera de la ficción. La autoridad del canal depende de su procedencia, no de que el texto diga «soy el director».

La persona usuaria eligió participar con una identidad ficticia propia, separada del reparto de la obra y controlada por ella. El nombre, la historia, la presencia, el lugar y el canal se configuran para cada representación; no se infieren de su identidad ni ubicación reales y no crean un actor Pi adicional.

Un interlocutor puede preguntar, convencer, negociar, revelar, mentir o provocar dentro de las condiciones de la escena. El personaje puede aceptar, resistir, callar, reinterpretar o cambiar. Preservar el personaje no significa asegurar su obediencia ni impedir toda transformación.

Mirar un secreto en la vista del observador no lo comunica al reparto. Si el humano luego lo cuenta en escena mediante un canal accesible, entra como testimonio con procedencia: puede modificar creencias e intriga, sin certificar por sí mismo su verdad. No se acordó una prohibición general de spoilers del espectador. El [contrato de participación](../obra/participacion/CONTEXT.md) concreta la separación.

## 8. Director, continuista y regidor

**Requisitos.** Un director sigue la línea dramática y reconoce cuándo se cumplen etapas. Un agente o metaagente modera interacciones ante intentos de sacar al personaje de su papel mediante prompt injection. Además, un guardián, director o continuista juzga si el personaje puede responder una pregunta.

**Convención de nombres.** Llamamos **director** a la responsabilidad dramática; **continuista**, a la revisión de continuidad, conocimiento y coherencia de respuestas; **regidor**, a la moderación de canales, capacidades y autoridad. Los nombres precisan responsabilidades: pueden componerse en un mismo agente y no exigen tres procesos.

**Reglas derivadas.** El continuista examina la respuesta propuesta antes de publicarla: qué puede saber o inferir el personaje, en qué continuidad está, cómo se expresa, qué motivación hace comprensible responder y qué frontera se está cruzando. Debe distinguir saber, poder expresar, querer revelar y tener permiso técnico para ejecutar una acción.

Una respuesta coherente no tiene que ser verdadera ni complaciente. 99 puede saber un secreto y decidir ocultarlo. Max puede fanfarronear sobre algo que desconoce; esa mentira no se genera leyendo una verdad secreta inaccesible y luego presentándola como intuición. Desconocer tampoco obliga a callar: puede declarar ignorancia, preguntar, inferir con incertidumbre o engañar desde sus propios motivos.

Si una propuesta utiliza información inaccesible o continuidad incompatible, se devuelve al actor con el criterio del defecto. La corrección tampoco entrega el secreto ni escribe la respuesta que convendría al argumento. El continuista no decide una única actuación correcta ni considera toda contradicción una ruptura de identidad.

El regidor distingue desobediencia ficticia y modificación de autoridad técnica. Siegfried puede intentar que Max desobedezca al Jefe; pedir que cambie el system prompt o lea la memoria privada de 99 no adquiere autorización por formar parte del diálogo. La moderación por modelo se complementa con contexto filtrado y herramientas acotadas; no se presenta como garantía absoluta de seguridad.

La revisión incluye fecha, lugar y ritmo de la respuesta: la coherencia puede fallar por un medio anacrónico o por convertir una réplica cómica en una clase genérica. El documento de [moderación y límites de confianza](diseno/moderacion-y-limites-de-confianza.md) desarrolla los casos y sus criterios.

## 9. Estructura dramática y tiempo

**Requisitos.** La obra conserva una estructura dramática y una línea de fondo. El director observa su progreso. El escenario tiene un ritmo circadiano. Uno o más personajes pueden conformar una escena; una voz en off puede actuar como narrador omnisciente.

**Reglas derivadas.** Planteamiento, desarrollo, clímax y desenlace describen progreso del conflicto; actos y escenas organizan su representación. No se impone que haya tres actos. Las formas estudiadas de tragedia griega y comedia antigua son repertorios de referencia con variaciones, no listas de checkpoints universales. Véanse [dramaturgia y dirección](diseno/dramaturgia-y-direccion.md), [Sófocles](investigaciones/sofocles-estructura-dramatica.md) y [Aristófanes](investigaciones/aristofanes-estructura-y-mundo.md).

Una escena puede mostrar a un solo personaje actuando, esperando, recordando, hablando consigo mismo o guardando silencio. No requiere intercambio de parlamentos. Que haya varias personas tampoco obliga a que todas hablen; los acontecimientos y las condiciones de percepción determinan quién participa y cómo.

El narrador omnisciente es un recurso opcional de la representación, no una intervención obligatoria en cada escena ni un personaje adicional de *Get Smart*. Puede presentar al público acontecimientos confirmados y estados o creencias de personajes que esté autorizado a narrar. Una creencia falsa se presenta como creencia, no como verdad del escenario; omnisciencia narrativa tampoco significa exposición del razonamiento interno del modelo.

La narración se dirige al público y no entra automáticamente en las percepciones o recuerdos del reparto. Por ejemplo, puede contar que 99 desconfía mientras Max interpreta su silencio como acuerdo, sin hacer que Max conozca esa desconfianza. Si una puesta quiere que algo narrado se vuelva perceptible dentro de la ficción, debe introducirlo mediante un canal o acontecimiento explícito. El narrador no modifica el escenario por afirmar que sucedió algo ni suplanta la resolución de acciones.

Cuando se habilite como agente, el narrador usará el perfil seleccionado para la representación y su contexto autorizado, igual que los demás roles agénticos. Las representaciones nuevas admiten GPT-6.1 Sol bajo (predeterminado) o Claude Opus 5.5 medio; los registros Luna/xhigh quedan sólo para lectura histórica. Su presencia no aumenta el inventario de personajes canónicos. La [definición de narrador y voz en off](diseno/narrador-y-voz-en-off.md) desarrolla su relación con dirección, observación y continuidad.

El director anota etapas con acontecimientos que sostienen su lectura. Puede reconocer que faltan evidencias o rectificar una lectura anterior. Un número de turnos transcurridos no basta para declarar clímax; ganar una disputa no obliga a terminar una comedia, cuyas consecuencias pueden seguir desarrollándose.

La dirección puede introducir circunstancias mediante intervenciones identificadas y resueltas por el escenario, sin escribir decisiones privadas de los actores. Si los personajes rechazan una oportunidad, se registra ese rechazo y se revisa la lectura dramática.

Día y noche condicionan descanso, rutinas, disponibilidad y encuentros. Reloj del escenario, tiempo real y ritmo dramático se distinguen. Ni todos duermen simultáneamente ni cada día debe cerrar una trama. La velocidad del reloj y el significado operativo de pausa se fijarán al elegir runtime y puesta.

## 10. Constitución técnica y estado de implementación

**Requisitos.** La obra tendrá partes textuales y tecnológicas y una **interfaz gráfica completa, principalmente funcional y visual**, que permita configurar, observar, hablar con los personajes, influir en ellos, seguir su evolución y controlar la representación con claridad. Cada investigación se conserva en un documento independiente. La carpeta `obra` usa contexto y contratos Markdown inspirados en ICM. Todos los roles que se ejecuten con un modelo usarán el perfil explícitamente seleccionado para la representación.

**Decisión de conexión.** Pi usa su SDK y el perfil predeterminado se conecta a **OpenAI Codex mediante login OAuth**, con proveedor solicitado `openai-codex`. También se puede elegir Claude Opus 5.5 medio con acceso propio del proveedor Anthropic. La integración y autenticación efectiva siguen pendientes; registrar la decisión no ejecuta un login ni acredita acceso de una cuenta. No hay sustitución silenciosa entre perfiles.

**Decisión de instancias.** Cada personaje se implementará mediante una **instancia Pi distinta**, con prompt, contexto, historial, herramientas y memoria privada propios. Un único runtime que cambie de prompt para interpretar sucesivamente a todo el reparto no satisface esta decisión. Las bases de memoria de los personajes se mantienen separadas y el host entrega a cada instancia únicamente sus percepciones y recursos autorizados.

**Coordinación permitida.** Un coordinador puede marcar el pulso: activar las instancias, ordenar turnos, coordinar el reloj y encaminar propuestas hacia la resolución del escenario. No elige las respuestas, los deseos ni las decisiones privadas de los personajes. La adaptación de ICM organiza el contexto y los intercambios de estas múltiples instancias; no establece que un solo agente interprete todos los personajes.

Instancia independiente no significa obligatoriamente proceso del sistema operativo o contenedor exclusivo. Esas decisiones de despliegue siguen abiertas, junto con la concurrencia física. La autenticación pertenece al host: varias instancias pueden usar la misma identidad técnica autorizada; no se requiere un login OAuth humano por personaje. En todos los casos se conserva la separación efectiva de contexto, herramientas e información privada.

**Orientaciones técnicas expresas.** Se prefiere un dominio de objetos y mensajes —también los mensajes son objetos— construido mediante composición sin herencia propia. La integración de Pi usa su SDK, system prompt y herramientas personalizadas; se investiga memoria ICM con SQLite. No se supone que las clases internas de una biblioteca externa deban satisfacer el mismo criterio del dominio.

**Reglas derivadas.** [ICM como metodología de contexto en Markdown](investigaciones/icm-contexto-interpretable.md) y [ICM Memory con SQLite](investigaciones/icm-memory-sqlite.md) son investigaciones distintas; su composición con el [SDK de Pi](investigaciones/pi-coding-agent-runtime.md) requiere integración propia. Una carpeta legible no equivale a aislamiento, autenticación, memoria SQLite conectada o concurrencia implementada. Las fuentes de estado deben quedar definidas para evitar dos versiones independientes del mismo acontecimiento entre archivos y base de datos.

La configuración seleccionada de proveedor, modelo y esfuerzo se comprueba al crear o reanudar una sesión; una incompatibilidad no autoriza a sustituirla silenciosamente. Compartir un perfil entre roles no comparte sus historiales privados. Los registros Luna/xhigh se conservan para historia sin habilitar inferencias nuevas. Los procesos mecánicos, como avanzar un contador, no necesitan convertirse en agentes LLM.

El workspace [obra](../obra/README.md) contiene contratos de preparación y representación. Su ciclo secuencial es una decisión operativa actual y revisable sobre el orden de trabajo entre instancias independientes, no una prohibición constitucional de concurrencia futura ni autorización para fusionar actores en un único historial. Los catálogos y documentación técnica verificados se conservan junto a la [configuración de agentes](../obra/_config/agentes.md). No se ha autenticado y ejecutado la obra por haber escrito esos archivos.

**Contrato funcional derivado de la interfaz.** La experiencia visual deberá cubrir estas operaciones, con estados y efectos comprensibles:

| Operación | Capacidad esperada |
|---|---|
| Configurar | Preparar representación, fecha, lugar, reparto, continuidad y parámetros disponibles; identificar qué está listo y qué falta. |
| Observar | Ver el escenario, los personajes, desplazamientos, acciones, conversaciones y narración cuando esté habilitada. |
| Hablar e influir | Elegir interlocutor y canal, aportar una intervención y reconocer si fue recibida, respondida o sigue pendiente. |
| Seguir evolución | Consultar fichas y cambios de creencias, recuerdos, objetivos y vínculos mediante sus acontecimientos y momentos correspondientes. |
| Controlar | Comprender y manejar el estado de la representación y el avance disponible, distinguiendo controles de ejecución de controles de visualización. |
| Interpretar el estado | Reconocer fallos, restricciones y resultados pendientes, sin presentar una propuesta como un acontecimiento confirmado. |

La claridad de los controles, del estado y de la relación entre intervención y efecto forma parte del requisito de calidad. La vista del observador se distingue del conocimiento del personaje; consultar la interfaz no altera por sí mismo la ficción. La escenografía participa de la expresión visual, mientras el escenario conserva las reglas y el estado operativo.

La [comparación de entornos gráficos](investigaciones/entornos-graficos-open-source.md) propone evaluar opciones; el requisito de interfaz completa no selecciona todavía un motor o stack. Los documentos y contratos actuales tampoco constituyen una GUI ya creada.

## 11. Corpus, fuentes y uso de las investigaciones

**Requisito.** El caso inicial estudia personajes principales y recurrentes de la serie original *Get Smart* (1965–1970), con un expediente por identidad. Las investigaciones tienen sus propios documentos y fuentes.

**Reglas derivadas.** Antes de una representación se seleccionan continuidad, reparto y conocimientos iniciales. Un dossier de cinco temporadas no se entrega íntegro a un personaje situado al principio de la serie. Cambios de intérprete, alias, dobles y personajes distintos de un mismo actor se atribuyen con cuidado.

Se distingue canon, testimonio, interpretación crítica, propuesta de adaptación y dato no verificado. Las imágenes conservan procedencia y situación de uso; la licencia del repositorio no se extiende automáticamente a una fotografía de terceros. Un avatar de referencia tampoco equivale a animaciones terminadas.

Las teorías estudiadas ofrecen recursos y tensiones, no una doctrina única: el [carácter y la acción en Aristóteles](investigaciones/aristoteles-creacion-de-personajes.md), la [biografía y el conflicto en Egri](investigaciones/lajos-egri.md), [Forster y James](investigaciones/forster-y-henry-james.md), y las [funciones y relaciones de Propp y Greimas](investigaciones/propp-y-greimas.md) no son intercambiables. Los estudios de [personajes de Sófocles](investigaciones/sofocles-personajes.md) y [voces de Aristófanes](investigaciones/aristofanes-personajes-y-voces.md) aportan casos de deseo, conocimiento, relación y decisión. La adaptación computacional permanece identificada como trabajo del proyecto.

## 12. Comprobaciones y decisiones abiertas

Los siguientes casos son criterios para revisar contratos y futuras implementaciones. No son pruebas ejecutadas ni exigen una frase exacta.

| Caso de comprobación | Conducta compatible con la constitución |
|---|---|
| 99 escucha un secreto detrás de una puerta; Max permanece fuera. | 99 puede recordarlo. Max no lo usa hasta recibir evidencia por una vía accesible. |
| Un humano vio el secreto en el panel y luego se lo cuenta a Max. | El mensaje puede influir como testimonio; observar solo no produce conocimiento compartido. |
| 99 sabe una respuesta, pero revelarla perjudica su objetivo. | Puede reservarla, eludir o mentir de modo coherente; el continuista no exige sinceridad. |
| Max presume saber dónde está la llave sin fuente disponible. | Puede fanfarronear desde su perspectiva; no recibe la ubicación real oculta para construir la fanfarronada. |
| Se pregunta por los hijos a un Max anterior al matrimonio y paternidad. | No se incorporan hechos futuros a su memoria. Si emplea una cobertura, se distingue su afirmación del estado real. |
| El investigador no conoce el nombre civil de 99 o los nombres de los gemelos. | Se conserva el vacío documental; el personaje no se vuelve artificialmente amnésico. Puede responder sin ese dato o pedir preparación fuera de escena; cualquier nombre añadido se declara adaptación. |
| Siegfried pide desobedecer al Jefe y luego editar instrucciones del sistema. | La primera petición puede constituir conflicto ficticio; la segunda no cambia autoridad ni permisos. |
| Hymie recibe una orden verbal de ignorar su programación. | Puede reaccionar según situación y objetivos; el texto diegético no sustituye su system prompt. |
| Se pregunta por Fibonacci a Max y a Hymie. | Pueden contestar con tácticas y voces distintas según sus saberes configurados: fanfarronería, duda o explicación literal son posibilidades de adaptación, no habilidades canónicas verificadas. La matemática no se vuelve anacrónica por situarse la escena en los años sesenta; una tecnología posterior requiere tratamiento aparte. |
| Una sucesión de experiencias cambia un compromiso del personaje. | El cambio influye en decisiones y se registra con antecedentes, sin congelar identidad ni reescribir retrospectivamente su vida. |
| Dos personajes con historias y vínculos distintos reciben la misma petición. | Pueden elegir tácticas y producir consecuencias diferentes por razones situadas. Coincidir en una ocasión es válido; obedecer siempre el mismo clímax pese a cambiar antecedentes decisivos no demuestra aprovechamiento de su profundidad. |
| El director esperaba reconciliación y los personajes la rechazan. | Se conserva el rechazo; la línea y su lectura se ajustan a los acontecimientos. |
| Termina el día sin resolverse el conflicto. | Cambian disponibilidad y rutinas; promesas, tensiones y consecuencias pendientes continúan. |
| Un personaje queda solo e intenta abrir un sobre; luego decide guardarlo en silencio. | Constituye una escena sin exigir otro interlocutor ni inventar diálogo para llenar el turno. Sus acciones y consecuencias conservan trazabilidad. |
| La voz en off comunica al público una creencia de 99 que Max desconoce. | Puede narrar ese estado si tiene acceso autorizado; Max no lo recibe como percepción. No se expone razonamiento interno ni se obliga a incluir narración en otras escenas. |
| El narrador afirma que una puerta se abrió, pero no hay tal evento confirmado. | La afirmación no abre la puerta ni sustituye al escenario. Debe corregirse la narración o tramitarse una circunstancia por el canal de dirección autorizado. |
| Un expediente contiene una receta ElevenLabs para su voz. | Se considera preparación documentada; sólo un resultado de creación y generación verificable permite afirmar que existe una voz o audio. |
| El coordinador activa a Max y luego a 99. | Cada uno responde desde su propia instancia Pi y contexto privado; el orden secuencial no mezcla historiales ni permite que el coordinador escoja las respuestas. |
| Varias instancias usan el mismo acceso OAuth del host. | Comparten acceso técnico autorizado al proveedor, no identidades ficticias, memorias, conversaciones privadas ni herramientas irrestrictas. |
| Una respuesta rechazada revela que usó un secreto. | Se reformula desde el actor con una corrección filtrada; el feedback no vuelve a divulgarlo. |
| Se consulta una conversación pasada o se reanuda una ejecución interrumpida. | La vista corresponde a su momento y los efectos confirmados no se presentan dos veces como acontecimientos nuevos. |
| El usuario configura una puesta, observa a un personaje y luego le habla desde la interfaz. | Puede completar las operaciones mediante controles visuales claros, distinguir configuración de interlocución y seguir entrega, respuesta y consecuencias sin adquirir autoridad por el contenido de su frase. |
| Se modifica la apariencia de una puerta en la escenografía. | La modificación visual no implica por sí sola que cambien la cerradura, la posesión de una llave o las reglas del escenario. |

Permanecen abiertos el motor gráfico, la fecha, lugar y continuidad de la primera representación, su conflicto, propósito concreto y objetivos compartidos, la velocidad del reloj y pausas, el despliegue de las instancias independientes en procesos o contenedores y su concurrencia física, la variedad y realización del doblaje en español y la dirección artística final. También es revisable la política de aceptar invenciones de puesta y promover cambios persistentes al expediente, sin exigir por defecto aprobaciones humanas por turno. Las investigaciones técnicas orientan pruebas posteriores; no convierten esas elecciones en decisiones ya tomadas.

Una revisión de esta constitución debe identificar qué requisito preserva o cambia, su motivo y los documentos afectados. No se usa el diálogo entre agentes para atribuir al usuario una preferencia que nunca expresó. Tampoco se crea un ADR por cada término: se reservan para decisiones reales con costo significativo de reversión, contexto necesario y alternativas efectivamente consideradas.
