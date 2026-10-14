# Flujos de una interfaz gráfica completa

## Prioridad: funcional y visual

La interfaz completa debe ser **principalmente funcional y visual**. Su criterio central es que el usuario pueda entender la obra y operar sus funciones: reconocer personajes, espacios, acciones y estados; seleccionar a quién observar o con quién hablar; controlar la ejecución; y comprobar qué cambió como resultado.

Las vistas gráficas, la escenografía y los controles deben hacer visibles esas relaciones. El texto acompaña con diálogos, etiquetas, fichas y explicaciones pertinentes. La navegación de uso habitual debe resolverse en la interfaz, sin exigir editar Markdown o conocer la estructura técnica del repositorio.

Cada control debe tener una finalidad reconocible, expresar si está disponible o pendiente y mostrar el resultado real de su operación. La revisión del producto comprobará esos comportamientos, además de la comprensión visual del estado. Esta prioridad no selecciona todavía un estilo gráfico, motor, framework ni stack tecnológico.

## Preparación de la obra

El usuario podrá examinar el reparto y sus fichas, seleccionar uno o más personajes, fijar fecha/lugar y situación inicial, revisar el objetivo general y los objetivos personales, y configurar ritmo temporal, registro de doblaje y narración opcional. Los hechos de investigación, interpretaciones y elaboraciones de la puesta conservarán su distinción.

Los detalles de autenticación pertenecen a configuración técnica: se mostrará el estado real de conexión de Pi a Codex y el modelo solicitado, sin exponer secretos. No se presentará una cuenta como conectada por la existencia de documentos.

## Escenografía y representación en curso

La vista gráfica mostrará espacios, avatares, posiciones, movimientos, objetos, acciones y condiciones visibles de día/noche. La escenografía representa el Escenario. Una transición visual podrá interpolar un resultado confirmado, pero no inventar que alguien llegó, oyó o tomó un objeto.

Una escena con un solo personaje o sin diálogo sigue siendo observable. La interfaz puede mostrar acción, espera o silencio sin fabricar conversaciones. La voz en off aprobada aparece como narración para espectadores, visualmente diferenciada del habla del reparto.

## Conversación y participación humana

El usuario podrá seleccionar un personaje o grupo alcanzable y conversar, preguntar, negociar o persuadir. La vista distinguirá mensaje preparado, pendiente, efectivamente emitido y recibido. El personaje conserva la posibilidad de aceptar, resistir, dudar, mentir o cambiar de plan según su situación.

Los modos **observador**, **interlocutor** y **dirección** deben ser distinguibles antes de enviar. Destinatarios, canal y alcance perceptivo son relevantes: una conversación privada no se muestra como escuchada por todo el reparto. Una instrucción de dirección se enruta fuera de la ficción, sin que una frase dentro del chat gane autoridad por autodenominarse orden.

## Evolución y lectura dramática

Habrá una vista por personaje de metas, recuerdos, relaciones y creencias con sus cambios y procedencia; una vista de hechos confirmados del Escenario; y una lectura del Director sobre etapas dramáticas. Las perspectivas se rotulan para no confundir creencias con hechos o interpretaciones con resultados.

El usuario puede acceder a una vista interna autorizada sin otorgársela a los personajes. El razonamiento interno privado del LLM no se convierte en pensamiento ficticio ni se exhibe como contenido del personaje. La interfaz podrá explicar un estado de revisión de forma acotada, sin reemplazar la interpretación del actor.

## Historia y continuidad

El historial enlazará acciones, conversaciones y evolución mediante eventos y versiones. La selección de un momento pasado deberá mostrar la proyección de ese momento; no el estado actual etiquetado con una fecha anterior. Reproducir o inspeccionar la historia no reejecuta efectos ni mueve el reloj operativo.

La interfaz conserva por separado borradores/revisiones técnicas y contenido publicado. Una versión rechazada no aparece en la conversación como pronunciada. Una narración corregida mantiene trazabilidad sin modificar lo que hizo un personaje.

## Control de ejecución

El usuario podrá iniciar una puesta preparada, pausar/reanudar la ejecución, solicitar un pulso y observar qué instancias tienen trabajo pendiente. Pausar la ejecución no borra ni reemplaza sus memorias. No se activa al reparto completo en cada paso sólo por mostrarlo en pantalla.

El avance de reloj y las elipsis siguen las reglas del Escenario. Velocidad de animación, latencia del modelo, ritmo dramático y tiempo diegético son conceptos distintos, aunque la interfaz permita operar varios. Una orden de control se registra y se confirma antes de mostrar su efecto como aplicado.

## Comprobación de utilidad visual y funcional

| Tarea del usuario | Evidencia de que la interfaz la resuelve |
|---|---|
| Entender la escena | Identificar visualmente quién participa, dónde está, qué hace y en qué momento de la puesta se encuentra |
| Observar a un personaje | Seleccionarlo y acceder a su interacción y evolución, distinguiendo perspectiva propia y hechos del Escenario |
| Conversar e influir | Elegir destinatario y modo, enviar una intervención y reconocer si fue recibida y cómo respondió el personaje |
| Operar la representación | Usar controles de preparación, inicio, pausa, reanudación o pulso y observar su estado y efecto confirmado |
| Comprender un cambio | Relacionar una acción o conversación con sus consecuencias y consultar el momento pertinente de la historia |

Estos criterios requieren funciones operativas y estados legibles; todavía no se han validado en una aplicación implementada.

## Estados incompletos y verificación

Se mostrarán estados reales de preparación, desconexión, revisión pendiente, fallo de una acción y ausencia de respuesta. No se fabrican éxito, diálogo o voz para ocultarlos. La prueba de producto deberá recorrer estos flujos, incluyendo conversación humana, aislamiento de información, escena individual y reanudación sin efectos duplicados.

Todavía no existe implementación de estos flujos. Los Markdown son la especificación y los artefactos previstos para su integración, no una interfaz ya operativa.
