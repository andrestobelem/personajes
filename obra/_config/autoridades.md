# Autoridades de escritura y lectura

Esta tabla es el contrato canónico. Cada personaje se interpreta en su propia instancia Pi. El Coordinador invoca esas instancias y coordina las demás responsabilidades; no ejecuta las identidades del elenco cambiando de rol dentro de su historial.

| Autoridad | Puede escribir | Lectura mínima |
|---|---|---|
| Configurador | `_config/continuidad.md`, `_config/voz-y-ritmo.md`, `_config/narracion.md`, configuración del escenario, identidades preparadas y estado inicial | Dossiers y decisiones de diseño; acceso de preparación, no conocimiento diegético |
| Coordinador | `output/ejecucion.md`, `output/pulsos.md`, `stages/*/output/registro.md`, `participacion/output/entrada.md`, bandeja de revisión en etapa 03, `narrador/output/bandeja.md` y `personajes/*/output/revision.md`; normalización de propuestas humanas | Cursor y comprobaciones de cierre; no necesita monólogos privados |
| Escenario | `escenario/output/*`, `participacion/output/salida.md`; paquetes de percepción y distribución; `personajes/*/output/entrada.md` | Estado del escenario, reglas, propuesta validada, canales y destinatarios |
| Actor de `<slug>` | Sólo su `output/propuesta.md`, `output/estado.md` y `output/memoria.md` | Su identidad, su entrada y recuerdos pertinentes; nunca estado global, dirección ni memoria ajena |
| Regidor | `stages/03-moderacion/output/veredictos.md`, `narrador/output/veredictos.md` | Propuesta, capacidades/identidad del actor y reglas; no necesita todos los secretos |
| Continuista | `stages/03-moderacion/output/revisiones-respuestas.md`, `narrador/output/revisiones.md` | Propuesta y versión, contexto pertinente del actor, continuidad e indicaciones autorizadas |
| Director | `direccion/output/*` | Eventos confirmados y sus consecuencias; puede solicitar un informe de configuración, sin transferirlo a actores |
| Narrador opcional | `narrador/output/borradores.md` | Sólo fuentes autorizadas para espectadores; nunca razonamiento interno privado del LLM |
| Observador | `observacion/output/*`, `narrador/output/narracion.md` | Eventos confirmados y registros de evolución; los privados sólo en una vista interna explicitada |

No hay escrituras simultáneas sobre el mismo archivo. Las instancias pueden preparar decisiones de manera independiente; Escenario confirma efectos compartidos en orden serial y el Coordinador evita dos trabajos simultáneos sobre una misma sesión de actor. Invocar una instancia no cambia al autor responsable. Un actor no puede editar sus capacidades ni su núcleo estable durante la actuación; puede proponer un cambio, con evidencia, para una revisión explícita de configuración. Esto no congela decisiones o valores: puede reconsiderarlos y actuar de otra manera por una experiencia, conservando la trazabilidad del cambio.

Las carpetas no hacen cumplir esta tabla. El runtime deberá entregar contexto filtrado y herramientas acotadas por rol. El Regidor y el Continuista aportan revisiones complementarias; no constituyen una garantía absoluta contra prompt injection. Nunca se agregan secretos reales, credenciales ni permisos de infraestructura al contexto diegético.

Los manifiestos de etapa (`stages/*/output/registro.md`) los escribe únicamente el coordinador al comprobar los productos del responsable de etapa. Contienen estado, IDs y rutas, sin duplicar el contenido privado. Los roles entregan sus productos; no escriben a la vez el manifiesto.

El Director evalúa dramaturgia, el Continuista la admisibilidad de respuestas y el Regidor las fronteras de autoridad. Son responsabilidades combinables en una misma instancia; no obligan a crear tres runtimes. Esta combinación sólo concierne a responsabilidades de control: no permite mezclar sus historiales con los de un personaje ni fusionar instancias de distintos personajes. La devolución técnica al actor se mantiene fuera de su memoria diegética.

El Narrador opcional es una responsabilidad de representación para espectadores, no un personaje canónico adicional. Sus versiones requieren controles de Regidor y Continuista antes de publicación por el Observador; no se escriben eventos, percepciones o recuerdos de actores a partir de ese texto.
