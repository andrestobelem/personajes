# Resolución

Responsable: **Escenario**.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| [Veredicto del Regidor](../03-moderacion/output/veredictos.md) | Propuesta y versión del turno | Verificar canal, capacidad y autoridad |
| [Revisión de respuesta](../03-moderacion/output/revisiones-respuestas.md) | Decisión para la misma versión, o no aplicabilidad explícita | No publicar un borrador sin revisión |
| [Estado](../../escenario/output/estado.md) | Entidades, objetos y último evento aplicado | Evaluar causalidad |
| [Eventos](../../escenario/output/eventos.md) | ID base de propuesta y confirmaciones | Evitar efectos duplicados |
| [Reglas](../../escenario/references/reglas.md) | Espacio, duración y condiciones | Resolver resultados |
| [Protocolo de publicación](../../references/revision-y-publicacion.md) | Versión y reintentos | Conservar una única emisión por intento |

## Process

1. Si alguna revisión necesaria está incompleta, ausente o corresponde a otra versión, **no resolver ni asignar evento**: devolver al Coordinador el estado pendiente de etapa 03. Si se pide reformular, volver a etapa 02 sin evento. Si se rechaza, registrar cierre técnico `sin_evento` sin simular ejecución.
2. Con admisión del Regidor y permiso del Continuista para la versión exacta —o revisión comunicativa no aplicable—, buscar primero un evento por ID base de propuesta. Si existe, reanudar o reutilizar el resultado y no emitir otra respuesta por un reintento.
3. Revalidar las precondiciones frente al estado confirmado actual, aunque la propuesta se haya preparado antes de otro resultado del pulso. Determinar éxito, fallo o resultado parcial, con consecuencias concretas y duración. Asignar ID de evento desde el contador del escenario; registrar `preparado`, reservar el número una sola vez, aplicar la proyección y confirmar según el protocolo de reanudación.
4. No reescribir la respuesta permitida durante resolución. Si cambió su contenido, requiere nueva versión y revisión antes de publicar. El canal puede fallar o producir una recepción parcial, que se registra como tal; eso no autoriza a inventar palabras alternativas.
5. Una frase pronunciada es un hecho de emisión, no prueba de la verdad de su contenido. Una petición o persuasión no establece por sí sola la decisión del receptor.

## Outputs

Evento en el [registro autoritativo](../../escenario/output/eventos.md), con ID base, versión y revisiones habilitantes; [estado](../../escenario/output/estado.md) actualizado. También puede haber un cierre técnico sin evento o retorno pendiente, explícitamente diferenciados.

El Coordinador es el único que actualiza el manifiesto `output/registro.md` con IDs, rutas y comprobaciones. No copia contenido privado en él.

## Cierre

Evento confirmado y estado coherente, o cierre explícito sin evento por rechazo. Una revisión incompleta no cierra el turno como exitoso ni avanza a publicación. No hay efectos repetidos, respuestas sustituidas por otro rol ni adjudicación de creencias ajenas.
