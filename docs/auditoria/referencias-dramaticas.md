# DIR-04 — referencias dramáticas opcionales

La puesta ahora admite de cero a doce referencias de tragedia griega o comedia antigua. Cada referencia registra tradición, autor, obra y un foco opcional escrito por quien configura la obra. La lista pertenece a `RunConfigurationDraft` y `ReadyRunConfiguration`; no es un requisito para validar una puesta. Las propuestas editoriales deben confirmarse antes de promover.

La interfaz de preparación permite agregar, editar y quitar referencias, y explica que son lentes opcionales. Una lista vacía es válida. Una referencia no formula el conflicto, no altera la línea dramática y no abre ni cierra episodios, actos o escenas.

El journal entrega la lista confirmada al `DirectorContext`. El system prompt la define como orientación: no impone un orden, una plantilla de etapas ni un desenlace. No se añade a los contextos actorales, al Escenario, a memorias ni a eventos. Las investigaciones completas permanecen en `docs/investigaciones/`; el contexto recibe sólo metadatos breves escogidos para esta puesta.

El campo es opcional en borradores, configuraciones Ready y contextos Director históricos. La lectura no inventa una selección vacía para documentos legados ni modifica su representación canónica. Un borrador nuevo registra explícitamente la lista vacía como valor inicial editable; una lista vaciada y confirmada se conserva como `[]`.

La verificación cubre schema, duplicados, confirmación, promoción a Ready, conservación de conflicto no formulado, edición gráfica, validación de contextos históricos y envío del contexto elegido por SQLite/journal al runtime Pi controlado del Director. La suite focal aprobó 135 pruebas al corte inicial. La aceptación visual de punta a punta y la evaluación con login/inferencia de proveedor reales siguen dentro de la aceptación integral pendiente; este cambio no certifica progreso semántico del Director con modelos reales.
