# Continuación en Codex Cloud

Fecha: 14 de octubre de 2026. El objetivo integral permanece activo: leer y corregir los documentos, completar y revisar PRD/specs, implementar y revisar el producto hasta verificar todos sus requisitos. La tarea no ofrece una herramienta de Goal formal; el objetivo recibido se conserva como instrucción y en [objetivo y progreso](objetivo-y-progreso.md).

## Checkout y entorno comprobados

El checkout antiguo contenía sólo tres archivos en `1b34b3d7f5c141259472591eac13f487d571ec6b`. Se obtuvo `main` desde GitHub usando la autenticación/proxy existentes. El checkout está en la rama `main`, siguiendo `origin/main`, en `b6246e1f2c6ecedc7f0dc6869bfeb336f47bfd4b`. Estaba limpio antes de continuar la implementación. No se creó otra rama de trabajo ni worktree, y no se hizo push.

Cloud usa Node 24.19.0 y npm 11.9.0. Se instalaron dependencias mediante `npm ci` sin alterar el lockfile. ICM 0.11.4 se instaló desde la release oficial Linux x86_64 GNU, con TLS y checksum verificados, en `/workspace/personajes-tools/icm-0.11.4/icm`:

- Archivo de release: SHA-256 `319e619e809cc80e033b56dfb7ec5977ad886d1a13f9db2ab82022a9ecaca376`, contrastado con el digest de la API oficial.
- Binario: SHA-256 `9359be07cd6e195d7962c3a961d906e7fd2e4853cd7fcf699bd9b67d8a9c4d5c`.

Esta release es distinta de la compilación del commit auditado que se usó en macOS. Los resultados anteriores no se atribuyen a Cloud. Los procesos y los datos sintéticos de pruebas no constituyen la primera obra del usuario.

## Corte de implementación y revisión

La agenda de una corrida autorizada acepta quedar ociosa, sin inventar un estímulo, una sesión Pi o un evento ficticio. Antes, esa ausencia de trabajo podía causar una pausa compensatoria por supuesto rechazo del runtime. La prueba de regresión compara el snapshot completo y verifica cero solicitudes y cero sesiones nuevas.

Los controles gráficos consultan RunView y el presupuesto público del host. Conservan la clave y el corte del comando ante una respuesta incierta; errores, confirmación de cierre y estados pendientes quedan visibles. Las rutas dedicadas de start/pause/resume/step/stop/close comparten la autoridad y el handler CAS/idempotente. La lectura periódica no reemplaza la entrega SSE prevista para el producto completo.

La revisión independiente detectó y corrigió respuestas antiguas de interfaz que podían afectar otra corrida seleccionada. También identificó que recuperar un paso no puede reutilizar autorización de proveedor de un proceso anterior: debe conservar el job/pulso y exigir una nueva comprobación antes de inferir. El cierre de un paso espera entregas de su propia corrida, no las de todo el host.

## Evidencia focal ejecutada

- Adaptador CLI/SQLite de ICM real: 4 pruebas aprobadas, cero fallos y cero omisiones.
- Runtime y regresión de agenda ociosa: 7 pruebas aprobadas, cero fallos y cero omisiones, con ICM real y transporte Pi local controlado.
- Chromium headless con servidor construido real y dos preparaciones sintéticas: lectura de estado/presupuesto; start y step bloqueados sin preflight; cambio de corrida con control y preflight pendientes, incluyendo respuesta antigua; evaluación habilitada desde pausa; stop confirmado; cierre confirmado y terminal; sin errores JavaScript de página. Se liberó ownership al cerrar el launcher y se eliminaron los datos sintéticos.

La ejecución restringida del runner no produjo el recuento individual esperado y no se cuenta como gate aprobado. Las verificaciones útiles se repitieron con el runner Node real y acceso a sockets locales. No hubo login, inferencia real de proveedor, Voice Design, TTS ni calibración audiovisual. Estos gates permanecen separados y pendientes.

La aceptación integral de los 77 requisitos sigue abierta. El [PRD](../PRD.md), las [specs](../specs/README.md), la [trazabilidad individual](trazabilidad-prd.md) y los [pendientes](../PENDIENTES.md) conservan el alcance completo.

## Gate global y configuración reusable

`PERSONAJES_ICM_TEST_BINARY=/workspace/personajes-tools/icm-0.11.4/icm npm run verify` pasó en Cloud: tipos y **406 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build` pasó con 399 módulos; permanece el aviso de bundle de 703,11 kB. La prueba de preflight con ICM usa ahora la misma variable de binario que el resto de la suite, eliminando la dependencia de una ruta temporal histórica de macOS.

Se ejercitó el script de instalación completo (ICM verificado, npm ci y build) y se guardaron `install_script`, `start_skill` y la pertenencia del repositorio con SHA/mount path correctos. El guardado confirmó un draft; no publicó ni comprobó restauración en otra tarea. La publicación corresponde a los ajustes del entorno.

El arranque guardado inició el launcher con raíz privada fuera del checkout e ICM persistente verificado. Respondió HTML construido y health HTTP/catalog `ok`, con runtime `unavailable` y estado general `degraded`: la composición de workers no acredita roles administrativos completos ni acceso al proveedor. El entorno permite desarrollar y probar; no se declara la obra completa lista para inferir.

## Escenario y conversación: corte 31

La proyección pública ya no transporta mentes, nombres privados, biografías humanas ni contexto preparado desde la configuración completa. Endpoints de Escenario, eventos, conversaciones y jobs usan DTO acotados. La historia admite sólo cortes de commit conservados; si una operación confirmó varios eventos atómicamente, no se inventa un snapshot intermedio. El plano es esquemático y el transcript distingue palabras emitidas, audiencia efectiva y entregas/memorias técnicas.

Chromium ejecutó 17 comprobaciones con tres corridas sintéticas, incluyendo intervención humana publicada, filtro de conversación, bloqueo de envío al pausar y preservación del borrador. La revisión corrigió ID humano interpretado como UUID y la vista de Escenario atrasada respecto de una pausa ya confirmada. No hubo actuación de proveedor. El build de este corte pasó (407 módulos, 738,04 kB); el gate global anterior de 406 pruebas no se atribuye a cambios todavía en integración.

El draft reusable se actualizó y su guardado fue confirmado: verifica ffmpeg/ffprobe y mantiene el proxy de Node con `NODE_USE_ENV_PROXY=1`, TLS y raíz de autenticación independiente. El script completo se repitió con éxito. Sigue requiriendo revisar y guardar los ajustes, y publicar el entorno; no se comprobó restauración en una tarea nueva.

## Checkpoint integrado y arranque recuperado

Tras estabilizar fuentes y corregir fixtures de migración, el gate completo pasó con 516 pruebas. El checkpoint posterior incorpora la corrección de ownership y los hechos registrados del Narrador: **522 pruebas aprobadas, cero fallidas y omitidas**, tipos aprobados. Build pasó con 422 módulos; bundle principal 758,83 kB y voces separadas 47,67 kB, con aviso de tamaño pendiente.

Se verificaron en Chromium 21 comprobaciones de controles/Escenario/intervención/intercambio y los flujos positivos de voces/binding/Fang con HTTP, SQLite y medios FFmpeg reales y transporte REST controlado. No se atribuyen a acceso ni generación de proveedores reales. El inspector distingue corte causal, revisión y commit; Director tiene sesión/ledger propio y cuota agregada. Backup usa barrera global comprobada con ICM real; restore permanece pendiente.

El servidor anterior dejó ownership asociado a un proceso zombie de Linux. La recuperación explícita verifica dos lecturas concordantes de PID/estado/startTicks dentro de los gates y conserva nonce/inode/contenido; no mata ni libera procesos vivos o ambiguos. Diez pruebas de ownership pasaron, incluida una con zombie real. Se recuperó exclusivamente ese registro y se conservaron los datos. El launcher arrancó, respondió health/HTML/bundle con HTTP 200 y cerró/reabrió limpiamente para servir el build actual. Health indica composición local `degraded`, sin acreditar proveedores.

La ampliación v28 del reviewer del Narrador quedó aislada y preservada en `/workspace/personajes-cloud/drafts`, fuera del checkout ejecutable. El journal sigue en v27. Planner de iniciativa/rutinas y Configurador son componentes parciales; no se presentan como ejecución terminada. El objetivo integral y los 77 criterios permanecen abiertos, con alcance vigente en [PENDIENTES](../PENDIENTES.md).
