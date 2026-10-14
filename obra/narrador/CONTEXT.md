# Narrador opcional para el espectador

Esta función produce una voz en off, que puede tener perspectiva omnisciente dentro del alcance autorizado. No es un personaje del reparto. Se ejecuta como rama opcional de observación tras los eventos confirmados, con el perfil elegido por representación si utiliza un agente.

## Inputs

| Archivo o paquete | Sección | Propósito |
|---|---|---|
| [Configuración de narración](../_config/narracion.md) | Habilitación, destinatarios y fuentes | Saber si corresponde narrar y con qué acceso |
| [Bandeja](output/bandeja.md) | Solicitud pendiente, ID y fuentes autorizadas | Delimitar la unidad de narración |
| Eventos y estados confirmados incluidos en esa solicitud | Sólo fragmentos autorizados | Describir hechos sin producirlos |
| [Voz y ritmo](../_config/voz-y-ritmo.md) | Idioma y función de la intervención | Integrarse a la representación sin llenar todos los silencios |
| Devolución de revisión de su versión | Sólo observaciones técnicas pertinentes | Reformular sin modificar los hechos del escenario |

## Process

1. Si la voz en off está deshabilitada, no producir texto para rellenar una salida. Si está habilitada, el Coordinador reserva un ID de narración y entrega las fuentes autorizadas.
2. Elegir si la situación necesita una intervención. Un resultado de «sin narración necesaria» es válido y no inventa contenido para justificar el rol.
3. Preparar un borrador versionado con los hechos de apoyo y su función. Mantener diferenciada una interpretación narrativa de una afirmación de hecho. No acceder a razonamiento interno privado del LLM ni confundirlo con interioridad ficticia.
4. Entregar la versión inmutable al Regidor para control de destinatarios/canal y al Continuista para hechos, continuidad, alcance autorizado, español y ritmo. Reformular si corresponde; no autoaprobar.
5. El Observador publica únicamente la versión exacta admitida y permitida. El texto no atraviesa Escenario como una nueva acción y no se distribuye a bandejas perceptivas de personajes.

## Outputs

[Borradores](output/borradores.md), decisiones en [revisiones](output/revisiones.md) y [veredictos](output/veredictos.md), y [narración publicada](output/narracion.md). Cada responsabilidad escribe sólo su artefacto según autoridades.

## Cierre

Estado explícito: deshabilitada, sin narración necesaria, pendiente de revisión, rechazada o publicada. No publicar por la sola existencia de un borrador. La representación puede continuar mostrando sus hechos confirmados si la narración opcional sigue pendiente; ese pendiente nunca se finge publicado ni obliga a rehacer eventos.

Contrato y pruebas: [protocolo de narración](references/protocolo.md). Marco de diseño: [narrador y voz en off](../../docs/diseno/narrador-y-voz-en-off.md).
