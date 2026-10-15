# Diálogo sobre rutinas diarias y día/noche

15 de octubre de 2026. Entrevista real entre `daily_interviewer` y `daily_custodian`, coordinada por el integrador. Aplica [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md), [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) y el [procedimiento del proyecto](../diseno/procedimiento-grill-with-docs.md).

Las [respuestas conservadas por el custodio](rutinas-diarias-respuestas.md) complementan este registro.

Las decisiones siguientes son propuestas técnicas delegadas dentro del encargo de implementación; no se atribuyen al usuario horarios, hábitos de personajes ni preferencias artísticas. Este registro no acredita ejecución. La evidencia de código y pruebas corresponde a sus documentos de implementación.

## Evidencia y árbol de decisiones

Se leyeron las entradas README, índice, constitución y glosario; PRD TIM-01, ACT-06 y controles de ejecución; S01 reloj, S02 persistencia, S03 coordinación, S05 preparación; diseño de tiempo y auditoría del reloj. Se contrastaron `AvailabilityRoutineSchema`, evaluación de disponibilidad y `actor-activation.ts` existentes.

El árbol examinado fue: (1) calendario local → intervalos diarios y medianoche → resolución IANA; (2) clasificación día/noche → separación de luz material; (3) fronteras efectivas → convocatorias y saltos → guards de escena, lifecycle y presupuesto. Se mantuvieron cerradas las decisiones existentes de reloj ficticio, no avance fuera de línea, pausa y contextos privados.

## Ronda 1: intervalos, DST y luz

**Pregunta 1 del entrevistador.** Se propusieron intervalos diarios locales semiabiertos, fin anterior al inicio como cruce de medianoche, igualdad inválida y rechazo de solapes circulares. ¿Qué evidencia preserva disponibilidad predeterminada y actor sin rutina?

**Respuesta del custodio.** TIM-01 y constitución §9 exigen horarios/rutinas/disponibilidad sin imponer descanso simultáneo. Se preservan `always`, ventanas absolutas y `defaultState` sin reescribir hashes históricos. La rutina se intersecta con disponibilidad explícita, preparación y escena; no autoriza por sí sola un actor. Una ventana 22–06 comprende dos fechas, termina a las 06 de modo exclusivo y puede haber comenzado el día anterior sin inventar acontecimiento. Se recomienda conservar el intervalo original y derivar segmentos sólo para validación/evaluación; persistir dos intervalos normalizados perdería intención y complicaría revisión.

**Aclaración del integrador comunicada al custodio.** Usar minutos locales, permitir 0→1440 como día completo; 1440 sólo como fin. Inicio=fin sigue siendo inválido.

**Respuesta del custodio.** Es una excepción explícita coherente. Admitir 1440 como inicio exigiría otra normalización declarada; se recomienda no admitirlo.

**Pregunta 2 del entrevistador.** S01 exige elección visible para fecha inicial ambigua/inexistente. Para recurrencia IANA, ¿qué política resuelve horas repetidas y huecos sin sustituir IANA por offset fijo ni aplicar defaults ocultos?

**Primera respuesta del custodio.** No hay política diaria elegida por el usuario. Propuso alternativas explícitas: primera/segunda repetición y omisión/desplazamiento de horas inexistentes. FixedOffset carece de esa ambigüedad. Una política que produzca intervalo de duración nula/inversa no puede convertirse en disponibilidad infinita. Pertenencia directa a hora de pared, que puede incluir ambas repeticiones, es otra política y no equivale a resolver una sola ocurrencia.

**Aclaración del integrador comunicada al custodio.** Se propone una política única `compatible`, elegida y guardada explícitamente al preparar IANA: primera ocurrencia repetida; hora inexistente desplazada por el salto. Resolver mediante una biblioteca Temporal, sin algoritmo casero de zona. La semántica debe ser la misma en elegibilidad y próxima frontera.

**Rectificación del custodio.** Acepta esa política única explícita como propuesta técnica válida; sus alternativas iniciales no eran requisito. La preparación debe explicar el significado. FixedOffset no necesita una elección DST ficticia. Intervalos resueltos nulos/invertidos se omiten con diagnóstico determinista; no se vuelven infinitos. La política recurrente no reinterpreta el instante inicial ya guardado.

**Pregunta 3 del entrevistador.** ¿Puede día/noche ser clasificación editorial derivada del instante con horarios explícitos, sin cambiar luz física ni despertar personajes?

**Respuesta del custodio.** Sí: dos minutos distintos y convención del reloj, opcional en snapshots existentes. No muta `lighting` ni introduce un amanecer no configurado. TIM-01 exige además que rutinas efectivas sí condicionen acceso, percepción, convocatoria y encuentros; la clasificación no debe sustituir ese comportamiento por decoración. Día/noche no despierta a quien no está disponible. No son fases solares científicas ni implican horarios 06/18 o duración fija de noche.

## Ronda 2: fronteras, saltos y controles

**Pregunta A del entrevistador.** Si una acción cruza varias ventanas o días y termina disponible, ¿sólo corresponde el comienzo efectivo del intervalo actual, sin recuperar turnos perdidos ni duplicar fronteras disponibles contiguas?

**Respuesta del custodio.** Correcto como regla derivada. Una invitación con `boundaryAt` estable sólo si se cruzó el comienzo efectivo del intervalo disponible actual. Si termina indisponible, cero. Ventanas disponibles contiguas no duplican, tampoco entre fechas, medianoche o repetición IANA. No se inventan decisiones pasadas, ni se abandonan metas o promesas al cambiar el día.

**Pregunta B del entrevistador.** ¿Próxima frontera de rutina sólo para actores preparados/presentes en escena abierta y del reparto, mientras día/noche puede dar frontera sin actores si hay ciclo explícito, siempre exigiendo escena abierta?

**Respuesta del custodio.** Correcto. No activar al actor fuera del reparto, rellenar escenas automáticamente ni avanzar tras cerrar la última. Una frontera de día/noche puede existir sin actores si el calendario está configurado y hay escena abierta.

**Pregunta C del entrevistador.** ¿El reloj automático puede alcanzar frontera sin LLM, pero conserva guards de pausa/stop/trabajo con commit, y presupuesto durable sin reinicio diario?

**Respuesta del custodio.** Correcto. Sólo tiempo ficticio; no latencia, host o recuperación de tiempo fuera de línea. Se conservan CAS/idempotencia y límites existentes del avance v32. La próxima frontera debe ser estrictamente mayor que ahora y no exceder el máximo por salto; cero bloquea y no se hacen avances parciales. Validar overflow seguro y no insertar campos derivados al parsear snapshots antiguos. Gasto de inferencia no es metabolismo ficticio: el cambio de día no reinicia el presupuesto.

## Resultado, alternativas y pendientes

Contrato recomendado al integrador: rutinas diarias locales semiabiertas con default explícito y solapes circulares rechazados; política IANA `compatible` declarada; ciclo día/noche opcional y separado de luz material; disponibilidad, percepción y planificación comparten la resolución de intervalos; sólo transiciones efectivas presentes producen convocatoria y no hay recuperación de actuación perdida. La evaluación debe cubrir noches, días contiguos, saltos DST, salto por acción, ciclo sin reparto y ausencia de escena.

No se eligen horarios canónicos ni solares, descanso fisiológico, velocidad de ejecución, rutina para un personaje sin preparación ni simulación fuera de línea. No se amplía autoridad de dirección o herramientas actorales. Las alternativas DST descartadas para este corte siguen siendo posibles ampliaciones explícitas, sin sustituir silenciosamente la política guardada.

La implementación debe acreditar esta propuesta mediante pruebas y UI; este diálogo no permite marcar TIM-01 integralmente aceptado ni afirmar inferencia real. Las definiciones de dominio y contratos definitivos corresponden al glosario/specs mantenidos por el integrador.
