# Actuación

Responsable: **instancia Pi propia del actor del turno**. No se ejecuta cambiando de identidad dentro del historial del Coordinador u otro personaje.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| `personajes/<slug>/CONTEXT.md` | Ruteo de actuación | Cargar sólo contexto propio |
| `personajes/<slug>/identidad.md` | Núcleo, voz y capacidades activadas | Sostener identidad |
| `personajes/<slug>/output/entrada.md` | Paquetes nuevos pertinentes | Saber qué ocurrió desde su perspectiva |
| `personajes/<slug>/output/estado.md` y `output/memoria.md` | Metas y recuerdos relevantes | Elegir una acción situada |
| `personajes/<slug>/output/revision.md` | Devolución técnica de la versión que se reformula, si existe | Corregir el borrador sin incorporar feedback como memoria |

## Process

1. Interpretar las observaciones a partir de la historia disponible, vínculos y deseos. La información incierta puede generar creencias equivocadas.
2. Elegir una acción concreta, incluyendo esperar, preguntar o desistir cuando tenga sentido. No inventar la respuesta del destinatario.
3. Escribir una propuesta con ID base y versión inmutable, pulso/turno y referencia de observaciones o último evento conocido, capacidad, objetivo observable, destinatario, canal, contenido público, acto de habla y propósito breve. Si responde como conocimiento, hipótesis, engaño o reserva, distinguirlo en el campo privado pertinente. No hace falta registrar razonamiento privado extenso.
4. Mantener diferenciada la propuesta del resultado. Una circunstancia de dirección se normaliza desde su intervención autorizada, sin inventar una actuación de personaje ni alterar su contenido. Si habla un interlocutor humano, el coordinador usa el contenido aportado por esa persona: no inventa su intención ni su voz.
5. Antes de publicarse, el borrador pasa a etapa 03. Si el Continuista solicita reformular, el mismo actor añade otra versión con el mismo ID base; no se borra la anterior ni se transforma el feedback técnico en experiencia vivida.

## Outputs

`personajes/<slug>/output/propuesta.md`, usando [propuesta](../../templates/propuesta.md). Para humanos, una intervención en la [bandeja humana](../../participacion/output/entrada.md) se normaliza como propuesta sin alterar su texto.

El coordinador es el único que actualiza el manifiesto local `output/registro.md`, con los IDs y rutas entregados por el responsable de etapa. No copia contenido privado en él.

## Cierre

La propuesta tiene procedencia, no escribe efectos como ocurridos y usa únicamente contexto autorizado.

La mera existencia de un archivo en `output/` no significa que esta etapa esté terminada. El cierre requiere estado explícito y comprobaciones satisfechas.
