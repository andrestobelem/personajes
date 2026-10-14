# Obra: workspace ICM en Markdown

Esta carpeta convierte las definiciones del proyecto en instrucciones, contratos y archivos de trabajo revisables. Está preparada para organizar una representación; **no se ha ejecutado una escena**. El reparto contiene 27 personajes de la serie original *Get Smart* (1965–1970), inicialmente inactivos.

## Qué hay

- [Ruteo de tareas](CONTEXT.md) y [coordinación del pulso](coordinador/CONTEXT.md): entrada para coordinar instancias de personajes independientes.
- [Puesta en marcha](setup/CONTEXT.md): elegir corte temporal, reparto y situación inicial sin entregar spoilers a los actores.
- [Reparto](personajes/README.md): contexto individual, identidad, bandeja y memoria de cada personaje.
- [Participación humana](participacion/CONTEXT.md): hablar con los personajes, negociar e influir en ellos mediante sus interacciones.
- [Continuista](continuista/CONTEXT.md): revisar si cada respuesta propuesta respeta conocimiento, continuidad, voz y contexto antes de publicarla.
- [Escenas](references/escenas.md): uno o más personajes, con conversación, acción solitaria o silencio.
- [Narrador opcional](narrador/CONTEXT.md): voz en off para espectadores, con revisión propia y sin crear hechos del escenario.
- [Dirección](direccion/CONTEXT.md): línea dramática y registro de etapas por evidencias.
- [Escenario](escenario/CONTEXT.md): estado compartido, tiempo, eventos y resolución de acciones.
- [Interfaz gráfica completa](interfaz/CONTEXT.md): prioridad funcional y visual para entender y operar configuración, escenografía, interacción, evolución e historia; todavía sin aplicación implementada.
- [Observación](observacion/CONTEXT.md): conversaciones y evolución accesibles al observador.
- [Verificación](references/verificacion.md): pruebas del protocolo y revisión de una corrida.

## Voz y contexto de la puesta

Los personajes actuarán en **español de doblaje**, con voz propia y respuestas ajustadas al ritmo de la escena. La [configuración de voz y ritmo](_config/voz-y-ritmo.md) distingue ese requisito de la variedad concreta todavía pendiente. La fecha y el lugar de la ficción se fijan en la puesta; no se deducen del reloj ni de la ubicación real del usuario.

## Modelo de los agentes

El perfil por representación puede ser **GPT-6.1 Sol bajo**, predeterminado mediante Codex OAuth, o **Claude Opus 5.5 medio** mediante Anthropic. La [configuración común](_config/agentes.md) conserva la decisión posterior del usuario. Elegir un perfil no autentica una cuenta ni inicia agentes de la obra.

## Cómo usarlo

Un agente con lectura y escritura de archivos puede abrir `obra/CONTEXT.md` y preparar la configuración. La representación posterior requiere una instancia Pi distinta por personaje; el Coordinador invoca a cada una mediante los contratos de `stages/` y marca el pulso. No representa al elenco rotando roles en un único contexto. Los handoffs son archivos Markdown. No se ha instalado un motor LLM, servidor, scheduler ni interfaz gráfica. La navegación del repositorio permite inspeccionar registros, pero el producto requiere una interfaz gráfica completa, principalmente funcional y visual, para entender la obra, prepararla, observarla, conversar, dirigir y examinar evolución mediante controles claros y funciones verificables. El [contrato de interfaz](interfaz/references/contrato.md) conserva ese alcance; no está implementada.

La primera operación es configurar una escena: seleccionar la etapa de la continuidad, uno o más personajes participantes, qué sabe cada uno, dónde está y qué herramientas tiene. En este estado no se ha elegido una etapa de la serie ni asignado una misión. Los campos pendientes no se convierten en hechos por inferencia silenciosa. El configurador puede elaborar una propuesta de puesta en escena dentro del encargo del usuario, marcando lo que inventa.

## ICM y adaptación

Se siguen las capas de orientación, ruteo, contratos de etapa, referencias estables y artefactos variables descritas por [ICM](https://github.com/RinDig/Interpretable-Context-Methodology). El ICM de referencia organiza un flujo por etapas con un orquestador y admite delegación. Esta adaptación fija un Coordinador y una instancia Pi independiente por personaje: sus decisiones son privadas y la confirmación de efectos compartidos se serializa. La especialización teatral, las fronteras de percepción y el protocolo de eventos son diseño de este proyecto, no resultados validados por el paper.

El paper estudia flujos revisables con intervención humana. Aquí las etapas pueden continuar autónomamente una vez que sus entradas y comprobaciones son suficientes: no se añade una aprobación humana por cada turno. El usuario conserva la posibilidad de revisar o intervenir. Los límites de seguridad deben implementarse en el runtime; Markdown establece contratos, no permisos efectivos.

La [investigación y referencia del paper](../docs/investigaciones/icm-contexto-interpretable.md) documenta fuentes, alcance y límites. La procedencia está fijada en [ICM: fuentes](references/icm.md).

## Entrada práctica para un agente con herramientas de archivos

Se puede pedir: «Leé `obra/CONTEXT.md`, revisá el cursor y continuá la siguiente operación válida; no declares ejecutada una escena si sólo preparaste configuración». Si la puesta y las instancias Pi están listas, cada pulso coordina sus turnos a través de las ocho etapas y deja un cierre verificable. Una instancia no se sustituye por el historial de otro personaje. Si todavía faltan decisiones de puesta, el agente prepara y registra esa configuración antes de actuar. No hace falta una aprobación nueva por cada etapa.

Para conversar dentro del escenario, se puede pedir: «Como interlocutor en la escena, quiero decirle a [personaje]: [mensaje]». La entrada se enruta por el contrato de participación y la respuesta nace de la interpretación del personaje y del resultado de las acciones.

## Preparación de voces

La [guía de diseño de voces en ElevenLabs](../docs/investigaciones/elevenlabs-diseno-de-voces.md) y las secciones de cada dossier preparan descripciones y muestras por personaje. Son material para elegir y probar una interpretación; este workspace no contiene voces generadas, IDs de voz asignados ni llamadas de síntesis. La voz del narrador, si se habilita, se configura aparte y no suma un personaje al reparto.

## Independencia de los personajes

La [configuración de instancias Pi](_config/instancias-pi.md) fija una instancia propia por personaje. Compartir el perfil elegido y la autenticación del host no comparte historias. El uso de procesos separados o varias instancias SDK en un mismo proceso sigue abierto; no se han creado contenedores ni sesiones por estos documentos.

## Términos del espacio de la obra

[Escenario, escenografía y escena](references/escenario-y-escenografia.md) se distinguen: el Escenario es el mundo operativo; la escenografía lo representa visual y materialmente; una escena es una unidad con uno o más personajes. La organización de Pi y del Escenario se desarrolla en [el documento de diseño](../docs/diseno/organizacion-de-pi-y-escenario.md).
