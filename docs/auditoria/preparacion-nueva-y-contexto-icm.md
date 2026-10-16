# Preparación nueva hasta función completa con ICM

Corte: 16 de octubre de 2026 UTC. Rama `main`, base `3892c0b`, cambios locales sin commit ni push. La prioridad es preparar, ver e intervenir en una obra completa. Importación ampliada permanece en V2.

## Resultado real

[Una pregunta a tiempo](../representaciones/pregunta-a-tiempo-icm.md) recorrió desde preparación nueva, curación manual y selección explícita de nueve fuentes ICM hasta Ready, memorias independientes, sondeo OAuth real, dieciséis gates, inicio por botón, conversación en vivo, desenlace, escena y episodio cerrados y detención. Once emisiones habladas; 58 llamadas, 241.783 ms medidos, cero reservas. El asistente interpretó al visitante. Veintinueve paquetes persistidos de actores, Continuista y Director pasaron inspección readonly de contratos, sellos, audiencias y cortes. Esto extiende la evidencia previa de una función con configuración heredada sin ICM.

## Reparaciones necesarias

### Sesión de preparación

`PreparationSessionPanel` permite salir explícitamente de Interlocución/Dirección hacia observación para consultar fuentes. Conserva el editor y las elecciones locales; refresca fuentes mediante una revisión independiente sin remontar el borrador. Un resultado incierto conserva la misma operación; un conflicto exige lectura nueva. Ante 401/403 o resultado incierto ofrece reconexión explícita sin reenviar PUT ni recuperar permisos privados. Sólo un GET nuevo que confirme `observer` refresca las fuentes. Un lifetime separado evita invalidarse por el reset que emite su propia reconexión, y descarta respuestas tras desmontaje o cambio de cliente.

La GUI comprobó el cambio normal de modo y conservación del nombre editado. React montado y HTTP real comprobaron bootstrap/cache, cookie rotada, 401, CSRF 403, fallo/reintento, respuesta perdida, GET aún interlocutor, doble clic, unmount y cambio de API. No se afirma reproducción de una expiración natural en el navegador.

### Gate ICM en preflight durable

La primera preparación real reveló que el evaluador producía `icm-context-runtime`, pero el enum público y la validación de checks no lo admitían. Se incorporaron el gate y su diagnóstico legible al contrato, journal y GUI. Se preservan quince gates de configuraciones históricas; las configuraciones con ICM deben acreditar los dieciséis al completar y al leer el resultado durable. No se acepta una prueba antigua de quince checks para iniciar una puesta con ICM.

Pruebas focales verifican persistencia con SQLite real, bloqueo legible y pase de dieciséis gates, incluida negativa explícita a completar sólo quince bajo configuración ICM. El segundo preflight de la puesta nueva pasó y su botón Iniciar ejecutó la función.

### Evidencia del Configurador de evolución

Su worker ICM usaba prompt de sistema compilado y un mensaje breve, pero la prueba terminal todavía esperaba el JSON de entrada del camino anterior. Ahora comparte el prompt breve y verifica paquete/receipt, configuración histórica, preparación, scope, lease/sesión, contrato y contexto exactos. Conserva el camino histórico sin ICM, sin degradar a él ante paquete ausente o corrupto. Las lecturas del ledger son readonly en su conexión y evitan transacciones anidadas; comprueban también el anclaje de snapshot/commit e historial de configuración.

SDK Pi con proveedor controlado, SQLite y JSONL reales comprobaron aceptación/reapertura sin nueva inferencia, rechazo de prompts ajenos y corrupción incluso con hashes recalculados, aplicación transaccional e integridad de anclas históricas. No acredita Configurador previo a Ready ni ejecución de evolución con proveedor real en esta función.

## Verificación final

`npm run verify` final con `TMPDIR=/private/tmp` y `PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`: **1364 tests, 1363 aprobados, cero fallos y una omisión exclusiva de Linux**; typecheck aprobado. `npm run build` aprobado, con aviso de tamaño de chunk; `git diff --check` limpio. Logs locales: `/private/tmp/personajes-new-preparation-reconnect-global-final.log` y `/private/tmp/personajes-new-preparation-reconnect-build-final.log`. Incluye la última reparación de sesión. La revisión independiente y las pruebas controladas del Configurador cubrieron su aceptación transaccional e integridad histórica; la función real acreditó actores/Continuista/Director.

## Alcance abierto

Continuar por las superficies centrales de [PENDIENTES](../PENDIENTES.md): Configurador previo a Ready e inspección gráfica de paquetes. Ritmo, fidelidad, audio, Anthropic real y aceptación integral conservan sus límites. No convertir este ensayo corto en una certificación del producto completo.
