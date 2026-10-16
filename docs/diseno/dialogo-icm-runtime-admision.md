# Diálogo: admisión de ICM Markdown al runtime

Fecha: 15 de octubre de 2026. Ronda real entre `human_reception_interviewer` y `human_reception_custodian`, coordinada por el integrador antes de implementar. Se conservan preguntas, respuestas y challenge efectivamente intercambiados, condensados. Las opciones técnicas son decisiones del integrador; no nuevas preferencias atribuidas al usuario.

Se revisaron el [plan de integración](plan-icm-markdown-runtime.md), el [diálogo anterior](../auditoria/dialogo-icm-markdown-runtime.md), [obra/AGENTS](../../obra/AGENTS.md), el ruteo y los contratos citados abajo, las skills locales grill-with-docs/grilling/domain-modeling y su [procedimiento](procedimiento-grill-with-docs.md). ICM Markdown y memoria ICM SQLite siguen siendo componentes distintos.

## 1. Inventario y secciones

**Pregunta:** ¿cerrar un inventario allowlisted por ID y secciones precisas, sin cargar identidad raw ni seguir enlaces? El entrevistador recomendó `Process` y `Cierre` para actuación y contexto propio, y contratos mínimos equivalentes por rol.

**Respuesta del custodio:** compatible como **propuesta técnica**, no elección del usuario. Las secciones precisas evitan Inputs/Outputs que pueden referir archivos crudos o instrucciones de filesystem. No son un sandbox: incluso `Process` contiene verbos como leer, escribir o actualizar memoria. La política y las tools reales del host conservan autoridad. El prólogo del contexto propio contiene reglas de independencia Pi/activación que deben preservarse en política del host y datos tipados aunque no se seleccione ese prólogo. La moderación mezcla responsabilidades: su contrato no concede al Continuista autoridad del Regidor mecánico.

Inventario técnico admitido para este alcance; los IDs son referencias estables del manifiesto propuesto, no rutas aportadas libremente por el modelo:

| Rol | ID lógico y archivo autorizado | Secciones |
| --- | --- | --- |
| Actor | `stage.actuation` — [etapa 02](../../obra/stages/02-actuacion/CONTEXT.md) | `Process`, `Cierre` |
| Actor | `actor.<slug>.context` — `obra/personajes/<slug>/CONTEXT.md`, sólo personaje asignado y seleccionado | `Process`, `Cierre` |
| Continuista | `stage.moderation` — [etapa 03](../../obra/stages/03-moderacion/CONTEXT.md) | `Process`, `Cierre` |
| Continuista | `role.continuista` — [contrato propio](../../obra/continuista/CONTEXT.md) | `Process`, `Cierre` |
| Director | `stage.direction` — [etapa 07](../../obra/stages/07-direccion/CONTEXT.md) | `Process`, `Cierre` |
| Director | `role.director` — [contrato propio](../../obra/direccion/CONTEXT.md) | `Process`; este archivo no tiene `Cierre` |
| Configurador | `role.configurator` — [setup](../../obra/setup/CONTEXT.md) | `Process`, `Cierre` |
| Narrador, si está habilitado | `role.narrator` — [contrato opcional](../../obra/narrador/CONTEXT.md) | `Process`, `Cierre` |

Seleccionar una sección inexistente falla; no se toma el archivo entero como sustituto. No hay descubrimiento recursivo de enlaces ni carga automática de `identidad.md`, dossiers, investigación global, outputs vivos o contexto de otro actor. Identidad/historia siguen pasando por preparación curada y experiencias propias admitidas. El Regidor mecánico no necesita una nueva instancia LLM por esta integración.

Fuentes: plan, pasos 1 y 5; diálogo anterior, rondas 2 y 3; contratos de etapa/rol y reglas de aislamiento de obra.

## 2. Snapshot, paquetes y compatibilidad

**Pregunta:** ¿congelar snapshot inline con bytes/hash en Ready y paquetes en journal por rol/job/generación/corte, manteniendo hash ICM separado de `preparedContextHash`? ¿Conservar legacy sin backfill y exigir selección admitida para puestas nuevas?

**Respuesta del custodio:** almacenamiento inline y paquetes en journal son **propuestas técnicas** coherentes con los pasos 3 y 6 del plan. `preparedContextHash` conserva su significado de identidad/preparación; no se redefine para representar el contrato ICM. Bytes, procedencia, audiencia, revisión y versión del compilador se fijan antes del despacho. Recovery y reformulación del mismo job/generación conservan el paquete exacto; un hash adulterado o paquete de otro actor/job bloquea antes de inferir.

**Regla derivada:** legacy conserva configuración, hashes y prompt histórico, sin completar datos desde el árbol actual. La excepción técnica permite continuar su flujo histórico con estado explícito `legacy-without-icm`; no acredita integración MEM-07. Las puestas nuevas no heredadas necesitan selección admitida antes de Ready. La GUI puede proponer IDs, pero esa propuesta no equivale a elección humana ni a admisión confirmada.

Cambiar, borrar o sustituir una fuente por symlink después de Ready no cambia el snapshot guardado. Una admisión nueva valida raíz, ruta, UTF-8, límites, sección y hashes; la ejecución existente usa sus bytes congelados, no relee el árbol mutable. Ausencia o corrupción de un paquete que debiera existir es error técnico, no falta de memoria ficticia.

## 3. Configurador antes de Ready

**Pregunta:** el Configurador ayuda a preparar Ready, que todavía no existe. ¿Usar un snapshot de borrador admitido mediante CAS/hash y un paquete congelado por job, sin ruta ambiental?

**Respuesta del custodio:** sí, como **propuesta técnica** que resuelve esa dependencia. La GUI admite la selección de borrador antes de crear el job; el Configurador sin snapshot admitido no usa `setup/CONTEXT.md` vivo como fallback. La promoción utiliza el snapshot Ready pertinente a su corte y la fuente exacta elegida; nunca el último workspace disponible por defecto.

## 4. Capas de autoridad y outputs

**Pregunta:** ¿separar `hostPolicy`, `roleContract` Markdown seleccionado y `diegeticContext` curado en el prompt, manteniendo `noContextFiles`, sin filesystem tools y con outputs Markdown como proyecciones?

**Respuesta del custodio:** la separación de autoridad, `noContextFiles`/ausencia de filesystem tools y outputs no autoritativos preservan **reglas derivadas ya acordadas**; el formato de tres capas es una **propuesta técnica**. El contrato procedural entra realmente al prompt del rol, pero no puede ampliar tools, proveedor, identidad autenticada, paths, capacidades ni permisos. Una mención de escritura no crea una tool; la escritura autoritativa sigue pasando por el schema y journal del host. Las proyecciones Markdown no son commits ni recuerdos por el mero hecho de existir o editarse.

Fuentes: diálogo anterior, rondas 2 y 3; constitución y autoridad por rol; PRD MEM-07; S02 ICM Markdown y S03 contexto/tools.

## Challenge y cierre

**Pregunta:** si falta el snapshot admitido del Configurador, ¿leer setup vivo? Si un paquete nuevo está corrupto, ¿tratarlo como legacy? ¿Un fork legacy recibe contratos actuales? ¿Seleccionar sólo Process/Cierre basta para hacer seguros los verbos de archivo?

**Respuesta real del custodio:** no a las cuatro sustituciones. El Configurador primero necesita admisión; corrupción nunca habilita fallback legacy; un fork legacy conserva ausencia y procedencia, sin rellenarlas; secciones precisas reducen superficie pero no reemplazan política del host ni enforcement de tools. Nueva puesta no heredada admite fuentes antes de Ready. No seguir enlaces ni convertir referencias en permisos.

El integrador puede implementar estas decisiones sin otra preferencia humana: inventario explícito por rol, snapshot inline admitido, paquetes journal ligados a job/corte con hash independiente, admisión de borrador para Configurador y excepción legacy declarada. No se acredita cumplimiento global mediante el slice de actor: también requieren integración los roles de modelo Continuista, Director y Configurador; Narrador conserva habilitación opcional y su scope propio.

Este documento registra diseño y fronteras. Implementación, recepción efectiva del contrato por Pi, pruebas adversariales, reinicio/reformulación, GUI y fork/backup requieren evidencia posterior; esta entrevista no los declara ejecutados.
