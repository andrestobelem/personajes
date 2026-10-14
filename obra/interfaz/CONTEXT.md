# Interfaz gráfica completa: contrato de proyección e interacción

La interfaz es un requisito de producto para operar y observar la obra. La prioridad expresa del usuario es que sea **principalmente funcional y visual**: debe permitir entender qué ocurre y operar la representación mediante vistas y controles claros, con funciones verificables. Este contrato está documentado; todavía no se ha implementado una aplicación gráfica. No se satisface el requisito final sólo con navegar Markdown o ver una animación.

## Inputs

| Fuente | Sección | Propósito |
|---|---|---|
| [Contrato de interfaz](references/contrato.md) | Flujos y estados | Cubrir el uso completo |
| [Escenario](../escenario/CONTEXT.md) | Estado y eventos confirmados | Proyectar hechos sin inventarlos |
| [Observación](../observacion/CONTEXT.md) | Conversaciones, evolución y vistas | Mostrar la representación con trazabilidad |
| [Participación](../participacion/CONTEXT.md) | Modos de interacción humana | Hablar, observar o dirigir por el canal adecuado |
| [Coordinador](../coordinador/CONTEXT.md) | Pulso, control y pendientes | Mostrar y operar el estado de ejecución |
| [Reparto](../personajes/README.md) y configuración de la puesta | Selección y fichas | Preparar escenas con uno o más personajes |
| [Narrador](../narrador/CONTEXT.md) | Publicaciones habilitadas | Integrar voz en off opcional para espectadores |

## Process

La futura interfaz proyecta las fuentes autoritativas y enruta solicitudes a sus responsables. Una acción en pantalla no muta directamente memoria, posición o reloj por saltarse el protocolo. Se distinguen cambios de escenografía/presentación de efectos operativos del Escenario.

## Outputs

Vistas de configuración, escenografía, representación en curso, participación, evolución, historia y control. Los cambios solicitados usan los contratos existentes; las vistas no son otra fuente independiente de hechos.

## Cierre

La interfaz se considerará implementada cuando esos flujos funcionen y sean verificados sobre un runtime real, y el usuario pueda identificar visualmente el estado de la obra y operar los controles con resultados observables. En esta entrega sólo existen el contrato y sus criterios de aceptación, sin renderizador, controles activos, audio ni sesiones conectadas.
