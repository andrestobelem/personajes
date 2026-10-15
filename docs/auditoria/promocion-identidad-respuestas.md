# Promoción de identidad: respuestas del custodio — corte 50

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, conforme al [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Las propuestas técnicas no se atribuyen al usuario ni acreditan una promoción ejecutada.

## Fuentes y estado inicial

Conversación: identidad exhaustiva, historia y memoria propias, punto de vista situado e influencia sin obediencia garantizada. Constitución §2/§5, PRD CAT-08/P22 y specs S01/S02/S03/S05. Se leyeron `src/domain/configurator.ts`, `configurator-context.ts`, `configurator-tools.ts`, preparación, roles administrativos y contratos de journal/sesiones. El código inicial ofrece contexto/propuesta/consentimiento validados y candidato local en memoria; no equivale a propuesta Pi durable ni promoción aplicada desde GUI.

## Ronda 1 — qué cambia y qué demuestra la evidencia

**Pregunta recibida.** El entrevistador propone identidad/prepared nuevos sólo a futuro en la misma corrida, evidencia exacta de actor, diff y consentimiento, con nueva epoch/sesión Pi y memoria/historia conservadas. Pregunta por el caso de Max que cree un rumor sobre 99, por tipos de evidencia, alcance de campos e invalidación de roles.

**Respuesta.**

- **Requisito y regla documentada:** CAT-08/P22 y Constitución §2 preservan evolución ya vivida sin esperar promoción de ficha; S01/S05 exigen propuesta, evidencia/diff, revisión nueva y contexto futuro en una frontera coherente, conservando originales e historia.
- **Regla derivada:** misma corrida y continuidad si sólo se consolida una identidad futura. Reescribir hechos pasados requiere bifurcación declarada, no esta promoción.
- **Propuesta de evidencia tipada:** actor y anchor completo —run, commitIndex, revisión/secuencia/hash de snapshot, configuración/prepared vigentes— con payload/hash de checkpoint registrado. Una experiencia de evento requiere percepción/experiencia propia y recepción hasta ese corte. Un evento global ajeno no prueba que el actor lo conozca. La mente propia prueba creencia, objetivo o relación, no verdad objetiva del contenido.
- **Regla derivada:** biblioteca documental se cita separadamente con sourceId/hash y propósito de investigación; no demuestra experiencia o conocimiento del personaje. Evidencia futura, ajena o sin cierre de referencias bloquea. Mencionar a 99 como contraparte no permite importar su mente.
- **Caso concreto:** puede consolidarse la disposición de Max a desconfiar de 99 por un rumor atribuido, conservando fuente y subjetividad. No se declara la traición como canon ni se modifica lo que 99 sabe.
- **Propuesta de alcance inicial:** promoción de los cinco campos reales de `CuratedIdentitySchema`: selfReference, selfConcept, values, dispositions y contradictions. **Rectificación explícita de la primera respuesta:** ese schema no contiene biografía; la mención inicial de biografía como parte de él fue errónea. Biografía, voz, metas, vínculos y capacidades tienen fuentes/contratos distintos; no se alteran implícitamente al editar identidad.
- **Regla derivada:** herramientas y permisos no nacen de una frase de identidad. Metas/relaciones ya pueden evolucionar por acciones subjetivas propias. Cambios de voz/audio requieren sus contratos y conciliación independientes.
- **Propuesta técnica:** cambiar sólo prepared/identity de los actores explícitos; invalidar las bases técnicas de los roles que dependan de la configuración/epoch anterior, sin modificar sus datos por ello. Actor afectado recibe sesión/contexto nuevos, anterior forense; ICM e historia permanecen y no se promete conducta determinada.

**Hallazgo de código.** La evidencia committed-character-state ya incluye commitIndex, pero la validación inicial sólo contrasta revisión/secuencia contra un scope administrativo sin anchor completo de commit. La implementación deberá cerrar esa brecha en vez de asumir que una secuencia basta para estados subjetivos/editoriales distintos.

## Ronda 2 — frontera, consentimiento y reanudación

**Pregunta recibida.** El entrevistador propone job Configurador Pi durable en Ready/paused/stopped sin writers, congelación de contexto, diff/consentimiento ligados a hashes y CAS, y rechazar cambios entre preview/apply. Pregunta por propuestas pendientes al pausar, rotación de sesión, resultados tardíos y replay tras caídas antes/después de aplicar.

**Respuesta.**

- **Regla documentada:** la revisión/confirmación de producto no implica pedir una autorización humana adicional para implementar. Principal y fecha del consentimiento provienen del host, nunca de un campo del cliente/modelo.
- **Propuesta de admisión:** Ready/paused/stopped en frontera sin writers del modelo; job Configurador propio con perfil elegido, sesión separada y presupuesto de corrida más cuota administrativa explícita. No fabricar un pulso actoral para una tarea administrativa. El candidato de la tool se persiste antes del receipt; la prosa final del modelo no aplica cambios.
- **Regla derivada:** congelar corte privado y padres exactos; preview muestra before/after de los campos permitidos, motivos, vacíos y evidencia atribuida. Contenido privado requiere la superficie autorizada correspondiente. Consentimiento liga context/proposal/target hashes, versiones y CAS; un cambio relevante invalida, sin rebase silencioso ni nueva llamada LLM automática.
- **Frontera conservadora:** drenar writers fuera de transacción SQL y abortar claims no asentados conservando su archivo/diagnóstico y epoch. Una propuesta ya aceptada o un pulso pendiente con derecho futuro de commit no se borra para poder promover: bloquear hasta resolverla o cancelarla explícitamente con recibo. Pausar conserva esas propuestas; no equivale a descartarlas. Entregas/memorias pendientes se drenan o bloquean la frontera, sin completar evidencia con ICM actual.
- **Propuesta de rotación:** sesión nueva del actor desde prepared nuevo y estado/memoria propios autorizados; JSONL previo íntegro como forense e historial asociado a su configuración. No adoptar tails ni mezclar actores. La aplicación invalida las bases previas; antes de reanudar se requiere comprobación vigente, sin cambiar el perfil.
- **Regla derivada:** candidato tardío tras cancelación no adquiere autoridad; gastos/request inciertos se conservan. Aprobación y promoción atómicas son preferibles; si se separan, aprobación pendiente debe ligar exactamente hashes/operación y recuperarse sin otra elección.
- **Regla derivada de idempotencia:** caída tras commit y antes de respuesta recupera el mismo receipt antes de reevaluar CAS/epoch; mantiene identityVersion/configuración sin aplicar otra vez. GET del estado actual es lectura distinta.

**Contraste con revisión de arquitectura.** `/root/actor_cut_integrity_review` propuso configuración efectiva completa versionada por commit, no overlay por actor: commit administrativo con revisión/commit nuevos y secuencia/reloj iguales, identityVersion incrementada sólo del actor, mind/historia/canon intactos. El custodio confirmó compatibilidad conceptual. Fork y replay históricos deben resolver esa versión del corte, nunca la última.

## Ronda 3 — historia, fork, backup y presentación

**Pregunta recibida.** El entrevistador propone commit administrativo sin acontecimiento ficticio, resolución histórica de configuración/identidad, fork anterior/posterior, backup de consentimientos/sesiones y flujo dedicado incluso en Ready derivado protegido. Pregunta por edición manual, exposición de evidencia y separación entre transporte controlado y P22 live.

**Respuesta.**

- **Regla derivada:** registrar la promoción como operación administrativa con revisión/commit/configuración/prepared/identityVersion nuevos; no crear evento «Max se convirtió», percepción, secuencia ni tiempo ficticio. El estado vivido y su archivo de memoria permanecen.
- **Regla histórica:** inspector, replay y readForkSource deben resolver configuración/prepared vigentes en el commit. Un fork anterior no recibe núcleo futuro; uno posterior hereda el nuevo núcleo con memoria propia correspondiente al corte. El checkpoint debe relacionar correctamente snapshot/configuración/versiones sin reconstruir el pasado desde latest.
- **Regla de persistencia:** backup incluye jobs, candidatos, consentimientos, promociones/versiones y sesiones forenses. C48 debe conocer/comparar las nuevas tablas; C49 debe ampliar explícitamente el catálogo/versionado admitido, no aceptar el nuevo esquema como si fuera v37 idéntico. No ignorar tablas para hacer pasar recover.
- **Propuesta:** permitir promoción en Ready derivado mediante flujo dedicado y los mismos gates, sin habilitar escritura genérica de draft ni modificar semilla/origen. Experiencia heredada puede ser antecedente propio atribuible; no se inventa otra experiencia nueva para satisfacer validación.
- **Regla de revisión:** adaptación de biblioteca permanece separada. Editar una propuesta genera otra propuesta/version/hash y consentimiento; no sobrescribe un candidato aprobado.
- **Regla de privacidad:** historia pública sólo actor/versión/momento/corte/estado seguros. Un motivo libre puede contener secretos y no se publica por defecto. Diff, subjetividad y evidencia sólo en inspector opt-in autenticado; paths y pensamiento interno no se muestran.
- **Evidencia necesaria:** cortes antes/después con igual secuencia; callbacks tardíos, claims obsoletos y presupuesto incierto; atomicidad y replay del consentimiento/aplicación; Ready derivado; backup/restore/import con nuevo esquema; GUI que genera propuesta Pi, revisa/consiente, aplica a futuro, reinicia y comprueba contexto nuevo con memoria anterior. SDK real con transporte controlado verifica orquestación, no P22 live ni calidad artística con proveedor.

**Cierre.** No se detecta una preferencia humana material imprescindible para el alcance de los cinco campos de identidad. El workflow completo incluye propuesta Pi durable y aprobación/aplicación gráfica: una tool local o staging sin dispatcher no lo cumple. La implementación puede avanzar por etapas conservando ese alcance y declarando cada frontera todavía pendiente. Canon, biografía, voz, permisos y otros cambios permanecen fuera de esta promoción específica.

## Precisiones de arquitectura posteriores a la entrevista

El revisor `/root/actor_cut_integrity_review` comunicó la decisión del integrador: el fallback a la configuración original sólo es admisible mientras el ledger histórico esté vacío; la primera promoción deberá insertar los bytes/hash originales en commit 0 antes de cambiar el head, dentro de la misma transacción. La primera etapa v38 será fundamento de lectura, no aplicación de promociones.

El mismo revisor propuso `actor_identity_epochs` append-only con run/actor/epoch/identityVersion/preparedHash/configRevision/effectiveCommit/parentEpoch/operation. Epoch 0 conserva sesiones existentes; promover reserva epoch siguiente sin abrir Pi y la primera inferencia autorizada crea sesión nueva con leaf inicial. Sesiones, candidatos y recibos anteriores se consultan por epoch, sin mezclar leaves. Esto requiere migrar claves/referencias actuales run+actor; no está implementado por documentarlo.

El agente `/root/actor_cut_inspector` comunicó el contrato aprobado del compiler: scope de evolución con `ownActorStateCut`, anchor fuente exacto y preparedContextHash; evidencia `admitted-experience` con envelope congelado y estado epistémico perceived/reported/inferred/believed/remembered; mente propia del mismo corte. El lector actual de fuente no aporta eventos globales: no se fabrican confirmed-events y las variantes anteriores sólo se aceptan si se demuestra referencia en percepción/testimonio propios del corte. Dossier original conserva vacíos/contradicciones documentales; prepared vigente es fuente privada distinta y versionada.
