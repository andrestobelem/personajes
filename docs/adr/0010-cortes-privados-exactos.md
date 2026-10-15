# ADR 0010 — Cortes privados registrados por commit

El estado privado actual y la secuencia causal de una experiencia no demuestran cuándo fue admitida: una entrega posterior puede conservar la secuencia de un evento anterior. Se decide registrar conocimiento y experiencias propias al final de la misma transacción de cada commit del Escenario, vinculados al snapshot y la configuración exactos, y declarar no disponibles los cortes antiguos que nunca se capturaron.

Se descartan reconstruir el pasado filtrando el ICM actual por secuencia y fabricar checkpoints durante la migración. La copia completa por commit aumenta almacenamiento y costo de escritura/lectura, pero permite comprobar integridad, membresía y cierre de referencias sin depender del estado mutable del índice ICM. Una compactación futura deberá preservar este contrato. La bifurcación durable sigue pendiente; este ledger es un prerrequisito, no su implementación.

Contrato contrastado mediante [entrevista delegada](../auditoria/dialogo-cortes-privados.md); implementación y límites en [evidencia del corte 43](../auditoria/cortes-privados.md).
