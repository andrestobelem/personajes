# Distribución

Responsable: **Escenario**.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| Evento confirmado del turno | Señales, canales y receptores posibles | Calcular qué llega a cada uno |
| [Estado](../../escenario/output/estado.md) | Posiciones y medios | Resolver audibilidad, visibilidad y recepción |
| Entradas individuales afectadas | IDs ya entregados | Evitar duplicación |

## Process

1. Verificar que el evento confirmado corresponde a la versión habilitada; nunca distribuir un borrador o devolución de revisión. Si la resolución indicó `sin_evento`, no crear entrega de ficción y devolver un cierre sin distribución. Para un evento confirmado, crear una percepción por destinatario efectivo. No todos reciben el mismo texto ni tienen acceso a lo mismo.
2. Enviar al emisor la retroalimentación perceptible de su intento, sin informar resultados remotos que no puede conocer.
3. Agregar entregas a las entradas de los personajes afectados. Registrar para cada destinatario ID de evento y alcance recibido.
4. Si el destinatario es humano, preparar la respuesta observable en la salida de participación. No exponer la memoria privada del personaje salvo que el usuario esté en vista interna explícita.

## Outputs

Entradas por destinatario, entrega humana en [salida](../../participacion/output/salida.md) y manifiesto con IDs efectivamente distribuidos.

El coordinador es el único que actualiza el manifiesto local `output/registro.md`, con los IDs y rutas entregados por el responsable de etapa. No copia contenido privado en él.

## Cierre

Cada percepción tiene origen, receptor y límite; entrega y percepción no se equiparan a aceptación de su contenido.

La mera existencia de un archivo en `output/` no significa que esta etapa esté terminada. El cierre requiere estado explícito y comprobaciones satisfechas.
