# Rutinas diarias y día/noche: respuestas del custodio

15 de octubre de 2026. Entrevista delegada entre `daily_interviewer` y `daily_custodian`, coordinada por el integrador. Este registro conserva respuestas efectivamente enviadas. Las propuestas de agentes no son elecciones artísticas del usuario ni acreditan implementación.

## Fuentes y estado previo

- [Constitución](../constitucion.md), §9: ritmo circadiano, descanso, disponibilidad y encuentros; no todos duermen simultáneamente ni cada día cierra una trama.
- [PRD](../PRD.md), TIM-01 y §4.6: reloj ficticio, rutinas, disponibilidad; pausa congela reloj y nuevas convocatorias; avance fuera de línea desactivado por defecto.
- [S01](../specs/01-dominio-y-catalogo.md), reloj: convención `fixedOffset` o `ianaZone`, instante ficticio seguro, resolución inicial explícita de ambigüedades y huecos, sin reloj del equipo.
- [Auditoría previa](reloj-y-rutinas.md): intervalos absolutos ya conectados; recurrencia y día/noche pendientes al corte 40.
- [Glosario](../../GLOSSARY.md): ritmo circadiano distinto del arco dramático.

## Ronda 1

### Q1. Ventanas locales recurrentes, medianoche y disponibilidad predeterminada

**Requisito expreso:** TIM-01 requiere horarios, rutinas y disponibilidad; no prescribe horarios concretos para Max, 99 ni otro personaje.

**Regla derivada:** conservar `always` y ventanas absolutas existentes sin reescribir hashes históricos. Fuera de ventanas rige `defaultState`; la rutina se combina con disponibilidad explícita, preparación y escena. Por sí sola no concede permiso para actuar. No se inventa una rutina para quien carece de preparación.

**Propuesta aceptada para implementación:** intervalos locales diarios semiabiertos `[inicio,fin)`, con fin menor que inicio para cruce de medianoche. Inicio igual a fin es inválido. Se rechazan solapes circulares, incluido último/primero. Conservar el intervalo original y derivar segmentos para validación evita alterar la intención nocturna. Una ventana 22–06 termina a las 06 exclusivas del día siguiente.

**Aclaración posterior del integrador:** minutos enteros, `fromMinute`/`toMinute`; `[0,1440)` representa el día completo sin usar inicio igual a fin. El custodio aceptó esa excepción y recomendó permitir 1440 como fin, sin convertir silenciosamente un inicio 1440 en otra fecha.

### Q2. Convención IANA y cambio de horario

**Regla derivada:** IANA no se sustituye por el offset actual ni por el reloj real. La política recurrente no reinterpreta un instante inicial ya guardado.

**Propuesta inicial del custodio:** resolución explícita para horas repetidas e inexistentes, con alternativas primera/segunda y omitir/desplazar; sólo necesaria para IANA. Eran alternativas técnicas, no requisitos ni decisiones humanas.

**Rectificación ante propuesta concreta del integrador:** una política explícita única `compatible`, elegida y guardada al preparar, es válida si la interfaz explica «primera ocurrencia de una hora repetida; desplazamiento por el hueco de una hora inexistente». Esto conserva soporte IANA ejecutable sin un default oculto. `fixedOffset` no necesita una elección DST ficticia.

Si la resolución de extremos produce duración nula o invertida, omitir ese intervalo con diagnóstico determinista; nunca interpretarlo como disponibilidad infinita. Probar hueco y repetición tanto en pertenencia como en siguiente límite, además de la validación textual.

### Q3. Clasificación día/noche y luz material

**Propuesta aceptada:** clasificación derivada del instante ficticio, su convención y dos minutos locales explícitos distintos (`dayStartsAtMinute`, `nightStartsAtMinute`), opcional para registros previos.

**Regla derivada:** el ciclo no muta `lighting`, no materializa automáticamente un amanecer físico y no despierta a un personaje no disponible. Las rutinas sí deben condicionar acceso, percepción, convocatoria y encuentros; clasificar día/noche no sustituye esa causalidad. Las horas son convención de puesta, no cálculo astronómico ni horarios humanos ya elegidos. No se imponen 06/18, ocho horas de sueño o igualdad entre personajes.

## Ronda 2

### A. Una acción cruza varias ventanas o días

**Regla derivada:** no ejecutar decisiones retroactivas en ventanas ya atravesadas. Si el actor termina disponible y cruzó el inicio efectivo del intervalo disponible actual, corresponde como máximo una invitación con `boundaryAt` estable. Si termina indisponible no se convoca. Ventanas contiguas sin cambio efectivo, incluso entre fechas, medianoche y repetición IANA, no duplican invitación.

### B. Próximo límite

**Propuesta coherente con contratos existentes:** rutinas de actores preparados, presentes y pertinentes a la escena activa abierta. Los límites día/noche pueden avanzar aun sin actores si se configuró el ciclo y hay escena abierta. No abrir ni rellenar escenas para producir avance.

El siguiente límite debe ser estrictamente posterior al instante actual y no superar `maxAdvanceMs`. Cero bloquea; no fabricar avances parciales para alcanzar una frontera demasiado lejana. Mantener enteros seguros y diagnosticar desbordamiento.

### C. Pausa, trabajo pendiente, presupuesto y persistencia

**Regla derivada:** no usar latencia, reloj real ni duración fuera de línea. Respetar lifecycle, trabajos con autoridad de commit, CAS e idempotencia existentes. El nuevo día no reinicia el presupuesto de inferencia; ese gasto no es metabolismo ficticio. Promesas, objetivos y conflictos continúan al cambiar el día.

No añadir defaults o campos derivados al parsear snapshots históricos: cambiaría su contenido canónico y sus hashes. Las proyecciones pueden derivar estados a partir del corte confirmado sin reescribirlo.

## Pendientes y límites

No hay una preferencia humana sobre horarios concretos, rutinas individuales, duración del día o política creativa de sueño. Esos valores se preparan explícitamente para una puesta. La entrevista no acredita simulación fisiológica, ciclos solares científicos, inferencia real de proveedores ni puesta representada.
