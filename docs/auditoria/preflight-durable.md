# Comprobación durable antes de iniciar una representación

## Alcance del corte v21

La comprobación de ejecución es una operación administrativa explícita sobre una configuración Ready guardada. Captura la configuración y el corte del Escenario; no inicia la obra, no avanza su reloj, no abre sesiones actorales y no sondea proveedores. Ready indica validez de la preparación, no disponibilidad de todos los recursos de ejecución.

El journal incorpora jobs, historial, resultados privados y receipts idempotentes. El POST requiere el ETag compuesto de configuración y mundo. Su receipt conserva la aceptación original; GET devuelve el estado actual y distingue un informe vigente de uno obsoleto. Cancelación, exclusión por representación, leases y recuperación de trabajos abandonados evitan adoptar resultados tardíos o repetir evaluaciones al reiniciar.

Una aprobación exige exactamente quince gates pasados: configuración, versión guardada, corte del Escenario, contextos preparados, elegibilidad del catálogo, perfil de inferencia, SDK, configuración Pi, autenticación, runtime de los roles, memoria ICM, presupuesto, comprobación de acceso, disponibilidad de participantes y voz. No basta con que exista una prueba de acceso aprobada. Los informes públicos contienen identificadores y códigos acotados; los detalles, huellas de cuenta, rutas y configuración íntegra quedan privados.

## Recursos reales y límites

El adaptador consulta journal, catálogo, SDK instalado y credencial local sin renovarla. El recibo de acceso debe corresponder al perfil y cuenta observados; un resultado posterior fallido, cancelado o incierto impide reutilizar una aprobación anterior. La lectura de memoria exige aislamiento físico y compatibilidad de lectura con el CLI, sin crear una base para convertir artificialmente una ausencia en disponibilidad.

El estado actual extiende el ledger común a todas las sesiones Pi que infieren: Actor, Continuista, Director, Narrador/revisor y Configurador. Presupuestos con historia anterior sin medición, requests inciertas, scope desajustado o cero restante bloquean el preflight. `GET /runs/{id}/budget` expone inferencia; RunView agrega las cuotas durables separadas de Voice Design/TTS/SFX y la vista se consulta durante la representación. C59 verifica con ICM real y transporte Pi controlado que agotar el ledger en una obra activa pausa el runtime y deja el perfil/saldo visibles. La aceptación live sigue pendiente. Una base privada todavía no provisionada se declara no disponible.

## Verificación

TypeScript y el gate global de **364 pruebas con ICM real, cero fallos y cero omisiones** pasaron. El build también pasó. La revisión independiente detectó y corrigió informes aprobados incompletos, reutilización de acceso incierto, geometría alterada con igual revisión y el GET de un informe previo después de editar Ready a borrador.

La integración de [HTTP real](../../tests/http-preflight-integration.test.ts) recorre preparación limpia → Ready → POST → informe bloqueado → cierre/reapertura → replay inmutable → edición a borrador → informe obsoleto, con SQLite, PiRuntime y adaptador host reales. Sentinelas comprueban cero llamadas al proveedor. Las pruebas del [host](../../tests/production-preflight-host.test.ts) usan ICM 0.11.4 real y verifican que la lectura no modifique la base ni cree sidecars; una base sin sidecars necesarios se declara no disponible. Los tests de un informe sintético aprobado verifican el contrato y sus invariantes; no acreditan acceso real a una cuenta, actuación ni fidelidad del doblaje.

En navegador se operó una preparación sintética en un directorio temporal aislado: evaluación explícita, recuperación del mismo job tras reiniciar y edición del nombre con el informe conservado como desactualizado. La preparación de prueba no corresponde a la primera obra del usuario. El directorio de prueba termina con una corrida en borrador, un job preflight completado/bloqueado, tres entradas de historial y un resultado; cero eventos, commits, sesiones actorales/Continuista, jobs de actuación, access-check u OAuth. Las pestañas y el servidor de prueba fueron cerrados. Evidencia local: `/var/folders/ds/qq6rdy255jv9pywyn_yx51lh0000gp/T/personajes-preflight-v21-gui-oKkPwW/informe-recuperado.jpg` y `informe-obsoleto.jpg`; verificación global: `/tmp/personajes-preflight-v21-final-verify.log`.

Los 77 criterios de aceptación integral permanecen pendientes. Este corte no sustituye el inicio/control de la representación, la interfaz visual del Escenario y sus conversaciones, dirección, sonido, replay ni backups.

En el corte v21, la revisión de referencias comprendió 419 Markdown y 1.530 enlaces locales: cero destinos faltantes; los hashes de las specs de ese corte coincidían con el registro.

## Actualización v22

La lectura host del gate de presupuesto ahora consulta `readRunModelTimeBudget` en el journal en vez de declarar esa capacidad no disponible. `tests/production-preflight-host.test.ts` y `tests/http-preflight-integration.test.ts` verifican estado conocido y bloqueos por legado/uncertidumbre/desajuste; la integración HTTP también cubre el snapshot protegido `GET /runs/{id}/budget`. El gate global posterior pasó TypeScript y 381 pruebas con ICM real, sin fallos ni omisiones; el build de producción transformó 397 módulos. La UI muestra las métricas en la preparación Ready y sigue separando disponibilidad para ejecutar de una preparación. No se ejecutaron login ni inferencias contra proveedores.
