# Auditoría de lectura del PRD y contratos de obra

Fecha de lectura: 14 de octubre de 2026. Alcance: todos los Markdown bajo obra, excepto obra/personajes/**, reservado a la revisión de expedientes individuales de otro agente. Leí cada archivo de este alcance uno por uno y de principio a fin, incluidos contextos, referencias, plantillas, registros de estado y salidas iniciales; los comentarios de la tabla son conclusiones de contenido. Las huellas SHA-256 identifican la versión de bytes examinada, pero por sí solas no prueban lectura ni validación semántica. También leí como contexto README.md, docs/README.md, docs/constitucion.md y GLOSSARY.md, además de las instrucciones de AGENTS.md suministradas por el usuario.

No inicié ni simulé una escena. Los registros que dicen vacío o no iniciado siguen así. La inspección de enlaces locales Markdown encontró 0 destinos faltantes entre los 73 archivos incluidos. Este documento es el único archivo producido por esta auditoría.

## Síntesis de requisitos del producto

La carpeta obra es un PRD operativo para una obra de ficción con interfaz gráfica completa, principalmente funcional y visual. El usuario debe preparar una puesta, entender el escenario, seleccionar personajes, conversar e influir, seguir evolución, operar pulsos y consultar la historia desde controles visibles. Navegar Markdown no satisface la interfaz.

Cada personaje necesita una instancia Pi distinta con contexto, prompt, sesión, historial, memoria y herramientas separados. Los roles agénticos usan openai-codex mediante login OAuth, gpt-6-luna y xhigh; el runtime debe verificar el perfil efectivo y dejar el trabajo pendiente si no puede cumplirlo. No hay fallback silencioso. Compartir un login del host no comparte identidades ni historias. Los permisos reales dependen del host, no de carpetas o prompts.

El dominio distingue Escenario como autoridad de los hechos, escenografía como presentación visual y escena como unidad de acción con uno o más personajes. La propuesta de un actor no es un hecho. Sólo Escenario confirma resultado, duración y efectos; luego distribuye percepciones por canal y destinatario. Cada actor conserva creencias y recuerdos con procedencia, que pueden ser erróneos y cambiar sin editar retrospectivamente el acontecimiento.

El Coordinador marca el pulso, activa instancias pertinentes y organiza el orden; no elige objetivos ni respuestas. Regidor controla canal, capacidad y autoridad; Continuista evalúa acceso al conocimiento, continuidad, identidad, voz y versión exacta; Director interpreta progreso dramático por evidencia. Sus responsabilidades pueden compartir una instancia de control, pero ningún rol reutiliza la sesión de un personaje.

La forma ordinaria del turno es: setup → percepción → actuación → moderación → resolución → distribución → memoria individual → dirección → observación. La voz en off es una rama opcional posterior a hechos confirmados, dirigida a espectadores, con controles propios; no crea eventos ni se distribuye a personajes. Una escena solitaria, silenciosa o sin narración sigue siendo válida.

La interfaz debe conservar vistas pública/interna explícita, hechos/creencias, versiones propuestas/publicadas y presente/historia. Inspeccionar el panel no informa a personajes. Intervenciones humanas tienen canal de observación, interlocución o dirección. El texto de una intervención no cambia su canal ni su autoridad; persuasión y engaño ficticios sí pueden influir legítimamente.

## Autoridad, ciclo, idempotencia y privacidad

La autoridad de escritura se asigna por rol: Configurador prepara puesta e identidad; Coordinador administra cursor, pulsos y manifiestos; Escenario escribe estado/eventos y entregas; cada actor escribe propuesta, estado y memoria propios; Regidor escribe veredictos; Continuista revisiones; Director etapas/intervenciones; Narrador borradores; Observador proyecciones/publicaciones. El Coordinador mantiene los manifiestos de etapa y no copia secretos o recuerdos en ellos. No se permiten dos escritores simultáneos sobre el mismo estado o sesión de actor.

Una propuesta usa ID base por turno/actor y versiones inmutables. La admisión del Regidor y el permiso del Continuista deben referir al mismo texto exacto. Hasta dos reformulaciones automáticas mantienen el ID base; rechazo cierra sin evento y revisión incompleta no avanza. El límite es del protocolo del workspace, no del canon ni de ICM. El narrador tiene IDs nar separados de evt y su propia revisión/publicación idempotente.

Antes de resolver, Escenario busca un evento por ID base, comprueba controles y revalida condiciones frente al último estado. El evento queda preparado, se aplica y confirma; una interrupción debe reanudarse verificando el último evento aplicado. Distribución, memorias y proyecciones consumen eventos confirmados y registran IDs para reintentos sin duplicados. El diseño reconoce que Markdown no ofrece transacciones: para ejecución durable o concurrente propone un solo journal SQLite como autoridad de hechos, con vistas reconstruibles; esa decisión aún está abierta.

La privacidad depende de paquetes filtrados, herramientas acotadas y rutas fijadas por el host. Un actor no recibe estado global, dirección secreta, sesiones o memorias ajenas ni herramientas de mantenimiento. Continuista, Regidor y narrador no reciben cadenas de pensamiento privadas como material diegético. El observador puede tener una vista interna explícita sin convertirla en conocimiento de actores. La autenticación se guarda fuera de prompts, Markdown, bases de memoria y snapshots.

## Hallazgos de consistencia y vacíos para implementar

No encontré contradicciones sustantivas entre los contratos de las ocho etapas, el glosario operativo y las reglas de autoridad. Hay una diferencia deliberada de aplicabilidad: respuestas comunicativas de personajes requieren revisión de Regidor y Continuista; acciones no comunicativas y la intervención humana de interlocución pueden marcar la revisión de respuesta como no aplicable, pero conservan el control de autoridad, capacidad y resolución del Escenario. Eso permite un ciclo coherente.

Los principales vacíos son decisiones abiertas, no requisitos que el agente de implementación pueda inventar como si fueran elecciones humanas: continuidad/fecha/lugar/conflicto de la primera puesta; stack y arte definitivo; semántica de pausa, reloj y simultaneidad; capacidades e inventarios por personaje; variedad del español; presupuestos de llamadas; fuente persistente autoritativa y política de memoria/olvido. La app puede construirse con pantallas de configuración y estados pendientes, pero no afirmar que una puesta real está preparada sin esos valores.

El proceso para promover cambios de identidad estable necesita una transición explícita: la actuación puede evolucionar metas, creencias y relaciones en estado/memoria propios, mientras el actor no puede editar su núcleo estable; D06 deja abierta la política de aceptación y promoción por el Configurador. La implementación debe representar propuesta, evidencia, revisión, nueva versión de identidad y conservación del original.

El contrato de evento exige origen y resolución idempotente, pero algunos eventos de reloj/rutina o control pueden no provenir de una propuesta de personaje. La integración deberá identificarlos como comando autorizado con ID estable y procedencia, sin convertir una rutina automática en acción atribuida a un actor. El mundo durable requiere commit que cubra evento y proyección, y una cola de entregas reintentables. El propio diseño advierte que edición de archivos Markdown no da esas garantías.

Las reglas de concurrencia permiten generar propuestas desde la misma revisión y resolverlas serialmente, con revalidación de precondiciones. Una UI debe exponer espera, error, cancelación, revisión incompleta y propuesta pendiente por separado de silencio elegido. La primera integración puede operar secuencialmente; no debe simular paralelismo ni pausa del mundo sin definirlo.

No está conectado Pi, no se autenticó OAuth, no se ejecutó una sesión, no hay GUI, base SQLite, TTS ni representación. El estado de estos elementos debe seguir visible y verificable. Los contratos incluyen 40 criterios de verificación conceptual y adicionales de interfaz/arquitectura, pero esta auditoría no los ejecutó como pruebas de runtime.

## Registro por archivo

SHA-256 se calcula sobre el archivo completo en bytes. Cada conclusión resume lo leído en el archivo indicado.

### Ruteo e instrucciones

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/AGENTS.md | 4fb8150e342174e8682dfb2ca7069fd77e6788a4a0a9be0591d0d92b405e9095 | Limita la carga de contexto al contrato pertinente; los documentos de investigación no son conocimiento diegético. Exige instancias independientes, controles de revisión y no inventar sucesos para completar archivos. |
| obra/CONTEXT.md | 5f370e7572590fe1fea9c339a65499a898d86e19726058c3abaa2d6eae6f0600 | Rutea cada tarea a sus contratos y define como estado inicial que la continuidad y las sesiones no están preparadas ni conectadas. |
| obra/README.md | f96697b748cec96cebb3ce6dda6b3731eb45f3bf4cc96261d43a856397db1134 | Resume el workspace documental, perfil Luna 6 xhigh con OAuth Codex, preparación pendiente y los límites de ICM, memoria, interfaz y audio. |

### Configuración

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/_config/agentes.md | b22a8194b644bdfa498f8b11e154c4d61d3cb9e276b22ebffbbc2615178126f0 | Fija openai-codex por login OAuth, gpt-6-luna y xhigh para los roles agénticos; no permite fallback y no afirma login ejecutado. |
| obra/_config/autoridades.md | 89c7ec441a9d424fb84ed8f4aef1075db0f9f3cc4c21e4480e6626caf927672c | Asigna escrituras por responsabilidad, impide escrituras concurrentes y deja claro que Markdown no aplica permisos. Actor edita estado/memoria propios, no su núcleo estable. |
| obra/_config/continuidad.md | 9e74ce756afaf8cadd090aef015437708d14b726388a159bb59b7cc201bf1da1 | La puesta está sin preparar: corte, fecha, lugar, hechos, elenco, situación, metas y reglas iniciales siguen pendientes. |
| obra/_config/instancias-pi.md | 1d56f38e8681fb5f6a829b4647fa17cf0468b7f8a45cd318ff37cf45fe580555 | Exige una instancia y sesión Pi por personaje, activación selectiva por pulso y contextos/herramientas/memorias independientes; proceso del SO queda abierto. |
| obra/_config/narracion.md | dec0d50f3f0834e0cbc426618aad227b21b59e13307ec889f7281b4c1230d2ed | Narrador opcional para espectadores, sin audibilidad diegética; fuentes limitadas y sin razonamiento interno del modelo. |
| obra/_config/voz-y-ritmo.md | 42b425bfe0349cbe4e212f50295548aefb4340372a3e1d0e540bcf8df7f5f4b8 | Fija español de doblaje y pautas cualitativas de actuación, deja variedad sin elegir y separa ritmo dramático, reloj diegético y latencia. |

### Roles de coordinación, control y dirección

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/coordinador/CONTEXT.md | 86716ed3347acc8572df9263cbc5cdb3abd4cb4399c4a5aee8242d9306f6a7f8 | Coordinador activa actores, sigue cursor, organiza controles, resolución serial y cierres; no decide respuestas ni metas privadas. |
| obra/continuista/CONTEXT.md | 99073411d2e98ebb7b0bd60aa70be1d2ea45dfba13cf9853106dd09c27d2ea0a | Continuista revisa una versión exacta por conocimiento, tiempo, voz e identidad; permite, pide reformular, rechaza o queda incompleto. |
| obra/continuista/references/criterios.md | 2223d0a739485b2d935d2aad128c0c0e80faa9f3c94ee47160a4c06fd19abdf9 | Detalla acceso al conocimiento, cambio de identidad, indicaciones autorizadas, resultados de revisión y fixtures conceptuales, incluidos engaño y Fibonacci. |
| obra/direccion/CONTEXT.md | edc55332d4b914261c2f9ad8ffa66a824abf9f0cd3c3a4689d9343eb24af7467 | Director evalúa etapas a partir de eventos confirmados y puede proponer circunstancias que deben resolverse como hechos separados. |
| obra/direccion/references/linea-dramatica.md | 3febb4959306843413faceb7d96bb08fc34314d161c1e54a4d2a9ccdfb6e5f7a | Define evidencia para planteamiento, desarrollo, clímax y desenlace sin barras por cantidad de turnos ni estructura fija de actos. |
| obra/direccion/output/etapas.md | ffea92064a47cc94817f78b58f69a9a53c3ce0df05eacf4ea4d0f60464d44987 | Estado inicial sin representación; tabla de progreso y revisiones conserva lecturas anteriores. |
| obra/direccion/output/intervenciones.md | 7ebebdc55029f3cca30200a9016a42689a5c07563977175e4e620b57f72c7860 | No hay intervenciones directoriales; las futuras requieren motivo, destinatario técnico y evento de aplicación. |

### Escenario y estado de puesta

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/escenario/CONTEXT.md | 62299a24924c94d91e482177523b675ac8d485659ffec9c9d4ab2d5f71bf54d3 | Escenario es autoridad única de hechos compartidos y reloj; recibe sólo estado pertinente y resoluciones admitidas. |
| obra/escenario/references/reglas.md | a1a033389d8e05823010fb94751f627db0b4419bc15e74e663070481aba9d3ea | Fija causalidad, canales, tiempo diegético independiente y rutinas; el reloj está detenido hasta configurar escala y duración. |
| obra/escenario/output/estado.md | e65a66453c79503a295d19a1eddaad8167e091853ab0ae572e9ecc8def261d72 | Estado no inicializado, fecha/hora y lugares vacíos, contador de evento en 1 y reloj detenido. |
| obra/escenario/output/eventos.md | 0923cd21c20f04774eeb7fe043a8c9e26f63b2e637a682c7223b3697b653ad96 | Registro autoritativo vacío; sólo eventos confirmados se distribuyen y usa la plantilla de evento. |

### Interfaz gráfica

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/interfaz/CONTEXT.md | ae7d135c49b7a5324b9c071fcd58a84366dac4096c1e2d9dfada13a87677555e | La interfaz completa, principalmente funcional y visual, es requisito; sólo existe contrato, sin aplicación ni runtime conectado. |
| obra/interfaz/references/contrato.md | c2cc56f02c6b8b22ed17c524d12fed29b352cd1ddcea735142e804531c0c2123 | Especifica preparación, mapa/escenografía, conversación, evolución, historia temporal, controles y estados fallidos; uso habitual no debe exigir editar Markdown. |

### Narrador y publicación de voz en off

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/narrador/CONTEXT.md | 208088cacd12b98e3a3dfe2701f3fc14128e64e658022a66652708fb2fc4c7f2 | Rama opcional después de hechos confirmados; el narrador entrega borrador para doble revisión y el Observador publica la versión exacta. |
| obra/narrador/references/protocolo.md | befbd0e847915106ce8628c5616d1c9a5448b7a7b01cc86b2f7448f619a1bc70 | Define IDs nar, versiones inmutables, límites de fuentes, doble control, hasta dos reformulaciones y publicación idempotente sin evento ni entrega a personajes. |
| obra/narrador/output/bandeja.md | e6547c5f4622355dc3584f660f9902af7220b67feca8f34b497953c1bd1568b1 | Bandeja vacía y contador nar; una solicitud no prueba producción o publicación. |
| obra/narrador/output/borradores.md | 1f4232acb1198a1a472284753cf9a86e6f8b02f8f3b91d3a7d2aa5cdf676a4a5 | No hay texto generado; autoridad del Narrador y versiones inmutables. |
| obra/narrador/output/narracion.md | 77c3e2b69eb3b39966920b2d07bf827388225869955541f69a467ee02fedd006 | No hay narración publicada; sólo Observador puede publicar con controles y fuentes. |
| obra/narrador/output/revisiones.md | 21e3a24ec4fe1b0563f740f13f75c08075b962a0d7df53e9024cae31ba656860 | No hay decisiones; Continuista debe registrar fuentes y no filtrar razonamiento privado. |
| obra/narrador/output/veredictos.md | 55b8d9d968aa3d6c8bdf471293d70d678f22acc0fcfcd92f81d609d23e385204 | No hay veredictos; Regidor controla canal y audiencia de espectadores. |

### Observación y proyecciones

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/observacion/CONTEXT.md | d5e1c2add0032d86b977de57dfb8df3bee55eaa91bdba335a54a1999bde9e23c | Observador proyecta hechos confirmados, evolución y dirección con vistas separadas; la proyección no modifica el mundo. |
| obra/observacion/output/conversaciones.md | 6b59b62cf6672e34740a1cefa1490af76447e484230875dc13ed950529d54f79 | Vacío; futuras entradas sólo vienen de eventos confirmados e identifican emisor, receptores, canal y tiempo. |
| obra/observacion/output/evolucion.md | 7b707e98011854c0a144c8f33a0cba663088bafcacf0e51fe434e91f7aeb1018 | Vacío; los cambios se muestran con evidencia y separan vista interna del conocimiento de otros actores. |
| obra/observacion/output/panel.md | 99d595ff961c49c87d2501d4fa3bc79283a80ba817456653449ae707b0adef51 | Panel documental marca representación sin iniciar, sin escena, reparto ni narración. |

### Cursores y participación

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/output/ejecucion.md | 904a3890b8d0a478061b9c803a385ce2713886648c0fabbc2421a2d7b22dd7de | Cursor está en setup; no hay turno, actor, pulso ni evento activos. |
| obra/output/pulsos.md | e9c8d3f2c675239a4dad928fdf3f55d146d904286551aab0c3926a2b24051716 | Sin pulsos ni sesiones iniciadas; registros futuros identifican instancias por slug sin copiar historiales. |
| obra/participacion/CONTEXT.md | 479635d2df6e9748466945ca7f119a44db355018b1809203f96d1b42b9fbd47c | Distingue observador, interlocutor y dirección por origen/canal; una frase no puede autoelevar autoridad. |
| obra/participacion/output/entrada.md | 8bc0344f36f454de13acdc8411b97840b13479c7dcbb0a9d7709def6ef04754e | Sin participante o entrada humana configurados; mensajes de diseño no son diálogo ficticio. |
| obra/participacion/output/salida.md | 154559ec8852ec14de5472df1050d8a4f51f7f54f1f3b098d72ee84cc684e2d2 | Vacía; sólo registra respuestas realmente emitidas y recibidas con ID de evento e hilo. |

### Referencias de operación

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/references/ciclo.md | bc0cf9e11552ef6e6fc4773cbfddc3fafa45b57f7ec13bd83ce03fd6b2111f20 | Define el ciclo de ocho etapas, IDs, orden serial, reanudación y cómo evitar eventos duplicados; narración es una rama opcional. |
| obra/references/escenario-y-escenografia.md | 935cc0424d206c331bc99920abc251932223f0e277ce674648eeb5e843d29db3 | Glosario operativo: Escenario autoritativo, escenografía visual y escena con uno o más personajes. |
| obra/references/escenas.md | 1b40778eea7e1d4b72e555a37346670b933fcc1a6067649f82c60fb9c1d4c136 | Permite escena individual, acción, espera o silencio; narración opcional no añade reparto ni habilita diálogo. |
| obra/references/herramientas.md | b204a3e10b0214913d7262ce8ebe54e4e7ce0a8a4ee31067f7f8be1f6d19cc62 | Lista gramática inicial de capacidades y exige herramientas diegéticas limitadas a posesión, acceso y resolución. |
| obra/references/icm.md | ddcfab1879d98b9bf9a13e9e5c9d22c4f31c144e38d025ccb6a2fd7fe443f57a | Separa metodología ICM Markdown de aislamiento, transacciones, memoria y GUI; identifica las decisiones propias de esta adaptación. |
| obra/references/pulso.md | f6e99bce7ce54cb8f283751af43f9669f17c1b2aa4d5cfc6f517cccf908af1bf | Define pulso no equivalente a tiempo/escena, activación selectiva, propuesta desde revisión y revalidación serial. |
| obra/references/revision-y-publicacion.md | 92a5aa3859132ed2dade11037a64aae6a863a7901c93775533bc9150d84e7d17 | Versiones inmutables y permisos exactos, máximo dos reformulaciones, rechazo sin publicación y reintentos reutilizan un solo evento. |
| obra/references/verificacion.md | 3404ba04e9d7b5e9bf53d2514c6bda33c770677ad9b19ec1e65b8cf5e70bd30e | Criterios de aceptación conceptuales para seguridad, memoria, continuidad, instancias, narración y GUI; explícitamente no ejecutados. |
| obra/setup/CONTEXT.md | af20290630ebd8ec98074e6113b8cc887945e8b73532ad09028ba8d7c2bdd32b | Lista entradas y cinco pasos para configurar continuidad, reparto, conocimiento, escena, voz y Pi; sólo Coordinador cierra setup. |

### Etapas 01–04

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/stages/01-percepcion/CONTEXT.md | 7527e9f610217ce07eb95bf931ee6469a115016928b4d61da162badba93ecc36 | Escenario calcula y empaqueta percepciones individualizadas con procedencia, conserva entregas no procesadas y no copia secretos. |
| obra/stages/01-percepcion/output/registro.md | eb363f184d15455ca5af77b498afd4d6f5e6ceb9b89c291fae8cdd1ca6f06918 | Etapa no iniciada; manifiesto pertenece al Coordinador y no es cierre por existencia del archivo. |
| obra/stages/02-actuacion/CONTEXT.md | 09d4402e89e6cf3dd7a7bbf159933f1f64490f98580cf68e183f70359db2ce1f | Actor escribe propuesta versionada desde su sesión, puede esperar o desistir y reformula en su misma instancia. |
| obra/stages/02-actuacion/output/registro.md | 2d285171376c22e1e872d8f747ed13d8454fe9f00b44fc8a07d5b991d8292f2e | Etapa no iniciada; sin propuesta ni evento, el coordinador actualizará el historial de cierres. |
| obra/stages/03-moderacion/CONTEXT.md | f5f3c41261555baf8227a9efcafd200bb7de8c20bfec162ed5bd3ba34191b9f1 | Regidor valida origen/canal/capacidad; Continuista revisa contenido de la versión exacta; ausencia o revisión incompleta bloquean resolución. |
| obra/stages/03-moderacion/output/bandeja-respuestas.md | 76ce074896082e503df2cae16e47da5dea5fb5d82d378bdc48230a5baecc6c2e | Bandeja técnica vacía con estados de trabajo y referencias, sin biografía o memoria común. |
| obra/stages/03-moderacion/output/registro.md | 45e16d6b198cad63d34be343c15029ffa263eedd70eea40cce0882edfc9870fa | Etapa de moderación no iniciada; ninguna propuesta pasó control. |
| obra/stages/03-moderacion/output/revisiones-respuestas.md | 447170e50457592645a20ca935a8ce6645ee578c645ba609ce8f8748f745ec35 | Registro del Continuista vacío; decisiones ligadas a propuesta y versión inmutable. |
| obra/stages/03-moderacion/output/veredictos.md | ad4a97bf25ef00ed3069d78581579d99b097cd5b0e30b12ce3ff1c0caf212b3c | Registro del Regidor vacío; estados de canal/capacidad/autoridad no sustituyen la revisión de contenido. |
| obra/stages/04-resolucion/CONTEXT.md | 55f05c58b9ab84e6bafd707233e5cefff20f3311cd6b67eabc707e83eacce4b9 | Escenario resuelve sólo después de controles compatibles para la misma versión, revalida precondiciones y deduplica por ID base. |
| obra/stages/04-resolucion/output/registro.md | e7be7d20345820f0df118ee086e3e452859a894727506d6a77960912ada1a4bd | Etapa de resolución no iniciada; no hay evento ni efecto del mundo. |

### Etapas 05–08

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/stages/05-distribucion/CONTEXT.md | d085488b711db78c1ebe7e2e4dc23c683fbc2ce5dbac090b1564217bca34866c | Sólo eventos confirmados generan entregas por receptor; la percepción no convierte el contenido en verdad aceptada. |
| obra/stages/05-distribucion/output/registro.md | 4d7db71302d890c2bb77bd773c49d2d79c5a517a951b5bcc224c0e6d7f9f5749 | Etapa de distribución no iniciada; no se han entregado eventos. |
| obra/stages/06-memoria/CONTEXT.md | a7c885e0826a8684475b56f0344355c367c037816a13a80964e8fc3fe170fb04 | Cada actor incorpora por sí mismo sólo experiencias recibidas, conserva incertidumbre y procesa IDs sin duplicar recuerdos. |
| obra/stages/06-memoria/output/registro.md | 09589cc3ac936cfa65c95e9edc9179faa7db6e8fceb93685f7fc2d0eccf8b1db | Etapa de memoria no iniciada; el manifiesto no expone recuerdos privados. |
| obra/stages/07-direccion/CONTEXT.md | cc93f0ea8f0105bad90d962d401abe3853deebe60cfd97cb0461a56309de795b | Director registra progreso con eventos y propone circunstancias sin narrarlas como ocurridas ni dictar decisiones. |
| obra/stages/07-direccion/output/registro.md | f83efd63a06827e34bf0aa1b147fc813eab1ba5e6450c8db4881f4762f399251 | Observación dramática no iniciada; ninguna etapa tiene evidencia. |
| obra/stages/08-observacion/CONTEXT.md | 8f37e30ecf5f74d86dfd5d926d6c824f36e8eaa228d506ced13da962980a2968 | Observador publica hechos y evolución; puede continuar sin narración mientras ésta esté pendiente. |
| obra/stages/08-observacion/output/registro.md | 62144f936dd4edf18209518f703a73c0d1eaad5779bd472751e8ba0188da73d3 | Observación no iniciada; no hay cierre de pulso ni producto publicado. |

### Plantillas

| Archivo | SHA-256 | Conclusión de lectura |
|---|---|---|
| obra/templates/evento.md | f32db353d03828f10d26370120b607dfb62f05f53e9e9f4f06122a39492379f5 | Esquema para evento preparado/confirmado, causa, cambio aplicado, canales y referencia de corrección. |
| obra/templates/intervencion-humana.md | d9e15963f5ddb5225b06c14eadcad0d5766ec78e9f9061e98a80ede970b159df | Esquema preserva mensaje original y separa modo, identidad, canal, ruta y recepción. |
| obra/templates/memoria.md | 395c9949f97d518e789d52ad0092550ab154c5c1deb11434276b4579f3d3b1a3 | Esquema distingue experiencia, testimonio, inferencia y adaptación con procedencia y revisión de creencia. |
| obra/templates/narracion.md | 1a848939cb2131218c788641a68f4fc8de7ad99257cfdd99663e905bb41db9d5 | Esquema exige fuentes autorizadas, versión y doble revisión para texto al público sin efecto causal. |
| obra/templates/percepcion.md | 74d654d674cd999026a599523bb8932cebc41e3ce77e5f5c82c4c1bbf6d44bd7 | Esquema dirige observaciones accesibles a un receptor, separa inferencia y señala incertidumbre. |
| obra/templates/propuesta.md | aedcb5a340bfab27488812800a7971eb7c8345c90f101f0fa03ed373ef0c4133 | Esquema de intento versionado con evidencia, acto de habla, canal, propósito breve y resultado reservado a Escenario. |
| obra/templates/revision-respuesta.md | 1d4dd56d3cc057baccbc4e15af1fa22127f8052cff9acc6c74b75ec3e9d4831a | Esquema vincula evaluación a versión exacta y exige evidencia, decisión, devolución acotada y control de Regidor separado. |
