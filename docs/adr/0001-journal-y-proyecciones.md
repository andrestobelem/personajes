# Journal SQLite autoritativo y memorias separadas

Se adopta un journal SQLite del host para confirmar conjuntamente resolución, eventos, revisión del estado y outbox. Las bases ICM privadas por actor/continuidad sirven recuperación de experiencia; las carpetas Markdown conservan contexto y proyecciones regenerables. La decisión es del integrador para implementar los requisitos de durabilidad/privacidad, no una elección humana previa.

Se consideraron archivos Markdown autoritativos y un backend completo de AI Town/Convex. Los archivos no ofrecen commit transaccional, y delegar verdad/memoria al ejemplo gráfico complicaría aislamiento, escenas múltiples y replay mental histórico. El journal añade esquema/migraciones/outbox propios, pero deja renderer, SDK y recuperación de memoria detrás de puertos. La verdad compartida no depende de transacciones distribuidas entre bases ICM; su entrega reintentable conserva IDs y la única autoridad de hechos.

Estado: adoptado para escribir specs; implementación y demostraciones de recuperación todavía pendientes. Ver [S02](../specs/02-persistencia-e-icm.md) y [PRD MEM05–09](../PRD.md).
