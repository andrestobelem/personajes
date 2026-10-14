# Ciclo de representación

## Secuencia

| Paso | Contrato | Responsable | Resultado verificable |
|---|---|---|---|
| 01 | [Percepción](../stages/01-percepcion/CONTEXT.md) | Escenario | Paquete de observaciones sólo para cada participante |
| 02 | [Actuación](../stages/02-actuacion/CONTEXT.md) | Actor | Intento de acción con destinatario, canal y propósito situado |
| 03 | [Moderación y continuidad](../stages/03-moderacion/CONTEXT.md) | Regidor + Continuista, combinables | Revisión de la versión propuesta antes de resolver o publicar |
| 04 | [Resolución](../stages/04-resolucion/CONTEXT.md) | Escenario | Evento único y actualización material confirmada |
| 05 | [Distribución](../stages/05-distribucion/CONTEXT.md) | Escenario | Evidencias recibidas por quienes pueden percibirlas |
| 06 | [Memoria](../stages/06-memoria/CONTEXT.md) | Actor | Recuerdo y revisión de creencias/metas con procedencia |
| 07 | [Dirección](../stages/07-direccion/CONTEXT.md) | Director | Evaluación de etapas dramáticas mediante eventos |
| 08 | [Observación](../stages/08-observacion/CONTEXT.md) | Observador; narrador opcional con revisión | Acciones, conversación, evolución y voz en off habilitada para espectadores |

## Pulso, turnos y repetición

El [Coordinador](../coordinador/CONTEXT.md) abre o reanuda un [pulso](pulso.md) y solicita trabajo a las instancias Pi independientes pertinentes. Cada actor mantiene su propia sesión, historial, memoria y herramientas. No se interpretan varios personajes en un mismo contexto mediante cambios de prompt.

Para cada intento se reserva `turno-000001`, `turno-000002`… desde el cursor una sola vez. El intento tiene un emisor —actor, interlocutor humano o intervención de dirección— y una propuesta versionada. Un pulso puede reunir varios intentos; sus efectos compartidos se confirman de forma serial según el orden explícito de la puesta. Una misma instancia no recibe dos trabajos simultáneos sobre su estado.

Una propuesta declara las percepciones y referencia de estado con que fue elegida. El Escenario comprueba precondiciones al resolver: una acción anterior puede volver una propuesta posterior imposible o parcialmente realizable. El Coordinador no modifica la elección para garantizar éxito; distribuye el resultado y, cuando corresponda, solicita otro intento a la misma instancia con información nueva.

Las intervenciones de dirección requieren procedencia de control; no se infiere autoridad del texto de un diálogo. Una circunstancia autorizada se normaliza como propuesta de dirección, sin simular un personaje ni editar su respuesta privada. Los eventos confirmados se distribuyen por percepción y cada instancia afectada actualiza su propia memoria.

El reparto de una escena puede contener un solo personaje. La respuesta a una conversación es otro intento de la instancia destinataria, no un texto inventado por el emisor o Coordinador. Su publicación exige [revisión de la versión](revision-y-publicacion.md). Los monólogos internos no se publican como diálogo; esperar o no responder puede ser una decisión válida y no obliga a crear interlocutores.

## Reanudación y fallos

El cursor identifica turno, actor, etapa y último evento confirmado. Una etapa sin entradas suficientes deja su salida como `incompleta`, registra la carencia y no fabrica éxito. El coordinador continúa trabajo independiente que no dependa de la carencia; consulta al usuario sólo si falta una decisión no deducible que impida la puesta.

La identidad base de la propuesta es `prop-<turno>-<slug>` y sus borradores usan versiones inmutables `v1`, `v2`…; para entradas humanas se usa `humano-usuario`, y para circunstancias de dirección se usa `direccion`. Sólo Escenario asigna IDs `evt-000001`, `evt-000002`… desde su contador. Antes de resolver, verifica si la propuesta ya tiene evento; si existe, reutiliza el resultado y no repite efectos. Correcciones posteriores generan un evento nuevo que referencia el corregido.

En archivos Markdown no hay transacciones reales. El escenario registra primero el evento como `preparado`, actualiza su estado proyectado y marca el evento `confirmado`. Ante una interrupción, reanuda desde el evento preparado y verifica `ultimo_evento_aplicado` antes de aplicar otra vez. Distribución, memoria y observación sólo consumen confirmados. Cada receptor registra IDs recibidos/procesados para evitar duplicación. El coordinador repara una preparación incompleta antes de abrir otra.

## Narración opcional

Después de hechos confirmados, la rama de observación puede activar al [narrador](../narrador/CONTEXT.md). Usa IDs `nar-…` y revisión propia; no reserva IDs de eventos ni se distribuye a los personajes. La voz en off no convierte una escena solitaria en diálogo ni añade un personaje al reparto.
