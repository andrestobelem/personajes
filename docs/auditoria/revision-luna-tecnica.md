# Revisión técnica Luna 6 xhigh

Fecha: 14 de octubre de 2026. Alcance: las investigaciones sobre Pi Coding Agent, ICM Memory con SQLite, ICM como metodología de contexto interpretable y entornos gráficos open source; revisión de consistencia con los contratos de `obra/` y sus requisitos técnicos. La constitución, el glosario y los archivos de `.agents/skills/` se consultaron en modo de lectura. No se modificaron ni se instalaron runtimes.

## Rectificación y validación del mapeo

La versión anterior de este informe afirmaba por error que `AgentSession` no tenía `getAvailableThinkingLevels()`. El código oficial de Pi `v1.2.0` sí declara ese método y devuelve `getSupportedThinkingLevels(this.model)`; la llamada del ejemplo era válida. [Código de `AgentSession`, líneas 2511–2514](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/agent-session.ts#L2511-L2514).

La comprobación adicional `model.thinkingLevelMap?.xhigh === "xhigh"` también es válida para ambos catálogos elegidos: `openai/gpt-6-luna` declara `xhigh: "xhigh"` y `openai-codex/gpt-6-luna` declara el mismo mapeo. El tipo `Model` define `thinkingLevelMap` como el mapeo entre los niveles de Pi y los valores del proveedor. [Catálogo OpenAI de Pi](https://pi.dev/models/openai/gpt-6-luna), [catálogo OpenAI Codex de Pi](https://pi.dev/models/openai-codex/gpt-6-luna), [tipo `Model`, línea 798](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/types.ts#L798).

Por tanto, se conserva la verificación de mapeo y nivel efectivo en el ejemplo, pero no se presenta como arreglo de un método inexistente. Es una verificación de metadatos del catálogo y selección efectiva de Pi; no prueba la disponibilidad de la cuenta ni una sesión ejecutada. No se instaló ni ejecutó Pi.

## Revisión de los cuatro documentos

Los cuatro documentos distinguen capacidades verificadas, propuestas para esta obra y trabajo pendiente. Se mantiene clara la separación entre ICM Markdown e ICM Memory; la memoria por actor requiere un archivo SQLite propio con backend `ICM_DB_BACKEND=sqlite` fijado por el host, y los temas/filtros de ICM no se presentan como permisos. El texto tampoco atribuye seguridad, aislamiento de filesystem ni enforcement a Pi o a carpetas Markdown.

La comparación gráfica expresa la composición sin herencia como requisito del dominio propio, no como una propiedad de AI Town o AgentSociety. El director conserva una lectura revisable de las etapas dramáticas basada en eventos, separada de actos y escenas. El reloj circadiano se trata como estado del mundo, no como avance automático de la trama. El runtime y la simulación permanecen explícitamente sin instalar ni ejecutar.

Revisé los enlaces locales de estos cuatro documentos: no encontré destinos internos rotos. No hice un rastreo exhaustivo de todos los enlaces externos. No identifiqué otra afirmación incorrecta con evidencia suficiente para editar.

## Contraste con `obra/`

Los contratos observados asignan Luna 6 `xhigh` a todos los roles que ejecuten un modelo y rechazan sustituciones silenciosas. Separan al Director, al Continuista y al Regidor; exigen revisar propuestas antes de publicarlas y previenen que la devolución al personaje divulgue secretos. La participación humana admite persuasión, negociación y cambios de creencia cuando tienen una vía de acceso diegética. Las reglas de dirección no convierten diálogo en autoridad de control.

Al momento de la revisión, fecha, lugar, corte temporal y criterio de doblaje aparecen pendientes en `obra/_config/continuidad.md`; no los cambié porque el responsable de `obra/` estaba actualizando esa configuración. Se le comunicó la verificación del mapeo de Pi y la rectificación del método de sesión.

## Archivos modificados

- `docs/investigaciones/pi-coding-agent-runtime.md`: comprobación explícita del mapeo de catálogo `xhigh` y del nivel efectivo de sesión.
- `docs/auditoria/revision-luna-tecnica.md`: este informe.

Esta revisión no modificó `obra/`, `docs/constitucion.md`, `GLOSSARY.md`, `.agents/skills/` ni `docs/auditoria/skills-manifest.json`. No se añadieron ni ejecutaron pruebas.
