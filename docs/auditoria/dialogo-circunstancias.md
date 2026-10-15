# Diálogo sobre cambios de circunstancia

Fecha: 15 de octubre de 2026. Entrevista real entre `circumstance_interviewer` y `circumstance_custodian`, coordinada por el agente integrador. Aplica el [procedimiento grill-with-docs](../diseno/procedimiento-grill-with-docs.md) y sus skills locales. Las respuestas delegadas no son preferencias elegidas por el usuario ni prueban implementación. Este registro complementa la [auditoría del contrato](cambios-de-circunstancia.md).

## Fuentes y árbol de decisiones

Fuentes compartidas: [constitución](../constitucion.md), [PRD](../PRD.md), [S01](../specs/01-dominio-y-catalogo.md), [S03](../specs/03-pi-y-coordinacion.md), [S04](../specs/04-api-y-autoridad.md) y código de Escenario. Dependencias: autoridad y lifecycle → resolución transaccional → percepción e integración con actores. Catálogo y procedencia se pueden resolver en paralelo; compatibilidad artística pertenece a preparación, compatibilidad mecánica a resolución.

## Ronda 1: preguntas y respuestas intercambiadas

### A. Lifecycle y concurrencia

**Pregunta efectiva.** «Propongo cambios físicos sólo run paused y sin pulso/turno/intención/entrega pendiente en vuelo; permitir running exige barrera durable que hoy no existe. ¿Qué requisito exige running o paused y qué trabajo exactamente bloquea?»

**Respuesta del custodio.** No hay requisito expreso que fije lifecycle para circunstancias. Pausa prohíbe convocatoria y avance ficticio, no toda administración. Propone admitir `running` y `paused` en punto serializable sin pulso activo ni trabajo actoral/Continuista con permiso vigente de commit ni step activo; revalidar lifecycle, CAS y ausencia de trabajo dentro de una transacción SQLite. No mantener una transacción abierta durante red. Si beginPulse/claim y circunstancia compiten, sólo una transacción gana. Bloquear toda intención/entrega pendiente sería excesivo y podría impedir dirigir indefinidamente en pausa. Fuentes: constitución §9, S01 Dirección y controles de S03.

**Desafío efectivo.** Entrega antigua pendiente conserva su worldSeq confirmado; recibirla después no debe crear un turno con corte anterior sin revalidar. Se propuso no bloquear outbox, inbox e intenciones pendientes por sí solos; sí pulso, lease/dispatch con capacidad de commit o step activo.

**Respuesta.** Confirmado, siempre que la percepción sea inmutable y scheduling revalide snapshot/epoch al reclamar. Verificar además jobs queued reclamables y propuestas aceptadas sin commit que pudieran existir sin pulso activo; no suponer invariantes sin auditarlos.

**Resultado: propuesta de ingeniería.** Se retira la restricción inicial paused-only: no es requisito del usuario. Admisión `running`/`paused` entre trabajo que pueda confirmar acciones, con controles serializados. Si esa garantía no puede probarse, documentar explícitamente la limitación antes de afirmar cobertura. Las entregas de hechos ya confirmados conservan su corte.

### B. Catálogos y compatibilidad

**Pregunta efectiva.** «Cinco familias ya requeridas. Ambiente mediante enum/claves de catálogo inicial Ready; aparición sólo instancia de definición de objeto preautorizada con geometría/procedencia; jamás objeto arbitrario ni instrucciones. ¿Catálogo inicial por run o global, y dónde derivar compatibilidad?»

**Respuesta del custodio.** S01 requiere puerta, iluminación, disponibilidad de dispositivo, condición ambiental y aparición compatible, mediante catálogo cerrado. Constitucion §§5–6/11 exige procedencia, situación y conocimiento situado. Propone catálogo autorizado y versionado por corrida, fijado en Ready/configuración; catálogo editorial global sólo sirve de fuente seleccionable. Ambiente tiene clave estable, descripción perceptible, modalidades/alcance y estados tipados, sin texto ejecutable ni efectos físicos implícitos. Aparición usa definición preautorizada con nombre, descripción, geometría, portabilidad, cantidad/condición y procedencia de puesta; comando aporta templateId y lugar/posición autorizados, ID de entidad generado por host. Preparación valida continuidad/fecha/mundo mediante fuentes o adaptación declarada; resolución revalida escena, lugar, geometría, colisión y límites. No juzgar canon con LLM ni inferirlo por el nombre.

**Resultado.** Cinco familias y autoridad cerrada son requisito/regla derivada existente; estructura por corrida es propuesta técnica. Falta el contenido artístico del primer catálogo: puede permanecer vacío hasta configuración explícita. Las pruebas usan adaptación sintética identificada, no canon inventado.

### C. Transiciones perceptibles

**Pregunta efectiva.** «Apagar luz/puerta se evalúa unión de observadores sensorialmente elegibles pre y post, misma presencia/lugar antes/después; disponibilidad interna de dispositivo sólo cambia estado sin percepción automática salvo señal perceptible configurada. ¿Respaldo/contradicción?»

**Respuesta del custodio.** Constitución §§5–6 y auditoría respaldan conocimiento situado y transición. La unión pre/post es propuesta técnica correcta para elegibilidad de la transición: observador presente y disponible al evento, modalidad/camino/rango aptos a algún lado. No entregar unión de snapshots: oscurecimiento no revela objetos secretos; apertura revela sólo lo perceptible según reglas posteriores. Conservar modalidad y evidencia sin autor ficticio, principal, motivo ni metadata privada de catálogo. Indisponibilidad interna no es automáticamente visible, tampoco en la proyección posterior por mera mirada. Si código actual la revela, debe corregirse antes de afirmar aislamiento.

**Resultado.** Regla derivada de conocimiento situado; mecanismo pre/post propuesto. Transición confirmada no equivale a revelar todo estado nuevo. Una condición ambiental descriptiva tampoco implica mecánica física no implementada.

### D. CAS, alcance y ausencia de efecto

**Pregunta efectiva.** «Request exige expectedWorldSeq y expectedDirectionRevision; escena exacta vigente y autoridad sobre ambos extremos puerta; replay mismo hash retorna aun cerrado antes de lifecycle/CAS. ¿Algún matiz?» Después: «Mismo estado: propongo rechazar NO_EFFECT sin nueva revisión/evento, salvo receipt durable idempotente explícito de no-op; ¿alguna obligación que exija registro?»

**Respuesta del custodio.** Autoridad por origen host, escena vigente y todos los lugares afectados; CAS mundo y Dirección e idempotencia antes de nuevas validaciones de ejecución derivan de S01/S04 y auditoría. Matiza que worldSeq no sustituye WorldRevision si snapshot puede cambiar sin seq: usar revisión autoritativa y ETag Dirección, o ETag Run compuesto íntegro. Replay conserva resultado tras cierre, pero exige autorización vigente de lectura al run/alcance y mismo principal/clave/hash; no expone recibos de otra sesión/corrida. Cambio incompatible con pasado se rechaza con diagnóstico; bifurcación es otro flujo explícito.

Para mismo estado propone receipt durable `noApplied`/`no-effect`, sin revisión mundo, seq, evento, percepción ni mutación de snapshot nuevos. Un rechazo no almacenado permitiría que la misma clave pase a causar efecto después, por eso no se recomienda para solicitud ya admitida/evaluada.

**Resultado: propuesta de ingeniería.** CAS usa revisión real de Escenario, no sólo seq. Autorización de lectura precede al replay; lifecycle, precondiciones y CAS de ejecución posteriores no invalidan replay exacto. Solicitud admitida sin efecto tiene recibo durable y trazabilidad administrativa, sin acontecimiento ficticio.

## Ronda 2: matices enviados para cierre

El entrevistador envió: «Acuerdo receipt durable noApplied/no-effect sin revisión mundo/eventos/percepciones; ledger Dirección sí registra solicitud y su revisión administrativa. CAS worldRevision (y worldSeq si hash compuesto) + directionRevision, lectura autorizada antes replay; execution validaciones después. Para puerta compartida, escena debe contener todo lugar conectado por cualquier conexión que usa doorId; no sólo primer par. Ambiente perceptible estricto por modalidad (visual pre/post, auditivo por canal/path existente; sin implementar clima físico derivado). ¿Confirmás estos matices y outbox/intenciones no bloqueantes?»

**Respuesta efectiva del custodio.** Confirma como decisiones de ingeniería derivadas: ledger registra noApplied/no-effect con revisión administrativa nueva y mundo idéntico; CAS worldRevision + directionRevision; autorización de lectura antes del replay; para puerta compartida, todos los lugares de todas las conexiones que usan doorId. Añade verificar trayectos perceptivos que atraviesan la puerta: si produce efectos fuera del alcance permitido, rechazar o exigir scope run; nunca ampliar autoridad silenciosamente. Ambiente usa modalidades/caminos/rango existentes, sin clima, daño, humedad ni canales implícitos. Outbox/intenciones pendientes no bloquean si conservan corte inmutable y reclamo revalida. No identifica preferencia humana necesaria para el contrato técnico; contenido artístico del catálogo permanece configuración explícita.

## Contrato para integración y pruebas

El integrador debe contrastar estas propuestas con el código y actualizar contratos de API/preparación antes de afirmar implementación. Validar carreras con beginPulse/claim/commit; replays tras cierre y reinicio; rollback de snapshot/ledger/outbox; CAS de mundo y Dirección; puerta compartida fuera de escena; apagado perceptible sin filtrar secretos; indisponibilidad interna sin filtración; catálogo desconocido/incompatible; geometría de aparición; no-op durable; entrega antigua sin cambiar su experiencia; despertar como oportunidad, nunca respuesta impuesta. Ninguna respuesta del custodio sustituye estos resultados.
