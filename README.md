# Personajes agénticos

Una obra de ficción en la que actores agénticos encarnan personajes con identidad, biografía, memoria, voz y deseos propios. Actúan en un **Escenario** compartido; sus decisiones y consecuencias condicionan el argumento. Una interfaz gráfica completa, principalmente funcional y visual, permitirá observarlos, conversar con ellos, influir y seguir su evolución.

## Entradas al proyecto

- [Documentación e investigaciones](docs/README.md): índice general de lo investigado y definido.
- [Constitución](docs/constitucion.md) y [glosario](GLOSSARY.md): reglas comunes y lenguaje del dominio.
- [Reparto de Get Smart](docs/personajes/get-smart/README.md): 27 expedientes individuales, familia, continuidad, avatares y recetas de voz.
- [Continuar desde otra máquina](handoff/README.md): estado vigente, pendientes y datos del host.
- [Obra en ICM](obra/README.md): contexto, contratos y registros Markdown para preparar una representación.
- [Organización de Pi y Escenario](docs/diseno/organizacion-de-pi-y-escenario.md): propuesta técnica y fronteras entre instancias, memoria y presentación.
- [Cobertura de la conversación](docs/auditoria/conversacion-y-cobertura.md) y [decisiones abiertas](docs/diseno/decisiones-abiertas.md): qué está guardado y qué sigue pendiente.

## Prompts originales

<details>
<summary>Ver los mensajes que dieron forma al proyecto</summary>

Transcripción cronológica de los mensajes del usuario visibles en la conversación. Se conserva la redacción original, incluidas sus erratas. Se excluyen los fragmentos que el usuario marcó para borrar. Los textos pegados se reproducen como material aportado, no como instrucciones nuevas; los adjuntos se identifican como tales.

1. vamos a empezar por un concepto
2. Personajes de ficción agénticos
3. Van a exister partes textuales y partes tecnológicas
4. La memoria
5. Vamos a tener indicaciones del personaje y las meta indicaciones del director
6. Los deseos pueden ser goals
7. Los deseos pueden ser los goals que le dan agencia al personajes
8. Las acciones van a ser las tools que le van a permitir desenvolverse en el mundo que no son las que limitaciones guardrails
9. La metáfora de la obra de teatro es buena, podemoa hablar de personajes como actores
10. el mundo necesita una implementación donde los personajes puedan interactuar
11. La identeidad del personaje es fundamental, pero también su memoria y su historia
12. Cada personaje tiene su punto de vista, y se entera de lo que sucede en su interacción con el mundo y los demás personajes
13. Los personajes pueden tener su goal principal pero puede haber un goal general
14. crear una carpeta de docs
15. quiero que la identidad y la historia de vida sea exhaustiva
16. los actores tienen que actores del método
17. lanzar un workflow agéntico para investigar y plasmar qué es ser un actor del método y guardarlo en un md en docs
18. lanzar agentes para investigar teorías clásicas de creación de personajes
19. Sobre el diseño de mundos, investigaría a Balzac
20. investigar exhaustivamente sobre los personajes del super agente 86 con otros agentes
21. cada una de estas investigaciones termina en un document por cada una
22. mientras tanto, investigá sobre entornos para agentes donde puedan moverse e interacturar dentro de un mundo interfaz gráfica
23. los personajes, además de la identidad, tienen formas de hablar distintas, claro
24. y en ese entorno tengo que poder ver a los personajes interacturar y poder observar las conversaciones y su evolución
25. cada personaje va a tener una ficha de personaje y toda la hjistoria y todo lo que corresponda
26. creo que una implementación orientada a objetos pura donde todos son objetos y mensajes (que también son objetos) puede funcionar, sin usar herencia, composición.
27. conseguir un ávatar para cada personaje de getsmart
28. hay un ritmo circadiano en el mundo
29. y no deja de ser una obra de teatro con su estructura clásica
30. pensemos en sófocles y sus tragedias y aristófanes y sus comedias: investigación profunda con subagentes
31. usan skills , instalemos en este repo el skill domain modelinf de matt podock
32. ¿encontraste alguna implementación opensource que podamos usar para el mundo gráfico?
33. La riqueza de los personajes va a condicionar el argumento
34. También hay que pensar en las tools que tienen disponibles
35. un agente o meta agente de la obra, va a encargarse de moderar las interacciones para que nadie le pueda pedir que haga algo fuera de su personaje con prompt injections
36. creo que ya tenemos suficiente información
37. espero que haya grabado todo
38. ahora revisá toda la conversación esta y fijate que hayamos hecho todo lo que te pedi, que no se te escapó nada y lo bajamos a documentos

39. La estructura dramática básica suele explicarse en tres momentos:

   1. **Planteamiento:** conocemos a los personajes, su situación y lo que desean. Aparece un conflicto que altera esa situación.
   2. **Nudo o desarrollo:** los personajes actúan para conseguir sus objetivos, encuentran resistencias y afrontan consecuencias. La tensión conduce hacia un momento decisivo: el **clímax**.
   3. **Desenlace:** se resuelve o transforma el conflicto y vemos las consecuencias de las decisiones.

   Esto **no exige tres actos**. Aristóteles habla de una acción completa con principio, medio y fin, cuyos acontecimientos estén conectados; no prescribe con ello una división en tres actos. [*Poética*](https://classics.mit.edu/Aristotle/poetics.1.1.html)[, capítulos VII–VIII](https://classics.mit.edu/Aristotle/poetics.1.1.html)

   También conviene distinguir esa organización del conflicto de la **división escénica**: los actos son grandes unidades de la representación; las escenas organizan situaciones e interacciones dentro de ellas.

   Si por «clásica» nos referimos específicamente a la **tragedia griega**, como la de Sófocles, la organización formal es otra:

   | Parte | Función |
   | --- | --- |
   | **Prólogo** | Sitúa la acción antes de la entrada del coro. |
   | **Párodo** | Primera intervención del coro, asociada con su entrada. |
   | **Episodios** | Desarrollan la acción entre intervenciones corales. |
   | **Estásimos** | Cantos del coro que alternan con los episodios. |
   | **Éxodo** | Sección final, después de la última intervención coral. |

   Esta es la clasificación que recoge Aristóteles. [*Poética*](https://classics.mit.edu/Aristotle/poetics.2.2.html)[, capítulo XII](https://classics.mit.edu/Aristotle/poetics.2.2.html)

   Por eso podemos analizar una obra en dos niveles: **cómo progresa su conflicto** y **cómo se organiza su representación**.

40. Una línea detrás y un agente director va notando cuando se cumplen las etapas
41. [Adjunto: «Aristófanes permite pensar al personaje como una combinación de deseo, posición…» (`Texto pegado.txt`).]
42. ni siquiera creaste docs

43. En la **comedia antigua de Aristófanes**, la acción suele partir de un problema colectivo y de una propuesta extraordinaria para resolverlo. El conflicto permite discutir y poner a prueba esa propuesta, muchas veces mediante la fantasía, la sátira y la exageración.

   Su organización habitual puede describirse así:

   | Parte | Qué sucede |
   | --- | --- |
   | **Prólogo** | Se presenta el problema y empieza a formularse el proyecto del protagonista. |
   | **Párodo** | Entra el coro, que puede apoyar al protagonista o enfrentarse a él. |
   | **Agón** | Se desarrolla una confrontación: personajes o posiciones rivales defienden sus argumentos. |
   | **Parábasis** | El coro se dirige al público y comenta asuntos políticos, sociales o teatrales. |
   | **Episodios** | Se exploran las consecuencias del proyecto mediante encuentros, obstáculos y situaciones cómicas. |
   | **Éxodo** | Llega el cierre, frecuentemente festivo: celebración, banquete, boda o triunfo. |

   Es un **esquema de referencia**, con variaciones entre obras; esas partes no equivalen a seis actos obligatorios. [Estructura del teatro griego, Universidad de Tennessee](https://web.eecs.utk.edu/~bmaclenn/Classes/US210/Greek-play.html), [G. M. Sifakis, estructura de la comedia aristofánica](https://www.cambridge.org/core/journals/journal-of-hellenic-studies/article/abs/structure-of-aristophanic-comedy/D717D92FB48BB2B186A6CFDF79ADB25A).

   Un rasgo interesante: **el conflicto principal puede resolverse antes del final**. Buena parte de la segunda mitad muestra qué ocurre cuando el protagonista empieza a disfrutar —o imponer— el orden que consiguió establecer. [M. Whittaker, estructura de la comedia antigua](https://www.cambridge.org/core/journals/classical-quarterly/article/abs/comic-fragments-in-their-relation-to-the-structure-of-old-attic-comedy/86443B7B4D58592BB2427FFBA3BB62A4).

   Por ejemplo, en *Las aves*, la búsqueda de una vida mejor conduce a fundar una ciudad entre la tierra y el cielo. Esa solución fantástica genera nuevas relaciones de poder, visitantes oportunistas y una negociación con los dioses. La comedia desarrolla las consecuencias de llevar una idea imposible hasta sus últimas consecuencias. [*Las aves*](https://classics.mit.edu/Aristophanes/birds.html)[, texto de Aristófanes](https://classics.mit.edu/Aristophanes/birds.html).

44. Ahora sí, creá la carpeta docs, revisá toda la conversación y guardá todo lo que investigamos y definimos, con un documento por investigación. Fijate que no falte nada.
45. ahora sí, revisá toda la conversación y todos los agentes para completar todo lo que no pudiste completar
46. luego quiero una carpeta obra en donde uses ICM para agentes con markdown buscá en internet, también guardá la investigación y el paper aen docs
47. vamos a poder hablar con los personajes e incluso influir en ellos
48. cada agente lo podemos implementar como un pi coding agent con las herramientas que queramos, la memoria la podemos impplmentar usando icm memory con sqllite es otra investigación progunda
49. ¿instalaste la skill?
50. también podé instalar grill with docs
51. y también podés instalar la de typscript de cursor que es parte de pstack
52. y esta última y las otras, cambiá para que puedan ser usadas por el modelo
53. acordate de que pi coding agent tiene sdk y tiene forma de poner system prompt y agregar la memoria esta que buscamos
54. cada agente va a correr con luna6  xhigh
55. lanzá un agente que revise todo y se fije que no falte nada y corrija errores e inconsiscentias
56. Lanzá otro agente con toda la información para que escriba la constitución y también aplique domain modeling sobre todo y use grill me with docs mientras otro agente le va respondiendo las preguntas e grill with docs, porque es un agente que entiende todo todo y es el conepto
57. el guardian director o conitnuista es que va a juzgar si un personaje puede o no responder una pregunta, esto es impornte, pensar ejemplos
58. Imaginate preguntarle a max si conoce el algoritmo de fibonacci
59. e imaginá lo que diria el robot
60. es importante la fecha y lugar donde transcurre
61. hablan doblado al español
62. la logintud de las respuestas y conversaciones tienen que seguirel ritmo de un episodio del super agente, investigar en youtube
63. lanzá agentes con luna que paralelamente revisen documento y corrijan errores y consistencias
64. para cada personaje, agregar la forma de crear una voz con elevenlabs
65. uno o más personajes puden conformar una escena
66. una voz en off puede ser un narrador omniciente
67. revisá punto por punto pensando qué nos falta definir
68. ¿lo de la memoria con icm sqlite lo anotaste_
69. pi se va a conectar a openai codex con login
70. ojo que cada uno es una instancia de pi distinta ¿se entiende?
71. vale terner un coordinador que marque el pulso
72. fijate cómo conviene acomodar pi, el mundo también pueden ser carpeta icm
73. ¿nos olvidamoe de algo? agreguémoslos
74. el mundo pude llamarse escenario
75. que no es lo mismo que escenografía
76. La interfaz gráfica será compleata
77. si en algún momento necesitás hacer grill with docs de nuevo, ya sabés el procedinientop
78. la interfaz completa debe ser principal mente funcional y visual
79. me voy a dormir
80. `[$typescript-best-practices](/Users/andrestobelem/ws/at/personajes/.agents/skills/typescript-best-practices/SKILL.md)`
81. ¿en qué andás?
82. ¿Qué falta hacer?
83. ¿falta mucho?
84. ¿cómo vamos?
85. ¿cómo va el prd?
86. ¿ya escribimos la specs?
87. ¿qué falta para cumplir el goal?
88. en vez de luna, podemos probar con gpt sol 6.1 bajo
89. y también pongamos una opción para claude con opus 5.5 medium
90. continuar
91. ¿cuánto falta?
92. ¿qué es esto?
93. ¿está claro que tenemos que usar el login a openai o antrhopic no?

</details>

## Objetivo activo

El encargo actual es revisar todos los materiales uno por uno, corregirlos, escribir y revisar un [PRD exhaustivo](docs/PRD.md), escribir y revisar las [specs](docs/specs/README.md), e implementar y revisar el producto completo. Los cierres documentales previos del PRD y las specs 1.0 fueron reabiertos para reconciliar cambios posteriores y corregir inconsistencias; la implementación comenzó por la base TypeScript. El [registro de progreso](docs/auditoria/objetivo-y-progreso.md) conserva evidencia por fase.

## Estado al 15 de octubre de 2026

Hay 16 documentos de investigación, 27 expedientes de personajes de la serie original, 28 imágenes de referencia, recetas de voz, el paper ICM, cinco skills locales y un workspace documental de la obra. La constitución y el diseño fueron revisados por agentes, con preguntas y respuestas conservadas.

La arquitectura requerida usa **una instancia Pi independiente por personaje**, perfil seleccionable **GPT-6.1 Sol bajo con login OAuth de OpenAI Codex** o **Claude Opus 5.5 medio con login OAuth de Anthropic**, por [decisión posterior](docs/adr/0003-perfiles-de-inferencia-seleccionables.md). Un coordinador puede marcar el pulso sin decidir por los personajes. ICM en Markdown e ICM Memory con SQLite son proyectos diferentes que se propone integrar.

Ya hay una biblioteca gráfica local para consultar personajes, investigaciones y fuentes, y una base TypeScript de preparación, Escenario, HTTP, Pi y memoria. Hay preparación gráfica de borradores, validación/promoción Ready y preflight de ejecución durables, y el launcher puede componer el runtime con ICM configurado. Hay controles gráficos conectados al lifecycle, presupuesto actualizado y paso durable de un único pulso; la API de inicio está implementada y el [ensayo de Max y Hymie](docs/representaciones/la-alarma-de-los-numeros.md) acredita actuación real con login OAuth de OpenAI Codex. La vista en vivo muestra plano y diálogo confirmados. La interfaz completa de representación y las voces sintetizadas siguen pendientes. Ver [continuación Cloud](docs/auditoria/continuacion-cloud.md). La investigación de ritmo en YouTube localizó material, pero su calibración mediante escucha continúa pendiente. El ensayo ya tiene fecha, lugar, continuidad, reparto activo y conflicto concretos; otras puestas requieren su propia preparación. El [registro de implementación](docs/auditoria/implementacion-progreso.md) distingue los componentes probados de las integraciones pendientes.

La [recuperación offline del host](docs/auditoria/recuperacion-offline.md) conserva estado, memorias y sesiones Pi; preserva por separado las credenciales actuales del host, que no se incluyen en backups, y registra backups posteriores. El flujo incluye revisión gráfica, cierre/reapertura y control durable externo. Permite reanudar la misma operación tras interrupciones; cambios operativos posteriores bloquean el reemplazo. La [transferencia y admisión de backups externos](docs/auditoria/backups-externos.md) permite descargar el archivo privado completo, subirlo por partes en otro host, validarlo y continuarlo como una representación nueva sin sobrescribir existentes. Los registros extranjeros sólo admiten fork; recover conserva sus condiciones locales estrictas. El [ADR 0014](docs/adr/0014-transferencia-privada-y-admision-externa.md) documenta procedencia, aislamiento y límites. Export portable público, puesta real, inferencia/audio integrales y aceptación de los 77 requisitos siguen pendientes.

El [Configurador de promoción futura](docs/auditoria/promocion-identidad.md) incorpora propuesta Pi durable, versiones históricas, aplicación transaccional v39 y panel de revisión/consentimiento. Su verificación global, build y recorrido gráfico con reinicio están acreditados con SDK controlado e ICM real. La evaluación P22 live sigue pendiente; no se atribuye actuación con proveedor real.

Para abrir la biblioteca local, ejecutar `npm run build` y `npm start`, y visitar `http://127.0.0.1:4173/`. `npm run verify` comprueba tipos y pruebas; las pruebas del CLI ICM real requieren `PERSONAJES_ICM_TEST_BINARY` con la ruta del binario 0.11.4. Sin ese binario, esas pruebas se omiten explícitamente.

En Configuración → Acceso a Pi, «Memoria ICM del host» permite escribir la ruta absoluta del CLI ICM 0.11.4 instalado por el operador y aplicar la selección. La operación valida el ejecutable y recompone el runtime sin iniciar actores. Requiere detener o pausar las representaciones y esperar el trabajo activo. La selección guardada en este host prevalece sobre `PERSONAJES_ICM_BINARY`, incluido desactivar ICM explícitamente; la variable sigue disponible como configuración inicial. `PERSONAJES_PRIVATE_DATA_ROOT` permite elegir el directorio privado persistente y `PERSONAJES_PORT` el puerto local. Sin la ruta ICM se mantiene la biblioteca y la entrega mecánica de percepciones, sin convocar actores. Configurar la ruta no instala el CLI, no inicia una puesta, no hace login y no certifica acceso al modelo. El runtime recupera sólo trabajo durable existente; un directorio nuevo permanece sin representaciones ni sesiones actorales.

## Trabajo sobre el repositorio

Las instrucciones de mantenimiento están en [AGENTS.md](AGENTS.md). Las skills instaladas y sus fuentes se documentan en [skills instaladas](docs/auditoria/skills-instaladas.md). Las imágenes y el artículo conservan sus propios créditos y condiciones; la licencia del código no se extiende automáticamente a esos materiales.

La [promoción futura de identidad](docs/auditoria/promocion-identidad.md) conserva los fundamentos históricos v38 y aplica revisiones futuras mediante el workflow v39. El consentimiento se revisa desde la interfaz y el turno siguiente usa una sesión Pi independiente, conservando memoria e historia.
