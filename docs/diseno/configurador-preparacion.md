# Configurador de preparación anterior a Ready

Corte de diseño: 16 de octubre de 2026. Continúa la [decisión ya discutida](dialogo-icm-runtime-admision.md#3-configurador-antes-de-ready) y el [plan ICM](plan-icm-markdown-runtime.md). Revisión del código por `new_preparation_flow_audit` y el integrador. No son preferencias nuevas atribuidas al usuario. El Configurador de evolución existente no acredita este recorrido.

## Recorrido completo requerido

1. Guardar un borrador, aunque tenga campos incompletos; admitir fuentes ICM del Configurador, elegir fuentes documentales concretas, perfil y presupuesto. El pedido especifica qué preparación se solicita.
2. Crear un trabajo durable ligado al principal local, representación, revisión y hash del borrador, fuentes congeladas, perfil, presupuesto y pedido. Crear/leer no infiere. Iniciar o reintentar es una operación explícita con idempotencia.
3. Comprobar acceso real al perfil elegido, SDK, integridad y disponibilidad administrativa. No exigir reparto curado, SQLite de personajes o Ready como condición de una ayuda destinada a completar esa preparación.
4. Usar una instancia Pi administrativa independiente, con `preparation-cut`, contexto ICM congelado y herramientas limitadas a presentar la propuesta. Sin lectura ambiental ni herramientas de actuación.
5. Mostrar diferencias, motivos, fuentes, adaptaciones y vacíos por sección de puesta y por personaje. Una propuesta disponible no es configuración confirmada ni canon.
6. Aplicar sólo elecciones revisadas por el operador mediante CAS y recibo idempotente, manteniendo versiones anteriores. Después continúan validación Ready, preparación de memorias y preflight de ejecución existentes.

La ayuda debe abarcar situación, continuidad, línea dramática, Escenario y contexto situado por actor. Reducirla a adaptar un expediente dejaría pendiente el trabajo de preparación. El modelo no cambia perfil, presupuesto, fuentes ICM ni identidad humana elegidos por el operador. Tampoco produce autoría, consentimiento o procedencia administrativa que sólo puede registrar el host.

## Fronteras de propuesta y aplicación

El contrato de entrada congela el borrador exacto y sus fuentes host-admitidas; una coincidencia de checksum no demuestra origen. Los expedientes de los actores seleccionados se identifican por sus versiones concretas. El paquete usa el contrato procedural del Configurador, no contextos actorales de ejecución ni el árbol vivo como fallback.

Las sugerencias son valores de dominio tipados con sección destinataria, motivo, referencias y vacíos explícitos. Distinguen respaldo documental y adaptación propuesta. Sólo se citan fuentes admitidas; no se eliminan silenciosamente vacíos ni contradicciones del expediente original. Un schema puede comprobar integridad y atribución, no demostrar que una afirmación esté semánticamente respaldada: esa revisión permanece visible al operador.

Una propuesta de Escenario describe condiciones iniciales; no incluye mentes, recuerdos vividos, ofertas de actuación ni permisos ficticios fabricados. La curación actoral propuesta tampoco adquiere autoría ni evidencia por declararlas el modelo. El overlay de revisión permanece propuesto y separado del borrador guardado. La posterior aceptación genera los metadatos del host y vuelve a validar el dominio completo.

Cambiar el borrador o sus fuentes invalida la elegibilidad del trabajo anterior. Su resultado histórico se conserva y no sobrescribe la revisión nueva. Reintentar después de interrupción crea otra generación; la recuperación no vuelve a inferir implícitamente ni reemplaza paquetes faltantes por texto actual.

## Necesidades de persistencia y presupuesto identificadas en el diseño inicial

Los borradores existen sin `world_runs`. Hoy `icm_context_packets` y `model_time_run_state` dependen de esa tabla; la política de wall-time/concurrencia/llamadas ilimitadas se obtiene de Ready. Reutilizar únicamente `configureRun` y `reserveNextRequest` antes de Ready dejaría un contador legacy sin las garantías actuales. Crear una representación o un Ready ficticios para satisfacer la dependencia también sería incorrecto.

La implementación necesita autoridad de preparación explícita, ligada al borrador/trabajo, que conserve llamadas y tiempo medidos al cambiar de revisión y al llegar a Ready. `null` mantiene el significado de ausencia de tope; timeout por solicitud, concurrencia y rechazo conservador ante medición incierta siguen vigentes. No se agrega una cuota de tokens ni se reinician contadores al editar.

Persistir en el journal del host: trabajo/generación/lease, entrada y fuentes congeladas, paquete ICM, sesión/checkpoints físicos, reservas/spans, candidato y prueba terminal, operaciones HTTP y recibo de aplicación. La composición debe conservar aislamiento por principal/representación y soportar cancelación y reinicio sin ejecutar modelos al leer. La integración con respaldo debe preservar estos registros; su aceptación ampliada entre hosts sigue en V2 y no se convierte en un nuevo camino crítico.

## Evidencia necesaria para cerrar este flujo

- Borrador incompleto real → job → SDK Pi con transporte controlado → propuesta → revisión/aplicación → Ready, con SQLite y checkpoints JSONL reales.
- Sin selección/fuente admitida, sin acceso o con ICM corrupto: ningún despacho al proveedor.
- Perfil fijo, sin fallback; llamadas/tiempo ilimitados correctamente medidos y límites operativos respetados.
- Cancelación, timeout, competencia entre solicitudes, interrupción/reinicio y retry sin doble despacho ni doble aplicación.
- CAS perdido, respuesta perdida y replay exacto; un candidato anterior no sustituye cambios posteriores.
- Propuestas con fuentes ajenas, memoria vivida inventada, permisos/autoría falsos o actor no elegido se rechazan estructuralmente; vacíos y adaptaciones permanecen visibles.
- GUI desde nueva preparación hasta revisión y aceptación; luego una puesta real iniciada por controles existentes. Pruebas puras del contrato no acreditan este recorrido.

Este documento fija el trabajo completo y sus límites. La base de contratos se implementa por separado; no debe presentarse como un Configurador ejecutable mientras falten autoridad de presupuesto, persistencia, worker, API y GUI.

## Primer corte histórico: base pura sin workflow ejecutable

Contratos, compilación/validación y overlay de revisión están implementados y pasaron dieciséis focales (ocho nuevos), con typecheck aprobado. La proyección no entrega contratos Markdown ajenos al Configurador. Son funciones puras sobre entradas ya admitidas; no establecen ownership ni autorización durable. Falta conectar la persistencia/presupuesto anteriores, tool, worker, API y GUI. [Evidencia y límites](../auditoria/inspector-icm-y-base-configurador.md).

## Implementación posterior

El corte v44 conecta autoridad de presupuesto previa a Ready, ledger, worker Pi, API, revisión gráfica y aplicación selectiva mediante CAS y recibos. Las curaciones actorales parciales se guardan separadas de los actores habilitados. La [auditoría de implementación](../auditoria/configurador-preparacion.md) delimita los resultados de pruebas y la aceptación que aún falta; las carencias anteriores describen el punto de partida y no el estado actual de cada módulo.
