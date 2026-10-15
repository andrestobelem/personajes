# ADR 0007 — Cierres dramáticos y bifurcación de continuidad

Estado: decisión adoptada; estructura básica implementada en journal v29, API autenticada y panel inicial. Director automático implementado con observaciones y evidencia por corte; fork durable, GUI completa y aceptación integral siguen pendientes.

## Contexto

Al adoptar esta decisión, ESC-10 exigía registrar cierres de escena/episodio y consecuencias que continúan. Entonces una escena ya tenía estado `open/closed`, pero el snapshot exigía una escena activa y no había productor de cierre ni agregado durable de episodio. El cierre terminal de `Run` no podía cumplir esa necesidad porque la representación debía conservar estado y permitir que la obra siguiera. Un fork real requiere más que copiar el snapshot: experiencias, referencias, SQLite ICM y sesiones Pi tienen scope de corrida/personaje.

La estructura teatral tampoco equivale a la lectura del conflicto. Episodio, acto y escena son unidades de representación; planteamiento, desarrollo, clímax y desenlace son etapas interpretativas; los episodios griegos son una parte formal de ciertas obras antiguas, no el episodio de una serie moderna. No se exige una división en tres actos ni un final predeterminado.

## Decisión

Un `Run` puede contener varios episodios secuenciales dentro de la misma continuidad. Cada episodio agrupa una o más escenas y puede agruparlas en actos opcionales. El cierre de una escena deja el episodio abierto; el cierre de episodio no cierra `Run`, no avanza el reloj, no resuelve automáticamente las líneas ni crea hechos ficticios. Sólo se cierra un episodio cuando todas sus escenas están cerradas y no hay jobs con permiso de commit pendientes.

Los comandos de abrir/cerrar escena y episodio pertenecen al operador autenticado y usan CAS/idempotencia. El Director puede recomendar cierre y aportar evidencia, pero el operador lo confirma. Actor, Continuista y Narrador no pueden cerrar estructuras ni cambiar su estado por tool o inferencia. Un cierre guarda el corte y las referencias a consecuencias ya confirmadas; los estados de líneas dramáticas son una lectura revisable con evidencia. El resultado no se entrega como percepción a los personajes.

Si la obra continúa, se abre el episodio siguiente dentro del mismo run, conservando el estado y memorias actuales. Si se desea reiniciar o explorar una alternativa desde un corte, se crea un `RunId` y una continuidad de representación nuevos. El fork conserva referencia al source y al hash/corte exacto, remapea IDs scoped, copia sólo estado confirmado y experiencias accesibles por actor hasta el corte, importa la memoria propia de cada personaje a una base ICM SQLite nueva mediante interfaces soportadas y crea sesiones Pi nuevas. No copia jobs, sesiones, leases, inboxes pendientes, reservas, secretos o entregas técnicas. Source y target continúan de forma independiente.

Las escrituras estructurales son commits de representación separados de los hechos diegéticos: avanzan `structureRevision`, `worldRevision` y `commitIndex`, pero no `worldSeq`, reloj ficticio, evento del Escenario, percepción o memoria. La lectura/replay los ordena por commit y mantiene ambas clases de evento etiquetadas. Una migración versionada debe conservar sin reescritura los snapshots v1 y sus hashes; el snapshot v2 admite el intervalo sin escena activa.

## Consecuencias

- El corte v29 ya persiste episodios, actos opcionales, escenas, eventos estructurales y operaciones; permite snapshot sin escena activa, filtra la estructura de los contextos de actuación y habilita aperturas explícitas posteriores.
- `GET replay` debe permitir localizar commits estructurales aun cuando `worldSeq` no cambie.
- La restauración con modo `fork` debe usar el mismo flujo seguro de remapeo/importación que el fork explícito. Una copia superficial de archivos o un fake de test no satisface el contrato.
- El panel actual muestra cortes de apertura/cierre, consecuencias y referencias de evidencia, y limita la selección de actos a escenas del episodio abierto. En replay histórico reconstruye una vista inmutable a partir del snapshot y los eventos estructurales hasta el `commitIndex` del corte; la timeline aún no permite saltar directamente entre marcadores estructurales. Metadatos completos de escenas y fork siguen pendientes.
- P04/P13/P14/P15/P19 son gates de aceptación integral para cierre, consecuencias, idempotencia, recuperación, replay y fork. Las pruebas locales actuales cubren migración, CAS/idempotencia y comandos estructurales, pero no sustituyen esos recorridos de producto.

## Estado de implementación (15 de octubre de 2026)

El corte del 15 de octubre pasó `npm run verify` con 554 pruebas aprobadas, cero fallidas y una omitida en macOS por ser exclusiva de procesos zombie Linux; `npm run build` y `git diff --check` también pasaron. HTTP→SQLite verifica replay idempotente con ETag obsoleto y rechazo de lugar desconocido sin commit parcial; journal prueba que cerrar una escena libera sus presencias. El Director ya muestra observaciones con evidencia, pero faltan proyecciones históricas y recomendaciones de cierre. Estas pruebas no acreditan fork durable ni ESC-10 completo.

## Referencias

- [PRD, ESC-10 y ensayos](../PRD.md)
- [S01 — Dominio](../specs/01-dominio-y-catalogo.md)
- [S02 — Persistencia](../specs/02-persistencia-e-icm.md)
- [S04 — API](../specs/04-api-y-autoridad.md)
- [S05 — Interfaz](../specs/05-interfaz.md)
- [S07 — Verificación](../specs/07-verificacion.md)

## Avance del corte 43

El journal v34 registra cortes privados exactos para nuevas confirmaciones, prerrequisito de bifurcación fiel. No se habilitó fork ni restauración como fork. [Evidencia y límites](../auditoria/cortes-privados.md). Las descripciones anteriores conservan el estado del corte que auditaron.

## Avance del corte 44

La [preparación interna de bifurcación](../auditoria/preparacion-de-bifurcacion.md) ya lee una fuente exacta completa, remapea mundo/conocimiento y materializa recuerdos con procedencia, con un gate ICM real separado. No publica el destino ni sustituye el contrato de job durable, configuración Ready, API y GUI. La nueva historia comienza en revisión cero conservando la secuencia causal del estado importado; así no se invalida el catálogo de objetos aparecidos.
