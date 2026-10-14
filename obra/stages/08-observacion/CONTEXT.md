# Observación para el usuario

Responsable: **Observador**.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| Eventos confirmados | Diálogos y acciones efectivas | Mostrar interacción |
| Cambios individuales del turno | Metas, relaciones y memoria en vista interna | Mostrar evolución con procedencia |
| [Narración opcional](../../narrador/CONTEXT.md) y [configuración](../../_config/narracion.md) | Habilitación y protocolo | Preparar voz en off sin afectar hechos o percepciones |
| Dirección | Etapas y revisión | Mostrar lectura dramática separada de los hechos |

## Process

1. Proyectar acciones y conversaciones efectivamente ocurridas con tiempo e ID de evento. Una escena de acción solitaria o silencio es válida aunque el registro de conversaciones esté vacío.
2. Mostrar cambios de los personajes y sus causas. Diferenciar una creencia de un hecho y una intención de un resultado.
3. Señalar vista pública de escena o vista interna de observador. No reutilizar la segunda como entrada del interlocutor humano dentro del escenario.
4. Si la voz en off está habilitada y aporta a la puesta, el Coordinador abre su solicitud; el Narrador propone, Regidor y Continuista revisan y el Observador publica sólo la versión exacta habilitada, según su contrato. Si no se necesita narrar o sigue pendiente de revisión, dejarlo registrado sin inventar texto.
5. Actualizar panel y registrar cierre. El coordinador podrá elegir el siguiente turno activo o dejar la representación detenida.

## Outputs

[Conversaciones](../../observacion/output/conversaciones.md), [evolución](../../observacion/output/evolucion.md), [panel](../../observacion/output/panel.md) y manifiesto de etapa. Cuando corresponda, [narración aprobada para espectadores](../../narrador/output/narracion.md), sin entrega a los personajes.

El coordinador es el único que actualiza el manifiesto local `output/registro.md`, con los IDs y rutas entregados por el responsable de etapa. No copia contenido privado en él.

## Cierre

No se publican propuestas como sucesos ni se hacen cambios causales desde una proyección. La observación básica del turno queda comprobada antes de avanzar. Una narración opcional pendiente se registra por separado; no impide mostrar hechos confirmados ni se declara publicada.

La mera existencia de un archivo en `output/` no significa que esta etapa esté terminada. El cierre requiere estado explícito y comprobaciones satisfechas.
