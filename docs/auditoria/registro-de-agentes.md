# Registro de trabajos de los agentes

Registro consolidado de los agentes de esta conversación y sus entregas revisadas al 14 de octubre de 2026. Los nombres corresponden a subtareas, no a instancias Pi de personajes ya ejecutándose. La raíz integró archivos e índices; los agentes conservaron responsabilidades delimitadas para evitar sobreescrituras.

Las tres revisiones históricas identificadas como Luna y los cinco agentes de la fase PRD/specs que se registran abajo se lanzaron expresamente con **gpt-6-luna con esfuerzo xhigh**. El requisito de que todos los agentes futuros de la obra usen ese perfil vive en su configuración; no cambia retrospectivamente el modelo de investigadores anteriores.

| Agente bajo `/root/` | Trabajo y entrega |
|---|---|
| `method_acting_research` | [Actuación del Método](../investigaciones/actuacion-del-metodo.md). |
| `agent_actor_design_review` | [Diseño de actores y fichas](../diseno/actores-personajes-y-fichas.md). |
| `classical_aristotle` | [Aristóteles](../investigaciones/aristoteles-creacion-de-personajes.md). |
| `classical_egri` | [Egri](../investigaciones/lajos-egri.md). |
| `classical_forster_james` | [Forster y James](../investigaciones/forster-y-henry-james.md). |
| `classical_narrative_roles` | [Propp y Greimas](../investigaciones/propp-y-greimas.md). |
| `balzac_world_design` | [Balzac y mundos](../investigaciones/balzac-diseno-de-mundos.md). |
| `sophocles_structure` | [Estructura de Sófocles](../investigaciones/sofocles-estructura-dramatica.md). |
| `sophocles_characters` | [Personajes de Sófocles](../investigaciones/sofocles-personajes.md). |
| `aristophanes_structure` | [Estructura y mundo de Aristófanes](../investigaciones/aristofanes-estructura-y-mundo.md). |
| `aristophanes_characters` | [Personajes y voces de Aristófanes](../investigaciones/aristofanes-personajes-y-voces.md). |
| `agent_world_platforms` | [Entornos gráficos abiertos](../investigaciones/entornos-graficos-open-source.md). |
| `get_smart_maxwell` | [Maxwell Smart](../personajes/get-smart/maxwell-smart.md). |
| `get_smart_99` | [Agente 99](../personajes/get-smart/agente-99.md). |
| `get_smart_chief_control` | [Jefe](../personajes/get-smart/jefe.md) y [Larrabee](../personajes/get-smart/larrabee.md). |
| `get_smart_hymie_agents` | [Hymie](../personajes/get-smart/hymie.md), [13](../personajes/get-smart/agente-13.md), [44](../personajes/get-smart/agente-44.md). |
| `get_smart_kaos` | Siegfried, Shtarker, Claw, Bobo y Ratton; cinco expedientes en el [reparto](../personajes/get-smart/README.md). |
| `get_smart_secondary_roster` | Quince secundarios, [familia](../personajes/get-smart/familia-smart.md) y [arcos multipartes](../personajes/get-smart/personajes-de-arcos-multipartes.md). |
| `get_smart_avatars` | [27 avatares y referencia familiar](../personajes/get-smart/avatares.md), manifest y galería. |
| `get_smart_ritmo_youtube` | [Ritmo y doblaje](../investigaciones/get-smart-ritmo-youtube.md), inventario de cuatro videos. Resultado parcial: no hubo escucha/medición de diálogo. |
| `icm_research` | [ICM Markdown](../investigaciones/icm-contexto-interpretable.md), paper, bibliografía y procedencia. |
| `icm_memory_research` | [ICM Memory SQLite](../investigaciones/icm-memory-sqlite.md). |
| `pi_runtime_research` | [Pi SDK](../investigaciones/pi-coding-agent-runtime.md), actualización OAuth Codex, instancias y coordinador. |
| `icm_obra` | [Workspace obra](../../obra/README.md): 27 contextos, ocho etapas, Escenario, coordinación, narrador, interacción e interfaz. |
| `skills_install_adapt` | [Cuatro skills instaladas/adaptadas](skills-instaladas.md), licencias, validación, manifiesto y parche. |
| `constitucion_domain` | [Constitución](../constitucion.md), [glosario](../../GLOSSARY.md), [diálogo](dialogo-constitucional.md) y adendas. |
| `custodio_concepto` | [Respuestas al entrevistador](respuestas-del-concepto.md) y [matriz de decisiones abiertas](../diseno/decisiones-abiertas.md). |
| `revision_integral` | [Auditoría independiente](revision-integral.md), corrección cruzada e integridad de archivos. |
| `luna_revision_investigaciones` | **Luna 6 xhigh**: [revisión literaria](revision-luna-investigaciones.md) y precisión de atribución del Método. |
| `luna_revision_personajes` | **Luna 6 xhigh**: [revisión del reparto](revision-luna-personajes.md), [guía ElevenLabs](../investigaciones/elevenlabs-diseno-de-voces.md), recetas individuales y narrador. |
| `luna_revision_tecnica` | **Luna 6 xhigh**: [revisión técnica](revision-luna-tecnica.md) y [organización de Pi y Escenario](../diseno/organizacion-de-pi-y-escenario.md). |

## Integración y revisión cruzada

### Fase del objetivo completo: PRD y especificaciones

| Agente | Perfil al lanzarse | Responsabilidad y evidencia |
|---|---|---|
| `prd_custodian` | gpt-6-luna / xhigh | Lectura del concepto, respuestas fundamentadas de entrevista, cinco pases de revisión PRD y S06 voces. |
| `prd_interviewer` | gpt-6-luna / xhigh | Entrevista real con custodio, siete pases PRD de producto, S05 interfaz y revisión de recorridos. |
| `prd_read_research` | gpt-6-luna / xhigh | Lectura individual de investigaciones/fuentes/paper, verificación SDK/ICM y [contrato de idempotencia](icm-idempotencia-y-contrato-cli.md). |
| `prd_read_characters` | gpt-6-luna / xhigh | Lectura de cada expediente/contexto de personaje y recursos; S07 verificación y matriz de los 77 requisitos. |
| `prd_read_obra` | gpt-6-luna / xhigh | Lectura de contratos operativos, seis pases PRD de autoridad y S04 API. |

Los [informes de lectura](lectura-prd-raiz.md) y [cierre del PRD](cierre-prd.md) registran versiones y alcance. Las [specs](../specs/README.md) siguen en elaboración/revisión; las asignaciones no acreditan que el producto ni los tests existan.

La raíz conservó el texto aportado, escribió la síntesis del concepto, documentos transversales, índices, relaciones del reparto, criterios de interfaz, procedimiento futuro de entrevistas y auditoría de cobertura. Coordinó las aclaraciones posteriores con autores y auditor.

El diálogo constitucional tuvo **cinco rondas y quince preguntas efectivamente intercambiadas** entre entrevistador y custodio. Las respuestas son trabajo delegado con evidencia, no respuestas humanas inventadas. Las aclaraciones posteriores quedaron como adendas.

La revisión integral comprobó, entre otros elementos, diferencias entre identidad y actor, límites de conocimiento, versiones aprobadas de respuestas, idempotencia, fuentes de estado y separación de efectos. También contrastó hashes de imágenes, paper, adjunto y skills. Los informes conservan su alcance y no sustituyen pruebas del runtime.

Se corrigió un falso positivo de la revisión técnica: `AgentSession.getAvailableThinkingLevels()` sí existe en la versión de Pi consultada. El expediente técnico y los informes conservan la rectificación; comprobar el nivel de razonamiento efectivo sigue siendo un criterio válido. No se perpetúa un hallazgo por haberlo producido un revisor.

## Corte 48 — recuperación offline

| Agente | Responsabilidad y evidencia |
|---|---|
| `restore_interviewer` y `restore_custodian` | Tres rondas reales de entrevista y respuestas; auditoría, ADR y reconciliación de las specs. |
| `recovery_ownership` | Gate previo a crear raíz, capability vigente y rescate explícito con prueba de ausencia del proceso. |
| `fork_icm_audit` | Comparación completa de SQLite/WAL, ICM y archivos; preservación administrativa, auth y backups posteriores. |
| `actor_cut_journal` | Control durable externo, intercambio por fases, reanudación idempotente y aborto seguro antes del rename. |
| `fork_http` | Composición reusable, barrera/SSE/sesiones y launcher de control tras dos SIGKILL reales, hasta verified. |
| `fork_backup` | Metadata explícita de receipts y migración con integridad, replay legacy y respuesta recovery/fork. |
| `actor_cut_migration_tests` | Inventario config ICM y cinco integraciones productivas de recuperación, aborto/replay/cierre incierto. |
| `restore_ui` y `actor_cut_inspector` | GUI, recarga independiente del catálogo, reanudación explícita y retiro de opt-ins sin perder borradores. |
| `actor_cut_integrity_review` | Revisión independiente, hallazgos corregidos y 31 focales finales aprobados. |

La raíz integró, verificó 946 pruebas aprobadas/una omitida por plataforma, build y QA gráfico, actualizó trazabilidad y mantuvo la aceptación integral pendiente. [Detalle](recuperacion-offline.md).

## Corte 49 — transferencia y admisión externa

| Agente | Responsabilidad y evidencia |
|---|---|
| `restore_interviewer` y `restore_custodian` | Tres rondas de entrevista, respuestas, ADR 0014 y reconciliación documental. |
| `actor_cut_journal` | Codec acotado con inventario completo y pruebas; regresiones SQLite de recibos, concurrencia, muerte de proceso y atomicidad ante errores. |
| `fork_icm_audit` | Worker aislado, esquema del host, catálogo ICM fijado y fuentes congeladas; ocho ensayos con ICM real. |
| `recovery_ownership` | Servicio durable de transferencia, cuotas acumulativas, publicación interrumpida, ownership y reintentos explícitos. |
| `fork_http` | Streaming autenticado, partes con CAS, cierre del descriptor y barrera hasta terminar la descarga. |
| `fork_backup` | Origen externo en restore, namespace durable de operaciones y correcciones de concurrencia/atomicidad de recibos. |
| `restore_ui` y `actor_cut_inspector` | Transferencia gráfica y recuperación de intenciones; revisión de registros sucesivos, respuestas tardías y fuentes de descarga. |
| `actor_cut_migration_tests` | Round-trip productivo entre dos hosts, archive mayor de 32 MiB, ICM/JSONL reales, colisión de ID y replay tras daño del origen. |
| `actor_cut_integrity_review` | Revisión independiente de backend, hallazgo reproducible postefecto y comprobación de su corrección con 26 pruebas focales. |

La raíz integró el launcher, el restore externo y los paneles, verificó el recorrido gráfico y mantuvo pendientes la aceptación integral y la puesta con proveedor. Los resultados globales y sus límites se registran en la [auditoría del corte](backups-externos.md).

## Corte 50 — fundamentos de identidad futura

| Agente | Responsabilidad y evidencia |
|---|---|
| `restore_interviewer` y `restore_custodian` | Tres rondas reales, rectificación del alcance de identidad, respuestas, auditoría y ADR 0015. |
| `actor_cut_inspector` | Auditoría de brecha, compiler host de evidencia propia, contratos exactos, contradicciones y fixture SQLite. |
| `actor_cut_journal` | Historial completo de configuración por commit en v38; resolución de cortes/forks, baseline y guardas append-only. |
| `actor_cut_migration_tests` | Mantenimiento de migraciones y schema externo 38, triggers confiables y comparación de estado en recuperación. |
| `actor_cut_integrity_review` | Revisión independiente; detectó duplicados en fence y errores de procedencia/expediente, contrastados y corregidos. |

La raíz preparó la transformación pura de identidad y sus pruebas, integró contratos y documentación y ejecutó la verificación global. No se ejecutó promoción, nueva sesión/epoch ni inferencia del Configurador. [Evidencia y límites](promocion-identidad.md).
