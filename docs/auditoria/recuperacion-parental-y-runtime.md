# Recuperación parental y composición del runtime

Corte v16, verificado localmente. No acredita login OAuth, inferencia de Luna ni puesta/representación desde la interfaz.

## Recuperar una actuación ya generada

`readActorTurnRecovery` distingue un job nuevo, una actuación con pruebas completas y una cola incompleta o incierta. La recuperación completa exige última propuesta exacta, terminal de la última request completada, sesión/corte originales y receipt administrativo aceptado con veredicto `allow`. También se aplica a acciones sin palabras: rechazar una propuesta `wait` no permite ejecutar la espera.

`acceptRecoveredActorTurn` reconcilia el claim nuevo con el candidato original mediante un grant inmutable, sin modificar candidatos, checkpoints o reservas anteriores. Guarda grant y aceptación/consumo del inbox en una transacción. Un replay exige receipt parental ya aceptado y proof JSON/hash exactos; un grant huérfano o alterado no concede la excepción del lease original. Callbacks tardíos con el claim anterior no pueden escribir actuaciones nuevas.

La migración v16 añade el vínculo terminal→propuesta y los grants de reconciliación. El backfill v15 es conservador: no atribuye un terminal de versión 1 a una propuesta posterior pendiente. El worker inspecciona estas pruebas antes de compilar, consultar memoria o abrir Pi. Si están completas, termina aceptación/commit sin otra inferencia; si faltan o hay incertidumbre, registra `recovery-required` sin regenerar.

## Comprobar el JSONL antes de adoptar un leaf

El journal expone IDs y ruta originales; el worker ejecuta `verifyPiActorSessionIntegrity` mediante lectura local. Comprueba ruta real dentro de la identidad privada, UTF-8, JSONL/header válidos para la versión del SDK, sesión/CWD y existencia de base/input/terminal. Todas las ramas conservan padres válidos, sin duplicados ni ciclos; terminal e input deben pertenecer a la misma cadena. No abre ni modifica una sesión SDK, ni usa OAuth o un modelo.

Archivo eliminado, leaf ausente, JSONL malformado, bytes inválidos, padre inexistente o header incompatible bloquean una nueva aceptación recuperada sin efectos. Esta prueba es estructural: **no detecta contenido modificado que conserva IDs y estructura válidos** sin hashes de transcript congelados independientemente. Un commit de una propuesta ya aceptada conserva su autoridad en el journal; no adopta otro leaf ni genera una nueva actuación. La próxima inferencia mantiene los controles del SDK sobre la sesión reabierta.

## Componer las etapas

`createRepresentationRuntime` recibe el host que ya tiene ownership. Compone Pi, worker actoral, Continuista, coordinador, entregas y proyección de memoria. Mantiene ICM/SQLite y cache por corrida/personaje; usa sólo receipts del journal para admitir recuerdos. Comprueba la versión del CLI antes de drenar incluso un outbox vacío. Un fallo de memoria suspende la convocatoria y conserva diagnóstico; no se presenta como búsqueda vacía.

Los commits actorales agendan entregas para sus destinatarios efectivos; esas entregas producen memoria e intenciones del pulso posterior. `recover` consume únicamente targets durables. Las operaciones públicas y callbacks quedan registradas: `close` cancela y espera a workers/procesos antes de cerrar el host, y `waitForIdle` usa un epoch de trabajo para no devolver mientras una entrega acaba de iniciar actuación. La factory no crea una escena, configura una corrida ni empieza trabajos por instanciarla. El launcher todavía no la invoca.

## OAuth administrativo

`createPiOAuthPort` encapsula `ModelRuntime.login/logout/listCredentials` para `openai-codex` y OAuth exclusivamente. Devuelve metadatos y códigos, sin tokens ni errores SDK que puedan contener credenciales. Distingue OAuth configurado de acceso a la cuenta: ese acceso queda `not-verified`. Serializa login/logout compartidos, propaga cancelación de la persona y del host y conserva lectura local de estado sin refrescar tokens ni llamar modelos. El compositor expone este puerto administrativo y espera sus operaciones al cerrar; todavía no tiene rutas HTTP ni UI de login.

La firma y el flujo se contrastaron con el SDK instalado 1.2.0 y documentación primaria mediante `find-docs`: [API de autenticación](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/src/auth/types.ts), [runtime del SDK](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/model-runtime.ts). No se ejecutó login ni logout de una cuenta real.

## Evidencia

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify`: TypeScript y **225 pruebas aprobadas, cero fallidas y cero omitidas**. El build pasó con 369 módulos.

- [Worker actoral](../../tests/actor-turn-worker.test.ts): reinicio con terminal/revisión, reserva incierta, versión posterior, input tardío y archivos del SDK eliminados/corruptos; sin nuevas calls o efectos indebidos.
- [Journal](../../tests/world-journal.test.ts): migración poblada v15→v16, metadata original, grants alterados/huérfanos, callbacks antiguos y commit idempotente.
- [Composición](../../tests/representation-runtime.test.ts): ICM 0.11.4 y SDK Pi reales con transporte controlado, fallo del CLI, cierre de procesos pendientes y espera de una actuación recién iniciada.
- [OAuth](../../tests/pi-oauth.test.ts): configuración y exclusión, cancelación, errores sanitizados, ausencia de fallback a API key y metadata del SDK con almacén nuevo.

Siguen pendientes launcher, configuración y representación en GUI, API/UI OAuth, tiempo operativo acumulado, dirección/narrador, voz/ritmo, historia/replay/backups y los ensayos integrales/live de los 77 criterios. La composición callable no equivale a una representación activa.
