# Personajes agénticos

Una obra de ficción en la que actores agénticos encarnan personajes con identidad, biografía, memoria, voz y deseos propios. Actúan en un **Escenario** compartido; sus decisiones y consecuencias condicionan el argumento. Una interfaz gráfica completa, principalmente funcional y visual, permitirá observarlos, conversar con ellos, influir y seguir su evolución.

## Entradas al proyecto

- [Documentación e investigaciones](docs/README.md): índice general de lo investigado y definido.
- [Constitución](docs/constitucion.md) y [glosario](GLOSSARY.md): reglas comunes y lenguaje del dominio.
- [Reparto de Get Smart](docs/personajes/get-smart/README.md): 27 expedientes individuales, familia, continuidad, avatares y recetas de voz.
- [Obra en ICM](obra/README.md): contexto, contratos y registros Markdown para preparar una representación.
- [Organización de Pi y Escenario](docs/diseno/organizacion-de-pi-y-escenario.md): propuesta técnica y fronteras entre instancias, memoria y presentación.
- [Cobertura de la conversación](docs/auditoria/conversacion-y-cobertura.md) y [decisiones abiertas](docs/diseno/decisiones-abiertas.md): qué está guardado y qué sigue pendiente.

## Objetivo activo

El encargo actual es revisar todos los materiales uno por uno, corregirlos, escribir y revisar un [PRD exhaustivo](docs/PRD.md), escribir y revisar las [specs](docs/specs/README.md), e implementar y revisar el producto completo. Los cierres documentales previos del PRD y las specs 1.0 fueron reabiertos para reconciliar cambios posteriores y corregir inconsistencias; la implementación comenzó por la base TypeScript. El [registro de progreso](docs/auditoria/objetivo-y-progreso.md) conserva evidencia por fase.

## Estado al 15 de octubre de 2026

Hay 16 documentos de investigación, 27 expedientes de personajes de la serie original, 28 imágenes de referencia, recetas de voz, el paper ICM, cuatro skills locales y un workspace documental de la obra. La constitución y el diseño fueron revisados por agentes, con preguntas y respuestas conservadas.

La arquitectura requerida usa **una instancia Pi independiente por personaje**, perfil seleccionable **GPT-6.1 Sol bajo con login OAuth de OpenAI Codex** o **Claude Opus 5.5 medio con login OAuth de Anthropic**, por [decisión posterior](docs/adr/0003-perfiles-de-inferencia-seleccionables.md). Un coordinador puede marcar el pulso sin decidir por los personajes. ICM en Markdown e ICM Memory con SQLite son proyectos diferentes que se propone integrar.

Ya hay una biblioteca gráfica local para consultar personajes, investigaciones y fuentes, y una base TypeScript de preparación, Escenario, HTTP, Pi y memoria. Hay preparación gráfica de borradores, validación/promoción Ready y preflight de ejecución durables, y el launcher puede componer el runtime con ICM configurado. Hay controles gráficos conectados al lifecycle, presupuesto actualizado y paso durable de un único pulso; la API de inicio está implementada, pero todavía no se acreditó una puesta real. La interfaz completa de representación y las voces sintetizadas siguen pendientes. Ver [continuación Cloud](docs/auditoria/continuacion-cloud.md). La investigación de ritmo en YouTube localizó material, pero su calibración mediante escucha continúa pendiente. La primera puesta aún necesita fecha, lugar, continuidad, reparto activo y conflicto concretos. El [registro de implementación](docs/auditoria/implementacion-progreso.md) distingue los componentes probados de las integraciones pendientes.

La [recuperación offline del host](docs/auditoria/recuperacion-offline.md) conserva estado, memorias y sesiones Pi; preserva por separado las credenciales actuales del host, que no se incluyen en backups, y registra backups posteriores. El flujo incluye revisión gráfica, cierre/reapertura y control durable externo. Permite reanudar la misma operación tras interrupciones; cambios operativos posteriores bloquean el reemplazo. La [transferencia y admisión de backups externos](docs/auditoria/backups-externos.md) permite descargar el archivo privado completo, subirlo por partes en otro host, validarlo y continuarlo como una representación nueva sin sobrescribir existentes. Los registros extranjeros sólo admiten fork; recover conserva sus condiciones locales estrictas. El [ADR 0014](docs/adr/0014-transferencia-privada-y-admision-externa.md) documenta procedencia, aislamiento y límites. Export portable público, puesta real, inferencia/audio integrales y aceptación de los 77 requisitos siguen pendientes.

El [Configurador de promoción futura](docs/auditoria/promocion-identidad.md) incorpora propuesta Pi durable, versiones históricas, aplicación transaccional v39 y panel de revisión/consentimiento. Su verificación global, build y recorrido gráfico con reinicio están acreditados con SDK controlado e ICM real. La evaluación P22 live sigue pendiente; no se atribuye actuación con proveedor real.

Para abrir la biblioteca local, ejecutar `npm run build` y `npm start`, y visitar `http://127.0.0.1:4173/`. `npm run verify` comprueba tipos y pruebas; las pruebas del CLI ICM real requieren `PERSONAJES_ICM_TEST_BINARY` con la ruta del binario 0.11.4. Sin ese binario, esas pruebas se omiten explícitamente.

El launcher puede componer los workers de representación con `PERSONAJES_ICM_BINARY` apuntando a una ruta absoluta del CLI ICM instalado por el operador. `PERSONAJES_PRIVATE_DATA_ROOT` permite elegir el directorio privado persistente y `PERSONAJES_PORT` el puerto local. Sin la ruta ICM se mantiene la biblioteca y la entrega mecánica de percepciones, sin convocar actores. Configurar la ruta no instala el CLI, no inicia una puesta, no hace login y no certifica acceso al modelo. El runtime recupera sólo trabajo durable existente; un directorio nuevo permanece sin representaciones ni sesiones actorales.

## Trabajo sobre el repositorio

Las instrucciones de mantenimiento están en [AGENTS.md](AGENTS.md). Las skills instaladas y sus fuentes se documentan en [skills instaladas](docs/auditoria/skills-instaladas.md). Las imágenes y el artículo conservan sus propios créditos y condiciones; la licencia del código no se extiende automáticamente a esos materiales.

La [promoción futura de identidad](docs/auditoria/promocion-identidad.md) conserva los fundamentos históricos v38 y aplica revisiones futuras mediante el workflow v39. El consentimiento se revisa desde la interfaz y el turno siguiente usa una sesión Pi independiente, conservando memoria e historia.
