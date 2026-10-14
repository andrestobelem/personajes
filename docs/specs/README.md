# Especificaciones de implementación

Versión 1.0, **revisión documental cerrada para implementar**, después del [cierre documental del PRD](../auditoria/cierre-prd.md). Estas especificaciones describen el producto completo; no acreditan que exista código o una integración ejecutada. El [PRD1.0](../PRD.md) y sus77requisitos conservan autoridad funcional.

## Componentes

| Spec | Contenido y responsabilidad |
|---|---|
| [S01 — Dominio y catálogo](01-dominio-y-catalogo.md) | Objetos/mensajes, schemas, continuidad, contexto curado, espacio, objetivos, eventos y estados. |
| [S02 — Persistencia e ICM](02-persistencia-e-icm.md) | Journal SQLite autoritativo, memorias ICM, outbox, sesiones, snapshots, recuperación y proyecciones Markdown. |
| [S03 — Pi y coordinación](03-pi-y-coordinacion.md) | Instancias, OAuth/perfil, tools, actor/revisión/director/narrador, pulso, presupuesto y cancelación. |
| [S04 — API y autoridad](04-api-y-autoridad.md) | Servidor local, endpoints, DTOs, permisos, SSE, límites y errores. |
| [S05 — Interfaz](05-interfaz.md) | Biblioteca, puesta, escena visual, conversación, inspección, dramaturgia, historia, controles y accesibilidad. |
| [S06 — Voces y ritmo](06-voces-y-ritmo.md) | Recetas, preview/selección, audio/subtítulos, efectos, calibración y pruebas de proveedor. |
| [S07 — Verificación](07-verificacion.md) | Trazabilidad de todos los requisitos, pruebas reales, recorridos GUI, gates y evidencia de cierre. |

## Decisiones de implementación

Aplicación local de escritorio mediante navegador: **servidor Node24+, TypeScript, React/Vite y Escenografía SVG2D**. Se compone un dominio propio, sin herencia propia, con adaptadores separados para Pi1.2.0, ICM0.11.4 y ElevenLabs. Las versiones exactas de dependencias se fijan en lockfile al instalar y se verifican contra sus tipos/documentación. El host actual tiene Node24.18.0.

Se elige un renderer propio porque AI Town limita conversaciones a dos y mezcla responsabilidades que aquí necesitan privacidad, múltiples participantes e inspectores completos. Esa comparación no obliga a adoptar su motor. SVG se limita a representar proyecciones; no resuelve acontecimientos. No reduce el alcance a una animación: las funciones completas del PRD siguen obligatorias.

SQLite del host mantiene hechos/estado/cola en una transacción; cada memoria ICM usa su propio archivo privado. Markdown es contexto estable y proyección exportable, no segundo escritor de verdad del runtime. Las [decisiones de persistencia](../adr/0001-journal-y-proyecciones.md) registran el tradeoff.

```text
src/domain/       schemas y objetos/mensajes puros
src/application/  comandos, coordinación y casos de uso
src/adapters/     SQLite, ICM CLI, Pi SDK, ElevenLabs, documentos
src/server/       HTTP, sesión local, SSE y static assets
src/web/          componentes React, store y renderer SVG
tests/            dominio, disco/adaptadores, API, E2E y gates live
docs/ y obra/     corpus/contratos versionados; no credenciales
```

El almacenamiento vivo pertenece a un directorio privado del host, fuera del repositorio: journal, memorias por corrida/actor, sesiones Pi, medios y backups. OAuth/key no se incluyen en export/snapshots. `PERSONAJES_DATA_DIR` es configuración de host; actor y contenido importado no la eligen.

## Fuentes técnicas verificadas

- [Investigación Pi](../investigaciones/pi-coding-agent-runtime.md) y [verificación técnica](../auditoria/lectura-prd-investigaciones.md): SDK1.2.0 y runtime por proveedor. El perfil actual es Sol 6.1 low mediante Codex OAuth o Claude Opus 5.5 medium mediante Anthropic; no hay fallback.
- [ICM Memory](../investigaciones/icm-memory-sqlite.md): CLI0.11.4, backend SQLite explícito, scopes no ACL y hooks Pi todavía TBD.
- [Node24 SQLite](https://nodejs.org/download/release/v24.18.0/docs/api/sqlite.html): DatabaseSync, statements y backup; se comprobarán tipos/operación al integrar.
- [React store externo](https://react.dev/reference/react/useSyncExternalStore): suscripción/snapshot estable y cleanup; [eventos accesibles](https://react.dev/learn/responding-to-events): controles nativos con semántica de botón.
- [ElevenLabs](../investigaciones/elevenlabs-diseno-de-voces.md): modelo de diseño distinto de TTS y precondiciones de voz.

## Gate para implementar

Cada requisito debe apuntar a una spec y a su ensayo con evidencia adecuada. La revisión debe detectar contradicciones de schemas, autoridad, flujo, persistencia, privacidad, voz y UX; comprobar conteos/enlaces por sí solo no basta. Hasta cerrar esa revisión no se declara terminada la fase de specs ni se sustituye el runtime por una demo.
