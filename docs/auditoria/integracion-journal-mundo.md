# Integración durable del journal de mundo

Fecha: **14 de octubre de 2026**. Alcance: migración explícita del journal v2 a v3, registro de corrida y continuidad preparada, propuestas/revisiones, commit de intentos y entrega durable de percepciones. El gate cubre componentes de dominio/journal; no declara runtime completo ni cierra P12.

## Contrato implementado

`openJournal` añade las tablas v3 dentro de una migración SQLite transaccional: `world_runs`, `world_prepared_contexts`, `actor_knowledge`, `world_proposals`, `world_reviews`, `world_resolutions`, `world_events`, `world_perceptions` y `world_deliveries`. La corrida conserva JSON canónico y SHA-256 de configuración, snapshot inicial y snapshot vigente. Su continuity fence registra para cada participante preparado el `continuityId`, revisión/hash de continuidad, `identityVersion` y hash de contexto preparado, y debe coincidir con el snapshot inicial. Reabrir con la misma configuración/fence/snapshot devuelve `existing`; cambiar alguno exige una nueva lineage.

El journal ofrece `loadWorld({runId, throughWorldSeq?})`. Los cortes sólo existen en fronteras durables de resolución y se validan contra el hash persistido; un corte intermedio de una resolución con varios eventos o fuera de rango no produce snapshot. `loadActorWorldCut` implementa el contrato usado por `createActorWorldProjectionPort`: continuidad, snapshot, revisión de conocimiento y percepciones entregadas al actor hasta el corte. `compareAndSwapActorKnowledge` contrasta en una transacción la revisión y secuencia actuales del mundo, la referencia exacta de continuidad y la revisión de `ActorKnowledge`, y sólo acepta handles cuyos destinos existen en ese snapshot. Los métodos son puertos internos del host; el server todavía no los publica.

`registerWorldProposal` valida el intento estricto y lo vincula con `runId`, actor, escena activa, revisión base, versión de propuesta, hash de contenido exacto y hash del intento completo. El actor no puede incluir un campo de aprobación en `WorldAttempt`. `recordContinuistaReview` conserva cada revisión secuencial y exige que coincidan proposalId, versión, actor, revisión base y hash exacto. `resolveApprovalReceipt` construye un receipt sólo desde la revisión vigente, completa y `allow`, con los ocho criterios definidos y evidencia referenciada, para la versión más nueva y todavía pendiente. `commitWorldAttempt` vuelve a comprobarlo dentro de la transacción. Una review incompleta o para otro hash nunca permite emitir speech.

El commit consulta primero `world_resolutions` por `(runId, actorAttempt, attemptId)`. Un reintento idéntico devuelve la resolución guardada sin repetir el CAS; reutilizar el origen con otra propuesta/hash falla. Si el intento quedó obsoleto, o el resolver devuelve `notApplied`, la resolución vacía también se persiste y deduplica. Para commits nuevos, la transacción llama al resolver puro y escribe resolución, eventos con secuencia contigua, snapshot/CAS, percepciones planificadas y sus filas de entrega. Cualquier error SQL revierte todo el conjunto. No hay llamadas Pi, ICM, voz, shell ni red dentro de la transacción.

Las percepciones nacen como `planned`. `claimWorldDelivery` las entrega de forma serial bajo el owner token que el host provee; `failWorldDelivery` conserva sólo códigos controlados y permite reclamar una entrega fallida. `completeWorldDelivery` valida el claim y, para una percepción con `eventId`, exige el envelope de Experience que corresponde a actor, corrida, percepción, evento y corte. La misma transacción marca `delivered` y escribe Experience más `memory_outbox`. Antes del ack, la percepción no aparece en `readDeliveredWorldPerceptions` ni en `loadActorWorldCut`, y no existe esa entrada de outbox. La variante `observation` no tiene `eventId` en el dominio actual: puede marcarse entregada sin crear Experience/outbox; no se inventó una asociación de evento.

## Límites y autoridad

Las funciones de registro de propuesta y revisión son host-only por composición; el SQLite no autentica un proceso Continuista. La revisión se valida estructuralmente y contra la propuesta exacta, pero el caller que la produce debe seguir siendo código host confiable. El lock de ownership exclusivo se asume adquirido por composición host y no se vuelve a implementar en este componente. Un owner nuevo puede reclamar una fila que sigue `delivering`; esto depende de que la exclusión del proceso anterior ya esté garantizada por el host.

El hash detecta alteración accidental o incoherencia, no firma ni autenticación del contenido. No se añadió transacción distribuida con ICM. La Experience de una percepción se incorpora al outbox al completarse la entrega; la proyección ICM y su receipt ocurren posteriormente en el worker journal–ICM existente. `readWorldEvents` es una lectura interna y aún no es una API pública/SSE. `loadWorld` por secuencia refleja la última resolución en una frontera con esa secuencia; cuando varias resoluciones sin eventos comparten `worldSeq`, ese corte no identifica por sí solo una revisión de commit única.

## Evidencia de componente

Se ejecutó:

```sh
npm run typecheck
node --import tsx --test tests/world-journal.test.ts
```

El typecheck pasó y el archivo de pruebas pasó **5/5**. Los casos usan SQLite en disco temporal y validan registro/idempotencia de corrida, continuity fence, CAS de ActorKnowledge, corte de actor, aprobación exacta/no aprobación, speech sin receipt, secuencias 1→2, resolución stale y replay tras reopen, fallo de entrega antes del outbox y rollback SQL de resolución/eventos/percepciones/delivery. No llaman a LLM o ICM; ejercitan el resolver de dominio real con IDs host inyectados. Esto verifica la unidad journal–World, no el flujo HTTP/SSE, concurrencia bajo server real, lock multiproceso ni ejecución del worker en producción. Los fixtures de esta prueba son datos de frontera, no una escena ficticia de producto.
