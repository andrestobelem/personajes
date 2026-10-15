# Cambios de circunstancia: revisión de contrato y brechas

Estado: auditoría de código y contratos del 15 de octubre de 2026. No constituye implementación ni aceptación de DIR-02. Fuentes: [S01](../specs/01-dominio-y-catalogo.md), [S03](../specs/03-pi-y-coordinacion.md), [S04](../specs/04-api-y-autoridad.md), [constitución](../constitucion.md) y archivos citados abajo. Revisión delegada al agente `circumstance_contract_audit`; integración de sus hallazgos contra el código local.

## Requisitos ya definidos

Dirección solicita operaciones tipadas y el Escenario conserva la autoridad de resolverlas. El ledger administrativo conserva autor y solicitud; el personaje sólo recibe un efecto perceptible confirmado. Ninguna operación escribe obediencia, memoria, creencias, metas o decisiones privadas. No hay JSON Patch ni texto libre que se convierta en efecto físico. Un cambio incompatible con el pasado vivido exige bifurcación declarada.

S01 requiere cinco familias: puerta, iluminación, disponibilidad de dispositivo, condición ambiental y aparición de objeto compatible. Puertas, luz y dispositivos ya tienen estado físico en [world-schema.ts](../../src/domain/world-schema.ts). Ambiente carece de estado tipado y de catálogo de condiciones. Los objetos tienen entidad e inventario, pero todavía falta un catálogo autorizado para admitir su aparición: aceptar un objeto arbitrario del cliente no satisface ese requisito.

## Cadena pendiente de implementación

1. Payload de Dirección con alcance y unión cerrada de operaciones registradas, independiente de metaindicaciones/revocaciones. El contexto administrativo actoral continúa recibiendo sólo metaindicaciones vigentes.
2. Autorización del run y de todos los lugares afectados. Una puerta que conecta lugares fuera del alcance de escena no debe ampliar autoridad implícitamente. CAS de mundo y de Dirección, no sólo ETag del ledger: un actor puede mover un objeto o cerrar una escena sin cambiar Dirección.
3. Una transacción para efecto, snapshot, commit, eventos, percepciones, intenciones y recibo. Replay exacto conserva el resultado anterior incluso tras cerrar; misma clave con otro payload se rechaza.
4. Percepción circunstancial sin inventar actor emisor. La variante `worldEvent` actual exige `sourceEntityId`, y el acuse en [journal.ts](../../src/adapters/journal.ts) lo busca como personaje del snapshot inicial. Esa variante no sirve para luz, ambiente o puerta accionados administrativamente. Deben ampliarse [world.ts](../../src/domain/world.ts), [deliver-world.ts](../../src/application/deliver-world.ts) y los schemas correspondientes.
5. Nuevo origen causal durable en entregas, intenciones y pulsos: sus enums y CHECK SQLite actuales sólo admiten intentos actorales e intervenciones humanas. Migración y recovery deben conservar aislamiento, deduplicación y presupuesto.
6. Publicación/observación sin hablante ficticio; luego entrega efectiva y pulso por percepciones recibidas. Un personaje puede hablar, esperar o ignorar la oportunidad. La operación administrativa no prescribe una respuesta.

## Decisiones que no deben ocultarse en la implementación

- Lifecycle admitido para cambios físicos. Metaindicaciones y revocaciones tienen un ledger propio; no se deduce de eso que una circunstancia física pueda cambiar durante un turno en vuelo. Hace falta fijar su política de ejecución y revalidación, sin modificar un corte congelado silenciosamente.
- Catálogos tipados de ambiente y objetos compatibles, con procedencia y geometría. Nombres tentativos de comandos no son decisiones del usuario.
- Percepción de transiciones: apagar una luz debe poder ser observado como oscurecimiento por quien estaba presente y podía percibir antes del cambio. Evaluar sólo visibilidad posterior puede ocultar la transición. La disponibilidad interna de un dispositivo tampoco es automáticamente visible.

## Pruebas necesarias

Cada familia requiere efecto válido, target desconocido, mismo estado, alcance inválido y precondición fallida; CAS concurrente; rollback integral; replay tras reinicio/cierre; integridad de hashes; propagación sensorial y actores ausentes/no disponibles; una sola Experience/intención por entrega repetida; ausencia de motivo, principal y catálogo privado en contexto actoral; cadena integrada con Actor y Continuista; observación histórica sólo desde su commit. Estas pruebas siguen pendientes. La revocación administrativa de metaindicaciones, implementada en el corte 38, no sustituye ninguna de estas operaciones físicas.
