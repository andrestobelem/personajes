# Recuperación de activaciones y diagnóstico seguro

Corte del 15 de octubre de 2026. Resuelve la omisión observada en [El visitante y el aviso](../representaciones/el-visitante-y-el-aviso.md). La [entrevista real](../diseno/dialogo-recuperacion-causas.md) conserva decisiones, alternativas y límites de autoridad.

## Recuperación explícita

Un job convocado por meta inicial o rutina puede tener inbox vacío. La selección anterior de `resume` sólo consideraba inputs liberados, por lo que omitía esas activaciones. Ahora revalida la invitación y permite una generación nueva ligada a la misma causa. El inbox de una intervención posterior conserva su causa e intención; no se agrega retrospectivamente a la activación ni se altera su corte congelado.

Journal v42 conserva enlaces de invitación por generación y añade `coordinator_pulses.parked_for_pulse_id`. El marcador sólo se registra durante la recuperación explícita. Puede apartarse un pulso posterior drenado cuyas intenciones pendientes estén impedidas por la activación que se recupera. Se conserva el mismo pulso, cuota, causa e intenciones; no se lo declara completado. Tras completarse la activación, se retoma el pulso marcado y se limpia el vínculo. Un pulso bloqueado cualquiera no obtiene esa autorización automáticamente.

La mutación y su selección comprueban solicitudes reservadas, despachadas o ambiguas del actor y sus descendientes Continuista, hijos activos y propuestas aceptadas pendientes. Las generaciones históricas sustituidas no bloquean la recuperación de un pulso por sí solas. No se reinician presupuestos ni se repiten sesiones por consultar una vista. El control gráfico de reintento admite tanto pausa como detención, igual que `resume`.

La migración conserva asignaciones previas y datos confirmados. El lector de backups reconoce el DDL histórico autorizado y copia columnas a un esquema construido por el host; no ejecuta DDL importado. La regresión de v39 reconstruye un esquema histórico sin el marcador futuro, y la migración lo incorpora una vez.

## Diagnóstico y limpieza

El Continuista conserva códigos existentes más específicos: `pi-incomplete`, `review-incomplete`, `recovery-required` y, después de comprobar elegibilidad, `job-inactive`. Un callback técnico comunica rol, IDs, generación, etapa y código cerrado. Excluye mensajes de excepción, stack, respuestas, prompts y rutas privadas; un callback fallido no altera el trabajo.

Las etapas de ese callback son telemetría, no un registro durable nuevo. El código de fallo del job sí permanece durable. Un fallo de `dispose()` no sustituye el error primario ni invalida un recibo ya aceptado y validado. No se solicita otra revisión por una limpieza fallida después de aceptar.

## Evidencia

`activation-retry-cause-parking.test.ts` prueba invitación sin percepción ficticia, generación nueva, testimonio separado, marcador, preservación de cuota y reasignación del mismo pulso sin repetir a otro participante. Después del pase global se extendió la misma regresión: ejecuta el último job con transporte controlado, completa el pulso humano, verifica marcador `NULL` e input consumido, reabre journal v42 y consulta la generación histórica bloqueada después de consumir su invitación. La focal posterior con `world-journal.test.ts` pasó 43/43 y typecheck pasó; sólo cambiaron tests. Las migraciones existentes pasaron 117/117. Las pruebas del Continuista incluyen secretos sintéticos, callback fallido y aceptación seguida de fallo de limpieza.

En el host real se migró y reabrió journal v42. Max publicó mediante generación 1; la inicial quedó bloqueada e intacta. La activación y el mismo pulso humano se observaron `completed`, con marcador `NULL`. También se recuperó explícitamente una revisión incompleta posterior de Hymie. La escena terminó en commit 15 y el episodio en commit 16, con 11 intervenciones. La evidencia y los límites están en el documento del ensayo.

La GUI se comprobó en 548 × 855: Interlocución expandida no se superpone con el diálogo, la detención no afirma trabajo actual por un registro histórico `running`, y la bandeja continúa disponible después del cierre. Un mensaje humano actual se distingue de un mensaje actoral legado sin audiencia humana registrada.

## Alcance que sigue abierto

Verificación global final con ICM real: **1275 tests, 1274 aprobados, cero fallos y una omisión** del caso de recuperación de proceso zombi exclusivo de Linux. Typecheck, build y whitespace aprobados. Las dos discrepancias iniciales de fixtures de backup se corrigieron reconstruyendo el esquema histórico, sin relajar la admisión de producción. Revisión independiente de las guardas corregidas sin nuevos bloqueos funcionales; su focal inicial detectó esos fixtures y no se presenta como otro pase global.

Una intervención durante trabajo activo todavía puede requerir recuperación manual: este corte no convierte respuestas obsoletas en válidas ni autoriza reintentos automáticos. Una activación cuya meta ya no está activa o cuya frontera de rutina pasó requiere una disposición técnica explícita futura; no se fuerza su elegibilidad ni se la declara aceptada. La calidad actoral, el ritmo audiovisual y los 77 criterios conservan su aceptación integral abierta.
