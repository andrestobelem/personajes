# ADR 0012 — Congelar la fuente respaldada antes de continuar una obra

Restaurar como bifurcación toma su autoridad del backup verificado: se conserva una fuente exacta sellada con el trabajo y la publicación se vuelve a derivar desde ella. Consultar al padre vivo sería más simple, pero impediría recuperar un origen perdido o incorporaría cambios posteriores al respaldo. El coste de guardar esa fuente es explícito y mantiene la recuperación independiente del estado actual del padre.

La revisión guarda una intención privada con propietario, selección y operación antes de cualquier efecto; confirmar la consume y admite siempre esa misma operación. Si el proceso cae entre confirmación y creación del fork, la intención permite volver a admitirlo sin elegir otro destino. Validación y migraciones se ejecutan sobre copias privadas desechables, porque incluso una lectura SQLite con WAL puede crear archivos auxiliares en el bundle. Recuperar el host completo conserva un contrato offline distinto; no se sustituye una base abierta desde la ruta de bifurcación.

[Entrevista y alternativas](../auditoria/dialogo-restauracion.md), [respuestas](../auditoria/restauracion-respuestas.md) y [evidencia ejecutada](../auditoria/restauracion-como-bifurcacion.md).
