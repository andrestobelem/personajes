# Recuperación offline: respuestas del custodio — corte 48

Intercambio real entre `/root/restore_interviewer` y `/root/restore_custodian`, conforme al [procedimiento delegado](../diseno/procedimiento-grill-with-docs.md). Continúa la [entrevista del corte 47](restauracion-respuestas.md). Las propuestas operativas son decisiones de diseño delegadas; no preferencias atribuidas al usuario ni evidencia de ejecución.

## Fuentes

Concepto de la conversación: identidad, memoria y punto de vista propios, instancia Pi independiente por personaje y GUI funcional. Contrato de producto: PRD MEM-08, NFR-03 y P14; S02 backup/checkpoints/sesiones; S04 recover sin descarte de posteriores; S05 operación gráfica. Estado leído: [restore-fork C47](restauracion-como-bifurcacion.md), [ADR 0012](../adr/0012-fuente-de-restauracion-y-confirmacion-durable.md), `src/domain/backup.ts`, `src/application/backup-service.ts`, `backup-fork-restore.ts`, `local-host.ts`, `host-backup-quiesce.ts`, `src/adapters/host-ownership.ts` y `pi-session-integrity.ts`.

El gate padre `withHostDirectoryOperation` ya existe y sobrevive al intercambio del directorio. Su existencia no acredita cierre de conexiones, recuperación ni reinicio. Las operaciones acquire/release de ownership cooperan con ese gate; no se debe introducir un release/reacquire anidado que intente tomarlo por segunda vez.

## Ronda 1 — estado recuperable, exclusiones y raíz canónica

**Pregunta recibida.** El entrevistador examina la propuesta GUI preview/confirmación, job durable en control externo hermano, cierre HTTP/workers/handles, staging completo con original conservado, intercambio offline y reapertura con GET. Pregunta por fingerprint, exclusiones administrativas, cambios de voz/perfil sin eventos nuevos y conservación de paths/leaves bajo el mismo root.

**Respuesta.**

- **Requisito del concepto y contrato P14/S02/S04:** recuperar la misma corrida, memoria, sesiones y frontera coherentes, sin descartar historia posterior. La interfaz permite operar y comprender el resultado; un motor CLI aislado no completa ese requisito.
- **Regla derivada:** fingerprint de todo el estado durable operativo, no sólo eventos/snapshot: configuración y perfil Ready, contexto preparado, subjetividad, presupuesto/reservas, trabajos/recibos/claims, voces/bindings, sesiones/checkpoints/medios y forks staging con artefactos. Cambiar voz o perfil con cero eventos nuevos puede hacer divergente al destino.
- **Propuesta de comparación:** journal completo normalizado con exclusiones explícitas mínimas e inventario de archivos, en vez de una lista de tablas conocidas que ignore futuras tablas. Tabla nueva desconocida debe fallar cerrada hasta decidir su semántica.
- **Exclusiones legítimas acotadas:** tablas del ledger de backups/previews de restore y únicamente receipts HTTP de esas operaciones administrativas pueden excluirse de la comparación semántica para evitar que la propia admisión invalide el preview. Deben conservarse y conciliarse explícitamente en el conjunto preparado; excluir de comparación no autoriza borrarlos. No excluir globalmente idempotencia ni integraciones: pueden representar cambios de voz, perfiles o presupuesto.
- **Regla derivada:** gates de ownership/PID transitorios y control externo de la operación actual tienen contratos propios; no son acontecimientos recuperables de la ficción. Se preservan durante el intercambio sin copiar el ownership antiguo del bundle.
- **Regla documentada S02:** no reescribir a mano IDs, paths JSONL, headers `cwd` o leaves congelados. El mismo root canónico permite recuperar los bytes y asociaciones originales, crear sólo directorios host vacíos necesarios y validar checkpoints al reabrir. La recuperación no inicia inferencia automáticamente.
- **Propuesta de alcance C48:** backups locales registrados, misma lineage y `originRootHash` concordante con la raíz canónica actual. Falta de hash o raíz distinta bloquea, salvo mecanismo equivalente explícitamente diseñado y probado. No afirmar portabilidad desde otra raíz.
- **Propuesta operativa:** control externo hermano + cierre/drain total + gate externo + staging e intercambio + reapertura + GET es compatible con GUI. Confirmar admite la operación; éxito requiere verificación después de reabrir. Validar el bundle mediante copias privadas y conservar original/quarantine.

No se identificó una preferencia humana material imprescindible para esta ronda.

## Ronda 2 — corrupción, fases de intercambio y gate abandonado

**Pregunta recibida.** El entrevistador contrasta un journal corrupto con un destino realmente ausente; plantea job externo con fases persistidas, crash entre los dos renames y lectura del resultado después del reinicio. Detecta además que `privateRoot` crea la raíz antes de tomar el gate externo y pregunta por rescate de gates y autorización frente a corrupción.

**Respuesta.**

- **Regla derivada de P14/S04:** ilegibilidad/corrupción no es ausencia. Si no se puede probar identidad y ausencia de historia posterior, preview bloquea. Conservar los bytes en quarantine no autoriza retroceder silenciosamente la historia. Un `world.sqlite` ausente entre otros datos tampoco significa un host vacío recuperable.
- **Propuesta de admisión del destino ausente:** exigir evidencia externa previamente registrada de identidad, lineage y operación, más ownership exclusivo. Nunca aceptar lineage o ausencia sólo porque lo afirma el cliente.
- **Propuesta durable:** registro externo de operación/principal/confirmación/bundle/fingerprint y fases antes de efectos; markers identificados para original, staging y publicación, fsync de directorios padre, y resultado verificable al reabrir. Reconciliar sólo la misma operación por IDs/hashes; si una fase es ambigua, conservar datos y diagnosticar. El preview vencido después de admisión no crea otra operación ni otra continuidad.
- **Hallazgo confirmado por lectura de código:** `privateRoot` hace `mkdirSync` y `chmodSync` antes de adquirir el gate externo. En el intervalo entre renombrar original y publicar staging, un competidor puede recrear una raíz vacía antes de fallar por gate ocupado. **Regla derivada:** adquirir la exclusión externa antes de cualquier creación, chmod u otro efecto sobre la raíz; corregir también el acceso general de ownership, no sólo el engine restore.
- **Propuesta de rescate explícito de un gate abandonado:** diagnóstico de nonce, bytes, inode/dev e identidad del proceso; probar ausencia (ESRCH o evidencia zombie ya contemplada), revalidar bajo exclusión de un mecanismo de rescate externo que no dependa de tomar el mismo gate ocupado, y conciliar fases/markers antes de retomar. PID activo/reutilizado/ambiguo bloquea. La antigüedad no autoriza borrar y el arranque no limpia gates automáticamente.
- **Frontera de consentimiento:** el recover y su confirmación del diff ya están autorizados como flujo de producto. Reemplazar un destino corrupto con un backup potencialmente anterior es una operación con pérdida desconocida distinta; no deducir esa elección de un error. Si se implementa en el futuro, debe presentar el alcance de pérdida y pedir una elección material explícita, conservar el original y auditar. Este corte puede bloquear corrupción sin añadir aprobación general para el recover seguro.

## Ronda 3 — inventario completo, reapertura y evidencia

**Pregunta recibida.** El entrevistador plantea preservar ledgers y backups posteriores, inventariar archivos ajenos al manifest sin borrarlos, no restaurar auth/credenciales HTTP y verificar memoria, sesiones, presupuesto y estado del mismo job al reabrir. Propone pruebas de competidor entre renames, cambios sin eventos, administración de backups y corrupción; pregunta por preferencias materiales ausentes.

**Respuesta.**

- **Regla derivada de conservación:** inventariar toda la raíz antes del intercambio. Copiar sólo los archivos del manifest puede borrar backups posteriores y otros archivos legítimos. Mantener su almacén y ledger actual fuera del retroceso o preservarlos por inventario host explícito. Archivo desconocido bloquea; no se elimina para simplificar la recuperación.
- **Regla documentada de secretos:** auth fuera de la raíz se conserva actual y no se importa desde el backup. Cookies, sesiones HTTP, CSRF y opt-in de inspector son permisos técnicos, distintos de sesiones Pi y de identidad ficticia; invalidarlos y restablecer sesión de host al reabrir. La GUI consulta el mismo ID de operación autenticada, sin secretos en la URL.
- **Regla derivada sobre infraestructura:** recrear directorios `cwd` vacíos declarados es admisible; contenido no inventariado no se borra silenciosamente.
- **Invariantes de reapertura:** mismas lineage, corridas, continuidades y cortes; trabajos/claims/receipts recuperables; mismos IDs ICM/ULIDs y asociaciones exactas entre experiencia y recuerdo; sesiones Pi y leaves aceptados verificados con tails forenses sin adoptarlos. Auth actual revalidada y perfil seleccionado conservado sin fallback.
- **Regla derivada:** la recuperación de trabajo abandonado usa sólo contratos mecánicos existentes. No inicia Pi ni TTS. Restaurar no reinicia presupuestos, reembolsa reservas ni inventa duraciones; tiempos inciertos permanecen conservadores. Pausas y mutaciones técnicas del drain deben quedar explícitas en fingerprint o transformación documentada, no presentarse como igualdad inexistente.
- **Propuesta de control durable:** estado y receipt de la operación viven fuera del journal reemplazado, ligados a principal/operación. GET sólo consulta; puede devolver el mismo resultado después de que el journal interno y las sesiones HTTP se hayan reemplazado.
- **Evidencia propuesta:** además de las pruebas del entrevistador, probar symlink/hardlink/traversal, integridad de manifest y sidecars del bundle, escritura tardía drenada/rechazada y fallo de reapertura que conserve original y no marque éxito. Probar cambios de tabla nueva, binding o perfil sin eventos; cambios administrativos de backup preservados sin autoinvalidación; corrupción bloqueada; competidor entre renames sin creación de raíz vacía.

**Cierre de diseño.** No aparece una preferencia humana material imprescindible. El flujo gráfico completo propuesto es compatible con el concepto, siempre que no transforme un reset sobre corrupción en recover seguro. El integrador debe conservar como pendientes las partes que no implemente o cuya ejecución no demuestre este corte; la entrevista no acredita ninguna restauración.
