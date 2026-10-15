# Continuar en otra máquina

Leer primero el [handoff vigente: 15 de octubre de 2026](2026-10-15-representacion-en-vivo.md) y luego los documentos que ese archivo indique para la tarea elegida.

## Al retomar

1. Revisar `git status`, la rama y el commit local; traer `origin/main` conservando cualquier cambio local.
2. Leer [AGENTS.md](../AGENTS.md) y el handoff vigente. Confirmar con la nueva conversación qué trabajo se retoma y el estado del objetivo; un archivo no reactiva automáticamente un goal de Codex.
3. Preparar las dependencias y el runtime de la máquina según el handoff. Verificar por separado código, acceso al modelo y datos de la representación.
4. Trabajar sobre el pendiente elegido y registrar evidencia de lo ejecutado.

## Al dejar otro handoff

Crear `AAAA-MM-DD-tema.md` —agregar hora o sufijo si ya existe— y actualizar el enlace vigente de este índice. Conservar los anteriores como historia, sin tratarlos como estado actual.

Cada entrega debe incluir:

- Rama y commit de referencia; cambios locales si los hubiera.
- Pedido vigente y estado del objetivo, incluidas pausas explícitas.
- Resultado observado, pruebas y enlaces a sus documentos.
- Pendientes ordenados y siguiente acción concreta.
- Dependencias del host y estado de los datos transferibles.
- Skills pertinentes para la siguiente tarea.

Referenciar specs, ADR y auditorías existentes. Guardar aquí contexto de continuidad, no duplicar el diseño completo.

## Qué viaja por Git

El código, los documentos, las skills locales y los tests. Las representaciones durables, sesiones Pi, memorias ICM SQLite, configuración privada y login OAuth pertenecen al directorio privado del host; `git pull` no los transfiere.

Para continuar una representación vivida, usar el flujo de backup/exportación y restauración de la aplicación descrito en [backups externos](../docs/auditoria/backups-externos.md) y [backup e intercambio](../docs/auditoria/backup-e-intercambio-cloud.md). Revisar su alcance y validar el resultado en destino; disponer del documento del episodio no restaura su memoria. Autenticar el proveedor mediante login en la máquina de destino. Mantener tokens, bases privadas y archivos de autenticación fuera de esta carpeta y de Git.
