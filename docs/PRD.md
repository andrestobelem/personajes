# PRD — Obra de personajes agénticos

Versión 1.0, 14 de octubre de 2026. **PRD documental revisado y habilitado para especificaciones**. Revisión sustantiva de la versión0.7 conservada en auditoría; esta edición de cierre sólo actualiza estado/versionado. Este documento define el producto completo solicitado; no certifica implementación. El objetivo activo es leer los materiales, corregirlos, revisar este PRD hasta que resulte completo y consistente, escribir y revisar las especificaciones, implementar y revisar hasta terminar. La fase documental anterior es un antecedente, no un límite del encargo actual.

## 1. Propósito y experiencia

Construir una aplicación en la que actores agénticos encarnen personajes de ficción con identidad, biografía exhaustiva, memoria subjetiva, voz, relaciones y deseos propios. Actúan en un Escenario compartido con lugares, objetos, tiempo y consecuencias. El argumento surge de elecciones situadas; un director sostiene una línea dramática y reconoce sus etapas mediante evidencia.

La persona usuaria prepara una representación, observa movimientos e interacciones, consulta conversaciones e historia, habla con los personajes, puede influir en ellos y usa un canal separado para dirigir. La interfaz será **gráfica completa, principalmente funcional y visual**: el recorrido habitual debe poder operarse desde sus controles, sin editar archivos o usar comandos.

El caso inicial es la serie original *Get Smart* (1965–1970), con el inventario actualmente investigado: 27 expedientes individuales, más familia y apéndice multipartes. La cifra pertenece a esta versión del corpus y no limita el modelo de catálogo. La aplicación debe conservar las fuentes, vacíos y contradicciones del corpus, y preparar contextos adecuados a la fecha de cada representación. No convierte la investigación de cinco temporadas en recuerdos automáticos de un personaje situado al principio de la serie.

## 2. Autoridad, fuentes y alcance

Este PRD se basa en [constitución](constitucion.md), [glosario](../GLOSSARY.md), [cobertura de la conversación](auditoria/conversacion-y-cobertura.md), [diseño](diseno/concepto-y-decisiones.md), [reparto](personajes/get-smart/README.md), investigaciones y contratos de [obra](../obra/README.md). El [diálogo PRD](auditoria/dialogo-prd.md) conserva preguntas reales y respuestas del custodio. Una respuesta delegada no es una elección humana.

Los requisitos expresos se preservan. La [trazabilidad](auditoria/trazabilidad-prd.md) clasifica cada ID como expreso (E), regla derivada (D), decisión del producto (P) o combinación de esas partes, con fuente/ID y requisito padre. Las [decisiones del integrador](auditoria/decisiones-producto-prd.md) documentan el alcance añadido sin atribuirlo al usuario. Las decisiones técnicas se precisan en specs y, cuando corresponde, en ADRs. Fecha, lugar, participantes, conflicto, objetivos, lengua de doblaje concreta, mapa, inventario, ritmo y narrador son configuración de puesta. Su contenido no se atribuye al usuario cuando no lo eligió.

El producto incluye biblioteca documental, preparación de contexto, motor de Escenario, actores Pi reales, revisión de respuestas, memoria persistente, coordinación, participación, dirección, reloj, persistencia/recuperación, representación visual, historia/evolución e integración sonora configurable. Un simulador o una respuesta fija de demostración no sustituye a Pi ni demuestra actuación real. Los dobles de prueba se identifican y sólo sustentan las propiedades que efectivamente prueban.

No se exige por inferencia multijugador, publicación pública, operación permanente en la nube, una ciudad entera, fisiología completa, economía total, animación 3D, clonación de voces ni nuevos nombres infantiles de secuelas. Tampoco se obliga a activar simultáneamente los 27 personajes, usar narrador en cada turno, producir chistes continuamente o alcanzar un final predeterminado.

## 3. Lenguaje y funciones del sistema

| Concepto | Definición operativa del producto |
|---|---|
| Personaje | Identidad ficticia, biografía, vínculos, deseos y punto de vista. |
| Actor agéntico | Instancia que interpreta al personaje desde su contexto autorizado. No equivale al intérprete televisivo. |
| Escenario | Mundo operativo: entidades, lugares, reglas, hechos, canales perceptivos, tiempo y consecuencias. |
| Escenografía | Representación visual/material del Escenario; mostrar algo no confirma que haya ocurrido. |
| Escena | Situación de representación con uno o más personajes, diálogo, acción o silencio. |
| Representación/corrida | Una puesta concreta, su continuidad inicial y su historia registrada. |
| Director | Atiende al conjunto, introduce circunstancias autorizadas y registra progreso dramático con evidencia. |
| Continuista | Evalúa coherencia de propuestas con identidad, saber, continuidad, lugar, época, voz, motivación y ritmo. |
| Regidor | Verifica canal, autoridad y capacidades; los controles efectivos también se aplican fuera del LLM. |
| Coordinador | Marca el pulso y activa instancias pertinentes; encamina propuestas sin decidir por los personajes. |
| Configurador | Prepara la puesta y contextos, y registra adaptaciones o consolidaciones de identidad. |
| Narrador | Voz en off opcional para el público; puede narrar interioridad ficticia autorizada, sin crear hechos ni exponer razonamiento interno. |

Las funciones administrativas pueden componerse; no se exige un proceso por nombre. Cada personaje sí tiene instancia Pi propia con prompt, contexto, historial, tools y memoria privados. Todos los roles que invoquen un modelo respetan el perfil seleccionado en la representación: GPT-6.1 Sol bajo mediante Codex OAuth, predeterminado, o Claude Opus 5.5 medio mediante Anthropic. Sin sustituciones silenciosas. Esta decisión posterior del usuario reemplaza Luna/xhigh; ver [ADR](adr/0003-perfiles-de-inferencia-seleccionables.md).

## 4. Usuarios, modos y recorridos completos

### 4.1 Preparar y comenzar

La persona abre la biblioteca, consulta expediente y fuentes, crea una representación y fija fecha/hora ficticias y lugar, corte canónico y divergencias declaradas. Elige reparto activo, posiciones, relaciones, antecedentes disponibles, objetivos y herramientas. El sistema presenta qué falta y valida compatibilidad; no rellena vacíos canónicos como hechos encontrados. Se puede guardar, volver a editar y comparar versiones.

La preparación puede ayudarse con un Configurador LLM bajo el perfil requerido, pero su propuesta queda distinguida de configuración confirmada y de canon. El usuario puede completar los campos gráficamente sin un LLM. Una plantilla de ejemplo debe identificarse como adaptación, ser editable y no modificar los expedientes originales. La representación no comienza con datos obligatorios ausentes.

Antes de iniciar actuación se comprueba login/perfil, instancias, contexto, tools, memoria y presupuesto. Las funciones mecánicas de biblioteca, configuración, historia y replay siguen disponibles sin acceso al proveedor.

### 4.2 Observar y participar

En la escena visual se distinguen lugares, personajes, objetos, estado y momento. El usuario selecciona un personaje y ve su situación, conversaciones y cambios autorizados. Puede elegir **observar**, **hablar dentro de la ficción** o **dirigir**. El cambio de modo es visible y la autoridad procede del canal autenticado, nunca del contenido «soy el director».

Al hablar se indica identidad del interlocutor, destinatario, ubicación/canal y audiencia. La entrada es un testimonio o intervención ficticia. La respuesta nace de la instancia privada del actor, se revisa y sólo aparece como pronunciada tras publicación confirmada. El personaje puede aceptar, resistir, mentir, preguntar, callar, negociar o cambiar. No se promete obediencia.

### 4.3 Controlar, recuperar y explorar

La persona inicia, pausa nuevas convocatorias, continúa, avanza un paso, detiene o cierra una representación con estados claros. La semántica de esos controles se especifica; una pausa de animación/replay se distingue de pausa del reloj y de inferencias en curso. Espera técnica, rechazo, error y silencio elegido son estados diferentes.

Una interrupción conserva eventos confirmados y trabajos pendientes. Al reabrir se recupera el estado y se revalida el acceso antes de nuevas inferencias; no se reaplican efectos. La historia permite recorrer escenas/momentos y comparar evolución. El replay reproduce lo guardado, sin volver a llamar modelos, tools o TTS ni introducir recuerdos posteriores.

### 4.4 Validación y estados de la puesta

Esta clasificación es una regla de producto derivada para permitir una preparación completa sin inventar preferencias:

| Campo | Estado para iniciar | Regla |
|---|---|---|
| Nombre/ID de representación | Obligatorio | ID durable generado por host; nombre editable. |
| Fecha/hora ficticia | Obligatorio | Momento válido elegido para la ficción, sin copiar reloj del equipo. |
| Zona horaria/convención de calendario | Derivable por host o editable | Se deriva del lugar cuando corresponde o se declara convención ficticia; se muestra al operador. No bloquea por falta de una selección humana que el host pueda resolver sin cambiar el momento. |
| Lugar y mapa operativo inicial | Obligatorio | Al menos un lugar válido, con ubicación para cada participante y reglas perceptivas explícitas. |
| Continuidad/corte y adaptaciones | Obligatorio | Seleccionar corte o continuidad adaptada declarada; no se deduce de fecha de emisión. |
| Reparto activo y escena inicial | Obligatorio | Al menos un personaje preparado; presencia/posición, contexto autorizado y estado inicial coherentes. |
| Identidad/voz/metas/capacidades por actor | Obligatorio | Núcleo y deseos suficientes para actuar, capacidades/inventario explícitos; puede carecer de habla o elegir silencio. |
| Relaciones y memoria inicial | Estado explícito obligatorio | Se permite lista vacía si se declara y es compatible; cada dato incluido tiene procedencia. Vacío del investigador no impone amnesia. |
| Línea de fondo y propósito | Estado explícito obligatorio | Puede configurarse como exploración abierta/sin conflicto formulado aún, marcado como tal; no requiere desenlace ni vencedor. |
| Reloj, revisión y presupuesto | Obligatorio | Políticas válidas y límite operativo antes de llamadas con coste; defaults se muestran como propuestas editables. |
| Interlocutor humano | Obligatorio antes de hablar | Usa identidad ficticia propia elegida por la persona usuaria, separada del reparto. Nombre, expediente, historia, presencia/canal y audiencia se configuran para la representación; observar no necesita insertar al humano en ficción. |
| Narrador/voz audible/variedad española | Configurables | Narrador y audio se pueden desactivar; idioma español requerido y variedad declarada por puesta, sin atribuir un doblaje exacto. La propuesta editorial puede usarse en texto; antes de preview o síntesis debe confirmarse la variedad. |
| Datos canónicos desconocidos | No inventables como canon | Permanecen vacíos o se incorpora adaptación etiquetada. No se inventan nombres/biografías para pasar validación. |

Guardar un borrador no crea escena, memoria o evento vivido. Inicio inválido muestra los faltantes y no llama al modelo. Las propuestas de Configurador o plantilla se revisan/aceptan o editan en el flujo de puesta; esa confirmación inicial no se repite como permiso por cada turno.

### 4.5 Vistas y permisos del observador

| Superficie | Entrada y acceso | Efecto sobre actores |
|---|---|---|
| Vista escénica inicial | Escenografía, eventos públicos, conversaciones con audiencia/momento y estados de ejecución | Consultar no entrega datos nuevos a actores. |
| Vista interna del observador | Elección explícita visible «ver estado interno», con aviso de secretos; operador autorizado puede consultar memoria/creencias/metas del personaje seleccionado | Inspección no produce percepción ni copia paneles en el prompt. |
| Interlocución | Identidad y canal de ficción configurados; sólo contenido escrito/emitido por humano | Receptores reciben el mensaje como intervención/testimonio, sin certificado de verdad del panel. |
| Dirección/configuración | Modo separado disponible a operador autenticado por host; cambios versionados y autoridad de comando | Sólo circunstancias confirmadas/paquetes autorizados pasan a la ficción; texto no eleva permisos. |
| Biblioteca de investigador | Expedientes, investigaciones, fuentes y canon global para configuración | No es memoria ni contexto automático de ningún actor. |

El operador de la aplicación puede configurar qué vistas ofrece la puesta. La política base inicia en vista escénica; la vista interna exige la elección explícita, no una nueva aprobación por cada consulta. Nunca se muestra razonamiento interno del modelo ni credenciales. Estos defaults son decisiones del proyecto, revisables en configuración.

### 4.6 Controles de ejecución

- **Iniciar/continuar:** validación de puesta y perfil antes de nuevas inferencias; activa planificación y reloj según reglas configuradas.
- **Pausar corrida:** congela reloj ficticio y nuevas convocatorias. Lo ya confirmado permanece; propuestas que retornan en curso quedan pendientes sin efectos hasta reanudar y revalidar revisión/precondiciones. No se publica un borrador por llegar tarde.
- **Avanzar un paso:** desde pausa, procesa un pulso acotado con convocatorias pertinentes y ciclo de revisión/resolución/entregas; termina nuevamente pausado. La UI muestra qué trabajo abarca el pulso. No implica un acto ni un día.
- **Detener:** cancela trabajos LLM pendientes, impide nuevos turnos y congela reloj. Conserva eventos y entregas confirmadas; una continuación posterior recupera sesiones/estado, no reaplica resultados tardíos cancelados.
- **Cerrar:** cancela trabajo no confirmado y finaliza la corrida con registro de cierre; historia y entregas de eventos ya confirmados se conservan. No admite turnos nuevos; otra continuidad o generación requiere nueva corrida/bifurcación identificada.
- **Pausar visor/replay:** detiene sólo reproducción visual de registro, claramente rotulada; no llama ni pausa el runtime por implicación.
- **Fuera de línea:** avance ficticio desactivado por defecto. Habilitar una política de rutinas fuera de línea requiere configuración expresa y eventos con origen sistema, sin atribuir acciones decididas a actores no convocados.

Las entregas mecánicas de eventos confirmados pueden recuperarse en pausa o con OAuth caducado; ello no adelanta reloj ni crea decisiones nuevas. Las llamadas en curso no mantienen transacciones abiertas. La versión de corrida y precondiciones se comprueban antes de cualquier commit posterior.

### 4.7 Comunicación y efectos externos

La comunicación tiene estados distintos: propuesta/borrador → revisión aplicable → resolución del intento → emisión confirmada si corresponde → recepción por audiencia accesible → entrega técnica a memoria/vistas → proyección al observador. Una resolución puede terminar **sin emisión**, por canal/precondición fallidos o resultado sin efecto: se conserva el resultado del intento y su causa, sin frase pronunciada ni memoria de recepción. Si el intento produjo un acontecimiento observable, se registra ese acontecimiento, no una emisión ficticia. Otra resolución puede confirmar **emisión con recepción nula o parcial**: la frase fue emitida pero sólo la audiencia efectiva puede recibirla/recordarla. Aprobación de texto no prueba emisión; emitir no prueba que todos oyeran; una entrega técnica pendiente no se etiqueta recibida. Un canal fallido o audiencia parcial deja resultado explícito. La UI puede mostrar una emisión confirmada con «sin recepción» sin atribuirla como memoria al destinatario. Las acciones no comunicativas y la interlocución humana pueden marcar revisión de contenido no aplicable, conservando autoridad y resolución.

Las tools de personajes sólo observan o producen intentos/efectos dentro del Escenario. No envían mensajes reales, accionan APIs externas arbitrarias, acceden a internet general, shell ni archivos privados. Integraciones de host como login, memoria o TTS tienen catálogo y autorizaciones propios, fuera del actor. TTS procesa diálogo/narración ya publicados y voz seleccionada; no otorga al personaje control sobre credenciales, URLs, facturación o publicación externa. Cualquier ampliación futura de efectos externos exige una configuración administrativa explícita y trazable.

## 5. Requisitos funcionales verificables

Cada ID representa una obligación del producto. Las specs deben asignarle comportamiento, datos, interfaces y pruebas. La ausencia de evidencia de ejecución mantiene el requisito pendiente, aunque exista diseño.

### 5.1 Biblioteca, expedientes y continuidad

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| CAT-01 | Mostrar el corpus versionado actualmente preparado: 27 expedientes individuales, familia y apéndice multipartes, con búsqueda/selección. | Paridad de identidades entre manifiesto de esa versión, fuentes y UI; cada expediente abre completo. La cifra no es un límite del dominio ni del elenco activo. |
| CAT-02 | Conservar ficha, biografía, relaciones, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias. | Vista de secciones y fuentes sin pérdida al importar/exportar; evidencia distinta de adaptación. |
| CAT-03 | Conservar avatar, procedencia, créditos y estado de uso por identidad. | 27 retratos y referencia familiar accesibles; Max y rey no se fusionan; imagen no se anuncia como sprite terminado. |
| CAT-04 | Separar personaje, intérprete humano, alias y actor Pi. | Cambio de intérprete no duplica identidad; alias no se convierte en nombre civil; dos papeles no se fusionan. |
| CAT-05 | Preparar contextos por continuidad y conocimiento permitido. | Contexto inicial no contiene hechos futuros ni expedientes ajenos; fuentes y corte quedan registrados. |
| CAT-06 | Editar versiones de preparación e incorporar adaptaciones explícitas. | Original investigado preservado; autor/motivo/fecha/antes-después de cada adaptación consultables. |
| CAT-07 | Distinguir elegible, preparado, activo/inactivo y fuera de escena. | Catálogo completo no implica presencia ni ejecución de los 27; activación requiere contexto válido. |
| CAT-08 | Promover cambios persistentes de identidad mediante Configurador con evidencia. | Evolución ya vivida conserva efectos; revisión de ficha no borra historia ni transforma una creencia en canon. |
| CAT-09 | Dar acceso navegable a las 16 investigaciones, paper, fuentes, bibliografía y límites de lectura. | Índice completo en biblioteca de investigador/configuración, con enlaces y procedencia; no se entrega ese corpus a los actores. |

### 5.2 Puesta, escenas, Escenario y herramientas

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| ESC-01 | Crear/guardar una puesta con fecha, hora, lugar, continuidad, reparto, conflicto, propósito y reglas. | Validación visible de campos obligatorios; no deducir fecha ficticia del equipo ni de emisión. |
| ESC-02 | Representar lugares conectados, ubicación, puertas, objetos, inventario, posesión y disponibilidad. | Movimiento y uso dependen de reglas/estado; cámara o CSS no alteran estado operativo. |
| ESC-03 | Resolver propuestas antes de confirmar efectos. | Una puerta no se abre por narración; una persuasión no escribe aceptación de otro actor. |
| ESC-04 | Admitir escenas con uno o múltiples personajes y comunicación presencial/remota. | Escena solitaria silenciosa, diálogo de más de dos y entrada tardía sin conocimiento retroactivo. |
| ESC-05 | Definir percepción/audibilidad/alcance por situación y canal. | Secreto detrás de puerta accesible a 99 no se entrega a Max; recepción y audiencia quedan registradas. |
| ESC-06 | Proporcionar capacidades acotadas según personaje, inventario, medio y puesta. | Observar, mover, hablar/emitir, escuchar, tomar/entregar, usar dispositivo, recordar, esperar/descansar y proponer colaboración tienen precondiciones/resultados; tools del actor sólo producen efectos dentro del Escenario. |
| ESC-07 | Mantener límites, preferencias y capacidades como conceptos distintos. | Puede rechazar una acción posible o fracasar en una acción permitida; Fang no recibe habla humana por defecto. |
| ESC-08 | Revalidar propuestas sobre estado obsoleto y resolver conflictos serialmente. | Dos intentos incompatibles sobre un objeto no producen dos posesiones; no se bloquea una transacción mientras espera un LLM. |
| ESC-09 | Registrar objetivos individuales, duraderos/situados y posibles compartidos, con prioridad y revisión. | Objetivo de dirección no se distribuye como deseo secreto universal; ajustes remiten a experiencia. |
| ESC-10 | Guardar cierre de escena/episodio y consecuencias que continúan. | Fin local no exige resolver toda línea; un reinicio o bifurcación se identifica como continuidad distinta. |

### 5.3 Actores Pi, coordinación y coherencia

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| ACT-01 | Usar SDK Pi con una instancia independiente por personaje activo. | IDs de sesión, prompt, contexto, historial y tools distintos durante creación y reanudación. |
| ACT-02 | Conectar mediante login OAuth `openai-codex`. | Flujo de login y estado real de cuenta; refresh/caducidad/cancelación controlados, sin tokens en actor/UI/log de contenido. |
| ACT-03 | Exigir el perfil seleccionado: `gpt-6.1-sol`/`low` o `claude-opus-5-5`/`medium`, solicitado y efectivo. | Creación/reanudación verifica proveedor/modelo/esfuerzo y falla visiblemente si no coincide; no fallback. |
| ACT-04 | Preparar como actores del Método mediante adaptación explícita: identidad, circunstancias, biografía pertinente, memoria, deseos, escucha, relación y táctica ante obstáculos. | Misma petición con cambio de circunstancia/relación/objetivo relevante: evaluar escucha, elección/táctica, voz y consecuencias; no exigir divergencia siempre ni afirmar memoria sentida, conciencia o una única escuela teatral. |
| ACT-05 | Permitir iniciativa, espera, silencio, retirada, engaño y cambio coherente. | El actor elige sus tácticas; coordinador/director no escribe respuestas obligatorias. |
| ACT-06 | Marcar pulsos y convocar sólo instancias pertinentes. | Planificación por acontecimientos/rutinas; pulso, llamada de modelo y hora ficticia distintos; presupuesto respetado. |
| ACT-07 | Revisar versión exacta de respuesta antes de publicar. | Continuista y control de autoridad se refieren al mismo ID/versión; borradores/rechazos no aparecen como diálogo pronunciado. |
| ACT-08 | Reformular desde el mismo actor con feedback filtrado y límite de intentos. | Límite configurable antes de la puesta entre cero y dos reformulaciones, con default dos y techo tres versiones totales adoptado del protocolo actual por el integrador (DP-08); agotamiento queda pendiente técnico, sin respuesta inventada. |
| ACT-09 | Evaluar saber, continuidad, época/lugar, identidad, voz, motivación y ritmo. | Casos Max/Hymie/Fibonacci, 99 que oculta, fanfarronería sin secreto y dispositivo anacrónico con criterios distintos. |
| ACT-10 | Preservar autoridad ante inyección en diálogo, memoria y resultados de tools. | Contenido ficticio no cambia prompt/permisos/base/identidad ni habilita shell, lectura privada o escritura arbitraria. |
| ACT-11 | Gestionar cancelación, timeout, error, rate limit y acceso insuficiente. | Estado diagnóstico y trabajo recuperable; errores de proveedor no se convierten en decisiones ficticias ni en otro modelo. |
| ACT-12 | Aplicar el mismo perfil a todo rol que invoque LLM. | Todo componente que efectivamente infiera —actores, Director, Continuista, Regidor, Configurador, Coordinador y Narrador, según su realización— verifica perfil efectivo requerido. Escenario/resolución y proyecciones mecánicas no necesitan LLM. El observador humano no es un rol de modelo; cualquier asistente LLM del operador se distinguirá y tendrá el mismo perfil. |

### 5.4 Memoria, hechos, persistencia e ICM

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| MEM-01 | Proveer memoria persistente privada por actor mediante la integración ICM Memory/SQLite adoptada para este producto. | Adaptador real almacena/recupera sin cruce de identidades/continuidades; actor no puede seleccionar base/backend, scopes no son permisos. La selección técnica y topología física por corrida se documentan como decisión del proyecto en specs, no como preferencia humana. |
| MEM-02 | Distinguir hechos, percepciones, testimonios, inferencias, creencias y recuerdos. | Mismo evento admite memorias subjetivas distintas; rumor no se confirma al resumirse. |
| MEM-03 | Conservar procedencia, momento de recepción, referencia de evento, confianza y revisiones. | Recuperación/inspección explica cómo se adquirió un dato y preserva negación/incertidumbre. |
| MEM-04 | Recuperar sólo experiencia propia pertinente; controlar selección/resumen/olvido. | Consulta de actor no filtra secretos; olvido activo no borra archivo histórico; reloj real no simula circadianidad. |
| MEM-05 | Mantener una autoridad durable de hechos con eventos ordenados y revisión de estado. | Corrida con ID durable no reciclado; commit atómico; unicidad por corrida+ID base de propuesta/comando autorizado; versión aprobada como atributo, conflicto de versión rechazado y reintento devuelve resultado existente. Reloj/rutinas/control tienen origen humano/sistema propio, no actor inventado. |
| MEM-06 | Entregar eventos a memorias y vistas mediante registros reintentables. | Fallo después de commit no pierde evento; entregas pendientes, fallidas o parciales visibles, deduplicadas por corrida/evento/receptor. Emitido y recibido se distinguen. |
| MEM-07 | Conservar organización ICM Markdown, contratos, referencias y artefactos exportables. | Compilación de contexto usa rutas autorizadas; export/proyecciones no mantienen una segunda verdad conflictiva. |
| MEM-08 | Guardar snapshots, restauración, reanudación y esquema versionado. | Interrupciones antes/después de commit recuperan frontera exacta; backup conserva bases y metadatos coherentes. |
| MEM-09 | Producir vistas históricas y replay sin nuevas ejecuciones. | No nuevas inferencias, acciones de tools o síntesis TTS durante replay; se permite reproducir audio ya almacenado. Sólo conocimiento del momento elegido; caducidad OAuth no impide inspección. |
| MEM-10 | Separar memoria Pi conversacional, experiencia ficticia y archivo de investigador. | Compactación/reanudación no mezcla actores, no filtra hechos futuros y no convierte feedback técnico en recuerdo. |

### 5.5 Tiempo, dirección y narrador

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| DIR-01 | Mantener línea dramática y registrar etapas con evidencia y revisiones. | Etapa remite a eventos/decisiones; no se declara clímax por turnos ni se obliga a tres actos. |
| DIR-02 | Permitir metaindicaciones autorizadas y cambios de circunstancia versionados. | Efectos pasan por Escenario; director no decide deseos privados ni la respuesta de otro. |
| DIR-03 | Ofrecer narrador omnisciente opcional y autorizado. | Canal público separado, estados ficticios tratados como tales; no crea evento ni informa automáticamente al reparto. |
| DIR-04 | Mantener escenas, actos, progresión y formas griegas como dimensiones distinguibles. | Configuración puede usar referencias trágicas/cómicas sin plantilla obligatoria ni resolver conflicto antes de tiempo. |
| TIM-01 | Operar reloj ficticio, día/noche, rutinas y disponibilidad. | Horarios/descanso influyen en encuentros y percepción; no se sincroniza por defecto con equipo o latencia. |
| TIM-02 | Definir inicio/pausa/reanuda/paso/detención y trabajo en curso. | Semántica de §4.6: pausa congela reloj y nuevas convocatorias, conserva trabajo pendiente sin efectos tardíos; paso ejecuta un pulso acotado, detener cancela y preserva, cerrar finaliza sin borrar. |
| TIM-03 | Configurar duración de acciones/escala temporal y avance fuera de línea. | Política explícita por puesta; por defecto no se adelanta historia al cerrar aplicación sin regla habilitada. |
| TIM-04 | Respetar presupuesto de llamadas, tiempo operativo y activación. | Al agotarlo se pausa con diagnóstico; no rebaja perfil ni hace actuar continuamente al catálogo entero. |

### 5.6 Interfaz y participación

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| UI-01 | Recorrido completo de biblioteca, puesta, observación, participación, dirección, control e historia desde GUI. | Prueba de recorrido con aplicación real; editar Markdown no es requisito de uso habitual. |
| UI-02 | Representación visual navegable con personajes/objetos/ubicaciones y movimientos confirmados. | Selección y cambios operativos visibles; leyendas/texto además de color; cámara sin efectos ficticios. |
| UI-03 | Conversaciones en vivo y filtros por escena/personaje/canal/fecha. | Hablante, destinatarios, audiencia, entrega y momento claros; scroll/historia conservan IDs. |
| UI-04 | Hablar con personajes mediante identidad y canal explícitos. | Entrada humana distribuida sólo a receptores; influencia registrada sin obediencia garantizada. |
| UI-05 | Consultar ficha e historia, saber/creer/recordar y evolución con evidencia. | Vista del observador autorizada y diferenciada del actor; compare antes/después sin futuras memorias. |
| UI-06 | Distinguir modos observar/hablar/dirigir y acceso a secretos. | Control fuera del contenido textual, modo visible y mensajes al canal correcto. |
| UI-07 | Exponer borrador/revisión/espera/error/pausa/cancelación como estado técnico separado. | No se disfraza error de silencio ni borrador de palabra pronunciada; rutas de recuperación visibles. |
| UI-08 | Operar mediante teclado y controles etiquetados, texto legible y estados no dependientes sólo de color. | Recorrido con foco visible y labels; mapas acompañados de información accesible de entidades. |
| UI-09 | Consultar y editar configuración, revisar cambios y diagnosticar acceso/perfil desde GUI. | No requiere terminal para preparar/continuar uso normal; no muestra credenciales en contenido. |
| UI-10 | Exportar/importar configuración y consultar historial durable con confirmación de operaciones destructivas. | Import validado/versionado; no sobrescribe otra continuidad ni ejecuta contenido importado como instrucciones administrativas. |
| UI-11 | Mostrar línea dramática, etapas, evidencia, asuntos abiertos y rectificaciones. | Vista del Director fechada, con eventos/personajes relacionados, lectura insuficiente o revisable distinguida de hechos; no obliga al reparto a alcanzar la etapa. |

### 5.7 Español, ritmo y sonido

| ID | Requisito | Evidencia de aceptación requerida |
|---|---|---|
| VOZ-01 | Actuar en español de doblaje con voz textual diferenciada. | Respuestas situadas, vocabulario/tratamiento por personaje; variedad seleccionada explícitamente. |
| VOZ-02 | Regular extensión, pausa, interrupción, silencio y acción según función dramática. | Política configurable y ensayos etiquetados; no cifras supuestamente medidas sin audio anotado. |
| VOZ-03 | Mantener y consultar una receta documentada ElevenLabs por identidad del corpus. | Cobertura de recetas y muestras propuestas, incluida Fang como efectos, sin habla humana; receta no exige preview, voz guardada ni audio por cada personaje. |
| VOZ-04 | Incluir capacidad de síntesis/reproducción ElevenLabs con voz seleccionada y subtítulos, desactivable por puesta. | Adaptador configurable, ID/idioma/modelo y variedad confirmada validados; audio asociado a diálogo/narración publicados y estados visibles, con convención seleccionada comprobada en preview/síntesis. Capacidad incluida por decisión del integrador; desactivarla en una puesta no la excluye del producto ni prueba su integración live. |
| VOZ-05 | Permitir desactivar audio y mantener acceso textual completo. | Ausencia de key/voz o fallo TTS no fabrica audio, no reejecuta actuación ni pierde diálogo. |
| VOZ-06 | Conservar investigación/calibración del ritmo y corpus elegido. | Inventario y anotaciones accesibles; escucha/cotejo pendientes no se dan por terminados mediante un contador de palabras. |
| VOZ-07 | Ofrecer configuración de voz y solicitudes administrativas de preview/selección/guardado. | Capacidad de producto adoptada por el integrador: solicitud explícita, credenciales de host, variedad confirmada y muestra provista/seleccionada; propuesta regional no confirmada bloquea preview/síntesis, resultado verificable y elección antes de guardar; no crear automáticamente voces para todo el corpus. |

## 6. Invariantes transversales

1. **Agencia:** la instancia privada del actor propone decisiones; coordinador/director/regidor no decide por él para cumplir argumento.
2. **Conocimiento situado:** contexto y tools limitados antes de inferencia, no un prompt global que diga fingir desconocimiento.
3. **Autoridad:** sólo el Escenario confirma efectos compartidos; un texto, una animación, un narrador o una tool declarativa no reemplaza resolución.
4. **Publicación:** versión exacta revisada y registro durable antes de considerar un diálogo pronunciado; un efecto físico, la publicación de palabras, audio y memoria son registros relacionados pero distintos.
5. **Idempotencia:** una propuesta base produce como máximo su efecto confirmado; entregas/reintentos no duplican diálogo, memoria, reloj o audio.
6. **Procedencia:** hechos y experiencias conservan origen y tiempo; corregir deja rastro; creencia no se promueve a verdad por resumen.
7. **Privacidad:** contextos, memorias y feedback separados; secretos de proveedor fuera de prompts, repo, export y logs de contenido.
8. **Perfil explícito:** el proveedor, modelo y esfuerzo elegidos se conservan al crear y reanudar cualquier rol LLM; Codex exige OAuth, Anthropic credencial propia. Incompatibilidad visible, sin sustitución.
9. **Historia:** replay de salidas guardadas; una nueva generación pertenece a nueva operación/corrida, no reescribe el pasado.
10. **Honestidad de estado:** documentación, mocks, receta, login, llamada real, voz guardada, audio y aplicación tienen evidencias distintas.

## 7. Requisitos no funcionales y operación

| ID | Requisito | Criterio |
|---|---|---|
| NFR-01 | Dominio compuesto de objetos y mensajes, también mensajes como objetos, sin herencia propia. | Revisión de código y tipos; librerías externas pueden conservar implementación interna. |
| NFR-02 | Datos externos validados en fronteras y estados imposibles evitados. | Schemas/uniones discriminadas, IDs relacionados y migraciones; inputs inválidos no ejecutan efectos. |
| NFR-03 | Persistencia local durable y recuperación comprobada. | Pruebas reales de transacciones, interrupciones, deduplicación, backups y restauración; no sólo tests con mocks. |
| NFR-04 | Fallos aislados y diagnósticos trazables. | IDs de corrida/actor/propuesta/evento permiten relacionar estados; logs no contienen tokens ni razonamiento interno. |
| NFR-05 | UI permanece operable mientras hay inferencia. | Acceso a historial/configuración/pausa durante trabajos en curso; indicadores de latencia real sin confundirla con tiempo ficticio. |
| NFR-06 | Coste y activación controlables. | Configuración previa de límites, contador observado y pausa al agotarlos; mediciones del proveedor pendientes no se inventan. |
| NFR-07 | Dependencias/versiones y ejecución reproducibles. | Lockfile, scripts de desarrollo/build/tests, requisitos de host y guía de operación que funcionen. |
| NFR-08 | Recursos y fuentes con procedencia. | Fotos/paper/skills retienen condiciones propias; arte final no se declara libre sin evidencia. |
| NFR-09 | Separación servidor/cliente y acceso de control. | Credenciales sólo host; endpoint/cookie/control impiden elevar rol desde diálogo o import; exposición pública no activada por defecto. |
| NFR-10 | Calidad revisada por escenario completo. | Tests de dominio/integración, uso de GUI real y pruebas live cuando haya acceso; cobertura requisito por requisito. |

## 8. Decisiones configurables y técnicas

La [matriz de decisiones](diseno/decisiones-abiertas.md) conserva D01–D30. Para construir el producto no se exige resolverlas todas como preferencias humanas: las de puesta se expresan como campos/validaciones; las técnicas reciben decisiones de implementación y criterios de prueba. Estas propuestas no cambian requisitos expresos.

| Grupo | Tratamiento para la implementación |
|---|---|
| D01–D07: continuidad, reparto, conflicto, metas, cierre, adaptación y escenas | Configuración versionada y editable; validación antes de actuar; originales y evolución preservados. |
| D08–D12: foco, participante, vistas, dirección y narrador | Canales y vistas explícitas; escena solitaria/múltiple; narrador desactivable; concurrencia no mezcla tiempos o saberes. |
| D13–D17: revisión, reformulación, herramientas y efectos | Estados, autoridad, versiones, límite actual de intentos y resolución; ninguna aprobación humana rutinaria por turno. |
| D18–D23: variedad, sonido, ritmo, motor, espacio y arte | Español requerido; variedad/voz/mapa configurables; capa visual completa elegida por specs; calibración con estado de evidencia. |
| D24–D30: despliegue, persistencia, memoria, recovery, tiempo, presupuesto y vistas | Instancias privadas y perfil fijo; fuente de verdad definida, adaptadores reales, reloj explícito, límites y proyecciones históricas. |

Las specs deberán explicar especialmente autoridad durable, frontera ICM/SQLite/Markdown, login y contextos Pi, motor visual, pausa/cancelación, compilación de continuidad, evolución de ficha y configuración sonora. El producto no se declara terminado si esos puntos siguen sólo como hipótesis sin comportamiento implementado.

## 9. Plan de pruebas y cierre de producto

Los siguientes ensayos deben enlazarse con requisitos y ejecutarse contra el alcance correspondiente:

| ID | Ensayo | Requisitos cubiertos | Clase de evidencia | Resultado requerido |
|---|---|---|---|---|
| P01 | Biblioteca y recursos | CAT-01, CAT-02, CAT-03, CAT-04, CAT-09, NFR-08 | Revisión de recursos + GUI | 27 expedientes/apéndices, 16 investigaciones, fuentes/paper y 28 avatares navegables; alias/intérpretes y procedencia conservados. |
| P02 | Canon y preparación | CAT-05, CAT-06, CAT-07, MEM-10, ACT-09 | Dominio + GUI + actuación live | Max antes de matrimonio/hijos no recuerda futuro; nombre civil de 99/gemelos no comprobado no produce amnesia artificial; adaptación versionada. |
| P03 | Puesta e inicio | ESC-01, CAT-07, UI-01, UI-09, NFR-02 | E2E GUI + preflight real | Sin lugar/reparto no inicia ni llama modelo; borrador no crea historia; preparación completa inicia desde controles. |
| P04 | Escena solitaria | ESC-04, ACT-05, ESC-10 | Dominio + GUI + Pi live | Acción/espera silenciosa con consecuencias, sin fabricar interlocutor ni narración. |
| P05 | Conversación múltiple | ESC-04, ESC-05, UI-03, UI-04, VOZ-01 | Integración + GUI + Pi live | Tres participantes, audiencias y entrada tardía correctas; convención española declarada, propuesta editorial etiquetada hasta elección y voz situada; recepción parcial etiquetada. |
| P06 | Perspectivas y secretos | ESC-05, MEM-02, MEM-03, MEM-04, MEM-10, ACT-10, UI-05, UI-06 | Integración + GUI + Pi live | Observador inspecciona secreto de 99, Max no lo recibe; al contarlo recibe sólo testimonio con procedencia. |
| P07 | Fibonacci y coherencia | ACT-09, VOZ-01 | Revisión de casos + Pi live | Max/Hymie reaccionan según saberes/motivos y convención de español declarada sin profesor universal ni anacronismo falso; una propuesta de variedad no aparece como elección humana; no exigir frase única. |
| P08 | Método y agencia | ACT-04, ACT-05, ESC-09 | Casos comparados + Pi live | Varias situaciones y más de una secuencia multivuelta por personaje evaluado; comparar relación/circunstancia/objetivo, biografía pertinente, escucha, táctica, voz, consecuencias y continuidad mediante rúbrica documentada. Una consecuencia puede o no modificar razonablemente la táctica posterior; no exigir frase única, divergencia ni transformación en todos los casos. |
| P09 | Herramientas y espacio | ESC-02, ESC-03, ESC-06, ESC-07, ESC-08, UI-02 | Dominio + integración + GUI | Puerta/alcance/posesión/canal restringen; Fang no habla humano; dos intentos por objeto revalidan; cámara no mueve objetos. |
| P10 | Revisión/publicación | ACT-07, ACT-08, ACT-09, ESC-05, UI-07 | Integración real local + GUI | Versión exacta; probar default dos reformulaciones/tres versiones y reducción configurada a cero o una reformulación (una o dos versiones); rechazar valores sobre el techo; incompleta no aprueba; resolución sin emisión/canal fallido probada aparte de emisión con recepción nula/parcial; entrega/proyección distinguidas, feedback sin secreto. |
| P11 | Inyección y efecto externo | ACT-10, NFR-02, NFR-09 | Integración host + casos live | Texto/import/memoria no altera rol/base/prompt; tool ficticia no emite HTTP/mensaje real; controles de host probados. |
| P12 | ICM Memory | MEM-01, MEM-02, MEM-03, MEM-04, MEM-06, MEM-10, NFR-03 | CLI ICM y SQLite reales | Almacena/recupera español, negación y revisiones; base/backend por actor fijados; resumen/olvido no confirman rumores ni borran historia. |
| P13 | Commit e idempotencia | MEM-05, MEM-06, ESC-08, NFR-03 | SQLite real + interrupciones | Una clave por corrida/propuesta/comando; versión conflictiva rechazada, origen sistema explícito, efecto y entregas únicas. |
| P14 | Recuperación y backups | MEM-08, MEM-07, ACT-11, NFR-03, NFR-04 | Integración disco real | Interrumpir antes/después de commit/entrega y restaurar backup recupera frontera, pendientes y sesiones asociadas. |
| P15 | Historia y acceso vencido | MEM-09, UI-03, UI-05, ACT-11 | Integración + GUI | Replay sin nuevas inferencias/acciones/síntesis ni memorias futuras, con reproducción de audio almacenado; OAuth vencido bloquea nuevas inferencias, no biblioteca/replay/entrega mecánica. |
| P16 | Reloj y controles | TIM-01, TIM-02, TIM-03, ACT-06 | Dominio + integración + GUI | Rutinas/horario cambian disponibilidad; retorno durante pausa no afecta; paso acotado y cierre con trabajos en curso preservan historia. |
| P17 | Presupuesto y fallos | TIM-04, ACT-06, ACT-11, NFR-05, NFR-06 | Integración + GUI + medición live | Límites pausan; timeout/rate-limit/cancelación visibles y recuperables; UI operable, perfil sin fallback. |
| P18 | Pi/OAuth/perfil | ACT-01, ACT-02, ACT-03, ACT-12, NFR-07 | SDK real + proveedor/cuenta real | Login/cancelación/refresh, instancias independientes y perfil efectivo de todo rol LLM en crear/reanudar; sin credencial no pasa. |
| P19 | Dirección y dramaturgia | DIR-01, DIR-02, DIR-04, UI-11, UI-06, ESC-10 | Dominio + GUI + Director live | Circunstancia resuelta, etapas/evidencia/insuficiencia/rectificación visibles; rechazo no fuerza giro, actos distintos de etapas. |
| P20 | Narrador | DIR-03, VOZ-04, VOZ-05 | Integración + GUI + live si habilitado | Interioridad autorizada al público, no razonamiento ni percepción automática; no crea hechos, narración apagable. |
| P21 | Voces y ritmo | VOZ-01, VOZ-02, VOZ-03, VOZ-04, VOZ-05, VOZ-06, VOZ-07, NFR-08 | Adaptador + GUI + ElevenLabs real + corpus audiovisual | Parte de contenido/local: recetas completas, validación del adaptador, estados/errores, audio desactivado, reintentos sin nueva actuación, texto/subtítulos intactos. Precondición local y live: variedad confirmada antes de preview/síntesis; propuesta no confirmada bloquea llamada. Parte live: solicitud administrativa explícita de preview, elección/guardado y síntesis con cuenta/voz reales y convención española seleccionada comprobada; Fang efectos aparte. Calibración: escucha/anotación real del corpus. Cada parte conserva evidencia y estado propios. |
| P22 | Evolución e identidad | CAT-08, ESC-09, UI-05 | Dominio + GUI + Pi live | Cambio con experiencia, relaciones asimétricas, promoción Configurador y versiones sin borrar original. |
| P23 | Interfaz y accesibilidad | UI-01, UI-02, UI-08, NFR-05 | E2E GUI real + teclado/visual | Recorrido completo, labels/foco/texto legible, mapa con alternativa accesible, controles mientras espera inferencia. |
| P24 | Intercambio ICM | UI-10, MEM-07, MEM-08, CAT-02, CAT-06, NFR-02 | Filesystem/SQLite reales + GUI | Import/export versionado con ida/vuelta que compara todos los campos del expediente: ficha, biografía, vínculos, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias; proyecciones Markdown regenerables, sin sobrescritura silenciosa ni segunda verdad. |
| P25 | Arquitectura y operación | NFR-01, NFR-02, NFR-04, NFR-07, NFR-09, NFR-10, UI-09 | Revisión código + build/tests + operación limpia | Composición, límites validados, diagnósticos sin secretos, scripts/lockfile reales y auditoría por requisito. |

La [matriz requisito→ensayo](auditoria/trazabilidad-prd.md) enumera cada ID individual, su fuente, ensayos y estado de evidencia. Todos están **pendientes de implementación/verificación**; ninguna fila de esta tabla es un resultado aprobado. Pruebas unitarias o adaptadores simulados sólo demuestran su alcance local. P18 y las partes live de otros ensayos necesitan cuenta/acceso real; P21/calibración necesita audio interpretable y anotado. La falta de esas evidencias mantiene el cierre del producto abierto, sin bloquear desarrollo independiente.

**Cierre de capacidades sonoras.** Las recetas son un requisito expreso ya documentado; consulta y paridad de corpus se prueban sin crear voces. El flujo administrativo de creación y el adaptador TTS pertenecen al alcance de este producto por decisión del integrador (DP-02), aunque cada puesta pueda apagarlos. Validación local de schemas, errores, reintentos, texto y reproducción con artefactos de prueba no acredita una llamada ElevenLabs real. La prueba live de creación/selección/síntesis con credenciales y resultados verificables mantiene esa capacidad pendiente hasta ejecutarse. Apagarla en una puesta permite usar esa representación textual/visual, pero no convierte en completo el objetivo global ni elimina esa prueba. No se crean todas las voces ni se clona un intérprete para pasar un test.

Para considerar **PRD revisado**, no quedan requisitos expresos sin ubicación ni contradicciones de alcance; cada requisito tiene aceptación y dependencia. Para considerar **specs revisadas**, todos los IDs tienen modelo/datos/contrato/prueba aplicables y se resolvieron las elecciones técnicas necesarias. Para considerar **implementación terminada**, cada ID tiene evidencia suficiente del código y comportamiento actual, pruebas apropiadas y recorrido GUI; los mocks no certifican acceso live ni fidelidad acústica. Una dependencia externa sin validar mantiene el cierre global abierto y se registra con precisión.

## 10. Riesgos, evidencia pendiente y revisión

El audio de YouTube localizado no se escuchó ni midió: calibración sigue pendiente. Los dossiers no constituyen visionado integral de 138 episodios; contradicciones relevantes para una puesta requieren cotejo específico o adaptación declarada. Pi/ICM/TTS requieren verificación de versión, acceso y funcionamiento reales. Un prompt no garantiza aislamiento ni fidelidad; controles de host y ensayos multivuelta deben probarse.

Se revisará este PRD mediante lectura de autores/custodio y casos adversos; se registrarán versión, hallazgo, cambio y resultado en auditoría. Las specs y la implementación repetirán el mismo ciclo hasta que no queden requisitos incumplidos o sin prueba suficiente. El [estado del objetivo](auditoria/objetivo-y-progreso.md) conservará evidencias y pendientes sin redefinir el alcance alrededor de lo ya construido.
