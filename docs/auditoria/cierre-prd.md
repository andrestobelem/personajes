# Registro del cierre previo y revisión reabierta del PRD

El cierre documental anterior habilitó S01–S07 con el PRD 1.0 y está conservado aquí como antecedente. La descripción original de esa edición —que sólo cambiaba la cabecera— no coincide con el documento actual. La revisión se reabrió el 15 de octubre de 2026 para revisar las adiciones posteriores antes de volver a declarar una versión cerrada.

La base de revisión v0.7 conserva los informes de siete pases de producto, cinco del custodio y seis de contratos:

- [Producto, R7](revision-prd-producto.md): sin hallazgos pendientes en ese pase.
- [Concepto, R5](revision-prd-concepto.md): sin omisión concreta pendiente en ese pase.
- [Contratos, R6](revision-prd-contratos.md): autoridad, privacidad, estados y límites revisados en ese corte.

Hashes históricos: PRD v0.7 revisado, `ab189ca2c1a620165ac15007afced6cb6f35a3a2cf6305f4189251113e2b7de5`; documento de cierre 1.0, `affdbb0de5a24b78c297d6337917ff0320639e00ba2a34883e4b957a3afbe323`. Identifican esos cortes, no el estado actual del PRD.

La edición vigente añadió la definición de Episodio y amplió ESC-10 junto con los ensayos P04, P13, P14, P15 y P19. El pase actual también corrigió el piso de cobertura de P08 para que coincida con el PRD, separó subresultados de P21 por capacidad y reabrió S07 para reconciliar la evidencia exigida. El inventario conserva 77 requisitos y 25 ensayos; los criterios aún necesitan revisión completa y su estado de aceptación sigue pendiente.

La [trazabilidad](trazabilidad-prd.md), el [espejo JSON](requisitos-prd.json) y la [lectura inicial](lectura-prd-raiz.md) documentan el alcance previo y la cobertura. Ninguna cifra de archivos, un hash ni una revisión anterior sustituye volver a inspeccionar los criterios afectados.

Este registro no cierra la revisión vigente. El PRD se cerrará otra vez cuando la relectura de fuentes, requisitos, ensayos y trazabilidad confirme que no quedan omisiones o contradicciones; luego habrá que sincronizar y revisar S01–S07.
