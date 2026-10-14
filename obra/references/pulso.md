# Pulso de coordinación

## Qué marca

Un pulso es una unidad de coordinación del trabajo de las instancias. Puede responder a nuevas observaciones, una intervención humana, una rutina, una necesidad de acción o una solicitud de avanzar la representación. No equivale automáticamente a un minuto de ficción, una réplica, una escena ni una etapa dramática.

El Coordinador registra un ID `pulso-000001`, `pulso-000002`… y el último evento confirmado que sirve de referencia. Cada intento de actor mantiene su ID de turno y propuesta dentro de ese pulso. La fecha y hora del escenario sólo cambian por una resolución de Escenario de acuerdo con la puesta.

## Activación y propuesta

Escenario prepara las percepciones por receptor. El Coordinador invoca las instancias Pi de los personajes pertinentes, cada una con su contexto e historial propios. Las instancias eligen qué intentar, decir, preguntar o esperar. El Coordinador administra cuándo se solicita y se recoge el trabajo; no decide la respuesta por ellas.

Las propuestas identifican la versión de observación o último evento conocido por el actor. Puede solicitarse trabajo a varias instancias en un pulso; la primera integración puede hacerlo una tras otra sin perder independencia. El paralelismo de invocación es una decisión de ejecución, no permiso para compartir contextos o escribir un mismo archivo simultáneamente.

## Confirmación y distribución

Regidor y Continuista revisan las propuestas. Las permitidas pasan a Escenario en el orden de resolución declarado para la puesta; la confirmación de efectos compartidos es serial. Una propuesta pendiente no produce efectos mientras otra ya confirmada avanza el escenario.

Si un resultado anterior cambia precondiciones de una propuesta todavía no resuelta, Escenario vuelve a comprobarlas: puede fallar, resultar parcial o necesitar observación nueva antes de otro intento. No se mantienen condiciones obsoletas para asegurar el éxito. Si el actor reformula a partir de información nueva, lo hace en su propia instancia con percepción recibida y versión correspondiente.

Los eventos confirmados se distribuyen a sus perceptores. Cada instancia afectada actualiza sólo su memoria y estado subjetivo; el Coordinador registra que entregó o recibió un producto, no una copia de las historias privadas. Después puede activar nuevos turnos motivados por esas percepciones.

## Reloj y dramaturgia

El Coordinador puede solicitar una espera, avance o elipsis contemplados por las reglas, pero Escenario resuelve duración y consecuencias. No suma la latencia de Pi al tiempo diegético ni usa un pulso como garantía de progreso dramático. El Director reconoce etapas por lo que hicieron los personajes y lo que ocurrió.

## Reanudación

El registro conserva pulso, instancia destinataria por slug, turno, versión, estado de trabajo y eventos confirmados. Reanudar utiliza esas referencias para evitar una doble solicitud o doble publicación. Un actor ocupado no recibe otra escritura sobre su sesión; no se cambia su identidad para aprovechar otra instancia libre.

Esta coordinación está especificada en Markdown. No hay scheduler ejecutándose, pool Pi creado ni concurrencia implementada.
