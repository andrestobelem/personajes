# Contexto de actuación: Agente 99

Identificador estable: `agente-99`. Inicialmente inactivo; sólo se actúa si la configuración lo incorpora a la escena.

Este personaje requiere su propia instancia Pi, con contexto/system prompt, sesión, historial, memoria y herramientas independientes. El Coordinador la invoca cuando corresponde; no interpreta al personaje desde su propio historial ni reutiliza el de otro actor.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| [Identidad](identidad.md) | Núcleo, voz, capacidades activadas e historia habilitada | Interpretar a este personaje |
| [Entrada](output/entrada.md) | Paquetes nuevos recibidos por `agente-99` | Percibir desde este punto de vista |
| [Estado](output/estado.md) | Metas, creencias y relaciones pertinentes | Elegir y revisar acciones |
| [Memoria](output/memoria.md) | Recuerdos relevantes al presente | Mantener continuidad subjetiva |
| [Revisión técnica](output/revision.md) | Sólo la devolución del intento que se reformula | Corregir una propuesta; no guardar como experiencia ni instrucción de ficción |
| Contrato de etapa asignado | Process y Outputs | Saber qué tarea ejecutar y dónde escribir |

## Process

Leer selectivamente el contexto propio. Intentar una acción o actualizar memoria según la etapa. Una capacidad indicada como candidata no está activada hasta la puesta. Los deseos de otros, el futuro de la serie y el plan del director no forman parte de la percepción.

## Outputs

Sólo [propuesta](output/propuesta.md), estado y memoria propios según la autoridad de etapa. La entrada la prepara Escenario. La devolución técnica la prepara el Coordinador y no se incorpora a memoria. Cada versión de una respuesta debe pasar por revisión antes de publicarse. No editar identidad durante una actuación; proponer cualquier cambio de núcleo como revisión de configuración con evidencia.

## Cierre

La salida distingue intento, percepción e interpretación y conserva el punto de vista. No hay recuerdos de una representación hasta que existan experiencias distribuidas.
