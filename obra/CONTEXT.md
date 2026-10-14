# Ruteo del workspace

## Inputs

| Tarea | Leer | Sección y propósito |
|---|---|---|
| Preparar una representación | [Setup](setup/CONTEXT.md) | Contrato completo; resolver sólo configuración |
| Coordinar o retomar la representación | [Coordinador](coordinador/CONTEXT.md), [cursor](output/ejecucion.md) | Pulso, instancias pertinentes y pendientes; no todos los historiales |
| Interpretar un personaje | Contrato asignado y `personajes/<slug>/CONTEXT.md` | Identidad propia, entrada recibida y recuerdos pertinentes |
| Definir o revisar interfaz gráfica | [Interfaz](interfaz/CONTEXT.md) | Prioridad funcional y visual, flujos completos y separación entre estado y presentación |
| Preparar o inspeccionar una escena | [Escenas](references/escenas.md) | Uno o más personajes, incluida acción solitaria o silencio |
| Narrar para el espectador | [Narrador opcional](narrador/CONTEXT.md) | Fuentes autorizadas, revisión y salida no diegética |
| Revisar una respuesta propuesta | [Continuista](continuista/CONTEXT.md) | Versión exacta, evidencias y criterios antes de publicación |
| Resolver una acción | [Escenario](escenario/CONTEXT.md) | Autoridad y estado material necesario |
| Observar la obra | [Observación](observacion/CONTEXT.md) | Conversaciones, evolución y progreso dramático |
| Hablar con personajes o dirigir como usuario | [Participación](participacion/CONTEXT.md) | Canal, identidad y destinatarios; conservar fronteras |
| Revisar metodología | [ICM](references/icm.md) | Adaptación y fuentes |

## Configuración común

Cada personaje tiene su propia instancia Pi según la [configuración de instancias](_config/instancias-pi.md). El Coordinador invoca esas instancias; no alterna las identidades dentro de una sola sesión.

Todos los roles LLM respetan el perfil elegido por representación según la [configuración de modelo](_config/agentes.md): Sol 6.1 bajo, predeterminado, u Opus 5.5 medio. Cada proveedor requiere acceso propio. La selección y las pruebas controladas no acreditan login o inferencia live.

## Process

1. Determinar si la tarea es configuración, ejecución, inspección o mantenimiento.
2. Consultar sólo las filas pertinentes. En ejecución, respetar [autoridades](_config/autoridades.md).
3. Si la continuidad no está preparada, ejecutar setup. Si está preparada, seguir el cursor y el contrato de la etapa siguiente.
4. Validar el cierre de esa etapa y persistir sus salidas antes de avanzar.

## Outputs

No se escribe estado en este índice. El coordinador registra avance en [ejecución](output/ejecucion.md); cada rol escribe exclusivamente los artefactos de su contrato.
