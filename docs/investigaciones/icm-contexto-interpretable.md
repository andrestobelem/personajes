# ICM: contexto interpretable y agentes organizados con Markdown

Fecha de investigación: 14 de octubre de 2026. Fuentes primarias: artículo de Jake Van Clief y David McDermott, versión arXiv `2603.16021v2`, y repositorio original de ICM, fijado al commit `02ba5d85c7871b75c7c702a2d8da6524723d53d4`. Este documento distingue lo que propone ICM de nuestra adaptación al proyecto **Personajes**.

## 1. Identificación de la propuesta

**ICM significa Interpretable Context Methodology**. El artículo se registra en arXiv como *Interpretable Context Methodology: Folder Structure as Agentic Architecture*. La primera página del PDF y el HTML usan la variante *Folder Structure as Agent Architecture*. Sus autores son **Jake Van Clief y David McDermott**. La primera versión se publicó el 17 de marzo de 2026 y la segunda, aquí consultada, el 18 de marzo. Se conserva el [PDF original versionado](../fuentes/icm/van-clief-mcdermott-2026-icm-arxiv-2603.16021v2.pdf), con su [ficha de procedencia y licencia](../fuentes/icm/README.md). [Ficha arXiv](https://arxiv.org/abs/2603.16021v2), [texto completo](https://arxiv.org/html/2603.16021v2).

El repositorio primario es [RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology). La dirección `SorretAI/ICM`, encontrada durante la búsqueda, es un fork. El enlace antiguo que aparece dentro del artículo redirige al repositorio de RinDig. Algunas convenciones y metadatos aún dicen **Model Workspace Protocol (MWP)**: es una inconsistencia de nombres conservada en las fuentes, no un protocolo adicional que debamos instalar. Tampoco estamos utilizando una herramienta de memoria que solamente comparta las iniciales ICM.

ICM organiza un flujo de trabajo mediante carpetas, instrucciones Markdown y artefactos intermedios. No es un motor gráfico, un modelo lingüístico, una base de memoria ni un servidor que haya que instalar. Las carpetas hacen legible la organización del trabajo; un agente y sus herramientas siguen siendo quienes lo ejecutan.

## 2. Problema que intenta resolver

La propuesta se concentra en flujos **secuenciales, repetibles y revisables por una persona**: investigar, redactar y producir; extraer información, estructurarla y fabricar una presentación. Sus autores sostienen que, en esos casos, definir numerosos agentes y coordinarlos mediante un framework puede introducir complejidad que no aporta al objetivo.

ICM conserva las instrucciones y los productos de cada paso en lugares previsibles. Un agente orquestador carga las instrucciones de la etapa correspondiente, trabaja con sus entradas y escribe un resultado. La siguiente etapa recibe ese resultado. La persona puede inspeccionarlo y editarlo antes de continuar. Cambiar el contenido de una instrucción no exige modificar el código de una clase de agente. [Artículo, §§1 y 3](https://arxiv.org/html/2603.16021v2).

Esto no significa que las carpetas ejecuten procesos por sí solas. El agente debe respetar el recorrido, cargar las entradas correctas y usar las herramientas disponibles. Tampoco significa que renombrar una carpeta repare automáticamente todas las referencias: nuestra adaptación debe validar los enlaces y las dependencias después de cualquier cambio estructural.

## 3. Fundamentos y límites de las analogías

El artículo relaciona ICM con varios antecedentes de ingeniería de software:

| Antecedente | Idea que ICM toma | Lectura para Personajes |
|---|---|---|
| Unix y composición de programas | Una tarea delimitada por componente; resultados que pasan al siguiente paso. | Separar percepción, interpretación, resolución y registro. |
| Modularidad y ocultación de información | Un componente no necesita conocer todo el sistema. | Entregar al actor el contexto pertinente a su personaje. |
| Archivos como dependencias | Las entradas y salidas permiten reconstruir qué depende de qué. | Saber qué ficha, percepción y estado respaldaron una intervención. |
| Compilación en varias pasadas | Cada etapa produce una representación intermedia inspeccionable. | Separar un intento de acción del resultado que confirma el mundo. |
| Programación literaria | Instrucciones ejecutables por el agente y explicación humana conviven. | Los contratos Markdown sirven para operar y revisar el ensayo. |

La última columna es **adaptación de este proyecto**, no un caso de estudio del artículo. ICM se apoya en estas tradiciones para organizar contexto; no prueba que una simulación dramática tenga las propiedades de un compilador determinista. Dos ejecuciones de un modelo pueden producir actuaciones diferentes aun leyendo los mismos archivos.

## 4. Las cinco capas de contexto

El mecanismo más concreto es distinguir cinco niveles y cargar únicamente lo necesario para la tarea actual. [Artículo, §3.2 y tabla 2](https://arxiv.org/html/2603.16021v2), [convenciones originales](https://github.com/RinDig/Interpretable-Context-Methodology/blob/02ba5d85c7871b75c7c702a2d8da6524723d53d4/_core/CONVENTIONS.md).

| Capa | Función en ICM | Forma típica |
|---|---|---|
| 0. Orientación | Identificar el espacio, sus carpetas y cómo empezar. | `CLAUDE.md` en la implementación original. |
| 1. Ruteo de tareas | Indicar a qué etapa corresponde cada pedido. | `CONTEXT.md` del workspace. |
| 2. Contrato de etapa | Precisar qué leer, qué hacer y qué producir. | `stages/NN-etapa/CONTEXT.md`. |
| 3. Referencias persistentes | Reglas, estilo, conocimiento y configuración reutilizables. | `references/`, `_config/`, `shared/`, `skills/`. |
| 4. Artefactos de una ejecución | Entradas particulares, resultados previos y trabajo producido. | `output/` de cada etapa. |

La diferencia entre las capas 3 y 4 importa más que los nombres de las carpetas. Una regla de voz es una referencia; lo que un personaje dijo ayer es un acontecimiento. Un modelo puede utilizar ambos, pero no debería tratar el diálogo de ayer como una nueva instrucción del director.

Para Codex, la orientación puede adaptarse a `AGENTS.md`, manteniendo explícito que es una adaptación al anfitrión. `CONTEXT.md` no es un formato ejecutable mágico: requiere una instrucción que conduzca al agente a leerlo.

El artículo ilustra cargas de entre 2.000 y 8.000 tokens por etapa, frente a un ejemplo monolítico superior a 40.000. Son cifras representativas de su workspace, **no un límite óptimo universal ni un ahorro medido en nuestro proyecto**. La biografía exhaustiva de un personaje puede ocupar muchos archivos; cada actuación debe recuperar las partes relevantes, sin eliminar la historia de vida del archivo maestro.

## 5. Contratos, referencias y productos

Cada contrato de etapa tiene tres piezas:

1. **Inputs:** archivo, sección o alcance que se debe cargar, y razón de esa lectura.
2. **Process:** tarea delimitada y pasos para realizarla.
3. **Outputs:** producto esperado, ubicación y forma de entrega.

Las convenciones añaden auditorías y momentos de revisión para tareas creativas. También recomiendan una sola fuente canónica por regla, referencias en una dirección, contratos breves y separación entre instrucciones de navegación y contenido de referencia. Las reglas de voz no se copian en todos los contratos: los contratos apuntan a ellas. [Convenciones, patrones 1 a 6, 11 y 12](https://github.com/RinDig/Interpretable-Context-Methodology/blob/02ba5d85c7871b75c7c702a2d8da6524723d53d4/_core/CONVENTIONS.md).

El repositorio propone contratos de menos de 80 líneas y referencias de menos de 200; son convenciones de mantenimiento de ese proyecto. En Personajes, la exhaustividad se consigue mediante archivos relacionados y un índice, no comprimiendo toda la historia de vida en un contrato pequeño.

Otra distinción útil es que **los documentos de referencia definen las reglas y los resultados son datos de ejecución**. Un resultado anterior puede ser una entrada legítima de la siguiente etapa, pero no se convierte por eso en la plantilla normativa de todas las actuaciones futuras. Esto evita consolidar como identidad un error circunstancial de una escena.

Los puntos de revisión permiten intervenir. No obligan a solicitar otra autorización por cada operación ya autorizada en nuestra sesión. En el futuro ensayo habrá que declarar cuándo se pausa para dirección humana y cuándo se avanza automáticamente.

## 6. Un orquestador puede delegar

La presentación resumida habla de un agente que cambia de rol al cargar contextos diferentes. El cuerpo del artículo introduce un matiz importante: las implementaciones de los autores usan **Claude Opus 4.6 como orquestador y Claude Sonnet 4.6 para subtareas delegadas**, mediante la capacidad de equipos de agentes de su entorno. El contexto de esas delegaciones también sale de los archivos de la etapa. [Artículo, §§4.1 y 4.2](https://arxiv.org/html/2603.16021v2).

Por tanto, ICM no prohíbe los subagentes. Su contribución está en hacer explícito y editable el contexto con el que trabajan. Una infraestructura externa sigue siendo responsable de iniciarlos, aislar sus contextos, esperar resultados y controlar sus herramientas. El artículo no implementa mediante Markdown un sistema universal de concurrencia.

Esta distinción es decisiva para nuestra obra: **actor como rol, personaje como identidad ficticia y proceso agéntico como ejecutor no son la misma cosa**. Se puede ensayar secuencialmente con un orquestador que interprete varios roles; para preservar puntos de vista privados, cada interpretación necesita un contexto efectivamente separado. Pedirle al mismo contexto que olvide un secreto ya leído no demuestra aislamiento.

## 7. Qué evidencia aporta el artículo

El texto presenta implementaciones de producción de videos, presentaciones y construcción de nuevos workspaces. Sus observaciones de uso provienen de una comunidad por invitación de **52 personas**. De **33** usuarios de flujos comparables, **30** describieron intervenciones humanas frecuentes al comienzo, menores en etapas intermedias y nuevamente frecuentes al final. Los tres restantes informaron una distribución aproximadamente uniforme. [Artículo, §§4.4 a 4.6, figura 5; PDF pp. 11-13](https://arxiv.org/pdf/2603.16021v2).

La figura muestra valores aproximados de 92%, 30% y 78% para las tres etapas. No se deben presentar como resultados instrumentados, tasa de éxito ni reducción de costo. Los autores aclaran que son relatos obtenidos en conversaciones; no un experimento controlado. También describen tres participantes sin experiencia de programación que usaron el constructor de workspaces, un indicio de accesibilidad con una muestra pequeña.

El propio artículo declara estas limitaciones:

- Selección voluntaria y comunidad por invitación, con posibles sesgos de entusiasmo.
- Observaciones informales, sin un protocolo de entrevistas o registro de uso sistemático.
- Mayor concentración de experiencias en producción de contenido.
- Evaluación con una familia de modelos, sin comparación entre proveedores.
- Ausencia de comparación controlada entre la carga por etapas y un prompt monolítico en las mismas tareas.

Nuestra conclusión es acotada: ICM ofrece una **estructura practicable e inspeccionable** que vale la pena adaptar. La investigación consultada no demuestra que por sí sola aumente la calidad dramática, haga más autónomos a los personajes o vuelva seguro un sistema de agentes.

## 8. Observabilidad, trazabilidad y mejora

Poder abrir cada archivo permite observar instrucciones y productos. Esto es útil para detectar en qué etapa aparece un problema. No revela el mecanismo interno del modelo ni explica causalmente cada palabra que generó.

El artículo distingue explícitamente **observabilidad disponible** de **trazabilidad todavía incompleta**. En §6 propone como trabajo futuro identificadores de procedencia, verificación entre etapas y puntos de interrupción semánticos. No debemos describir esas propuestas como funcionalidades implementadas en ICM. [Artículo, §§6.1 a 6.3](https://arxiv.org/html/2603.16021v2).

Para Personajes, agregamos como decisión de diseño propia que las intervenciones dramáticas tengan referencias a los acontecimientos que las sostienen. Por ejemplo: el director puede registrar que reconoce una complicación en `evento-014` y una consecuencia irreversible en `evento-029`. Son evidencias de lectura dramática; no una prueba infalible de que una etapa literaria terminó.

Corregir un resultado resuelve la ejecución presente. Si el mismo error de voz se repite, conviene revisar la referencia de voz o el contrato que lo favorece. La evolución deliberada de un personaje, en cambio, debe conservarse como experiencia e historia de cambios, sin reescribir silenciosamente su biografía inicial para hacerla parecer inevitable.

## 9. Aplicación a la carpeta `obra`

La adaptación de ICM a la obra debe conservar tres niveles diferentes:

| Nivel | Contenido | Tratamiento |
|---|---|---|
| Dirección y reglas del ensayo | Propósito, permisos, reglas del mundo y lectura de la estructura dramática. | Referencias y contratos con autoridad explícita. |
| Personajes interpretados | Identidad estable, biografía, voz, deseos, relaciones y posibilidades de acción. | Fuentes persistentes y vistas de actor delimitadas. |
| Representación en curso | Tiempo, percepciones, intentos, diálogos, consecuencias, memoria y evolución. | Artefactos versionados de una ejecución. |

La organización concreta del workspace se consulta en `obra/CONTEXT.md`. Esta investigación no duplica sus contratos operativos.

### Un recorrido de actuación

Como adaptación conceptual, cada intervención puede recorrer: preparar la situación y las percepciones; cargar el actor correspondiente; producir una intención y una acción; resolver el resultado en el mundo; registrar lo observado, lo recordado y la lectura del director. El nombre y número de etapas operativas no determinan el número de actos de la obra.

El actor no debería resolver unilateralmente que persuadió a otro personaje. Puede intentar persuadirlo y emitir un mensaje; la respuesta del destinatario y las consecuencias del mundo se resuelven después. Los mensajes son datos de interacción, aunque su contenido tenga forma imperativa.

### La línea dramática de fondo

El usuario definió una línea detrás de la acción y un agente director que advierte cuándo se cumplen las etapas. La adaptación conserva esa **lectura retrospectiva y acompañante**: el director examina acontecimientos y señala planteamiento, desarrollo, clímax o desenlace con evidencia y posibilidad de revisión. No convierte esas categorías en órdenes que obliguen al actor a traicionar su identidad.

La progresión del conflicto es distinta de la división escénica. Planteamiento, nudo y desenlace no imponen tres actos. Las partes de la tragedia griega o de la comedia antigua pueden servir como marcos de análisis diferentes. El prólogo, el agón o la parábasis no son nombres intercambiables de carpetas técnicas.

### Memoria y tiempo

Una historia de vida exhaustiva pertenece al archivo del personaje; su memoria es selectiva y puede ser incompleta o errónea. El registro del mundo debe conservar los acontecimientos confirmados, mientras cada actor recibe solamente las percepciones y comunicaciones a las que tuvo acceso. El observador humano puede consultar ambos niveles sin convertir automáticamente esa información en conocimiento de los personajes.

El reloj circadiano es parte del mundo: día, noche, rutinas, descanso y disponibilidad. Un contrato puede exigir leer el estado temporal, pero ICM no incorpora un reloj ni un simulador fisiológico. Avanzar una etapa de procesamiento tampoco equivale por sí solo a que transcurra una hora de ficción.

### Herramientas y composición

Markdown puede describir las herramientas disponibles, sus entradas y las consecuencias esperadas. La ejecución y validación corresponden al runtime. ICM no prescribe clases, herencia ni un modelo de objetos; es compatible con la preferencia de este proyecto por objetos y mensajes compuestos sin herencia, pero no la implementa automáticamente.

## 10. Lo que sigue requiriendo software

Una carpeta llamada `privado` no es una frontera de seguridad si todos los agentes pueden leerla. Una línea que prohíbe cambiar de personaje no es una defensa completa ante prompt injection. La separación de referencias y artefactos ayuda a organizar autoridad, pero la aplicación debe controlar qué contexto y herramientas entrega a cada actor.

El agente moderador puede detectar desviaciones y proponer respuestas compatibles con la escena. Las autorizaciones reales, el acceso a herramientas, la validación de acciones y la escritura de estado requieren controles fuera de sus respuestas lingüísticas. Engañar a Maxwell dentro de la ficción es una posibilidad dramática; usar ese diálogo para modificar permisos del sistema sería otra operación.

ICM tampoco proporciona animación, movimiento, transporte de mensajes en tiempo real, bloqueo de escrituras concurrentes, ejecución transaccional ni recuperación automática después de fallos. El artículo identifica expresamente la concurrencia alta, los intercambios rápidos entre agentes y la ramificación compleja como límites de su enfoque (§5.2). Un mundo gráfico puede consumir los artefactos del ensayo o compartir contratos con él, pero necesita su propia implementación.

## 11. Criterios para verificar nuestra adaptación

Estos criterios son del proyecto, derivados de sus requisitos; no un benchmark del artículo:

1. Cada etapa declara qué archivos y secciones lee y qué producto escribe.
2. Toda regla estable tiene una ubicación canónica y se referencia sin copiar versiones divergentes.
3. Se distinguen la identidad del personaje, sus recuerdos y el registro objetivo de la función.
4. Un actor no recibe acontecimientos ajenos a su percepción ni secretos del director.
5. Las acciones propuestas no se confunden con resultados ya confirmados.
6. El director registra hitos dramáticos con evidencia y puede revisar su interpretación.
7. Se distinguen el reloj del mundo, los turnos de ejecución y la estructura de la representación.
8. Los resultados de una función no se toman como nuevas instrucciones confiables.
9. La presencia de un archivo no basta para declarar completada una etapa: debe satisfacer su contrato.
10. La documentación indica si se realizó un ensayo real, si el contenido es un ejemplo o si solamente se preparó la estructura.

La última precaución mejora una simplificación del repositorio original, cuyo comando documental `status` considera completa una etapa si encuentra archivos en `output/`. Para nuestra obra puede existir un borrador, una muestra o una actuación rechazada: todos requieren estados distintos.

## 12. Fuentes, lectura realizada y licencia

- Van Clief, Jake; McDermott, David. *Interpretable Context Methodology: Folder Structure as Agentic Architecture*. arXiv:2603.16021v2, 18 de marzo de 2026. [Registro](https://arxiv.org/abs/2603.16021v2), [HTML completo](https://arxiv.org/html/2603.16021v2), [PDF](https://arxiv.org/pdf/2603.16021v2), DOI [10.48550/arXiv.2603.16021](https://doi.org/10.48550/arXiv.2603.16021). Lectura sustantiva de §§1-7; cotejo de las tablas, las limitaciones empíricas y el estado de las propuestas futuras.
- [Repositorio original, revisión fijada](https://github.com/RinDig/Interpretable-Context-Methodology/tree/02ba5d85c7871b75c7c702a2d8da6524723d53d4). Consultados README, `CLAUDE.md`, `_core/CONVENTIONS.md`, `workspaces/workspace-builder/CONTEXT.md` y licencia. No se instalaron dependencias ni se ejecutaron los workspaces de ejemplo.
- [Convenciones de ICM](https://github.com/RinDig/Interpretable-Context-Methodology/blob/02ba5d85c7871b75c7c702a2d8da6524723d53d4/_core/CONVENTIONS.md). Fuente de los contratos, capas y patrones operativos; sus ejemplos de video no se trasladan como requisitos dramáticos.
- [Licencia del repositorio](https://github.com/RinDig/Interpretable-Context-Methodology/blob/02ba5d85c7871b75c7c702a2d8da6524723d53d4/LICENSE): MIT, copyright 2026 Model Workspace Protocol Contributors.
- **Licencia del artículo: CC BY 4.0**, declarada en arXiv y en los metadatos del PDF. [Licencia Creative Commons](https://creativecommons.org/licenses/by/4.0/). La copia local conserva el artículo sin modificaciones; este documento contiene una síntesis en español y una adaptación propias, sin atribuirlas a los autores como un resultado suyo.

No se leyó y verificó cada una de las 54 referencias secundarias del artículo. Tampoco se atribuye revisión por pares a la mera presencia del preprint en arXiv. La adopción en Personajes parte de su estructura documentada y conserva como preguntas empíricas la calidad dramática, el comportamiento entre modelos y la robustez de la ejecución.
