# Diagnóstico público del Continuista

Estado: contrato implementado y validado con SQLite y pruebas locales; no prueba una revisión LLM real.

`criterionCodes` enumera los criterios evaluados. No distingue cuáles fallaron. La revisión incorpora `failedCriterionCodes`, una lista pública de códigos del mismo enum: `knowledge`, `continuity`, `identity`, `voice`, `periodPlace`, `motivation`, `rhythm` y `authority`. No contiene texto libre ni referencias de evidencia. El worker entrega exclusivamente esta lista al actor como feedback de reformulación.

Una nueva revisión completa con veredicto `reformulate` requiere al menos un criterio fallido. `allow` exige que no haya fallidos. Se rechazan duplicados y códigos fallidos que no aparecen entre los criterios evaluados. La completitud operativa sigue exigiendo los ocho criterios evaluados y evidencia interna; el diagnóstico no reemplaza ese control.

## Compatibilidad

Las revisiones históricas no incluían este campo. `ContinuistaStoredReviewSchema` permite leerlas sin agregar valores, alterar su JSON canónico ni cambiar sus hashes. `ContinuistaReviewInputSchema` exige diagnóstico para las nuevas reformulaciones completas. No se inventan criterios fallidos para históricos ni se reescriben evidencias.

Una revisión histórica sin diagnóstico no permite reconstruir cuáles fueron sus defectos; requiere una nueva revisión antes de ofrecer feedback específico a un actor. La lectura histórica conserva el veredicto original y no lo transforma en autorización.

## Evidencia y límites

Las pruebas en `tests/world-journal.test.ts` cubren listas válidas, rechazo de reformulación sin diagnóstico, `allow` con fallidos, duplicados, fallidos no evaluados y lectura de un payload histórico con hash válido en SQLite. El worker y sus pruebas se mantienen por separado. Los códigos orientan la corrección sin exponer evidencia privada; no explican por sí solos el detalle del defecto ni prueban que un modelo lo haya juzgado correctamente.
