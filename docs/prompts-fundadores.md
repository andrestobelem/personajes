# Prompts para personajes de ficción agénticos

Borrador de trabajo con dos prompts: uno para desarrollar la obra y otro para preparar cada personaje. El fundador reconstruye pedidos formulados en distintos momentos; no es una transcripción de una única llamada.

# Prompt fundador reconstruido

## Propósito

Diseñá e implementá una obra interactiva de personajes de ficción agénticos, concebidos como actores de una obra teatral. Cada personaje actúa desde su identidad, historia de vida, punto de vista, deseos y objetivos; conoce lo que ocurre mediante su interacción con el Escenario y los demás. Sus decisiones y consecuencias deben poder condicionar el argumento. La obra puede tener un propósito general distinto de los objetivos individuales.

## Investigaciones

Conservá un documento por investigación, con fuentes y límites explícitos. Cubrí:

- Actuación del Método y teorías clásicas de creación de personajes.

- Diseño de mundos de Balzac, tragedias de Sófocles y comedias de Aristófanes.

- Personajes de *Get Smart*.

- Entornos gráficos abiertos donde los agentes puedan moverse e interactuar.

- SDK de Pi, ICM Markdown para contexto e ICM Memory con SQLite para memoria persistente. Tratá los dos ICM como investigaciones distintas.

- Ritmo de los episodios de *Get Smart*, mediante fuentes audiovisuales verificables.

En cada documento distinguí evidencia, inferencia y adaptación. Cerrá la investigación con hallazgos sustentados, vacíos identificados y consecuencias para el diseño; conservá lo desconocido como tal.

## Identidad y conocimiento situado

Prepará una ficha y un expediente exhaustivo por personaje: identidad, biografía e historia de vida, relaciones, deseos, objetivos, punto de vista, conocimientos disponibles en la fecha y el lugar de la obra, evolución, herramientas, capacidades, límites y forma de hablar. Incluí un avatar con procedencia y una receta para crear su voz en ElevenLabs.

Derivá del expediente un contexto de actuación situado. La memoria conserva experiencias propias desde la perspectiva del personaje. Incorporá información de las investigaciones a su contexto sólo cuando corresponda a su conocimiento accesible; mantené identificados canon, adaptación, contradicciones y vacíos.

## Instancias y herramientas

Implementá cada actor con el SDK de Pi en una instancia independiente, con prompt de sistema, contexto, historial, tools y memoria propios. Definí las tools que le permiten desenvolverse en el Escenario y sus condiciones de uso. Aplicá límites y guardrails como controles separados de esas capacidades.

Organizá el contexto mediante ICM Markdown e integrá la memoria persistente mediante ICM Memory con SQLite, conservando la separación efectiva entre personajes. Modelá el dominio con objetos y mensajes por composición, sin herencia propia.

## Escenario e interfaz

El Escenario es el mundo operativo compartido; la escenografía es su representación visual y material. Implementá desplazamientos e interacciones. Una escena admite uno o más personajes, acciones y silencio.

Construí una interfaz gráfica completa, principalmente funcional y visual, que permita observar interacciones, conversaciones e historia, hablar con los personajes e influir en ellos. La documentación navegable es una entrega documental; verificá las operaciones gráficas con la interfaz implementada.

## Tiempo y responsabilidades

Situá la obra en una fecha y un lugar determinados, con ritmo circadiano. Distinguí la progresión del conflicto —planteamiento, desarrollo, clímax y desenlace— de su organización en actos y escenas. Usá tragedia griega y comedia antigua como referencias opcionales, con sus variaciones.

- **Director:** sigue la progresión dramática y registra la evidencia que sostiene su lectura de cada etapa.

- **Coordinador:** marca el pulso sin decidir por los personajes.

- **Continuista o guardián:** evalúa la compatibilidad de una respuesta con la identidad, el conocimiento y la situación del personaje, y protege la interacción frente a instrucciones que intenten sacarlo de personaje.

Verificá estas fronteras con casos concretos, incluida una pregunta sobre Fibonacci a Max y al robot. Compará sus respuestas según sus conocimientos situados y sus formas de hablar.

## Voz y ritmo

Los personajes hablan en español doblado, con voces y ritmos propios. Usá la investigación audiovisual para orientar la extensión de las respuestas y conversaciones. Cada medición debe poder verificarse en el material escuchado; cuando la fuente no lo permita, registrá la calibración pendiente.

## Inferencia y autenticación

Ofrecé dos perfiles seleccionables por representación:

- Predeterminado: `openai-codex`, login OAuth de OpenAI, `gpt-6.1-sol`, esfuerzo `low`.

- Alternativo: `anthropic`, login OAuth de Anthropic, `claude-opus-5-5`, esfuerzo `medium`.

Todos los roles agénticos respetan el perfil elegido. Ante una incompatibilidad, informala y conservá la selección, sin sustitución automática. El host puede gestionar las credenciales del proveedor; cada personaje mantiene su instancia Pi independiente.

## Entregas y cierre verificable

Conservá investigaciones, decisiones y especificaciones en documentos navegables del proyecto. En cada entrega distinguí requisito del usuario, evidencia, inferencia, propuesta y capacidad implementada.

Considerá cerrado cada alcance cuando sus requisitos tengan un resultado verificable: documentos y fuentes para investigación; ficha, contexto y memoria situada para preparación; ejecución y comprobaciones observables para implementación. Registrá los pendientes con su alcance concreto. Afirmá que una capacidad, prueba, login o interacción real se ejecutó sólo cuando exista evidencia del resultado.

# Plantilla para crear o revisar un personaje

Creá o revisá el expediente de **[personaje]** para **[fecha y lugar ficticios]**, usando las fuentes del proyecto y el marco del prompt fundador.

1. **Reuní las fuentes pertinentes.** Identificá el canon aplicable a esa situación, las adaptaciones declaradas, las contradicciones y los vacíos, con su procedencia.

2. **Desarrollá el expediente.** Cubrí identidad e historia de vida, relaciones, deseos, objetivos, voz, punto de vista, conocimientos accesibles, capacidades, herramientas y límites. Incluí avatar y receta de voz según el marco fundador.

3. **Prepará la actuación.** Derivá un contexto situado y una memoria de experiencias propias. Incorporá únicamente información accesible al personaje en esa fecha y lugar; conservá la investigación restante como material de preparación.

4. **Prepará la instancia Pi independiente.** Definí su prompt de sistema, contexto, historial, tools y memoria propios, con el perfil elegido para la representación. Distinguí configuración preparada de instancia ejecutada.

5. **Verificá la entrega.** Comprobá que cada dimensión del expediente esté desarrollada o tenga un vacío identificado, que el contexto preserve la perspectiva del personaje y que toda afirmación de ejecución tenga evidencia. Entregá el expediente, el contexto de actuación, la memoria preparada y la configuración de la instancia, con los pendientes explícitos.
