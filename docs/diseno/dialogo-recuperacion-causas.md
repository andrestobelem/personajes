# Diálogo: recuperación explícita de causas bloqueadas

Fecha: 15 de octubre de 2026. Intercambio real entre `human_reception_interviewer` y `human_reception_custodian`, por encargo del integrador. Se condensan preguntas y respuestas efectivamente intercambiadas. Las propuestas técnicas no son preferencias expresas del usuario ni acreditan implementación o ejecución.

## Evidencia y pregunta

El integrador informó un caso observado en la representación identificada por el prefijo `5c94`: una activación inicial de Max quedó bloqueada sin inbox; un pulso humano posterior permaneció `running`, Hymie respondió y una intención de Max siguió pendiente porque la causa anterior lo excluía. La inspección de `src/adapters/journal.ts` corroboró dos obstáculos: el helper de retry exigía intenciones de percepción y la selección de `resume` con `retryBlockedActors` exigía entradas `released`. Durante la ronda ya se preparaba una rama del helper para invitaciones de activación elegibles sin inbox; esa corrección parcial aún no resolvía la ocupación del pulso. Reabrir la causa antigua también debía respetar la exclusión de un único pulso en ejecución.

**Pregunta del entrevistador:** ¿puede una recuperación explícita marcar `blocked` al pulso ocupante sólo cuando esté técnicamente drenado, conservando causa, identificadores e intenciones, para reabrir la causa antigua? Se recomendó operación transaccional con CAS, nunca retry automático ni alteración retrospectiva del corte privado. Se exigió comprobar trabajo activo y reservas inciertas, incluidos descendientes Continuista y transporte.

**Respuesta del custodio:** sí, como **propuesta técnica del integrador** que cumple recuperación explícita y preserva agencia. El estado `blocked` del ocupante no es una preferencia humana ni un requisito textual. Debe conservar causa, ID, cuota, diagnóstico de dependencia e intenciones pendientes, sin marcar falsamente `completed` ni inventar un fallo ficticio.

El ocupante sólo está drenado si no tiene trabajo vigente ejecutable o activo, descendientes Continuista/Director con autoridad pendiente, propuesta/revisión aceptada pendiente de commit, ni reserva sin liquidar que mantenga transporte o incertidumbre. Un actor terminal no prueba que su revisión o publicación terminó; una lease vencida no prueba que un transporte ambiguo desapareció. Esos casos impiden apartarlo.

## Challenge

**Pregunta del entrevistador:** el pulso humano conserva una intención de Max `queued`, actualmente no ejecutable por la causa anterior. ¿Exigir ausencia de toda intención pendiente crearía una dependencia circular? ¿Puede conservarse esa intención, apartar el pulso y retomarlo después con su mismo ID, sin repetir la respuesta aceptada de Hymie? Además, ¿la elegibilidad actual permite modificar el corte congelado anterior o absorber el inbox humano posterior en la activación inicial?

**Respuesta del custodio:** la intención impedida por una dependencia no equivale a trabajo ejecutable. Debe permanecer `queued`; apartar el pulso conserva su identidad y expresa una dependencia técnica. Retomar el mismo pulso al liberarla evita perder el aviso humano y duplicar lo ya aceptado. El retry no reescribe `frozenDirectionRevision`, `activeSceneId` ni el claim anterior. Si el contrato vigente captura un contexto curado para una generación nueva, esa captura es separada: nunca agrega entradas retroactivamente a la generación previa ni atribuye el inbox posterior a su causa inicial.

## Decisión y fuentes

Se adopta como decisión técnica implementable la reconciliación explícita del ocupante drenado antes de reabrir la causa antigua, en la misma transacción que verifica autoridad/CAS y preserva replay idempotente. No se reinician cuotas, no se consumen intenciones por apartar un pulso y no se admiten respuestas tardías sin autoridad. Trabajo activo o incertidumbre dejan diagnóstico recuperable y bloquean la operación; un timeout de observación no acredita drenaje.

El custodio clasificó recuperación, GUI y agencia como requisitos; conservación, no duplicación, CAS y tratamiento de incertidumbre como reglas derivadas; y el mecanismo de apartar un pulso como propuesta técnica del integrador. No quedaron preferencias humanas necesarias para este alcance y no se realizaron llamadas al proveedor por esta entrevista.

Fuentes utilizadas:

- [PRD](../PRD.md), §4.3, ACT-06, ACT-11, MEM-05, TIM-02 y UI-07: conservar confirmados/pendientes, recuperar errores y separar estado técnico de decisiones ficticias.
- [S02](../specs/02-persistencia-e-icm.md), ledger de pulsos, jobs y reservas, v13/v14 y contexto congelado: conservar causa/ID/cuota y generaciones explícitas; no reciclar reservas ambiguas por timeout.
- [S03](../specs/03-pi-y-coordinacion.md), retry explícito, autoridad de commit, coordinación y recuperación: commits seriales, revalidación y ausencia de retry automático.
- [Procedimiento de grill-with-docs](procedimiento-grill-with-docs.md): entrevistador y custodio separados, respuestas delegadas clasificadas y registro de los intercambios reales.

Este documento fija el diseño acordado; pruebas de atomicidad, guardas de descendientes/reservas, replay y preservación de ambas causas deben aportar evidencia de la implementación por separado.
