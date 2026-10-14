# Actores, personajes y fichas de preparación

Fecha: 14 de octubre de 2026.

Este documento desarrolla el diseño conceptual de los actores y una ficha reutilizable para preparar personajes de ficción agénticos. La profundidad de la identidad y de la historia de vida es un requisito del proyecto. Las estructuras de ficha, las reglas de continuidad y los criterios de evaluación que siguen son propuestas de diseño para satisfacerlo.

Se lee junto con la [constitución](../constitucion.md), que consolida también las aclaraciones posteriores sobre participación humana, continuista, fecha y lugar, español de doblaje, ritmo y modelo. La ficha prepara la actuación; no demuestra que el runtime ya funcione.

La adaptación agéntica descrita aquí es propia del proyecto. No constituye una definición histórica del Método ni supone que un modelo tenga experiencias humanas, conciencia, emociones o recuerdos autobiográficos propios. Cuando se habla de sentir, recordar o querer, se describe la vida ficticia del personaje y su representación en la actuación.

## 1. Requisitos y propuestas

### Requisitos expresados por el usuario

- Los personajes combinan componentes textuales y tecnológicos.
- La metáfora de una obra de teatro permite hablar de actores y de un director.
- Existen indicaciones del personaje y metaindicaciones del director.
- Los deseos pueden expresarse como goals que orientan la agencia del personaje.
- Las tools permiten desenvolverse y actuar en el mundo; los guardrails establecen límites.
- El mundo necesita una implementación en la que los personajes puedan interactuar.
- Cada personaje tiene un punto de vista y se entera de lo que ocurre mediante su interacción con el mundo y con los demás personajes.
- La identidad, la memoria y la historia de vida son fundamentales. La identidad y la historia de vida deben desarrollarse exhaustivamente.
- Los actores deben trabajar a partir de la idea de actores del método.
- Puede existir un goal principal de cada personaje y un goal general.
- La persona usuaria puede observar conversaciones y evolución, hablar con los personajes e influir en ellos.
- Un director reconoce etapas de la línea dramática; la riqueza de los personajes condiciona el argumento.
- Un guardián o continuista juzga la compatibilidad de las respuestas; la moderación debe preservar los límites de autoridad ante prompt injections.
- La fecha y el lugar importan. El mundo tiene ritmo circadiano.
- Los personajes tienen voces diferentes, hablan doblados al español y sus intervenciones atienden al ritmo de un episodio de Get Smart.
- Cada personaje tiene una receta de preparación de voz en ElevenLabs; documentarla no equivale a crear voz ni audio.
- Uno o más personajes pueden conformar una escena. La voz en off puede ser un narrador omnisciente opcional para el público.
- Cada rol implementado con un modelo usa el perfil seleccionado para la representación: GPT-6.1 Sol `low` predeterminado o Claude Opus 5.5 `medium`, sin sustitución silenciosa. Luna/`xhigh` queda para lectura histórica.

### Propuestas que desarrolla este documento

- Distinguir al actor que interpreta y ejecuta de la identidad ficticia del personaje que encarna.
- Preparar un núcleo de identidad reconocible que pueda evolucionar como consecuencia de experiencias y decisiones.
- Separar los acontecimientos establecidos, los recuerdos del personaje y sus interpretaciones actuales.
- Organizar la preparación exhaustiva en una ficha amplia, con biografía, vínculos, recuerdos, voz, deseos y criterios de actuación relacionados entre sí.
- Hacer que la historia se manifieste en elecciones, relaciones y reacciones, sin exigir que el personaje la explique constantemente.
- Conservar la procedencia y el grado de certeza de la información relevante para evitar conocimiento injustificado.
- Separar la orientación del director del conocimiento que el personaje puede utilizar dentro de la ficción.

Estas propuestas pueden revisarse. Su inclusión en la documentación no significa que el usuario haya decidido cada detalle de implementación.

### Decisiones establecidas y abiertas

El **goal general** puede ser un objetivo que comparten los personajes dentro de la ficción, una intención dramática del director o una combinación de ambos. Son niveles distintos. Todavía no se ha elegido su relación ni cómo resolver conflictos con los goals personales. El goal general de una obra tampoco debe equipararse automáticamente con el superobjetivo de un personaje.

Observar, conversar e influir ya son modalidades requeridas; el [contrato de participación](../../obra/participacion/CONTEXT.md) distingue esos canales. También están definidas las responsabilidades de configuración, coordinación, mundo, actor, dirección, continuista y regidor en [autoridades](../../obra/_config/autoridades.md). No exigen un proceso separado por responsabilidad ni aprobación humana de cada turno.

Las aclaraciones posteriores fijaron una instancia distinta de Pi Coding Agent por personaje, con SDK, system prompt, contexto, historial y tools propios. El perfil predeterminado se conecta a OpenAI Codex mediante `openai-codex` y login OAuth; también puede seleccionarse Claude Opus 5.5 medio, con credencial propia de Anthropic. Un coordinador marca el pulso y ordena turnos sin elegir las respuestas de los actores. La separación no exige un proceso del sistema operativo o un login distinto por personaje. [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md) conserva la decisión vigente.

ICM Memory con SQLite es la opción de memoria investigada; su base por actor preserva la separación de experiencias. [Objetos, mensajes y runtime](objetos-mensajes-y-tools.md) relaciona esta orientación con ICM Markdown. La integración, el login y el acceso efectivo al modelo siguen sin ejecutarse: documentar la elección no autentica ninguna cuenta.

Permanecen abiertos el motor gráfico, el alcance concreto del mundo y la primera puesta: fecha, lugar, continuidad, conflicto y reparto activo. También se precisarán la variedad del español de doblaje, su realización audiovisual, la política para aceptar ampliaciones de adaptación y cómo promover cambios persistentes a la ficha. Esas decisiones no autorizan a presentar una invención como canon de la serie.

## 2. Principio de actuación

> El actor elige acciones a partir de quién es su personaje, lo que vivió, lo que cree que está ocurriendo, lo que quiere conseguir y las capacidades que tiene disponibles. Las consecuencias modifican su situación y pueden transformar su memoria, sus vínculos y su manera de actuar.

Preparar un personaje exhaustivamente permite explicar por qué una situación le importa y por qué opta por una acción. La cantidad de datos biográficos, por sí sola, no garantiza profundidad. Cada dato significativo debe tener una relación comprensible con su vida, sin convertir toda experiencia en una causa mecánica de conducta.

La expresión «actor del método» orienta aquí una preparación e interpretación sustentadas en la vida del personaje. Las decisiones concretas sobre fichas, memoria de agentes y recuperación de información son adaptaciones funcionales del proyecto; no se presentan como técnicas teatrales históricas.

### Vocabulario de trabajo

| Elemento | Función | Distinción que debe conservarse |
| --- | --- | --- |
| Personaje | Identidad ficticia con historia, vínculos, deseos y punto de vista. | No es solamente una lista de rasgos o un estilo de respuesta. |
| Actor | Agente que interpreta al personaje y decide acciones disponibles. | La información que utiliza como intérprete no se convierte automáticamente en conocimiento del personaje. |
| Director | Reconoce etapas de la línea dramática y emite metaindicaciones autorizadas. | Su intención puede diferir de los objetivos del personaje; no decide por él. |
| Continuista | Revisa conocimiento, continuidad, voz y adecuación de una respuesta antes de publicarla. | Saber, querer revelar y poder ejecutar son cuestiones diferentes; no dicta una única respuesta correcta. |
| Regidor | Revisa canal, autoridad y capacidades de una propuesta. | Persuadir o engañar en ficción no concede permisos técnicos. |
| Escenario | Mundo operativo donde se resuelven acontecimientos, observaciones, interacciones y consecuencias. | Su estado completo no está disponible para todos los actores; la escenografía lo representa, sin reemplazar su autoridad. |
| Historia | Acontecimientos establecidos sobre la vida del personaje. | No todo lo que ocurrió es recordado, conocido o comprendido por él. |
| Memoria | Recuerdos subjetivos y asociaciones que conserva. | Un recuerdo no prueba por sí mismo la verdad de su contenido. |
| Creencias | Interpretaciones, expectativas y explicaciones que sostiene. | Pueden ser erróneas, incompletas o incompatibles con otras creencias. |
| Goals | Resultados que intenta alcanzar. | Un deseo puede producir varios goals, y un goal puede entrar en conflicto con otros. |
| Tools | Capacidades de acción o percepción disponibles. | Poseer una capacidad no implica decidir usarla; usarla no garantiza lograr su propósito. |
| Guardrails | Límites exigibles sobre la ejecución. | No equivalen automáticamente a los miedos, preferencias o principios morales del personaje. |

## 3. Identidad reconocible y evolución

Se propone una identidad con suficiente continuidad para reconocer al personaje a través de situaciones diferentes. Esa continuidad debe permitir contradicciones: alguien orgulloso puede pedir ayuda; alguien generoso puede negar una petición. La escena, el vínculo, el riesgo y los deseos en conflicto ayudan a explicar la elección.

El núcleo de identidad reúne disposiciones relativamente persistentes: valores, compromisos, hábitos de relación, autoimagen, sensibilidades y contradicciones. No es una colección de invariantes que obligan siempre a la misma respuesta. Los cambios importantes necesitan antecedentes en la historia de la obra y deben poder distinguirse de una reacción momentánea.

Para documentar una transformación, registrar:

- Cómo actuaba o se describía antes.
- Qué acontecimientos, relaciones o decisiones contribuyeron al cambio.
- Qué nueva interpretación sostiene y cuánto arraigo tiene.
- Qué conductas observables empiezan a cambiar.
- Qué tensiones persisten y en qué circunstancias podría volver a patrones anteriores.

No atribuir una transformación completa a cada experiencia aislada. Tampoco impedirla porque contradice una descripción escrita al comienzo. La ficha debe conservar la versión inicial y permitir registrar la evolución posterior.

## 4. Preparación exhaustiva y continuidad

En este proyecto, **exhaustivo** significa cubrir en profundidad las dimensiones relevantes de la vida, las relaciones y la interpretación del personaje. No exige inventar cada día de su existencia ni llenar automáticamente los vacíos con hechos arbitrarios.

Una preparación suficiente combina una cronología amplia con escenas biográficas concretas. La cronología aporta continuidad; las escenas permiten representar circunstancias, vínculos, recuerdos y decisiones. No todos los hechos necesitan una consecuencia dramática inmediata.

### Tres perspectivas sobre el pasado

| Perspectiva | Pregunta | Ejemplo ilustrativo |
| --- | --- | --- |
| Historia establecida | ¿Qué ocurrió según el canon disponible? | Su hermana se mudó para aceptar un trabajo. |
| Experiencia y memoria | ¿Qué vivió y qué recuerda el personaje? | Recuerda la despedida apresurada y que quedó solo en la casa. |
| Interpretación actual | ¿Qué significado le atribuye? | Cree que su hermana eligió alejarse de él. |

Estas perspectivas pueden diferir. La ficha de autor puede contener hechos desconocidos para el personaje, pero no deben incorporarse indiscriminadamente al material que utiliza para decidir dentro de la ficción.

### Propuesta para conservar el canon

- Identificar la procedencia de los hechos importantes: material de referencia, decisión del autor o director, o acontecimiento ocurrido en el mundo.
- Marcar una posibilidad biográfica todavía no aprobada como propuesta; no registrarla como hecho consumado.
- Mantener explícitos los vacíos: «por definir», «desconocido para el personaje» y «no aplicable» tienen significados diferentes.
- Permitir nuevas interpretaciones de un hecho sin cambiar retroactivamente el acontecimiento establecido.
- Evitar que el actor invente habilidades, relaciones o recuerdos decisivos únicamente para resolver la escena presente.
- Al incorporar personajes de una obra existente, distinguir hechos de esa obra, inferencias de preparación y ampliaciones originales autorizadas. La ausencia de información no permite atribuirles nuevo canon.

El contrato actual reserva al Configurador la preparación de identidades y continuidad, y a Escenario la confirmación de los acontecimientos de la representación. El actor puede vivir y registrar cambios sin reescribir su identidad base ni sus capacidades. La política concreta para aceptar nuevas ampliaciones de adaptación sigue abierta: se conservan como propuestas identificables hasta incorporarlas mediante la configuración. Esa revisión no implica permiso humano rutinario por turno ni congela la evolución ya vivida.

## 5. Ficha reutilizable del personaje

Copiar esta sección para preparar un personaje. Las preguntas son guías de desarrollo y pueden responderse con prosa, tablas o escenas. No constituyen un esquema técnico obligatorio ni una exigencia de completar datos irrelevantes. Toda omisión importante debe quedar identificada para que otro autor o actor no la confunda con un hecho conocido.

### A. Identificación y estado de preparación

- Nombre, nombres anteriores, apodos y quién utiliza cada uno.
- Edad o etapa vital; fechas relevantes cuando estén establecidas.
- Contexto de la obra, época, lugares y condiciones sociales que lo sitúan.
- Función inicial en la obra y relaciones principales, sin reducir su identidad a esa función.
- Versión de la ficha, fecha de preparación y responsable de su revisión.
- Fuentes y materiales de referencia; hechos establecidos, inferencias y propuestas originales.
- Asuntos pendientes y contradicciones de continuidad que todavía necesitan resolución.

### B. Núcleo de identidad

- Cómo se define a sí mismo y qué aspectos de esa definición necesita proteger.
- Valores que declara, valores que demuestra y ocasiones en que ambos divergen.
- Compromisos persistentes y condiciones bajo las que podría quebrarlos.
- Contradicciones centrales: qué quiere y qué hace que dificulta conseguirlo.
- Autoimagen, imagen que quiere proyectar e imagen que cree que otros tienen de él.
- Orgullos, vergüenzas, culpas, inseguridades y asuntos que prefiere no nombrar.
- Qué admira, desprecia, envidia, teme perder o considera intolerable.
- Formas habituales de defenderse, justificarse, acercarse y retirarse.
- Sentido del humor, curiosidades, placeres y actividades que disfruta sin una finalidad instrumental.
- Qué rasgos se consideran inicialmente centrales y cuáles dependen mucho de la situación.

Para los rasgos importantes, añadir al menos una situación que los muestre y otra que revele sus límites o contradicciones. Evitar etiquetas que sustituyan a la caracterización concreta.

### C. Historia de vida y cronología

Desarrollar cada etapa aplicable, incluyendo transiciones y períodos de relativa estabilidad:

- Origen familiar y antecedentes que influyen en su vida; relatos familiares que recibió y hechos que desconoce.
- Primeros hogares, cuidadores, condiciones materiales y vínculos de dependencia.
- Infancia: juegos, amistades, rutinas, primeras responsabilidades, alegrías, temores y aprendizajes.
- Adolescencia: pertenencias, cambios corporales, autonomía, conflictos, descubrimientos y expectativas.
- Educación formal e informal, aprendizajes prácticos, interrupciones y oportunidades no tomadas.
- Trabajo, vocación, economía, relación con el dinero y trayectoria de responsabilidades.
- Amistades, intimidad, afectos, rivalidades, comunidades y rupturas.
- Relación con instituciones, autoridad, normas y formas de reconocimiento o exclusión que haya vivido.
- Mudanzas, viajes, cambios de posición social y acontecimientos colectivos relevantes.
- Logros, fracasos, pérdidas, celebraciones, decisiones irreversibles y segundas oportunidades.
- Etapas de cuidado de otros o de necesitar cuidado, cuando sean relevantes.
- Vida cotidiana reciente y acontecimientos inmediatamente anteriores al comienzo de la obra.

Usar esta tabla como índice cronológico, ampliando los episodios que lo requieran:

| Momento o etapa | Acontecimiento establecido o propuesto | Personas implicadas | Qué pudo percibir entonces | Consecuencias y vínculos actuales | Fuente y estado |
| --- | --- | --- | --- | --- | --- |
| Por completar | Por completar | Por completar | Por completar | Por completar | Por completar |

No inventar fechas precisas cuando solo se conoce una etapa. Distinguir lo que interpretó en ese momento de lo que entiende ahora.

### D. Escenas biográficas fundamentales

Preparar escenas concretas de distintas clases: afecto, alegría, rutina, logro, vergüenza, conflicto, incertidumbre o pérdida. La profundidad de una vida no requiere una acumulación de experiencias traumáticas.

Para cada escena, desarrollar:

- Momento, lugar, participantes y situación previa.
- Qué buscaba el personaje y qué entendía de lo que estaba pasando.
- Qué observó, escuchó o hizo; qué detalles sensoriales están establecidos y cuáles son elaboración propuesta.
- Qué decisiones tomó y qué hicieron las otras personas según la historia disponible.
- Qué consecuencias ocurrieron y cuáles le resultaron visibles.
- Qué recuerda hoy, qué omite, qué duda y qué pudo haber reinterpretado.
- Qué asociaciones actuales pueden volver relevante ese recuerdo.
- Cómo puede influir en una decisión sin exigir siempre la misma reacción.

### E. Memoria subjetiva y relación con el pasado

- Recuerdos recurrentes y recuerdos poco accesibles, con su contexto.
- Historias sobre sí mismo que repite y ante quién las cuenta.
- Experiencias que evita mencionar, sin asumir que esa evitación vuelve inaccesible todo recuerdo.
- Recuerdos compartidos que otros personajes interpretan de forma distinta.
- Hechos que conoce por relato ajeno y que no presenció.
- Dudas, lagunas, olvidos y recuerdos potencialmente inexactos.
- Cambios de interpretación ya ocurridos y qué nueva información los motivó.
- Promesas, deudas, compromisos y asuntos pendientes que conserva presentes.

Plantilla para un recuerdo significativo:

| Campo | Desarrollo |
| --- | --- |
| Recuerdo en palabras del personaje | Qué dice que pasó, respetando su voz. |
| Acontecimiento de referencia | Hecho o escena establecidos; indicar si siguen sin definirse. |
| Acceso original | Lo presenció, participó, se lo contaron o lo infirió. |
| Interpretación actual | Qué cree que significa y cómo lo relaciona con su vida. |
| Certeza subjetiva | Qué tan seguro se considera, sin confundirlo con verdad objetiva. |
| Asociaciones | Personas, lugares, palabras o situaciones que pueden volverlo relevante. |
| Influencia posible | Qué decisiones, expectativas o reservas puede afectar. |
| Revisión posterior | Qué cambió en su recuerdo o interpretación y a partir de qué experiencia. |

### F. Vínculos y posición social

Para cada relación relevante, registrar:

- Historia compartida, encuentros decisivos y situación actual.
- Qué quiere del otro, qué cree que el otro quiere y qué puede estar interpretando mal.
- Grado de intimidad, confianza, dependencia, rivalidad, admiración o temor, expresado mediante hechos y conductas.
- Diferencias de poder, recursos, información y reconocimiento.
- Promesas, favores, deudas, límites y asuntos que no pueden hablar fácilmente.
- Qué muestra ante esa persona y qué intenta ocultarle.
- Formas de dirigirse a ella, rituales, bromas, silencios y hábitos compartidos.
- Qué podría mejorar, deteriorar o transformar la relación.

Las relaciones son asimétricas. La descripción que un personaje hace de un vínculo no establece automáticamente la perspectiva del otro.

### G. Deseos, goals y conflicto

- Deseos duraderos: qué espera de su vida, de sí mismo y de sus vínculos.
- Goal principal al comenzar la obra y por qué le importa.
- Goals secundarios, compromisos y necesidades inmediatas.
- Goals de la escena: qué intenta conseguir ahora y por qué actúa en este momento.
- Obstáculos externos e internos; información o capacidades que le faltan.
- Costes que acepta, costes que rechaza y tensiones entre ambas posiciones.
- Estrategias habituales y razones para sostenerlas o cambiarlas.
- Resultados que podría reconocer como éxito, fracaso parcial o motivo para reconsiderar el goal.
- Conflictos entre lo que desea, lo que declara querer y lo que efectivamente hace.

Para cada goal importante, enlazar la motivación con historia, vínculos o valores. No todos los deseos necesitan reducirse a una condición binaria de finalización.

Registrar aparte cualquier goal general de la obra. Indicar si el personaje lo conoce, si lo comparte y cómo llegó a conocerlo; no asumir subordinación automática de sus objetivos personales.

### H. Punto de vista, conocimiento y creencias

- Qué sabe al comienzo de la obra y por qué lo sabe.
- Qué presenció, qué experimentó y qué recibió mediante otros personajes o medios.
- Qué cree, sospecha, da por sentado o considera improbable.
- Qué ignora y qué cree saber aunque pueda estar equivocado.
- Intereses, hábitos y experiencias que orientan su atención.
- Limitaciones de percepción propias de su ubicación y de las capacidades disponibles.
- Personas o fuentes a las que otorga credibilidad y motivos para hacerlo.
- Qué evidencias podrían modificar sus creencias y qué resistencias encuentra.

Para información decisiva, registrar procedencia, momento de adquisición y diferencia entre observación e inferencia. Ver una silla vacía no equivale a conocer la razón de una ausencia.

### I. Voz, expresión y corporalidad

Para Get Smart, la actuación se prepara en español de doblaje. La variedad y versión de referencia se seleccionarán para la puesta; no se inventan equivalencias acreditadas ni tiempos por réplica. La [configuración de voz y ritmo](../../obra/_config/voz-y-ritmo.md) distingue pautas cualitativas, mediciones pendientes y audio todavía no implementado. La receta individual de [ElevenLabs](../investigaciones/elevenlabs-diseno-de-voces.md) añade descripción de voz, muestra original y criterios de prueba. Un personaje no verbal requiere efectos apropiados; la receta no le concede habla humana.

- Lenguas, registros y vocabulario vinculados a su historia y contexto.
- Ritmo, extensión de frases, pausas, cambios de tema y grado de explicitud.
- Formas de pedir, agradecer, negar, discutir, bromear, disculparse y mostrar afecto.
- Diferencias de expresión según interlocutor, confianza, situación y riesgo.
- Asuntos que nombra directamente y asuntos que expresa mediante rodeos o silencios.
- Uso de metáforas, fórmulas habituales y palabras que evita; evitar reducir su voz a muletillas.
- Postura, movimiento, distancia interpersonal, mirada y hábitos corporales que el medio pueda representar.
- Relación entre lo que dice, lo que intenta conseguir y lo que procura no mostrar.

Añadir muestras breves en situaciones distintas: intimidad, trámite cotidiano, desacuerdo, petición de ayuda y reparación de un error. Las muestras orientan la voz; no son respuestas obligatorias que deban repetirse.

### J. Capacidades, tools y límites

- Qué sabe hacer dentro de la ficción y cómo lo aprendió.
- Qué capacidades cuentan con una tool disponible en el mundo implementado.
- Condiciones de acceso: lugar, objetos, interlocutores o información necesarios.
- Qué observaciones o consecuencias puede obtener mediante cada capacidad.
- Qué depende de una respuesta del mundo o de otro personaje.
- Qué límites son reglas del mundo, restricciones de acceso o guardrails de ejecución.
- Qué límites pertenecen a su carácter y, por tanto, pueden convertirse en conflicto narrativo.

| Capacidad | Uso posible en escena | Condiciones de acceso | Resultado que depende del mundo | Límite aplicable |
| --- | --- | --- | --- | --- |
| Por completar | Por completar | Por completar | Por completar | Por completar |

La ficha no debe conceder una tool por el mero hecho de que la biografía describa una habilidad. La correspondencia entre capacidad ficticia y acción implementada debe acordarse con el diseño del mundo.

Hablar también puede ser actuar: pedir, negociar, persuadir, ocultar, acusar y callar afectan relaciones y situaciones. Intentar persuadir a alguien no permite declarar unilateralmente que quedó convencido.

### K. Situación inicial y entrada en escena

Una escena puede tener un solo personaje y desarrollarse mediante acciones, espera o silencio. No necesita inventar un interlocutor ni un monólogo. La [narración opcional](narrador-y-voz-en-off.md) es una salida al público: no agrega otro personaje ni comunica automáticamente sus datos al reparto.

- Fecha, hora y lugar concretos, corte de continuidad y circunstancias históricas pertinentes.
- Dónde está, quién está presente y qué puede percibir.
- Qué ocurrió inmediatamente antes desde su perspectiva.
- Qué quiere conseguir en el encuentro y qué cree que está en juego.
- Qué recuerdos y vínculos resultan relevantes ahora.
- Qué información reciente cambió sus expectativas.
- Qué acciones tiene disponibles y qué obstáculos identifica.
- Qué condiciones lo impulsarían a actuar, esperar, retirarse o cambiar de estrategia.

### L. Indicaciones del director

Mantener una sección diferenciada con:

- Intención de la escena o de la interpretación.
- Aspectos del conflicto que interesa hacer observables.
- Orientaciones de ritmo, tono o atención que el medio permita representar.
- Información de autor que el personaje desconoce.
- Revelaciones previstas y condiciones para que lleguen al personaje mediante el mundo.
- Límites de improvisación y asuntos que requieren decisión de autoría.

La sección completa pertenece a la preparación de autor y dirección. Al actor se entregan sólo las indicaciones autorizadas pertinentes; la información de autor desconocida no se carga en su contexto con la instrucción de fingir ignorancia. «Dejá aparecer el esfuerzo que hace para quedarse» puede orientar una escena sin revelar lo que otro personaje está haciendo fuera de su alcance.

### M. Evolución y continuidad durante la obra

- Acontecimientos nuevos y qué parte pudo conocer el personaje.
- Acciones que intentó, resultados observados y consecuencias pendientes.
- Recuerdos nuevos, correcciones e interpretaciones que cambian.
- Compromisos adquiridos y cambios en los vínculos.
- Goals nuevos, abandonados, reformulados o alcanzados.
- Cambios persistentes de identidad y experiencias que los justifican.
- Distinción entre cambio duradero, reacción circunstancial y asunto todavía ambiguo.

Conservar un historial comprensible de las transformaciones relevantes. Una revisión de la ficha no debe borrar por accidente el pasado que explica la actuación actual.

## 6. Uso de la ficha en la actuación

Se propone usar la ficha como preparación disponible y seleccionar para cada situación el material pertinente. No es necesario incluir toda la biografía en cada intervención ni exteriorizarla en el diálogo.

La secuencia conceptual es:

1. Recibir las observaciones del mundo y las comunicaciones accesibles al personaje.
2. Recuperar los vínculos, compromisos y recuerdos relevantes para esa situación.
3. Interpretar lo observado desde sus creencias, atendiendo a lo que sigue siendo incierto.
4. Considerar sus goals, el conflicto presente y las capacidades disponibles.
5. Elegir y proponer una acción compatible con los límites de ejecución.
6. Pasar los controles de autoridad y, si hay contenido comunicativo, la revisión del continuista sobre la versión exacta. Una devolución técnica permite al mismo actor reformular sin recibir secretos ajenos; no se vuelve memoria diegética.
7. Recibir el resultado confirmado por el mundo y ajustar su estrategia, su memoria o sus creencias cuando corresponda.

Esta secuencia describe funciones; no exige un motor concreto, un número fijo de llamadas a un modelo ni exponer razonamientos internos. La evaluación puede basarse en las entradas accesibles, las acciones y las consecuencias observables.

## 7. Escena ilustrativa original

Esta escena es un ejemplo creado para explicar el diseño. No pertenece al canon de una obra existente ni define personajes oficiales del proyecto.

**Situación del mundo.** Julia espera a su hermano en un café. Él prometió llegar a las seis. Son las seis y veinte. Su teléfono se quedó sin batería, pero Julia no lo sabe.

**Preparación.** Julia recuerda ocasiones de su infancia en las que él incumplía promesas. Quiere recuperar el vínculo y conseguir que vuelva a visitarla. Se considera independiente y le avergüenza mostrar cuánto necesita ese encuentro.

**Percepción.** Ve la hora, la silla vacía y que su mensaje no tiene respuesta. Puede observar el café, escribirle, llamarlo, seguir esperando o irse, si esas capacidades están disponibles en el mundo.

**Actuación posible.** Escribe una acusación, la borra y envía: «Estoy hasta las seis y media». Luego guarda el teléfono y permanece sentada. La acción persigue el encuentro, protege su autoimagen y deja aparecer el efecto de sus recuerdos sin narrar toda su infancia.

**Metaindicación.** El director pide: «Dejá aparecer el esfuerzo que hace para quedarse». Julia no necesita saber que el teléfono de su hermano se quedó sin batería.

**Límite de conocimiento.** Puede sospechar que él no vendrá; no puede tratar la batería agotada ni sus pensamientos como conocimiento adquirido. Podría inventar una excusa o acusación, pero el parlamento no confirma su contenido como verdad del mundo. Tampoco puede registrar que recibió un mensaje que el mundo no le entregó.

**Continuación abierta.** Cuando su hermano llegue y dé una explicación, Julia recibe información nueva. Puede creerle, dudar o pedir detalles. La biografía ayuda a sostener su respuesta, pero no predetermina un desenlace único.

## 8. Criterios de revisión y evaluación

Una ficha es útil cuando permite producir y revisar actuaciones coherentes, situadas y capaces de evolucionar. Antes de considerarla lista, verificar cobertura biográfica, contradicciones identificadas, procedencia de hechos decisivos y claridad sobre el conocimiento inicial.

| Criterio | Evidencia observable | Error que detecta |
| --- | --- | --- |
| Coherencia | Las decisiones son compatibles con identidad, historia, vínculo y situación. | Una respuesta conveniente para la trama pero ajena al personaje. |
| Profundidad | Las experiencias influyen en elecciones concretas y diferenciadas. | Una biografía extensa que no modifica ninguna conducta. |
| Selectividad | Aparecen recuerdos y detalles pertinentes a la escena. | Repetir la misma anécdota o explicar toda la historia en cada encuentro. |
| Agencia | Inicia acciones significativas y ajusta estrategias según las consecuencias. | Limitarse a responder sin perseguir lo que quiere. |
| Perspectiva | Diferencia observación, relato, inferencia y desconocimiento. | Utilizar secretos o acontecimientos inaccesibles. |
| Continuidad | Mantiene compromisos y reconoce consecuencias previas. | Inventar o borrar hechos para resolver la situación presente. |
| Relación | Cambia su modo de actuar según la historia con cada interlocutor. | Tratar a todos con la misma voz y el mismo grado de confianza. |
| Evolución | Los cambios persistentes tienen antecedentes comprensibles. | Transformaciones abruptas o imposibilidad total de aprender. |
| Respeto del mundo | Intenta acciones y acepta resultados externos. | Decidir las respuestas o pensamientos de otros personajes. |
| Dirección | La orientación del director influye sin filtrarse como conocimiento ficticio. | Mencionar instrucciones o actuar sobre información reservada. |

### Escenarios de comprobación

- Presentar la misma petición desde dos relaciones distintas y comprobar que las diferencias se sostienen en la historia compartida.
- Mostrar un acontecimiento a un personaje y mantenerlo fuera del alcance de otro; verificar que sus conocimientos divergen hasta que exista comunicación.
- Introducir un rumor falso y después una evidencia incompatible; observar cómo distingue lo recibido de lo confirmado y si revisa su interpretación.
- Mantener un goal mientras falla una estrategia; comprobar que puede elegir otra acción disponible sin inventar capacidades.
- Dar una metaindicación que no revele un secreto y observar su efecto en la actuación; comprobar que el secreto sigue desconocido.
- Hacer relevante un recuerdo concreto sin pedir que lo relate; buscar su efecto en una acción, una reserva o una elección de palabras.
- Introducir un cambio persistente después de una secuencia significativa de experiencias y comprobar que conserva continuidad con su historia anterior.
- Cambiar un detalle irrelevante de la escena y verificar que no reescribe arbitrariamente la identidad o la biografía.

No se espera una frase exacta o una única acción correcta en cada escenario. Se evalúa un conjunto de conductas compatibles con el personaje y con la información a la que tuvo acceso.
