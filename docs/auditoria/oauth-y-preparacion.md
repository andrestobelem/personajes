# Acceso Pi y preparación gráfica: corte v19

Fecha: 14 de octubre de 2026. El objetivo completo sigue activo; este corte no certifica los 77 criterios de aceptación.

## Implementación

El launcher comparte el ModelRuntime de autenticación entre el puerto administrativo y la representación, manteniendo sesiones, prompts, herramientas y memorias independientes por actor. El journal v19 conserva jobs OAuth, historial, leases e idempotencia sin tokens ni códigos. Login y logout son trabajos explícitos; al reiniciar no se inicia otra autorización. El flujo device-code oficial del SDK expone su código público temporal sólo a la sesión local que lo pidió, sin persistirlo en SQLite. La cancelación no finge rollback cuando el SDK ya confirmó una escritura de credenciales.

La GUI permite consultar metadata local, iniciar/cancelar autorización, desconectar y recuperar jobs después de recargar. No presenta una credencial como prueba de acceso a Luna. Los editores permiten redactar continuidad, identidad/historia humana y contexto curado de cada actor, y preparar lugares, escenas, canales, conexiones, dispositivos y posiciones. Una colocación explícita enlaza un personaje preparado con el Escenario; no convierte el dossier de investigación en conocimiento del actor. Audio aún conserva configuración sin editor completo.

Los objetivos, relaciones e inventario iniciales se materializan con elecciones explícitas y conservan su perspectiva propia. El nombre y la descripción privados de objetos no se convierten en apariencia pública. Los lotes conservan cantidad y condición al tomarlos. La revisión independiente detectó dos defectos y se corrigieron: los IDs de objetivos de origen y condiciones de hitos de dirección ya no llegan al actor; observar puede elegirse expresamente al colocar al personaje y se verificó su acción real. Ver [ADR de preparación y presencia](../adr/0002-preparacion-y-presencia-operativa.md).

El navegador detectó que pasar `fetch` directamente como propiedad de un objeto perdía el receptor Window en este navegador. Se corrigieron ambos clientes, de OAuth y de guardado de borradores, mediante funciones que invocan `fetch` con su receptor original. La [corrección del preflight](preflight-gates.md) impide aprobar un reporte con checks diferidos, incluido acceso ausente o expirado.

## Evidencia

- `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify`: TypeScript aprobado y 290 pruebas aprobadas, cero fallos y cero omisiones. Log local: `/tmp/personajes-v19-complete-verify.log`.
- `npm run build`: 387 módulos, sin externalización de Node; persiste aviso de bundle mayor de 500 kB. Log: `/tmp/personajes-v19-final-build.log`.
- Revisión independiente: 36 pruebas focales de colocación, proyección y reglas del Escenario aprobadas.
- Navegador real, host temporal `/tmp/personajes-gui-v19-Mj8mZs`, puerto 52943: panel administrativo sin credencial y sin jobs, editor de lugar con ID técnico oculto, dimensiones explícitas y plano; guardado confirmado de un borrador sintético y reapertura del mismo lugar, dimensiones e iluminación tras reiniciar el host. No se hicieron login, inferencias ni llamadas ElevenLabs.
- Lectura SQLite de ese host: un borrador, una versión de historia y una operación de guardado; cero WorldRuns, eventos, sesiones actorales/Continuista, jobs actorales/OAuth, reservas y reportes de validación. El fixture no es la primera puesta del usuario.
- Capturas locales: `/tmp/personajes-gui-v19-Mj8mZs/acceso-pi-final.jpg` y `/tmp/personajes-gui-v19-Mj8mZs/preparacion-guardada.jpg` y `/tmp/personajes-gui-v19-Mj8mZs/preparacion-reabierta.jpg`.

## Límites y siguiente paso

El recorrido completo de curación y colocación hasta Ready está probado con fixtures de dominio; no se recorrió entero desde la GUI. Las ediciones parciales de algunas secciones permanecen locales hasta aplicarlas. Falta prueba explícita de acceso al proveedor y su receipt vigente, adaptadores host de preflight, inicio/control durable desde GUI, medición del tiempo acumulado, representación y conversación visibles, dirección/narrador, voz/ritmo, replay, backups/restauración y aceptación integral/live. OAuth de cuenta, inferencia de Luna y audio real permanecen sin acreditar.

`DELETE /integrations/pi/oauth` actualmente acepta un job durable y devuelve 202. S04 conserva como contrato objetivo 204 de desconexión completada; esta diferencia queda abierta y no se presenta como cumplimiento de ese endpoint. Las rutas específicas OAuth tampoco sustituyen todos los jobs/SSE genéricos de S04.
