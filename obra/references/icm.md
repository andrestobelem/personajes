# Procedencia y adaptación de ICM

Fuentes primarias consultadas el 14 de octubre de 2026:

- Jake Van Clief y David McDermott, *Interpretable Context Methodology: Folder Structure as Agentic Architecture*, [arXiv 2603.16021v2](https://arxiv.org/abs/2603.16021v2), revisión del 18 de marzo de 2026; el resumen también utiliza la denominación Model Workspace Protocol.
- [Repositorio upstream RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology), referencia `02ba5d85c7871b75c7c702a2d8da6524723d53d4`. El repositorio publica el método con licencia MIT; el paper tiene su propia licencia.

La orientación general remite al ruteo; el ruteo conduce a contratos numerados; cada contrato selecciona referencias y artefactos por sección. El diseño evita cargar todas las instrucciones y todo el historial en cada paso. Los productos intermedios permiten inspección y revisión.

## Decisiones propias de esta adaptación

La obra adapta el método a un Coordinador que marca el pulso y a una instancia Pi independiente por personaje, con contexto, historial y memoria propios. No usa un único agente cambiando de personaje entre etapas. La representación recurrente se expresa como ciclos. ICM no proporciona por sí mismo concurrencia, aislamiento de secretos, permisos de archivos, transacciones ni interacción gráfica en tiempo real.

El flujo teatral distingue hechos compartidos, percepciones, creencias y metas. El director reconoce etapas a partir de las acciones; no distribuye el argumento secreto como un recuerdo del personaje. Los registros variables viven en `output/`, incluyendo los subdirectorios de cada personaje. La memoria cambia; las referencias de actuación no cambian automáticamente con ella.

Las referencias de conocimiento fluyen desde contratos hacia fuentes canónicas. Los índices son ayudas de navegación; no implican que un agente deba recorrer todos los enlaces. Los productos de una etapa se consumen por su identificador y turno, no como ejemplos autoritativos de cómo escribir futuros productos.
