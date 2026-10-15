# Cambios de circunstancia: respuestas del custodio

Entrevista efectiva del 15 de octubre de 2026 entre `circumstance_interviewer` y `circumstance_custodian`, coordinada por el agente integrador. Sigue el [procedimiento del proyecto](../diseno/procedimiento-grill-with-docs.md). Estas respuestas son decisiones de diseño delegadas dentro del encargo; no preferencias de puesta atribuidas al usuario ni evidencia de implementación.

Fuentes: [constitución](../constitucion.md), especialmente §§5–6 y 8–10; [S01](../specs/01-dominio-y-catalogo.md), puesta/dirección, resolución y tiempo; [S03](../specs/03-pi-y-coordinacion.md), lifecycle y revalidación; [S04](../specs/04-api-y-autoridad.md), autoridad, CAS e idempotencia; [auditoría previa](cambios-de-circunstancia.md). No se realizaron nuevas afirmaciones de canon.

## Ronda 1: preguntas y respuestas

### A. Lifecycle y trabajo pendiente

**Pregunta efectiva.** El entrevistador propuso admitir cambios físicos sólo en pausa y sin pulso, turno, intención o entrega pendiente; preguntó qué requisito determina el lifecycle y qué trabajo debe bloquear. Luego desafió la respuesta con una entrega antigua que conserva su corte confirmado.

**Respuesta.** **Falta información expresa del usuario:** no fijó `running` o `paused` para este comando. **Regla derivada:** la pausa prohíbe nuevas convocatorias y avance del reloj, conserva propuestas y exige revalidación al reanudar; no prohíbe toda operación administrativa. **Propuesta técnica aceptada entre agentes:** admitir `running` y `paused` en un punto serializable sin pulso activo, step activo ni trabajo actoral/Continuista con permiso vigente de commit. La comprobación y la resolución deben compartir transacción con CAS; competir con apertura de pulso o reclamación de job tiene que producir un único ganador verificable.

Outbox, inbox e intenciones pendientes no bloquean por sí solos: corresponden a hechos confirmados y su percepción conserva el corte original. Una entrega posterior no obtiene información del snapshot nuevo por su mera demora; el siguiente reclamo actoral revalida estado y época y construye el contexto vigente autorizado. Deben comprobarse también jobs en cola o propuestas aceptadas sin commit si pueden existir fuera de un pulso activo: no basta asumir el invariante. Si esa serialización no se acredita, limitar temporalmente a pausa y quiescencia es una limitación técnica explícita, no un requisito humano.

**Rectificación real.** El entrevistador retiró el bloqueo general de entregas/intenciones pendientes. No se adoptó su propuesta inicial de pausa obligatoria.

### B. Catálogos y compatibilidad

**Pregunta efectiva.** Cinco familias requeridas; ambiente por claves de catálogo y aparición por una definición preautorizada con geometría/procedencia. ¿Catálogo global o de corrida y de dónde sale la compatibilidad?

**Respuesta.** **Requisito contractual existente:** S01 exige puerta, iluminación, disponibilidad de dispositivo, condición ambiental y aparición de objeto compatible, con operaciones cerradas. **Reglas derivadas:** situación temporal, procedencia y conocimiento situado impiden que el texto del cliente o un catálogo global habiliten objetos arbitrarios.

**Propuesta técnica:** catálogo autorizado versionado por corrida y fijado en la configuración Ready. Un catálogo editorial global puede aportar candidatos seleccionados explícitamente; no concede autorización automática. Las definiciones ambientales tienen claves estables, estados admitidos y presentación sensorial por modalidad/alcance; no generan efectos físicos secundarios que el motor no implemente. Las definiciones de objetos contienen presentación, geometría, portabilidad, cantidad/condición y procedencia de puesta. El comando elige definición y lugar/posición autorizados; el host genera la identidad de entidad. No acepta objeto arbitrario ni instrucciones ejecutables.

Compatibilidad editorial se acredita en configuración mediante continuidad, fecha, fuentes o adaptación declarada; compatibilidad mecánica se revalida al resolver mediante alcance, escena, posición, colisiones y límites. No se deduce canon del nombre ni se delega al modelo una autorización física. **Falta información de puesta:** el contenido del primer catálogo; puede quedar vacío hasta configuración explícita. Las pruebas pueden usar adaptaciones sintéticas identificadas sin convertirlas en puesta real.

### C. Percepción de transiciones

**Pregunta efectiva.** ¿Usar observadores elegibles antes o después al apagar luz o cambiar puerta? ¿La disponibilidad interna de un dispositivo sólo produce percepción con señal configurada?

**Respuesta.** **Regla derivada:** el actor recibe efectos perceptibles confirmados, no principal, motivo ni catálogo privado. **Propuesta técnica:** elegibilidad de transición por unión de condiciones sensoriales previas y posteriores, conservando presencia y disponibilidad del receptor en el corte y respetando modalidad, camino y alcance. Esto permite percibir un oscurecimiento aun cuando la visión posterior ya no alcance.

La unión sólo habilita percibir la transición pertinente: no entrega una unión de snapshots ni objetos secretos. Abrir una puerta puede revelar lo que resulte perceptible después según las reglas del Escenario. La percepción no inventa un actor emisor. Disponibilidad interna de dispositivo no se anuncia automáticamente sin señal configurada y detectable. La proyección posterior tampoco debe divulgar un estado interno no observable sólo por mirar: si el código actual lo hace, es una discrepancia que debe revisar el integrador.

### D. CAS, alcance, replay y ausencia de efecto

**Pregunta efectiva.** ¿CAS de mundo y Dirección, escena vigente, ambos extremos de puerta, y replay anterior a lifecycle/CAS? En un segundo mensaje el entrevistador propuso rechazar el mismo estado como `NO_EFFECT` y preguntó si debe registrarse.

**Respuesta.** **Reglas derivadas de S01/S04:** verificar origen y autoridad del host; todos los lugares afectados dentro del alcance; CAS de mundo y Dirección; replay exacto devuelve el resultado guardado aunque la corrida se haya cerrado. La revisión de mundo es necesaria: `worldSeq` solo no sustituye cambios de snapshot que pudieran no incrementar secuencia. Debe usarse `worldRevision` y revisión de Dirección, o un contrato compuesto que las conserve.

La autorización de lectura de la sesión/run precede al replay; las nuevas validaciones de ejecución se realizan después. Replay no expone recibos de otra corrida ni elimina la comprobación del hash. Un cambio incompatible con el pasado se rechaza: una bifurcación declarada es otro flujo, no una reparación silenciosa.

**Propuesta técnica adoptada tras el desafío:** una operación admitida que ya tiene el estado solicitado conserva recibo durable `notApplied`/`no-effect`; registra la solicitud y su revisión administrativa de Dirección, pero no crea revisión de mundo, evento, percepción, avance temporal ni modificación del snapshot. Un rechazo sin recibo permitiría que la misma clave tuviera efecto después, debilitando la idempotencia del resultado. No se registra un falso acontecimiento ficticio para explicar el no-op.

## Ronda 2: matices de cierre

**Pregunta efectiva.** El entrevistador pidió confirmar el recibo durable sin efecto físico; CAS `worldRevision` y Dirección; autorización de lectura antes del replay; todos los lugares de todas las conexiones de una puerta; ambiente por modalidad sin clima derivado; y entregas/intenciones no bloqueantes.

**Respuesta efectiva.** Confirmadas como decisiones de ingeniería derivadas. Una puerta compartida exige validar todos los lugares de **todas** las conexiones que usan su ID, no sólo el primer par. Además deben revisarse trayectos perceptivos que la atraviesan: si el cambio produce efectos fuera del alcance autorizado, no se amplía autoridad implícitamente; se rechaza ese alcance o se exige autoridad de corrida.

Ambiente respeta modalidad visual previa/posterior o modalidad auditiva mediante canal, camino y alcance existentes. No se infiere clima físico, daño, humedad ni canales nuevos. Outbox/intenciones pendientes conservan el límite explicado en A; trabajo con permiso de commit bloquea. No apareció una preferencia humana necesaria para cerrar este contrato técnico. El contenido artístico de los catálogos queda como configuración explícita pendiente.

## Límites de este registro

El registro conserva sólo dos rondas intercambiadas. No demuestra CAS, propagación, migración, recovery o interfaz implementados. El integrador debe contrastar la decisión con el código, registrar la resolución final y probar carreras, aislamiento sensorial, rollback, replay y continuidad conforme a la auditoría previa.
