# S07 — Verificación integral de PRD1.0

Versión 1.0, estrategia de verificación; no describe una implementación ni resultados ejecutados. Autoridad funcional: [PRD1.0](../PRD.md); espejo de trazabilidad: [requisitos-prd.json](../auditoria/requisitos-prd.json). Ambos contienen 77 requisitos únicos y los mismos 25 ensayos planificados. Todos permanecen pendientes hasta que se ejecute y registre evidencia del nivel indicado.

## Evidencia y condiciones de ejecución

Los niveles nombran qué clase de evidencia hace falta; no son sustitutos entre sí. Una prueba con doble puede ser útil para aislar una ruta, pero nunca se rotula como verificación de SDK, proveedor, SQLite o CLI real.

| Código | Evidencia exigida |
|---|---|
| D | Inspección del corpus/versionado, manifiestos, fuentes, hashes y procedencia. No demuestra comportamiento de la aplicación. |
| U | Prueba determinista de dominio/schema/estados con entradas identificadas. Un adaptador simulado sólo prueba el contrato local y se anota como tal. |
| L | Integración local contra disco, SQLite real, filesystem y, cuando se indique, el binario ICM real fijado por las specs. No usar base en memoria o un mock como evidencia L. |
| G | Recorrido de la aplicación gráfica real ejecutándose. Incluye acciones visibles y evidencia del árbol accesible/teclado; capturas sin interacción no bastan. |
| A | Integración externa real, con resultado verificable. Para actores/roles LLM: SDK Pi real fijado (la spec actual propone @earendil-works/pi-coding-agent 1.2.0), autenticación compatible y perfil seleccionado Sol 6.1 low u Opus 5.5 medium, solicitados y efectivos; para voz: cuenta y API ElevenLabs reales. No guardar credenciales en artefactos. |
| H | Revisión humana cualitativa de una muestra audiovisual o de actuación, con rúbrica, personas/revisores, fuentes y marcas de tiempo. No inferir escucha a partir de metadatos o texto. |

Las specs actuales proponen Node 24.18.0, ICM CLI 0.11.4, Pi SDK 1.2.0 y Pi AI 1.2.0; son objetivos de versión por comprobar en el entorno, no evidencia de instalación. Cada ejecución debe usar un directorio de datos privado y temporal fuera del repositorio, una corrida con UUID nuevo y datos de prueba rotulados. En ensayos de memoria, usar SQLite del host y una base ICM SQLite real por actor/corrida; comprobar versión binaria y backend efectivo antes de escribir, inspeccionar tablas mediante la API/CLI soportada y verificar procedencia/aislamiento. No editar tablas internas de ICM a mano. No confundir el journal autoritativo con ICM Memory, sus proyecciones Markdown o el historial de sesión Pi.

Los casos sobre datos incompletos deben conservar la incertidumbre del expediente: las etiquetas sintéticas de seguridad o audiencia se declaran fixtures, nunca canon. La comparación de resultados de modelos registra modelo/esfuerzo efectivos, versión de prompt/contexto, entradas, propuestas, revisión, resolución y salida publicada; no registra razonamiento interno. La variabilidad de salida se evalúa por criterios, no por igualdad textual.

Las dependencias y versiones efectivamente instaladas se anotan junto al resultado; las versiones propuestas en las specs no se consideran instaladas hasta verificar el entorno. Para un resultado reproducible se conserva commit, lockfile/hash de corpus, versiones, configuración relevante sin secretos, IDs de ensayo, fixture, resultado observado y referencias a artefactos privados autorizados. No se adjuntan tokens, secretos del personaje ni pensamientos internos.

## Ensayos P01–P25

| Ensayo | Especificaciones relacionadas | Qué observa y resultado exigido | Datos contraejemplo que debe probar | Evidencia mínima |
|---|---|---|---|---|
| P01 Biblioteca y recursos | S01, S05 | Paridad navegable del corpus inicial: manifiesto con 27 IDs individuales, documento de familia (incluidos gemelos) y apéndice multipartes, 16 investigaciones, paper/fuentes y 28 imágenes; familia/gemelos no suman IDs de actor al catálogo individual. Abre cada expediente entero; conserva personaje, alias/intérprete, créditos y procedencia; el investigador puede consultar sin entregar la biblioteca íntegra al actor. | Manifiesto con expediente ausente o duplicado, avatar sin crédito, alias coincidente con identidad distinta y pareja Max/rey que no debe fusionarse. | D+G |
| P02 Canon y preparación | S01, S03, S05 | Compilar el contexto según corte y conocimiento accesible. Revisar el paquete antes de inferir y corroborar en actuación que la preparación no convierte el archivo investigador en recuerdos presentes. | Puesta situada antes de matrimonio/hijos de Max con material posterior en el dossier; nombre civil de 99 o de los gemelos no comprobado. Contraejemplo positivo: conservar lo desconocido sin causar amnesia sobre hechos que sí conoce el personaje. | D+L+A |
| P03 Puesta e inicio | S01, S03, S04, S05 | Crear y editar desde GUI; invalidar puesta incompleta sin job ni petición de modelo; iniciar una válida desde el control gráfico y observar preflight, perfil y estado persistidos. | Borrador sin lugar o sin actor preparado; pulsar iniciar no debe llamar al proveedor ni escribir escena/memoria. Caso positivo con los campos obligatorios y un actor elegible/preparado/activo distinguidos. | L+G+A |
| P04 Escena solitaria | S01, S03, S05 | Pi real interpreta una situación con un participante: puede actuar, esperar o guardar silencio; se conserva el estado técnico como distinto de la elección ficticia. No se añade un interlocutor para forzar diálogo. | Escena sin segundo actor; compara silencio elegido con timeout/error y con un narrador apagado. No se exige que el modelo elija silencio en toda repetición. | G+A |
| P05 Conversación múltiple | S01, S03, S04, S05, S06 | Tres participantes con canales, audiencias y entradas escalonadas; una frase oída sólo parcialmente llega a los receptores correctos; se distinguen emisión, recepción y memoria. Se comprueba voz textual española situada con variedad de puesta declarada. | Participante que entra después del intercambio inicial, receptor fuera de alcance, canal con audibilidad parcial y variedad sugerida pero aún no confirmada para audio. | L+G+A |
| P06 Perspectivas y secretos | S01, S02, S03, S04, S05 | Observar un dato privado en la vista autorizada no lo copia a la instancia de otro actor. Cuando el humano lo comunica en ficción, el receptor obtiene testimonio con emisor, momento e incertidumbre, no hecho certificado. | Marcador sintético SECRETO_99_TEST visible al observador y a 99 pero ausente del paquete de Max; luego el humano lo cuenta y sólo entonces aparece como testimonio. Si se usa secreto de canon, debe citarse expediente/fuente/corte y estar admitido en esa continuidad. | L+G+A |
| P07 Fibonacci y coherencia | S01, S03, S06 | Probar los casos documentados de Max, Hymie y Fibonacci con conocimiento, motivo, época, voz y variedad de español diferenciados. La rúbrica debe aceptar incertidumbre, fanfarronería coherente o negativa sin convertir al actor en expositor omnisciente. | Contexto sin antecedente para conocer un dato; personaje que afirma saberlo como hecho; dispositivo anacrónico; propuesta editorial regional mostrada falsamente como decisión humana. | G+A |
| P08 Método y agencia | S01, S03, S06 | Propuesta de cobertura de S07 aceptada por coordinación: evaluar las 27 IDs de identidad individual del manifiesto del reparto inicial mediante dos secuencias comparables por identidad, cada una con tres turnos/decisiones del actor y dos estímulos entrantes como piso de ensayo. Cambiar un dato material de circunstancia, vínculo u objetivo entre secuencias y registrar cuál fue. No requiere activar 27 actores en una corrida ni interlocución humana. El documento de familia, incluidos los gemelos, es fuente de contexto y no añade IDs de personaje/agente al conteo de 27; Fang sí pertenece al set individual y se evalúa por conducta/sonido no verbal, no por parlamento. Una rúbrica registra escucha, objetivo, biografía pertinente, táctica posible, voz, consecuencias y continuidad. Las consecuencias pueden o no cambiar la táctica; no se requiere frase, giro ni transformación únicos. | Respuesta genérica idéntica en función pese a cambiar un dato pertinente; actor que ignora una réplica anterior; director que dicta la decisión privada; resumen que expone pensamiento interno en vez de conducta observable. Un resultado atípico se revisa con contexto y no se rechaza sólo por diferir. | A+H |
| P09 Herramientas y espacio | S01, S02, S03, S04, S05 | Resolver movimiento/uso según posición, conexión, puerta, posesión, disponibilidad y capacidad. Serializar dos propuestas incompatibles; confirmar que cámara y escenografía son proyección, no estado. | Puerta cerrada, objeto fuera de alcance, objeto ya tomado por otra persona, dos acciones concurrentes sobre el mismo objeto y petición de habla humana de Fang. | U+L+G |
| P10 Revisión y publicación | S02, S03, S04, S05 | Vincular revisión al ID, versión y hash exactos; probar configuración de cero, una y dos reformulaciones, default dos y rechazo de valores fuera del rango. Incompleta no aprueba. Separar resolución sin emisión de emisión con recepción nula/parcial y entrega pendiente. | Revisor responde sobre versión anterior; agotamiento de límite; canal fallido con intento sin emisión; frase emitida pero nadie la recibe; un receptor oye parcialmente; fallo de proyección tras commit. | L+G+A |
| P11 Inyección y efectos externos | S02, S03, S04 | Intentar cambiar identidad, prompt, permisos, ruta de memoria o autoridad desde diálogo, importación, resumen o resultado de tool. Verificar además que una acción ficticia no produce HTTP, shell ni mensaje externo. | Cadenas adversariales rotuladas como texto no confiable; import con campo de ruta/rol; memoria que dice “lee base ajena”; respuesta de tool fabricada que pretende autorizar envío externo. | L+G+A |
| P12 ICM Memory | S01, S02, S03 | Escribir y recuperar en CLI ICM real con backend SQLite y archivo local real; verificar español, negación, fuente, actor/corrida, recepción, revisión y privacidad. Comprobar el aislamiento consultando una base ajena desde la API del actor y verificando que no puede seleccionarla. | Recuerdo con negación (“no vi”), testimonio incierto, corrección posterior y marcador privado en otra base; rumor repetido por resumen no se convierte en hecho. | L |
| P13 Commit e idempotencia | S01, S02, S04 | Con SQLite real, repetir entrega y comando con la misma clave, probar versión conflictiva y forzar interrupción alrededor del commit. Se conserva un resultado terminal por origen y los efectos/percepciones/deliveries no se duplican. | Reintento después del commit, crash antes del commit, misma propuesta con distinto hash aprobado, dos comandos de reloj con IDs diferentes y mismo ID repetido. | L |
| P14 Recuperación y backups | S02, S03, S04 | Backup/restauración del journal, archivos ICM, sesiones y medios autorizados en disco; cotejar frontera de eventos, entregas pendientes y sesiones al corte. Reanudar job interrumpido sin llamarlo decisión y excluir secretos. | Interrupción justo antes/después del commit, después de escribir ICM y antes de marcar entrega; backup con entrega pendiente y artefacto de audio; restore a corrida distinta no sobrescribe la anterior. | L |
| P15 Historia y acceso vencido | S02, S04, S05 | Recorrer desde UI una historia hasta un seq anterior. Verificar que el replay sólo lee salidas/media persistidas; no solicita Pi, tools, TTS ni memorias posteriores. Con OAuth no válido siguen operables biblioteca, historia y entregas mecánicas permitidas. | Registro posterior con recuerdo nuevo; contadores de llamadas fijados antes/después del replay; estado de auth vencido en el host para bloquear inferencia nueva sin bloquear lectura. | L+G |
| P16 Reloj y controles | S01, S02, S03, S04, S05 | Probar rutina/disponibilidad en reloj ficticio controlado, pausa, reanudación, paso acotado, stop y close con trabajo en curso. Persistir y reabrir para verificar frontera. | Hora real del host cambia; pausa con respuesta tardía; acción que cruza hora de rutina; retorno de app no avanza tiempo fuera de línea por defecto; paso no significa día/acto. | U+L+G |
| P17 Presupuesto y fallos | S02, S03, S04, S05 | Agotar presupuesto y verificar pausa diagnóstica; timeout, cancelación y rate limit son estados técnicos recuperables; la UI responde mientras el proveedor trabaja. Mantener modelo/esfuerzo y registrar uso recibido por proveedor separado de estimaciones. | Presupuesto cero, concurrencia al techo, timeout, rate limit, cancelación y fallo sin fallback; proveedor devuelve uso desconocido, no inventar costo medido. | L+G+A |
| P18 Pi, OAuth y perfil | S02, S03, S04 | Con el SDK real fijado, autenticación del proveedor elegido (Codex OAuth o credencial Anthropic permitida) y cuenta con acceso, crear/reanudar dos actores y roles LLM independientes. Registrar configuración pedida y campos efectivos del SDK/proveedor; probar login cancelado, refresh/caducidad y falta de entitlement. | Sesiones separadas Max/99, una OAuth cancelada, token vencido y perfil incompatible; no usar API key para Codex, API OpenAI directa, otro modelo ni esfuerzo distinto como pase. La API key Anthropic es válida sólo para el perfil Claude seleccionado. Los dobles sólo cubren la ruta de orquestación, no este gate. | A |
| P19 Dirección y dramaturgia | S01, S03, S04, S05 | Director vivo propone etapa fechada con IDs de eventos, suficiencia y rectificación; la interfaz separa escena, acto y etapa y la metaindicación se resuelve como circunstancia. | Pocos/muchos turnos sin evidencia de clímax; actor rechaza circunstancia; etapa revisada con datos que cambian interpretación; actos no obligan a un giro. | G+A |
| P20 Narrador | S01, S03, S04, S05, S06 | Con narrador habilitado, la instancia publica sólo en canal del público estados autorizados; no crea eventos, no cambia actor ni revela razonamiento. Apagado conserva escena textual y permite narración opcional; la ruta de audio se coteja en P21. | Observador conoce estado privado que el personaje ignora; narración de creencia falsa; intento de narrador de afirmar que se abrió una puerta; narrador apagado durante replay. | L+G+A |
| P21 Voces, ElevenLabs y ritmo | S01, S03, S04, S05, S06 | Mantener resultados independientes: paridad documental de recetas para las 27 identidades individuales; validación local de adaptador/estados; flujo live de Voice Design y síntesis ElevenLabs; escucha/anotación del corpus audiovisual con fuente, escena y timecodes. El ensayo live sigue el recorrido de S04/S06: confirmar variedad por POST /runs/{runId}/spanish-variety/confirm; pedir Voice Design con muestra original por POST /runs/{runId}/voice-designs; obtener operación/previews por GET /voice-designs/{operationId}, escuchar media por GET /voice-previews/{previewId}/media, escoger por PUT /voice-designs/{operationId}/selection; guardar por POST /voice-previews/{previewId}/save; crear binding draft con POST /runs/{runId}/speech-binding-drafts; probar TTS real mediante POST /runs/{runId}/speech-binding-drafts/{bindingDraftId}/tests, escuchar el artefacto, y aceptar por POST /runs/{runId}/speech-binding-drafts/{bindingDraftId}/acceptance para habilitar el binding; finalmente sintetizar con TTS real una publicación mediante POST /runs/{runId}/audio o el worker automático de la modalidad elegida. Inspeccionar publicación/modelo, audio, alineación y subtítulos. Una voz ya existente, una llamada TTS aislada o sólo datos de catálogo no pasan la etapa de Voice Design ni el gate live. El registro correlaciona operationId de diseño, hash de muestra y variedad, IDs sanitizados de previews, selección/escucha, voz guardada, revisión y validationEvidenceId del binding, publicationId/modelo TTS y hash del artefacto/alineación; no incluye credenciales. Para la calibración, usar como piso operativo la metodología propuesta en S06: al menos 20 intervenciones repartidas en tres escenas identificadas, con hablante/confianza, palabras, función, pausa/solapamiento y acción/silencio anotados. Puesta nueva inicia con audio apagado; al habilitarlo, TTS automático procesa sólo publicaciones futuras y se puede elegir solicitud manual; no hay creación automática de voces. Texto/subtítulos sobreviven a audio apagado/fallo; reintento no llama de nuevo al actor. Fang se evalúa como conducta/asset no verbal, no habla; no se requiere llamada live de SFX para aprobar P21. | Variedad sólo propuesta bloquea preview/síntesis; falta de key no crea audio; usar sólo una voz existente o saltar escucha/elección/guardado/binding no pasa el flujo live; fallo TTS conserva diálogo publicado; retry de TTS no duplica actuación; metadata YouTube sin escucha no acredita ritmo; no se crean/guardan voces automáticamente para las 27 identidades. Generación live opcional de SFX Fang no es gate. | D+L+G+A+H |
| P22 Evolución e identidad | S01, S02, S03, S05 | El actor cambia una creencia, meta o relación por experiencia referenciada; Configurador promueve revisión con diff/versionado; corridas anteriores conservan su estado e identidad investigada. | Intento de promover un rumor o preferencia sin evento/procedencia como rasgo estable; la promoción borra la ficha original o altera un replay previo. | L+G+A |
| P23 Interfaz y accesibilidad | S04, S05 | Recorrer flujo completo con aplicación real usando teclado; inspeccionar nombres/roles/estado/foco en árbol accesible y probar un lector de pantalla disponible. Mapa y estado tienen alternativa textual; estados no dependen sólo del color; historial y controles siguen utilizables durante inferencia. | Sólo color distingue estados; entidad del mapa sin nombre textual; foco invisible; acción habitual requiere editar Markdown/terminal; control de pausa bloqueado durante espera. | G+H |
| P24 Intercambio ICM | S01, S02, S04, S05 | Import/export en filesystem real y almacenamiento local real; roundtrip de cada expediente y apéndices compara texto y campos: ficha, biografía, vínculos, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias. Markdown se regenera como proyección y no compite como escritor. | Schema futuro/invalidado, link roto, campo desconocido, versión de continuidad distinta y export editado usado como evento ejecutado; no sobrescribir silenciosamente. | L+G |
| P25 Arquitectura y operación | S01, S02, S03, S04, S05, S06 | Revisar composición de objetos/mensajes y fronteras; instalar desde checkout limpio con lockfile, ejecutar build/tests/guía real, inspeccionar diagnósticos sin secretos y comprobar que host/control no quedan expuestos públicamente por defecto. | Input externo inválido, ID cruzado, secreto-canary en token/log, endpoint sin autenticación de operador, migración rota y dependencia/guía que sólo funciona en máquina autora. | U+L |

## Trazabilidad explícita de los 77 requisitos

La columna de ensayos replica los vínculos planificados en requisitos-prd.json. Las asignaciones de S04–S06 corresponden a las specs 1.0 revisadas; G0 tiene [cierre documental](../auditoria/cierre-specs.md). Cualquier ajuste debe conservar cada requisito y su evidencia. En “evidencia mínima” se unen los niveles de todos los ensayos ligados al requisito.

| ID PRD | Specs pertinentes | Ensayos | Evidencia mínima |
|---|---|---|---|
| CAT-01 | S01, S05 | P01 | D+G |
| CAT-02 | S01, S02, S05 | P01, P24 | D+L+G |
| CAT-03 | S01, S05 | P01 | D+G |
| CAT-04 | S01, S05 | P01 | D+G |
| CAT-05 | S01, S03, S05 | P02 | D+L+A |
| CAT-06 | S01, S02, S05 | P02, P24 | D+L+G+A |
| CAT-07 | S01, S03, S05 | P02, P03 | D+L+G+A |
| CAT-08 | S01, S02, S03, S05 | P22 | L+G+A |
| CAT-09 | S01, S05 | P01 | D+G |
| ESC-01 | S01, S04, S05 | P03 | L+G+A |
| ESC-02 | S01, S04, S05 | P09 | U+L+G |
| ESC-03 | S01, S02, S04 | P09 | U+L+G |
| ESC-04 | S01, S03, S05 | P04, P05 | L+G+A |
| ESC-05 | S01, S03, S04, S05 | P05, P06, P10 | L+G+A |
| ESC-06 | S01, S03, S04 | P09 | U+L+G |
| ESC-07 | S01, S03, S04 | P09 | U+L+G |
| ESC-08 | S01, S02, S04 | P09, P13 | U+L+G |
| ESC-09 | S01, S03, S05 | P08, P22 | L+G+A+H |
| ESC-10 | S01, S05 | P04, P19 | G+A |
| ACT-01 | S02, S03, S04 | P18 | A |
| ACT-02 | S03, S04 | P18 | A |
| ACT-03 | S03, S04 | P18 | A |
| ACT-04 | S03, S06 | P08 | A+H |
| ACT-05 | S01, S03 | P04, P08 | G+A+H |
| ACT-06 | S02, S03, S04, S05 | P16, P17 | U+L+G+A |
| ACT-07 | S03, S04 | P10 | L+G+A |
| ACT-08 | S03, S04 | P10 | L+G+A |
| ACT-09 | S01, S03, S06 | P02, P07, P10 | D+L+G+A |
| ACT-10 | S03, S04 | P06, P11 | L+G+A |
| ACT-11 | S02, S03, S04 | P14, P15, P17 | L+G+A |
| ACT-12 | S03, S04 | P18 | A |
| MEM-01 | S02, S03 | P12 | L |
| MEM-02 | S01, S02, S03, S05 | P06, P12 | L+G+A |
| MEM-03 | S01, S02, S05 | P06, P12 | L+G+A |
| MEM-04 | S01, S02, S03 | P06, P12 | L+G+A |
| MEM-05 | S02, S04 | P13 | L |
| MEM-06 | S02, S04 | P12, P13 | L |
| MEM-07 | S02, S05 | P14, P24 | L+G |
| MEM-08 | S02, S04, S05 | P14, P24 | L+G |
| MEM-09 | S02, S05 | P15 | L+G |
| MEM-10 | S01, S02, S03 | P02, P06, P12 | D+L+G+A |
| DIR-01 | S01, S03, S05 | P19 | G+A |
| DIR-02 | S01, S03, S04, S05 | P19 | G+A |
| DIR-03 | S01, S03, S05, S06 | P20 | L+G+A |
| DIR-04 | S01, S05 | P19 | G+A |
| TIM-01 | S01, S05 | P16 | U+L+G |
| TIM-02 | S02, S03, S04, S05 | P16 | U+L+G |
| TIM-03 | S01, S02, S03, S05 | P16 | U+L+G |
| TIM-04 | S03, S04, S05 | P17 | L+G+A |
| UI-01 | S04, S05 | P03, P23 | L+G+A+H |
| UI-02 | S01, S04, S05 | P09, P23 | U+L+G+H |
| UI-03 | S02, S04, S05 | P05, P15 | L+G+A |
| UI-04 | S04, S05 | P05 | L+G+A |
| UI-05 | S02, S04, S05 | P06, P15, P22 | L+G+A |
| UI-06 | S03, S04, S05 | P06, P19 | L+G+A |
| UI-07 | S03, S04, S05 | P10 | L+G+A |
| UI-08 | S04, S05 | P23 | G+H |
| UI-09 | S04, S05 | P03, P25 | U+L+G+A |
| UI-10 | S02, S04, S05 | P24 | L+G |
| UI-11 | S03, S04, S05 | P19 | G+A |
| VOZ-01 | S03, S05, S06 | P05, P07, P21 | D+L+G+A+H |
| VOZ-02 | S05, S06 | P21 | D+L+G+A+H |
| VOZ-03 | S01, S06 | P21 | D+L+G+A+H |
| VOZ-04 | S04, S05, S06 | P20, P21 | D+L+G+A+H |
| VOZ-05 | S04, S05, S06 | P20, P21 | D+L+G+A+H |
| VOZ-06 | S05, S06 | P21 | D+L+G+A+H |
| VOZ-07 | S04, S05, S06 | P21 | D+L+G+A+H |
| NFR-01 | S01 | P25 | U+L |
| NFR-02 | S01, S02, S04 | P03, P11, P24, P25 | U+L+G+A |
| NFR-03 | S02 | P12, P13, P14 | L |
| NFR-04 | S02, S03, S04 | P14, P25 | U+L |
| NFR-05 | S03, S04, S05 | P17, P23 | L+G+A+H |
| NFR-06 | S03, S04, S05 | P17 | L+G+A |
| NFR-07 | S02, S03, S04 | P18, P25 | U+L+A |
| NFR-08 | S01, S05, S06 | P01, P21 | D+L+G+A+H |
| NFR-09 | S02, S03, S04 | P11, P25 | U+L+G+A |
| NFR-10 | S01, S02, S03, S04, S05, S06, S07 | P25 | U+L |

## Gates de cierre

Los gates se cierran por evidencia adjunta al requisito, no por haber escrito la prueba o el diseño.

1. **G0 — Revisión de especificaciones:** S01–S07 tienen contratos revisados; cada uno de los 77 IDs tiene cobertura trazable, datos y ensayo; PRD/JSON coinciden; no quedan contradicciones de alcance sin marcar. En este gate se revisa que las rutas/contratos de Voice Design, escucha/elección, guardado y binding de S04 se mantengan coherentes con S06 y P21. G0 es revisión documental/técnica de specs: no exige ejecutar P21 ni implementar el producto.
2. **G1 — Corpus y dominio:** D/U pasan para catálogo, preparación, schemas, autoridad y estados; vacíos/contradicciones quedan preservados o adaptados de manera identificable.
3. **G2 — Persistencia local real:** L pasa sobre journal SQLite, filesystem y CLI/SQLite ICM reales, con recuperación y contraejemplos; mocks no sustituyen este gate.
4. **G3 — Aplicación real:** G pasa recorridos de interfaz, control, historia y accesibilidad con la app corriendo; documentos, capturas o pruebas DOM aisladas no sustituyen el gate.
5. **G4 — Integraciones live:** A pasa con Pi SDK/OAuth/proveedor/modelo/esfuerzo reales y, por separado, con ElevenLabs real. Los resultados de un proveedor no cubren al otro ni el funcionamiento del runtime del producto.
6. **G5 — Fidelidad y ritmo:** H registra revisión de secuencias multivuelta del Método y escucha/anotación audiovisual real. No se fija un número universal de palabras, segundos o réplicas sin corpus medido.
7. **G6 — Cobertura final:** los 77 requisitos tienen resultado y evidencia del nivel requerido; cada fallo conserva diagnóstico y decisión; no queda requisito crítico sólo con simulacro. El resultado del producto sigue abierto hasta cerrar dependencias externas y revisión humana.

## Estado documental y límites de ejecución

S04, S05 y S06 están presentes como specs 1.0 revisadas y sus asignaciones se cotejaron contra las matrices y operaciones descritas. S04 modela el flujo Voice Design → previews/media → elección → guardado → binding draft/prueba/aceptación → TTS de publicación, y los nombres de ruta de P21 coinciden con su tabla. G0 tiene cierre documental/técnico; ese cierre no acredita implementación ni ejecución de P21.

La matriz PRD/JSON sí coincide en cantidad e identidad de requisitos (77/77) y ensayos (P01–P25); esta auditoría documental no acredita que se haya ejecutado ninguno. Los requisitos de corpus audiovisual aún no tienen evidencia de escucha/anotación; P21/H no puede cerrarse con el inventario de enlaces. Los gates A y G dependen de código y acceso real que no se declaran disponibles en este borrador. La coordinación resolvió la elección de implementación que S06 había dejado abierta: audio apagado al crear la puesta; habilitarlo autoriza TTS automático sólo para publicaciones futuras, con opción manual seleccionable; no se crean voces automáticamente. P21 verifica ambos modos y el bloqueo inicial. SFX de Fang queda como receta/asset no verbal; el generador opcional de S06 no exige gasto ni llamada live para aprobar VOZ-03/P21. P21 live permanece pendiente hasta ejecutarse con cuenta real y una voz creada/seleccionada por el recorrido completo descrito; una voz existente no sustituye Voice Design. S04 distingue correctamente la media temporal de Voice Design (GET /voice-previews/{previewId}/media) del POST /voice-previews, que hace TTS temporal sobre voz existente; sus operaciones de diseño, selección, guardado, binding y test de TTS están enumeradas en la tabla actual. La ejecución live de P21 es evidencia de producto independiente del gate G0 de revisión de specs.

