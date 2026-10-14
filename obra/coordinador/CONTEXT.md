# Coordinador del pulso

El Coordinador marca cuándo se solicita actuación a las instancias Pi independientes y enlaza sus propuestas con los controles, Escenario y observación. No interpreta a los personajes ni decide sus metas o respuestas.

## Inputs

| Archivo o paquete | Sección | Propósito |
|---|---|---|
| [Instancias](../_config/instancias-pi.md) | Separación y asociación por slug | Invocar al actor correcto sin compartir historiales |
| [Continuidad](../_config/continuidad.md) | Reparto de la escena, rutinas y orden de resolución | Delimitar a quién activar |
| [Cursor](../output/ejecucion.md) y [pulsos](../output/pulsos.md) | Trabajo pendiente y último evento confirmado | Reanudar sin duplicar solicitudes |
| Paquetes preparados por Escenario e intervenciones enrutadas | Receptores, IDs y cambios pertinentes | Activar sólo con información permitida |
| Propuestas entregadas y controles | ID base, versión y estado | Reunir resultados sin sustituir decisiones del actor |
| [Reglas del pulso](../references/pulso.md) | Orden y cierre | Coordinar publicación, distribución y reloj |

## Process

1. Abrir o reanudar un pulso y determinar personajes pertinentes por escena, nuevas percepciones, mensajes, rutinas o iniciativa. No solicitar actuación a todo el reparto por el solo hecho de existir.
2. Invocar la instancia Pi propia de cada personaje con su paquete filtrado y el contrato de etapa. Mantener contexto, sesión, memoria y herramientas independientes. Un mismo actor no recibe dos trabajos simultáneos sobre su estado.
3. Recoger propuestas versionadas o decisiones explícitas de esperar/no actuar. No completar una respuesta faltante en nombre del actor ni copiar un borrador de otra instancia.
4. Enviar cada propuesta a Regidor y Continuista según corresponda. Devolver una solicitud de reformulación a la misma instancia y al mismo intento.
5. Entregar las versiones habilitadas a Escenario en el orden de resolución definido. Escenario confirma efectos de forma serial, distribuye percepciones y conserva autoridad del reloj. Coordinar luego las actualizaciones de memoria en las instancias afectadas.
6. Invocar dirección y observación sobre hechos confirmados; activar narración sólo si está configurada. Registrar pendientes sin convertirlos en sucesos.

## Outputs

Cursor, [registro de pulsos](../output/pulsos.md), manifiestos, solicitudes y devoluciones de su autoridad. No escribe recuerdos ni decisiones diegéticas privadas de los personajes. Los productos concretos pertenecen al rol que los genera.

## Cierre

Cada solicitud tiene un destinatario de instancia inequívoco y un estado. No hay propuestas resueltas dos veces, contextos de actores mezclados ni mensajes publicados sin controles. Las propuestas pendientes o actores ausentes quedan registrados; no se declaran como completados. El pulso puede cerrarse con pendientes identificados que se retoman posteriormente, sin inventar sus resultados.
