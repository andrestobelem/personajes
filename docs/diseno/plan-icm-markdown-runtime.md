# Plan de integración de ICM Markdown al runtime

Revisión inicial de sólo lectura del 15 de octubre de 2026, realizada por `dir04_design_review` sobre el código de ese corte y el [diálogo de diseño](../auditoria/dialogo-icm-markdown-runtime.md). La [fundación de contratos, lector y admisión](../auditoria/icm-markdown-fundacion.md) y la [integración v43](../auditoria/icm-markdown-runtime.md) implementan snapshots, paquetes durables, workers y selección gráfica. Las puestas nuevas ya exigen selección explícita y se ejecutó [una función completa desde preparación nueva](../representaciones/pregunta-a-tiempo-icm.md). El [Inspector por rol/job](../auditoria/inspector-icm-y-base-configurador.md) ya permite verificar paquetes/cortes con permiso privado. Siguen pendientes el workflow de Configurador anterior a Ready y la aceptación integral. ICM Markdown y el backend ICM Memory SQLite siguen siendo componentes distintos.

## Contrato completo

El host debe seleccionar por IDs y secciones permitidas, congelar bytes/procedencia/revisión/hash en Ready y entregar a Pi el contrato Markdown efectivamente seleccionado. Reserializar schemas de dominio no sustituye esa integración. Separar política inmutable del host, contrato procedural del rol y datos diegéticos autorizados. El Markdown nunca amplía tools, proveedor, permisos o acceso al filesystem.

La primera integración actoral usa `obra/stages/02-actuacion/CONTEXT.md` y el `CONTEXT.md` propio del personaje activo. Identidad e historia continúan pasando por preparación curada y experiencias admitidas: no se cargan libremente investigaciones globales, identidades de otros personajes ni sus memorias. Las instrucciones actuales de producir archivos como `propuesta.md` deben conciliarse con el runtime: serán proyecciones/borradores, no permisos para escribir hechos ni acceso al disco.

## Implementación prevista

1. Crear contrato de selección/snapshot de workspace, lector seguro del host y manifiesto explícito de fuentes. Rechazar escape por symlink, rutas arbitrarias y archivos fuera de límites. Integrar borrador en `src/domain/production.ts` y snapshot opcional versionado en `src/application/production-preflight.ts`, sin defaults históricos.
2. Admitir selección por revisión/hash mediante preview, CAS e idempotencia. Extender el editor gráfico existente con selección de secciones/rol/actor, procedencia, diferencias y conflictos; la interfaz no envía rutas ni bytes arbitrarios como fuentes autorizadas.
3. Compilar y persistir un paquete inmutable por corrida, rol, actor cuando corresponda, job/generación y corte, antes del despacho al proveedor. Incluir hashes de fuentes, compilador, configuración, contexto preparado, experiencias propias y dirección autorizada. Mantener un hash ICM separado de `preparedContextHash`, que conserva su significado actual de preparación/identidad.
4. Conectar el paquete real a `actor-turn-worker.ts` y a la sesión/checkpoints Pi, conservando `noContextFiles: true`. Recuperación y reformulación reutilizan exactamente bytes/hash persistidos; un paquete ausente o corrupto bloquea antes de inferir, sin reconstruir desde fuentes actuales.
5. Extender el mismo puerto a Continuista/Regidor, Director y Configurador; Narrador según el alcance de la puesta. Actor primero es orden de implementación, no sustitución del alcance completo. Separar sesiones, paquetes y audiencias de todos los roles.
6. Preservar snapshot/procedencia en revisiones de configuración, promoción de identidad, fork y backup. Guardar paquetes en el journal evita agregar un segundo inventario de archivos privados; aun así requiere admisión y verificación del esquema nuevo. Elegir la próxima migración disponible en la rama real, sin reutilizar números de cortes concurrentes.

## Evidencia requerida para aceptación

- Cambiar, borrar o reemplazar por symlink una fuente después de Ready no altera la representación guardada.
- Corrupción de snapshot/paquete bloquea; reinicio, reformulación y replay conservan bytes y hashes exactos.
- El actor no recibe documentos globales, otro personaje, datos futuros ni instrucciones Markdown capaces de ampliar autoridad.
- Editar una proyección Markdown no cambia el journal ni convierte una propuesta en hecho.
- Configuraciones antiguas conservan sus hashes sin backfill. Fork y transferencia entre hosts preservan procedencia y contenido sin releer al padre o al árbol vivo.
- La GUI permite seleccionar/revisar/guardar, resolver conflicto de revisión y observar integridad por rol/job sin exponer prompts privados al público.

Puntos de integración ya existentes: `prepare-character.ts`, `continuista-review-context.ts`, `continuista-pi-worker.ts`, `director-pi-worker.ts`, `configurator-pi-worker.ts`, `fork-configuration.ts` y `backup-service.ts`. Pruebas relacionadas verificadas en el inventario: `preparation.test.ts`, `actor-turn-worker.test.ts`, `actor-world-projection.test.ts`, `production-preflight-host.test.ts`, `preparation-source-admission.test.ts`, `source-selection-ui.test.ts`, `fork-configuration.test.ts` y `external-backup-roundtrip.test.ts`. Esas pruebas existentes no acreditan todavía la integración propuesta.

Ampliación técnica del inventario durante implementación: la narración habilitada ya tiene un worker de revisión separado. Su fuente propia es [revisor de narración](../../obra/revisor-narracion/CONTEXT.md), ID `role.narration-reviewer`, secciones `process`/`cierre` correspondientes a los encabezados `Process`/`Cierre`. No reutiliza el contrato del Narrador para autoaprobarse. Esta adición documenta reglas del worker existente; su conexión a ICM se verifica en el corte v43 citado, con transporte controlado.

La [revisión del Configurador anterior a Ready](configurador-preparacion.md) concreta el recorrido completo y detecta que las tablas actuales de paquetes y wall-time dependen de una representación Ready. Su base de contratos no sustituye la autoridad durable de preparación ni acredita ejecución.
