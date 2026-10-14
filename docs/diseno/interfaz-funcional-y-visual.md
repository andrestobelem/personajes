# Interfaz completa, funcional y visual

**Requisito expreso del usuario:** la interfaz gráfica será completa y debe ser principalmente funcional y visual. Debe permitir ver a los personajes interactuar, observar conversaciones y evolución, hablar con ellos e influir. Este documento convierte ese alcance en funciones y criterios comprobables; no afirma que la aplicación exista ni elige un stack o estilo gráfico.

## Qué significa «completa» en esta obra

La experiencia habitual debe poder realizarse desde la interfaz: preparar una representación, entender su situación, observar acciones, conversar, consultar personajes, seguir cambios y controlar la ejecución. Editar Markdown o usar comandos puede ser útil para mantenimiento, pero no debe ser un paso obligatorio del recorrido normal del usuario.

«Funcional y visual» significa que el usuario puede reconocer el estado y actuar sobre él con claridad. La apariencia de personajes, lugares y objetos ayuda a comprender la ficción; los controles producen efectos definidos y visibles. Una imagen atractiva sin interacción, un chat aislado sin situación y un panel con datos sin representación no satisfacen el alcance completo por sí solos.

## Tres conceptos visibles

- **Escenario:** mundo operativo, lugares, objetos, hechos, reglas, canales, tiempo y consecuencias.
- **Escenografía:** su representación visual/material: disposición visible, apariencia, iluminación, avatares y recursos de presentación.
- **Escena:** unidad de acción con uno o más personajes; puede incluir silencio, monólogo o acciones sin diálogo.

Cambiar zoom, cámara o la organización de paneles no cambia hechos del Escenario. Arrastrar un objeto para moverlo dentro de la ficción sí necesita una acción o intervención autorizada, con resultado confirmado. Ver [contrato de términos](../../obra/references/escenario-y-escenografia.md).

## Funciones y resultados esperados

Las siguientes son especificaciones propuestas para cumplir el requisito, abiertas a diseño de interacción y pruebas:

| Función | Resultado observable |
|---|---|
| Preparar una representación | Fecha, lugar, continuidad, reparto, situación y adaptaciones quedan identificados antes de comenzar. Los campos pendientes no parecen decisiones tomadas. |
| Ver el Escenario | Ubicación, presencia, movimiento, interacción y objetos relevantes se comprenden visualmente; el mapa no atribuye conocimiento global a los actores. |
| Seleccionar un personaje | Se accede a ficha, historia pertinente, voz, capacidades y situación; se diferencia expediente de investigación y estado vivido en la corrida. |
| Observar conversaciones | Se ve quién habla, a quién, por qué canal y en qué momento. Una intervención pendiente no se muestra como ya pronunciada. |
| Conversar e influir | El usuario elige interlocutor y canal; recibe una respuesta del personaje. Una petición no promete obediencia ni altera permisos del runtime. |
| Ver evolución | Cambios de vínculos, objetivos o creencias remiten a acontecimientos o testimonios. El diseño final de estas vistas queda por decidir. |
| Inspeccionar conocimiento | La vista distingue hechos, recuerdos, creencias e información de dirección según el modo autorizado; los actores no reciben el panel del observador. |
| Seguir tiempo y rutinas | Hora ficticia, día/noche y disponibilidad son legibles. Pulso técnico, latencia y tiempo diegético se distinguen. |
| Seguir la línea dramática | Etapas reconocidas por el director tienen evidencia, momento y carácter revisable; no se fuerzan decisiones para completar una barra. |
| Usar dirección autorizada | Las metaindicaciones se distinguen claramente de hablar dentro de la escena y dejan registro de sus efectos. |
| Pausar, continuar y avanzar | Cada control indica qué detiene o activa. Las acciones en curso y la recuperación no se duplican; la semántica vigente está definida en PRD §4.6 y S05 §7: pausa congela nuevas convocatorias y el reloj, y descarta efectos tardíos mediante la época durable. |
| Consultar historia | Selección de escena o momento con estado correspondiente a esa fecha; replay de lo registrado sin ejecutar otra vez decisiones o tools. |
| Escuchar y leer | Voz y subtítulos identifican al hablante; narrador opcional separado. Falta de audio no inventa una voz creada ni impide consultar la conversación textual. |
| Entender problemas | Espera, error de proveedor, propuesta rechazada o turno cancelado se distinguen de silencio elegido por el personaje. La vista técnica se mantiene diferenciada de la ficción. |

No se fijan aquí cantidad de paneles, disposición definitiva, 2D frente a 3D, biblioteca gráfica, diseño móvil o multijugador. Ninguna de esas elecciones se deriva automáticamente de «completa».

## Propuesta de recorrido visual

Una composición inicial a explorar combina escena central, selección de personaje, conversación y línea temporal, con controles de representación siempre localizables. Configuración y dirección deben ser accesibles sin confundirlas con diálogo ficticio. Esta es una propuesta de trabajo, no un mockup aprobado.

Los estados necesitan etiquetas además de color; el texto debe ser legible y la navegación de controles consistente. Los avatares ayudan a identificar, pero movimiento, audiencia de la conversación y cambios deben poder entenderse sin reconocer previamente al actor de televisión. Los recursos visuales definitivos, animaciones y criterios de accesibilidad se validarán en el prototipo.

## Ejemplos de aceptación

1. El usuario selecciona a Max, lee su situación y le pregunta por Fibonacci. Max responde desde su instancia y contexto; el continuista evalúa coherencia antes de publicación. La UI muestra la respuesta aprobada y mantiene separado un fallo técnico de un «no sé» actuado.
2. 99 escucha algo que Max no oyó. El observador puede inspeccionarlo en un modo permitido sin actualizar la memoria de Max. Si se lo cuenta en una interacción posterior, se registra como testimonio.
3. Un personaje queda solo y guarda un sobre en silencio. La interfaz muestra acción y consecuencia; no exige un segundo interlocutor ni genera parlamentos de relleno.
4. Un cambio de cámara no modifica posiciones operativas. Una intervención de dirección que cambia una circunstancia pasa por el canal correspondiente y se refleja al confirmarse.
5. Se consulta una conversación anterior y luego se regresa al presente. No se repite la acción, no se duplica un recuerdo y no se revelan conocimientos posteriores en la vista histórica.
6. El coordinador espera una instancia Pi. El usuario puede distinguir esa espera de una pausa del reloj y de la decisión del personaje de guardar silencio.

El [contrato operativo de interfaz](../../obra/interfaz/references/contrato.md) detalla proyecciones y autoridad. La [organización técnica](organizacion-de-pi-y-escenario.md) propone su relación con Pi y persistencia; la [comparación de plataformas](../investigaciones/entornos-graficos-open-source.md) orienta la evaluación. La [matriz de pendientes](decisiones-abiertas.md) conserva elecciones de experiencia todavía abiertas.
