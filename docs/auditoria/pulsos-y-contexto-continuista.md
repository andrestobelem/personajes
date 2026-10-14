# Pulsos y contexto autorizado del Continuista

Este corte conecta componentes locales; todavía no conecta una representación al launcher, no invoca Luna ni demuestra un juicio LLM real. Las fuentes y pruebas sintéticas no se guardan como escenas de la obra.

## Pulso con causa durable

El journal v14 añade `coordinator_pulses`, vinculado al contador existente de `pulses`. `beginCoordinatorPulse` sólo opera sobre una corrida `running` con configuración Ready hash-verificada. Busca una causa real en el ledger de commits, agrupa sus intenciones entregadas y asigna jobs a personajes del reparto habilitado. Corrida, causa e ID de pulso son durables e idempotentes; otra convocatoria o un reinicio no obtiene una cuota nueva para la misma causa.

La disponibilidad efectiva se comprueba contra el reloj ficticio antes de asignar y despachar. Una entrada entregada despierto puede permanecer pendiente mientras el actor duerme; no se gasta cuota ni se usa polling de tiempo real para despertarlo.

Las asignaciones coordinadas y el inbox congelado se limitan a esa causa. Una percepción de otra intervención permanece pendiente. Un destinatario cuya entrega llega más tarde se incorpora al mismo pulso; el cierre espera las intenciones de esa causa aún sin entregar o asignar. Una aceptación Pi todavía sin commit no completa el pulso. El cierre comprueba la propuesta exacta del receipt y su commit de Escenario. Un job bloqueado conserva el diagnóstico; un retry explícito puede reabrir el mismo pulso con otra generación sin ampliar cuota.

`createCoordinatorPulseSupervisor` consume estos registros, convoca al worker actoral de forma serial por corrida y conserva las señales recibidas durante el procesamiento. Recupera propuestas aceptadas una vez por pasada y consulta el cierre durable; no repite un commit existente en un bucle. `close` cancela y espera los workers. El supervisor sigue sin ser creado por el launcher.

## Contexto del revisor

`assembleContinuistaReviewContext` lee la propuesta durable exacta, la preparación del actor con el hash registrado y el corte congelado autorizado. Incluye identidad, voz, antecedentes admitidos, capacidades, memoria inicial autorizada, experiencias propias hasta el corte y proyección privada del Escenario. Metas y vínculos actuales proceden de esa proyección. No incluye el snapshot global, expedientes ajenos, tokens del lease ni documentación de mantenimiento.

El paquete canónico tiene hash y un mapa de evidencia. `validateContinuistaContextReview` vincula la revisión con actor, propuesta, versión, contenido, revisión y hash de contexto exactos; rechaza evidencia fuera del mapa y una revisión incompleta como autorización. La presencia de una referencia acredita su pertenencia al paquete, no la corrección semántica del veredicto.

`createContinuistaReviewTool` entrega únicamente un candidato local mediante `submit_continuista_review`, comprueba vigencia/cancelación y rechaza revisiones o referencias ajenas. El replay idéntico conserva candidateId/hash; otro payload genera conflicto. La revisión incompleta queda como diagnóstico. Nada de esto habilita un commit antes de un terminal administrativo durable.

El prompt distingue los datos de las instrucciones de control y prepara la entrega por una tool estructurada; el texto final del asistente no se publica como revisión. La falta de un ledger de metaindicaciones y de calibración audiovisual medida permanece explícita: no se inventan instrucciones vigentes ni mediciones.

## Evidencia y pendientes

- [Pruebas del journal](../../tests/world-journal.test.ts): migración poblada, causas, destinatarios tardíos, reinicio, cuota y cierre por commit.
- [Pruebas del supervisor](../../tests/coordinator-pulse-supervisor.test.ts): convocatoria, recuperación, agrupación, bloqueo y cancelación con journal real; su ejecutor actoral de prueba está identificado.
- [Pruebas del contexto](../../tests/continuista-review-context.test.ts): construcción con worker/journal/proyección locales, exclusión de secretos, fechas y referencias exactas.

El corte posterior [Continuista Pi v15](continuista-pi-y-recibos.md) implementa ledger/checkpoints administrativos y el worker con presupuesto compartido. Siguen pendientes la reconciliación del terminal parental, el tiempo operativo acumulado, control de lifecycle desde API/GUI y convocatoria desde el launcher. El paquete contextual y el supervisor no sustituyen estos componentes ni la verificación OAuth/live.

Gate global: TypeScript y 189 pruebas aprobadas, cero fallos y omisiones, con ICM 0.11.4 real; build correcto. Estos resultados verifican contratos locales y no inferencia de Luna ni GUI de representación.
