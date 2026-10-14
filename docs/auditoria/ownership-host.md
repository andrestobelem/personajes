# Auditoría de ownership del host

Revisión del adaptador local contra el contrato de almacenes y ownership de S02. El alcance fue `host-ownership.ts` y sus pruebas; no incluye la conexión al servidor, al journal ni una interfaz para diagnóstico o recuperación.

## Contrato cotejado

S02 exige un único host escritor por `privateData`, lock de creación exclusiva con nonce, PID y comienzo del proceso antes de abrir workers, recuperación explícita sólo tras verificar que el PID no existe, retención si la situación del PID es ambigua o pudo reutilizarse, y borrado normal sólo por el nonce del dueño. No promete elección distribuida para directorios de red. La fecha antigua no autoriza a robar el lock.

El adaptador cumple esas reglas en el proceso local: crea el lock con `O_EXCL`, conserva el registro ante locks dañados, requiere `operatorConfirmed: true` y el nonce diagnosticado para recuperar, y sólo trata `ESRCH` como prueba de ausencia. Un PID que responde a `kill(pid, 0)` queda activo aunque su fecha registrada sea antigua; `EPERM` y cualquier resultado no concluyente se conservan como ambiguos. `processStartedAt` no se usa para inferir identidad del proceso ni para autorizar borrado.

## Hallazgos y correcciones

La primera versión tenía una ventana entre comprobar nonce/inodo y borrar por ruta: dos recuperaciones podían leer el lock caído, una borrarlo y permitir un nuevo acquire, y la segunda borrar el lock nuevo. Se añadió `host-ownership.operation`, creado exclusivamente, para serializar acquire, release, inspect y recover entre procesos locales. La operación compara también contenido, dispositivo e inodo antes de retirar el registro. Un gate ya presente produce `OPERATION_BUSY`; no se toca el lock ni se intenta liberarlo por antigüedad.

La lectura del lock ahora tiene límite de 2.048 bytes, decodificación UTF-8 estricta y schema Zod estricto. Rechaza archivos que no sean regulares, tengan más de un hard link, permisos de grupo/otros, dueño distinto al usuario actual en sistemas con `getuid`, o que cambien de identidad durante la lectura. El directorio raíz debe ser absoluto, directorio real y pertenecer al usuario actual; se deja en modo `0700`. Los locks se crean en modo `0600`; los enlaces simbólicos al directorio raíz final y al registro no se aceptan. El nonce, PID y fecha se validan antes de usarlos.

## Evidencia ejecutada

`npm run typecheck` pasó. La suite acotada `npx tsx --test tests/host-ownership.test.ts` pasó con ocho pruebas. Incluye dos procesos reales para exclusión de escritores y recuperación tras caída; nonce cambiado y PID vivo con fecha antigua; sondeo PID inaccesible/ambiguo; lock dañado; tres procesos recuperadores y un acquire sincronizados en una barrera; gate ocupado que falla cerrado; y rechazo de enlace simbólico, permisos amplios y tamaño excesivo. La prueba de PID determina primero el resultado observable de `kill(pid, 0)` en el sistema y comprueba que sólo `ESRCH` habilita recuperación.

## Límites para la integración

El gate resuelve la carrera entre las operaciones que respetan este adaptador, pero su archivo queda si el proceso cae abruptamente dentro de la sección crítica. En ese caso las operaciones devuelven `OPERATION_BUSY` y se requiere revisión del operador; esta auditoría no implementa limpieza visual ni una recuperación automática del gate. El registro del gate conserva PID, nonce y hora de inicio para revisión local. La integración debe exponer este estado como diagnóstico y no sugerir que `OPERATION_BUSY` prueba por sí solo que un proceso sigue vivo.

Un fallo de escritura después de crear el ownership puede dejar un lock parcial; permanece bloqueante y requiere revisión, en lugar de permitir un segundo writer. El módulo todavía no está conectado al arranque del servidor ni al journal, así que las pruebas demuestran el comportamiento del adaptador local, no que la aplicación adquiera el lock antes de abrir workers. Tampoco prueban sistemas de archivos compartidos ni ofrecen elección distribuida. Una modificación manual concurrente por el mismo usuario queda fuera de la frontera de seguridad del directorio privado.

## Huellas revisadas

SHA-256 del contenido al cierre de esta revisión:

| Archivo | SHA-256 |
|---|---|
| `src/adapters/host-ownership.ts` | `1401159061a21913c651ed41a311de0a411f992980071b327b183ac6d21916f4` |
| `tests/host-ownership.test.ts` | `7c39dce0e298ecf9612c85e1a704620cca6e86bc6ca0476c5f73ee4890587a52` |
| `docs/specs/02-persistencia-e-icm.md` | `d46d65acebf5021d49c27ece43f5caa38f4566fe82aec037c65e6b75544c55da` |
