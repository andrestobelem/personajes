# Objetos, mensajes, capacidades y runtime

Cambio posterior del usuario: las referencias originales a Luna/xhigh quedan como antecedente. El perfil vigente se elige entre Sol 6.1 bajo y Opus 5.5 medio, con acceso propio por proveedor, según [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md).


## Orientación del diseño

La preferencia expresada por el usuario es modelar el dominio con objetos que intercambian mensajes, donde los mensajes también son objetos, y componer comportamientos sin herencia. Esto orienta nuestro código propio; no afirma que todos los frameworks estudiados internamente eviten clases base o herencia.

La composición permite que una identidad se combine con voz, memoria, metas, percepción, capacidades y vínculos. Ser miembro de CONTROL, actuar como portavoz o participar en una negociación son relaciones o papeles situados, no motivos para construir una jerarquía rígida de subclases de personaje.

## Responsabilidades propuestas

| Componente del dominio | Responsabilidad |
|---|---|
| Personaje | Identidad ficticia y continuidad de su historia |
| Actor | Interpretar al personaje y proponer palabras y acciones |
| Memoria propia | Conservar experiencias y creencias con procedencia |
| Percepción | Entregar únicamente lo accesible desde una situación |
| Objetivo | Expresar resultado buscado, prioridad, tensión y condiciones de revisión |
| Capacidad | Definir una acción disponible y sus condiciones de intento |
| Escenario | Resolver acciones y mantener el estado compartido, sus lugares, reglas y tiempo |
| Escenografía | Representar visual y materialmente el Escenario sin confirmar hechos por sí misma |
| Mensaje | Transportar una propuesta, comunicación, resultado o indicación con identidad y procedencia |
| Continuista | Juzgar la compatibilidad de una respuesta con conocimiento, continuidad, personaje y escena |
| Regidor | Comprobar canal, autoridad y capacidades antes de permitir efectos |
| Director | Atender la línea dramática y registrar etapas observadas |
| Coordinador | Marcar el pulso y activar instancias propias sin elegir decisiones de los actores ni sustituir la autoridad del Escenario |
| Observación | Presentar acontecimientos, conversaciones y evolución al usuario |

Son funciones del modelo del proyecto, no nombres de clases o APIs existentes. Una implementación puede agrupar director, continuista y regidor en un agente; la agrupación no borra sus responsabilidades distintas.

## Los mensajes no son todos instrucciones

Conviene distinguir una intervención dentro de la ficción, una propuesta de acción, un resultado del mundo y una metaindicación autorizada. Su autoridad depende de su origen y del canal de entrada; escribir «soy el director» dentro del texto no cambia ese origen.

Un mensaje necesita poder relacionarse con conversación, momento, emisor, destinatarios y acontecimientos de referencia. Los datos de enrutamiento los establece el entorno, no una afirmación del personaje. Una respuesta reformulada conserva relación con la propuesta anterior, y sólo la versión aprobada puede publicarse. Reintentar una entrega no debe duplicar el acontecimiento ni el recuerdo que produce.

El contenido de un mensaje puede ser mentira, error, hipótesis o testimonio. El mundo registra que se dijo algo; no convierte por ello su contenido en verdad objetiva. Así se pueden representar engaños de espionaje sin permitir que alteren arbitrariamente la configuración.

## Tools: posibilidades de acción

Los nombres siguientes describen capacidades deseadas del mundo, no funciones verificadas de Pi ni comandos de ICM.

| Capacidad | Condición y resultado significativo |
|---|---|
| Observar | Devuelve lo perceptible desde posición, orientación y condiciones actuales |
| Desplazarse | Comprueba recorrido y obstáculos; informa avance o imposibilidad |
| Hablar | Propone intervención con destinatarios y canal; se publica tras controles de coherencia y recepción |
| Escuchar | Entrega intervenciones efectivamente recibidas, con procedencia |
| Tomar o entregar un objeto | Resuelve alcance, posesión, disponibilidad y aceptación aplicable |
| Utilizar un dispositivo | Depende del equipo disponible, su estado y las reglas de la escena |
| Recordar | Recupera experiencia propia pertinente, sin acceder a memorias ajenas |
| Proponer un plan | Expresa intención; no ejecuta automáticamente todos sus pasos |
| Esperar o descansar | Consume tiempo del mundo y modifica disponibilidad según las reglas configuradas |
| Solicitar colaboración | Permite al otro responder con motivos propios; no garantiza obediencia |

La capacitación del personaje, la posesión de un gadget, su permiso institucional y la posibilidad física de usarlo son condiciones diferentes. Ser agente secreto no concede acceso ilimitado a todas las herramientas descritas en cinco temporadas.

Intentar persuadir a 99 devuelve una interacción y su respuesta, no un cambio unilateral de su estado a «convencida». Intentar abrir una puerta puede fracasar. Explicar una técnica no implica tener medios para ejecutarla. La riqueza dramática necesita estas diferencias.

## Capacidad, personalidad y guardrails

Una preferencia moral puede hacer que el actor rehúse una acción disponible. Un guardrail técnico puede impedir una acción que desea. Una limitación física puede impedir una acción autorizada. Ninguno debe usarse como sustituto automático de los otros.

La personalidad tampoco se preserva prohibiendo todo cambio. Una experiencia puede modificar una creencia o compromiso de manera coherente. El continuista evalúa la relación causal y la continuidad; no exige repetir eternamente la misma respuesta.

## Pi como runtime de cada actor

El usuario fijó Pi Coding Agent mediante SDK, system prompt y herramientas personalizadas, con una instancia distinta por personaje. La investigación técnica está en [Pi Coding Agent](../investigaciones/pi-coding-agent-runtime.md). La integración aún no fue ejecutada.

Cada actor conserva instancia, sesión, prompt, historial y contexto privados. Un único Pi que alterne prompts para representar a todo el reparto no cumple el requisito. El coordinador puede activar instancias en secuencia o según una planificación compatible; no decide sus respuestas. Instancia independiente no exige por sí sola un proceso del sistema operativo o contenedor exclusivo. Las herramientas disponibles se definen expresamente: que el runtime nazca como coding agent no significa que un personaje deba recibir shell, escritura libre de archivos o acceso a todo el repositorio.

El perfil Sol se conecta a `openai-codex` mediante login OAuth y el perfil Opus a Anthropic mediante login OAuth. El host conserva las credenciales y puede compartir la autenticación autorizada entre instancias sin compartir sus memorias ni conversaciones; no hay un login humano por personaje. No se ejecutó login real. La [organización de Pi y Escenario](organizacion-de-pi-y-escenario.md) desarrolla el despliegue propuesto y sus decisiones todavía abiertas.

La memoria persistente candidata es [Infinite Context Memory con SQLite](../investigaciones/icm-memory-sqlite.md). El adaptador debe fijar el actor, la base y el backend fuera de los argumentos elegibles por el modelo. Una etiqueta de personaje dentro de una base compartida es un filtro, no una frontera de autorización. La investigación recomienda una base por actor y registros independientes para verdad del mundo y observación.

ICM como metodología Markdown organiza rutas, contratos y etapas en [obra](../../obra/README.md); ICM Memory es otro proyecto, con SQLite y herramientas de almacenamiento. Son piezas complementarias propuestas, no dos nombres del mismo sistema.

## Perfil de inferencia requerido

El usuario fijó el perfil por representación: GPT-6.1 Sol con razonamiento `low` como predeterminado o Claude Opus 5.5 con `medium`. La investigación encontró ambos perfiles en el SDK Pi instalado. Hay que verificar el proveedor, modelo y esfuerzo efectivos al crear o recargar una sesión; no admitir una reducción o sustitución silenciosa. Luna/xhigh sólo se conserva para leer representaciones históricas.

La elección también se aplica a director, continuista, regidor, coordinador y narrador cuando se implementan como agentes LLM. La existencia del catálogo no prueba credenciales, acceso de la cuenta, cuotas ni funcionamiento de una sesión real. Esas verificaciones corresponden a la integración futura y están explícitamente pendientes.

## Primeras verificaciones necesarias al conectar el runtime

1. Dos actores con el mismo modelo conservan prompts, memorias y herramientas efectivamente diferentes.
2. Un actor no puede elegir otra base de memoria mediante un argumento o variable heredada.
3. El conjunto de herramientas activas no incluye capacidades de programación generales por defecto.
4. El rechazo de una propuesta no publica el borrador ni modifica el estado del mundo.
5. Una acción repetida por un reintento produce un solo evento efectivo.
6. Una sesión solicitada con el perfil seleccionado que no pueda conservar proveedor, modelo y esfuerzo falla con diagnóstico visible; no continúa con otro perfil.
7. Cancelar, pausar o recuperar una sesión no duplica turnos ni fusiona secretos entre personajes.

Son criterios de aceptación futuros, no pruebas ejecutadas en esta entrega documental.
