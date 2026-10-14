# Tools tipadas y reformulación en una misma sesión

Fecha: 14 de octubre de 2026. Esta evidencia describe código y SDK locales; no una actuación de Luna.

El schema publicado por `propose_action` se deriva de las doce variantes de `WorldAttemptSchema`, quitando `attemptId`, `runId`, `actorId` y `expectedRevision`. Son campos que aporta el host. La definición conserva objetos cerrados, discriminantes, campos requeridos y límites representables en JSON Schema. Zod sigue comprobando todas las reglas de ejecución, incluidas las refinaciones semánticas que JSON Schema no representa.

La conversión usa [`z.toJSONSchema`](https://zod.dev/json-schema) de Zod 4.6.5 en modo input, sin fallback a `any`, y `Type.Unsafe` para transportar ese JSON Schema mediante el contrato TypeBox de Pi. El nombre de esa API no sustituye validación: [los tests](../../tests/actor-tools.test.ts) invocan `validateToolArguments` del SDK Pi instalado y comprueban aceptación de una acción válida y rechazo de variantes desconocidas, campos ausentes, duraciones negativas y autoridad aportada por el modelo. Las fuentes de la API Zod se consultaron mediante Context7; también se revisó el validador del paquete Pi 1.2.0 instalado.

`getProposalVersion` es un callback privado del host. El worker cambia la versión sólo entre prompts asentados y después de una revisión de reformulación. Las mismas tools y la misma sesión pueden registrar versión 2 o 3 sin cambiar identidad, corte ni historial tentativo. La versión se valida de nuevo al ejecutar; el modelo no recibe parámetros para elegirla. El journal conserva el techo, los slots y la exigencia de una revisión completa previa.

Cada generación tiene un ID de propuesta determinista distinto. Las versiones de reformulación comparten el ID de su generación; un reintento explícito en otra generación no choca con una propuesta interrumpida. Una segunda llamada con el mismo slot y contenido conserva la idempotencia del journal.

Este cambio prepara la orquestación del worker. No implementa por sí mismo revisión LLM, login, transporte productivo, planificación de pulsos ni publicación gráfica.
