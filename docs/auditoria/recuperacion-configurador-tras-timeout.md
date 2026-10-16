# Recuperar la preparación después de un transporte interrumpido

El 16 de octubre de 2026, la curación simultánea de Max, 99 y el Jefe en el run `803a8675-2ad0-47ed-9d76-c7f8a64743a1` quedó bloqueada. El primer trabajo (`ef97af6b-a018-4680-99cc-76b84e231c8d`) no despachó por acceso vencido; el sondeo OAuth se renovó a las 07:19:04.988 UTC. El segundo (`47bf0567-0441-4f19-951e-3562bd163389`) terminó `PREPARATION_CONFIGURATOR_TERMINAL_INCOMPLETE`: el registro físico Pi contiene una respuesta abortada por timeout, sin propuesta aceptada. No hay biografías generadas que puedan promoverse desde ese trabajo.

## Problema y corrección

La solicitud quedó `ambiguous`, pero su transporte sí había terminado: `model_time_spans.state=settled`, 180008 ms medidos y cero tiempo reservado. El guard de preparación trataba toda respuesta ambigua como transporte todavía incierto y bloqueaba indefinidamente crear otro trabajo, aplicar o promover Ready. El presupuesto temporal ya distinguía ambas cosas.

La corrección conserva la solicitud ambigua y todo el consumo. Sólo permite un **trabajo nuevo** cuando el anterior es terminal y cada transporte ambiguo tiene asentamiento verificable: ámbito, epoch, owner, inicio/fin, duración derivada y hash exactos. Una reserva activa, tiempo incierto o consumo histórico desconocido siguen bloqueando. El trabajo incompleto no puede abrir otra solicitud ni obtener una prueba terminal válida; su candidato no se reutiliza. Crear un trabajo nuevo sigue siendo explícito, con IDs, sesión y contexto propios.

También se diferencia el diagnóstico de acceso vencido/ausente: la interfaz explica que se debe comprobar el modelo en Acceso a Pi y registrar una propuesta nueva. Los errores arbitrarios del proveedor no se muestran. Esto no renueva credenciales ni ejecuta sondeos automáticamente.

## Evidencia disponible

- Presupuesto con SQLite real: 11 pruebas aprobadas, incluidas conservación del cobro, bloqueo durante transporte incierto, nueva solicitud independiente y rechazo de duración/hash adulterados.
- Worker con SDK Pi y transporte controlado: 6 pruebas aprobadas; no usa proveedor externo.
- Diagnóstico de admisión y panel montado: 7 pruebas aprobadas, sin reintento automático ni filtración de errores privados.
- La ejecución real de la recuperación y la nueva curación siguen pendientes de integrar y verificar; estos tests no las acreditan.

La aclaración del usuario sobre [interacción libre](../diseno/concepto-y-decisiones.md#interacción-libre-y-alcance-de-la-representación--aclaración-del-usuario-16-de-octubre-de-2026) es independiente: corregir el presupuesto no añade iniciativa actoral ni transforma una escena breve en un episodio completo.
