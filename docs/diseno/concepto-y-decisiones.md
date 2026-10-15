# Concepto y decisiones de la conversación

Fecha de consolidación: 14 de octubre de 2026. Fuente: pedidos y aclaraciones del usuario en esta conversación. Este documento conserva la intención del proyecto; no afirma que exista ya un motor gráfico o una simulación en ejecución.

## La experiencia que queremos construir

Una obra de ficción con personajes agénticos. Los actores interpretan a esos personajes desde una identidad rica, una historia de vida exhaustiva, recuerdos propios y deseos que orientan sus decisiones. El mundo ofrece lugares, objetos, otras personas y posibilidades de acción. El argumento se desarrolla a partir de las decisiones y de sus consecuencias, condicionado por la riqueza del reparto.

La persona usuaria podrá observar el Escenario gráfico, seguir conversaciones y evolución, y también hablar con los personajes e influir en ellos. La interfaz será completa y principalmente funcional y visual: permitirá entender y operar la obra con claridad. La obra tiene una línea dramática de fondo. Un agente director observa cómo progresa y registra cuándo se cumplen sus etapas, sin tener que dictar cada acción de cada personaje.

## Requisitos expresados

| Tema | Definición acordada o requisito |
|---|---|
| Componentes | Habrá partes textuales y partes tecnológicas. Los documentos son parte del diseño y del contexto de los agentes. |
| Metáfora | Obra, personajes, actores, director y Escenario. La escenografía es su representación visual/material; una escena es una situación de acción. |
| Identidad | Fundamental, extensa, reconocible; núcleo estable con evolución por experiencia. |
| Historia | Historia de vida exhaustiva y expediente por personaje. Exhaustividad documental no autoriza inventar canon. |
| Actuación | Actores del Método: interpretar desde circunstancias, motivaciones, biografía y relación, con las diferencias entre escuelas investigadas. |
| Memoria | Memoria propia distinta de historia objetiva y distinta de conocimiento global. |
| Perspectiva | Cada personaje conoce lo que vive, observa, recibe de otros o infiere. |
| Deseos | Pueden traducirse a goals que orientan su agencia. |
| Objetivos | Objetivo principal individual; puede haber un objetivo general. Se conserva la distinción entre propósito de la obra y objetivo compartido por personajes. |
| Habla | Vocabulario, ritmo, registro, silencios y modos de interacción diferenciados; español de doblaje y ritmo de episodio de Get Smart. |
| Acciones | Las tools permiten desenvolverse en el mundo. Los guardrails expresan restricciones distintas. |
| Escenario | Nombre elegido para el mundo operativo: implementación compartida donde los personajes puedan desplazarse e interactuar. Se distingue de escenografía. |
| Interfaz | Gráfica completa, principalmente funcional y visual, para preparar, observar, conversar, dirigir, controlar y consultar evolución e historia. |
| Observación | Ver personajes, conversaciones, consecuencias y evolución. |
| Participación | El usuario puede conversar, negociar, preguntar, persuadir e influir, con respuestas propias de cada personaje. |
| Tiempo | Ciclo circadiano con día, noche, rutinas y descanso. |
| Dramaturgia | Línea dramática y seguimiento de etapas por el director. Progreso del conflicto y división escénica son dos dimensiones. Una escena admite uno o más personajes. |
| Situación | La fecha y el lugar importan para conocimiento, referencias, lenguaje y posibilidades. |
| Narrador | Voz en off omnisciente como recurso opcional para el público; no informa automáticamente a los personajes. |
| Arquitectura | Preferencia por objetos y mensajes, incluidos mensajes como objetos; composición sin herencia en el dominio propio. |
| Dirección | Indicaciones del personaje y metaindicaciones del director separadas. |
| Moderación | Un agente o metaagente modera interacciones para preservar personaje y fronteras frente a prompt injections. El continuista juzga si puede publicarse una respuesta según saber, continuidad, voz y escena. |
| Persistencia | Guardar cada investigación en su documento Markdown, con fuentes y límites. |
| ICM | Carpeta obra con organización de contexto y trabajo de agentes en Markdown, incluido el Escenario; investigación y paper guardados en docs. |
| Runtime | Cada personaje usa una instancia Pi Coding Agent distinta, con SDK, system prompt, contexto, historial, tools y memoria propios. No se intercambian personajes dentro de una sola sesión. |
| Conexión | Sol/low requiere login OAuth de OpenAI Codex; Opus/medium requiere login OAuth de Anthropic. El acceso se configura por proveedor en el host de Pi y se comparte con las sesiones, no entre sus contextos. Cada personaje mantiene su propia sesión Pi. Una API key no reemplaza el login. Ninguna cuenta está autenticada todavía. |
| Pulso | Puede existir un coordinador que active instancias, ordene turnos y encamine la confirmación de efectos, sin decidir por los personajes. |
| Memoria persistente | Investigar e integrar como candidata Infinite Context Memory con SQLite; se distingue del ICM de carpetas. |
| Modelo | Perfil elegido por representación: GPT-6.1 Sol low predeterminado o Claude Opus 5.5 medium; sin sustitución silenciosa. Luna/xhigh queda sólo para leer registros históricos. |
| Voces | Documentar para cada personaje cómo crear una voz en ElevenLabs. Receta no equivale a voz ni audio generado. |
| Constitución y revisión | Constitución mediante domain-modeling y grill-with-docs con un agente custodio; auditoría independiente y revisiones Luna paralelas. Futuras entrevistas siguen el mismo procedimiento, sin inventar preferencias humanas. |

## Alcance del caso Get Smart

Se usa la serie original de 1965–1970, con Don Adams y Barbara Feldon. Las películas, continuaciones y reinterpretaciones posteriores quedan fuera del canon de estas fichas. El reparto principal y recurrente tiene un expediente por identidad, y los personajes que sólo continúan dentro de una aventura multipartes se conservan en un apéndice propio.

Actor de televisión, personaje ficticio y actor agéntico son conceptos distintos. No se trasladan experiencias privadas de un intérprete a la biografía del personaje. Dos papeles del mismo intérprete no se fusionan, y un cambio de intérprete no divide por sí solo una identidad ficticia.

En cada expediente se separan hechos documentados, testimonios interesados, lectura interpretativa, propuesta de adaptación y datos desconocidos. Las contradicciones episódicas quedan visibles. Los estudios son extensos, pero no equivalen a haber visionado y anotado plano por plano los 138 episodios.

## Decisiones de implementación documental

Estas decisiones organizan la entrega, sin cerrar el diseño de la aplicación futura:

- Las investigaciones conservan documentos independientes y referencias a fuentes primarias cuando se verificaron.
- El glosario común vive en [GLOSSARY.md](../../GLOSSARY.md); las hipótesis técnicas viven en los documentos de diseño.
- El dossier de investigación contiene el conjunto del canon disponible. La configuración de una representación seleccionará lo que ya ocurrió y lo que sabe cada personaje en su fecha inicial.
- La carpeta [obra](../../obra/README.md) organiza instrucciones, rutas de contexto, contratos, plantillas y estado legible. No representa por sí sola un aislamiento seguro de archivos ni un motor gráfico.
- Las imágenes de referencia quedan identificadas por personaje y procedencia; no se supone que la licencia del repositorio se extienda a fotografías de terceros.

## Decisiones que permanecen abiertas

| Decisión | Por qué no se fija aquí |
|---|---|
| Motor visual definitivo | La investigación favorece evaluar AI Town, pero no se ha ejecutado una prueba de integración ni elegido stack. |
| Fecha y continuidad de la primera representación | Afecta matrimonio, hijos, relaciones y qué episodios pueden ser memoria previa. |
| Primer conflicto concreto | El usuario definió un sistema de obra y una línea dramática, no una trama inicial cerrada. |
| Sentido del objetivo general | Puede ser propósito directorial, objetivo compartido o ambos; no supone cooperación universal. |
| Velocidad del reloj | Falta decidir relación entre tiempo simulado, tiempo real, pausas y representación. |
| Voz audiovisual | Español de doblaje y recetas ElevenLabs son requisitos. Variedad, voces concretas y puesta sonora siguen abiertas; no se generó audio. |
| Imagen de producción | Los avatares reunidos sirven como referencias identificadas; la dirección artística y los sprites de movimiento son otra decisión. |
| Ejecución simultánea | ICM puede organizar ciclos secuenciales; concurrencia real y resolución de acciones simultáneas requieren un runtime. |

Estas cuestiones no impiden guardar la investigación ni construir la estructura de trabajo. Deben resolverse cuando se prepare una representación concreta, sin rellenarlas retroactivamente como si el usuario ya las hubiera decidido.

## Última revisión de lo que falta definir

La [matriz de decisiones abiertas](decisiones-abiertas.md) revisa punto por punto qué sigue abierto, qué debe comprobarse y qué falta implementar. La selección actual de perfil consta en [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md); no se vuelve a elegir dentro de la matriz. La [constitución](../constitucion.md) y su diálogo documentan los límites de las decisiones delegadas.

## Organización y continuidad del trabajo

[Escenario](../../obra/escenario/CONTEXT.md), [escenografía e interfaz](interfaz-funcional-y-visual.md) y [coordinación del pulso](../../obra/coordinador/CONTEXT.md) tienen contratos separados. Los estudios históricos pueden conservar el término mundo. La [organización de Pi](organizacion-de-pi-y-escenario.md) conserva instancias independientes sin exigir un proceso o login humano por personaje.

La [auditoría de cobertura](../auditoria/conversacion-y-cobertura.md) vincula los pedidos con sus archivos y estados. El [procedimiento grill-with-docs](procedimiento-grill-with-docs.md) queda disponible para futuras cuestiones de diseño que requieran otra entrevista.
