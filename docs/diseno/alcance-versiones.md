# Alcance de la primera y segunda versión

Actualizado el 15 de octubre de 2026. Este documento separa el alcance de la primera alpha de la aceptación del producto completo definida en el [PRD](../PRD.md). La asignación de versión no afirma que una capacidad esté implementada o probada; el estado técnico sigue en [pendientes](../PENDIENTES.md) y en la [trazabilidad individual](../auditoria/trazabilidad-prd.md).

## Decisión de alcance

La persona usuaria eligió **V1: alpha textual, un episodio y un elenco activo pequeño**. Para que pueda probarse de punta a punta, V1 incluye la preparación gráfica, conexión con ICM, login real del proveedor elegido, presets editables, una representación visible e intervención humana. La GUI de V1 debe permitir operar funcionalmente ese recorrido sin editar archivos ni recurrir a la terminal.

El corpus de 27 personajes y sus expedientes sigue disponible para elegir reparto. «Elenco pequeño» limita quién actúa en la alpha; no descarta ni recorta el catálogo investigado. Como tamaño inicial de implementación se puede probar con dos o más personajes; una cifra exacta de elenco no quedó fijada por la persona usuaria.

El perfil predeterminado es OpenAI Codex con GPT-6.1 Sol, esfuerzo bajo; Anthropic con Claude Opus 5.5, esfuerzo medio, es la alternativa. La interfaz ofrece ambos perfiles, pero cada sesión real usa el proveedor autenticado que se seleccionó, sin sustitución silenciosa. La aceptación de V1 requiere una puesta real con el perfil elegido; no exige que el usuario autentique ambas cuentas.

## Opciones preconfiguradas

V1 ofrece tres entradas a la preparación:

1. **Ensayo de conocimiento, adaptación sintética.** Max y Hymie reciben una pregunta sobre Fibonacci. Sirve para observar voces, conocimientos y revisión de coherencia diferentes. Fecha, lugar, metas y circunstancias se muestran como propuestas editables y no como canon ni como hechos ya ocurridos. El ejemplo no crea historia hasta que la persona lo revise e inicie la representación.
2. **Puesta desde continuidad documentada.** Carga los datos respaldados por el corte elegido. Vacíos y contradicciones permanecen visibles; no se completan como hechos canónicos. Los campos obligatorios aún no resueltos bloquean el inicio hasta que se elijan o se declaren como adaptación.
3. **Puesta en blanco.** Permite definir la situación desde cero.

Los formularios pueden proponer fecha/hora, lugar, reparto, conflicto, objetivos y un mapa pequeño como borrador. Las propuestas tienen procedencia explícita, se pueden editar y confirmar, y nunca modifican los expedientes originales. Elegir un preset tampoco inicia sesión OAuth, llama al modelo ni inicia una escena automáticamente.

## Estado de las opciones preconfiguradas

El selector gráfico ya ofrece puesta en blanco y ensayo Max/Hymie con propuestas editables; guardar y reabrir conserva su condición editorial. La curación y colocación del reparto siguen siendo explícitas. La entrada documental ya permite elegir entre dos cortes versionados con fuentes y límites explícitos; propone sólo continuidad y nombre y deja momento, lugar, reparto y recuerdos sin inventar. Ver [cortes documentales](../auditoria/cortes-documentales-de-continuidad.md). Ver [evidencia y límites de los presets](../auditoria/presets-de-preparacion.md).

## Criterios por versión

Los IDs siguen siendo los del PRD. Cuando una fila dice «mínimo V1 / ampliación V2», el criterio es compartido: V1 debe cumplir el comportamiento mínimo descrito y V2 completa la cobertura integral. No se debe interpretar un ID compartido como aceptación total en V1.

| Área | V1 — alpha textual | V2 — producto ampliado |
|---|---|---|
| Catálogo y expedientes | **CAT-01–07**: consultar el catálogo preparado, elegir un elenco pequeño, conservar identidad, procedencia y vacíos, y preparar contextos sin filtrar futuro. El expediente usado por cada personaje activo conserva la riqueza disponible. | **CAT-08–09**: promoción integral de identidad y acceso de investigador integrado a todas las investigaciones y fuentes. |
| Escenario | **ESC-01–10**, con un mapa pequeño, una escena o episodio, objetivos individuales, reglas situadas, acciones resolubles, percepción, herramientas acotadas y cierre durable del episodio. | Escala mayor, recorridos más amplios y evolución completa entre episodios; no se requiere poner a los 27 personajes en marcha simultáneamente. |
| Actores y moderación | **ACT-01–12**: instancia Pi independiente por actor, perfiles y OAuth, preparación del Método, agencia, coordinación, revisión y defensa frente a inyecciones. La primera aceptación usa los casos centrales y el elenco elegido. | Evaluación ampliada de calidad, iniciativa y resistencia en todo el corpus de escenarios y perfiles. |
| Memoria e ICM | **MEM-01–06, MEM-08–10** y la parte de **MEM-07** necesaria para operar la obra en carpetas Markdown/ICM con memoria SQLite privada, procedencia, eventos, transcript y recuperación local. | Exportación portable completa de **MEM-07**, recuperación/intercambio entre hosts y análisis histórico avanzado. La selección, síntesis y olvido automáticos se amplían sin borrar el archivo de eventos. |
| Dirección y dramaturgia | **DIR-01–02** en su forma básica y **DIR-04** para episodio/escenas: el Director observa etapas con evidencia y la dirección autorizada puede orientar sin decidir por los actores. | **DIR-03**, narrador omnisciente opcional, y tratamiento completo de formas clásicas, actos, precedencias y comparación dramática avanzada. |
| Tiempo | **TIM-01–02**: reloj ficticio, ciclo día/noche básico y controles de inicio, pausa, paso, reanudación y detención. | **TIM-03** y ampliaciones de **TIM-01**: escalas avanzadas, rutinas completas y replay temporal entre zonas/hosts. **TIM-04** queda para V2 como aceptación ampliada de presupuesto. |
| Interfaz | Recorrido principal completo y visual de **UI-01–09**, más la vista básica de etapas de **UI-11**: preparar, iniciar, ver el Escenario, seguir conversación, hablar, pausar y revisar la historia de la puesta actual. La accesibilidad básica forma parte de la alpha. | **UI-10**, importación/exportación integral, comparación histórica profunda y superficies administrativas que exceden operar esta alpha. |
| Voz | **VOZ-01–03, VOZ-05**: español textual diferenciado, ritmo cualitativo, recetas documentadas para el reparto y acceso textual aunque el audio esté apagado. | **VOZ-04, VOZ-06–07**: síntesis/reproducción ElevenLabs, calibración audiovisual y flujo completo de diseño, preview y selección de voz. |
| Calidad operativa | **NFR-01–05, NFR-07–09** para la puesta alpha. **NFR-06** conserva en V1 los topes y la pausa de seguridad ya implementados; **NFR-10** se acepta con ensayos del recorrido de un episodio. | Aceptación ampliada de **NFR-06** (incluidas métricas de costo) y **NFR-10**: los 25 ensayos y los 77 requisitos con toda la evidencia requerida. |

### Límite de presupuesto

El presupuesto ampliado pasa a V2, según la decisión de la persona usuaria. En V1 permanecen los límites operativos existentes: topes, timeout, control de concurrencia, bloqueo conservador y pausa al agotarse. V1 no espera medición de tokens ni de costo monetario con servicios reales. Esto difiere la aceptación ampliada, no desactiva las protecciones ya presentes.

### Puerta de aceptación de V1

La alpha no se declara lista por una build o por pruebas con transporte simulado. Debe completarse y verificarse en la GUI este recorrido real:

1. Elegir un preset editable o preparar una puesta en blanco y resolver fecha/hora, lugar, continuidad, reparto, conflicto y la identidad ficticia del usuario.
2. Conectar la carpeta ICM y la memoria SQLite conforme a los límites de cada actor.
3. Autenticar el proveedor elegido y comprobar el perfil efectivo en instancias Pi distintas para los personajes activos.
4. Iniciar un episodio, observar una respuesta actoral real y los cambios confirmados en el Escenario, intervenir como personaje ficticio y ver la conversación publicada.
5. Pausar y reanudar, comprobar la memoria y el historial, y confirmar que los errores de servicio no se presentan como diálogo ni como silencio dramático.

Esta puerta acepta un recorrido V1; no sustituye la aceptación completa del producto ni la ejecución de los 25 ensayos.
