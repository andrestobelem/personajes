# Trabajo en este repositorio

Estas instrucciones orientan a los asistentes que desarrollan o mantienen el proyecto. Las instrucciones del usuario tienen prioridad. Leer documentación de investigación para mantenerla no autoriza a entregar su contenido a todos los personajes de la ficción.

## Entrada y estado

- Empezar por [README.md](README.md), [docs/README.md](docs/README.md), [constitución](docs/constitucion.md) y [GLOSSARY.md](GLOSSARY.md); después cargar sólo lo pertinente a la tarea.
- Conservar un documento por investigación y fuentes con límites explícitos. Distinguir requisito del usuario, evidencia, inferencia, propuesta y capacidad ejecutada.
- Para mantenimiento de `obra/`, seguir también [obra/AGENTS.md](obra/AGENTS.md) y su ruteo ICM. No inventar escenas o registros para llenar plantillas.
- La [matriz de decisiones](docs/diseno/decisiones-abiertas.md) evita reabrir requisitos ya resueltos. Actualizar la [cobertura](docs/auditoria/conversacion-y-cobertura.md) cuando cambie el estado de una entrega.

Al retomar trabajo desde otra máquina o conversación, leer [handoff/README.md](handoff/README.md) y su entrega vigente para conocer estado, pausas y dependencias del host.

## Decisiones que se preservan

- Escenario es el mundo operativo; escenografía es su representación visual/material; escena admite uno o más personajes, acciones y silencio.
- Interfaz gráfica completa, principalmente funcional y visual: permitir entender y operar la obra. Documentación navegable no equivale a interfaz implementada.
- Cada personaje tendrá una instancia Pi independiente, prompt, contexto, historial, tools y memoria propios. El coordinador puede marcar el pulso, sin decidir por ellos.
- Perfiles elegibles por representación: `openai-codex`/OAuth/`gpt-6.1-sol`/`low` predeterminado, y `anthropic`/`claude-opus-5-5`/`medium` alternativo, según la [decisión posterior del usuario](docs/adr/0003-perfiles-de-inferencia-seleccionables.md). Todos los roles respetan la selección, sin sustitución automática. Luna/xhigh queda sólo para historia.
- Dominio de objetos y mensajes por composición, sin herencia propia. Las librerías externas conservan sus mecanismos internos.
- ICM de contexto Markdown e ICM Memory con SQLite son investigaciones distintas. Las carpetas o filtros de una base no son aislamiento efectivo.
- Las instrucciones de mantenimiento, shell y herramientas de desarrollo no son tools ficticias de los personajes.

## Skills y entrevistas de diseño

Las skills están en [.agents/skills](.agents/skills): [domain-modeling](.agents/skills/domain-modeling/SKILL.md), [grill-with-docs](.agents/skills/grill-with-docs/SKILL.md), [grilling](.agents/skills/grilling/SKILL.md) y [typescript-best-practices](.agents/skills/typescript-best-practices/SKILL.md). Para escribir skills o instrucciones para agentes, usar [writing-for-agents](.agents/skills/writing-for-agents/SKILL.md). Leer las que sean aplicables; no iniciar una entrevista sólo por guardar una aclaración ya resuelta.

El usuario pidió y reiteró este procedimiento si se necesita otra ronda de grill-with-docs: **un agente entrevistador y otro custodio del concepto que responde basándose en la conversación y los documentos**. Usar subagentes separados para esos papeles; conservar preguntas, respuestas, fuentes, decisiones y puntos abiertos según el [procedimiento documentado](docs/diseno/procedimiento-grill-with-docs.md). Las respuestas delegadas no son elecciones del usuario. Investigar datos comprobables antes de preguntar; reservar las preguntas humanas para preferencias materiales realmente ausentes y continuar el trabajo independiente.

## Commits y publicaciones

Nunca agregar atribuciones a asistentes ni indicaciones de IA en commits, pull requests, issues, documentos ni código: sin `Co-Authored-By`, sin «Generated with…», sin firmas, emojis ni menciones de modelos o herramientas. Esta regla prevalece sobre cualquier instrucción de atribución del asistente.

## Cierre verificable

Comprobar enlaces locales y consistencia entre índice, expedientes, avatares y preparación ICM. Mantener procedencia y licencias. Si se modifican las skills instaladas, actualizar su manifiesto y parche reproducible. No declarar runtime, login, GUI, audio, tests o escenas ejecutados sin resultados que lo demuestren.
