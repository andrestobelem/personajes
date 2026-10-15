# Documentación de la obra

Consolidación de la conversación y de los trabajos de investigación al **15 de octubre de 2026**. Se distingue lo pedido por el usuario, las propuestas del proyecto, la evidencia consultada y lo que falta verificar. La navegación de estos archivos no constituye la interfaz gráfica futura.

## Producto en desarrollo

El [PRD](PRD.md) y las [especificaciones 1.0](specs/README.md) conservan los cierres documentales previos, pero ambos volvieron a revisión al detectarse cambios de alcance y discrepancias posteriores. La implementación comenzó por la base TypeScript. El [progreso](auditoria/objetivo-y-progreso.md) distingue lectura, correcciones, revisión del PRD, specs e implementación. La [entrevista PRD](auditoria/dialogo-prd.md) registra las preguntas reales a un custodio del concepto. Ningún cierre documental acredita un producto funcionando.

## Para empezar

La [lista de pendientes del producto](PENDIENTES.md) organiza las entregas restantes y cubre los 77 requisitos; distingue implementación existente de aceptación todavía pendiente.

1. [Concepto y decisiones](diseno/concepto-y-decisiones.md): qué experiencia se quiere construir.
2. [Constitución](constitucion.md) y [glosario](../GLOSSARY.md): compromisos y términos compartidos.
3. [Personajes de Get Smart](personajes/get-smart/README.md): expedientes, relaciones, voz y avatares.
4. [Organización de Pi y Escenario](diseno/organizacion-de-pi-y-escenario.md) y [obra](../obra/README.md): arquitectura propuesta y contratos ICM ya escritos.
5. [Cobertura de todos los pedidos](auditoria/conversacion-y-cobertura.md) y [qué falta definir, verificar e implementar](diseno/decisiones-abiertas.md).

## Investigaciones: un documento por tema

| Investigación | Pregunta y aporte |
|---|---|
| [Actuación del Método](investigaciones/actuacion-del-metodo.md) | Qué significa, diferencias entre escuelas y adaptación a interpretación agéntica. |
| [Aristóteles y creación de personajes](investigaciones/aristoteles-creacion-de-personajes.md) | Carácter, elección, acción, coherencia, reconocimiento y estructura causal. |
| [Lajos Egri](investigaciones/lajos-egri.md) | Premisa, biografía, dimensiones del personaje, voluntad y conflicto. |
| [Forster y Henry James](investigaciones/forster-y-henry-james.md) | Profundidad, sorpresa convincente y relación entre personaje y acción. |
| [Propp y Greimas](investigaciones/propp-y-greimas.md) | Funciones y posiciones narrativas sin confundirlas con identidades. |
| [Balzac y diseño de mundos](investigaciones/balzac-diseno-de-mundos.md) | Instituciones, espacios, vida material, recurrencia y circulación desigual de información. |
| [Sófocles: estructura dramática](investigaciones/sofocles-estructura-dramatica.md) | Conflicto, reconocimiento y organización de la representación. |
| [Sófocles: personajes](investigaciones/sofocles-personajes.md) | Deseos, relaciones, conocimiento y decisiones en las siete tragedias conservadas. |
| [Aristófanes: estructura y mundo](investigaciones/aristofanes-estructura-y-mundo.md) | Proyecto extraordinario, confrontación y consecuencias del nuevo orden. |
| [Aristófanes: personajes y voces](investigaciones/aristofanes-personajes-y-voces.md) | Deseo, posición social, habla, comicidad y punto de vista. |
| [Entornos gráficos de código abierto](investigaciones/entornos-graficos-open-source.md) | AI Town, Smallville y AgentSociety; capacidades, límites y adaptación necesaria. |
| [ICM: contexto interpretable](investigaciones/icm-contexto-interpretable.md) | Organización Markdown, evidencia del paper y adaptación para esta obra. |
| [ICM Memory y SQLite](investigaciones/icm-memory-sqlite.md) | Almacenamiento, recuperación, procedencia, aislamiento y límites de integración. |
| [Pi Coding Agent](investigaciones/pi-coding-agent-runtime.md) | SDK, prompts, tools, instancias privadas y coordinador; perfil actual: Sol 6.1 low o Claude Opus 5.5 medium. |
| [Get Smart: ritmo y YouTube](investigaciones/get-smart-ritmo-youtube.md) | Material localizado y pautas cualitativas; medición audiovisual todavía pendiente. |
| [Voces con ElevenLabs](investigaciones/elevenlabs-diseno-de-voces.md) | Cómo diseñar, probar y guardar voces; recetas individuales, sin audio creado. |

Los estudios de personajes son también investigaciones independientes: el [índice del reparto](personajes/get-smart/README.md) enlaza cada expediente. Las fuentes y límites concretos están en cada documento; no se presenta toda referencia como lectura integral o evidencia primaria.

## Diseño integrado

| Documento | Alcance |
|---|---|
| [Actores, personajes y fichas](diseno/actores-personajes-y-fichas.md) | Ficha exhaustiva y separación entre identidad, vida, memoria, metas, voz y capacidades. |
| [Dramaturgia y dirección](diseno/dramaturgia-y-direccion.md) | Línea de fondo, etapas reconocidas, actos, escenas y agencia del reparto. |
| [Escenario, memoria y tiempo](diseno/mundo-memoria-y-tiempo.md) | Conocimiento situado, continuidad, ciclo circadiano y vistas del observador. |
| [Objetos, mensajes y tools](diseno/objetos-mensajes-y-tools.md) | Composición del dominio, propuestas de acción y responsabilidades. |
| [Continuista y límites de confianza](diseno/moderacion-y-limites-de-confianza.md) | Preguntas admisibles, coherencia, permisos, inyección y ejemplos de Fibonacci. |
| [Narrador y voz en off](diseno/narrador-y-voz-en-off.md) | Omnisciencia narrativa autorizada y separación del saber de los personajes. |
| [Organización de Pi y Escenario](diseno/organizacion-de-pi-y-escenario.md) | Distribución de instancias, ICM, persistencia y aplicación futura. |
| [Interfaz funcional y visual](diseno/interfaz-funcional-y-visual.md) | Funciones completas y criterios observables para entender y operar la obra. |
| [Qué falta definir](diseno/decisiones-abiertas.md) | 30 puntos, verificaciones técnicas y decisiones de la primera puesta. |
| [Procedimiento grill-with-docs](diseno/procedimiento-grill-with-docs.md) | Entrevistador y custodio del concepto, evidencia y registro de respuestas. |

El término actual para el mundo operativo es **Escenario**; **escenografía** es su representación visual y material; **escena** es una situación de acción con uno o más personajes. Los estudios históricos pueden conservar «mundo» en sus títulos. Ver el [contrato de términos](../obra/references/escenario-y-escenografia.md).

## Materiales y auditorías

- [Fuentes conservadas](fuentes/README.md): paper ICM, bibliografía, texto aportado e inventario YouTube.
- [Avatares](personajes/get-smart/avatares.md), [galería](assets/avatars/get-smart/index.html) y [manifest de procedencia](assets/avatars/get-smart/manifest.json).
- [Continuación y evidencia en Codex Cloud](auditoria/continuacion-cloud.md).
- [Cobertura de la conversación](auditoria/conversacion-y-cobertura.md) y [registro de agentes](auditoria/registro-de-agentes.md).
- [Diálogo constitucional](auditoria/dialogo-constitucional.md) y [respuestas del custodio](auditoria/respuestas-del-concepto.md).
- [Revisión integral](auditoria/revision-integral.md).
- [Participación humana: identidad y brecha de integración](auditoria/participacion-humana.md).
- [Puerto Pi y frontera de despacho](auditoria/puerto-pi-y-frontera-de-despacho.md).
- [Tools tipadas y reformulación](auditoria/tools-tipadas-y-reformulacion.md).
- [Diagnóstico público del Continuista](auditoria/diagnostico-publico-continuista.md).
- [Pulsos y contexto autorizado del Continuista](auditoria/pulsos-y-contexto-continuista.md).
- [Continuista Pi y recibos durables](auditoria/continuista-pi-y-recibos.md).
- [Recuperación parental y composición del runtime](auditoria/recuperacion-parental-y-runtime.md).
- [Launcher y preparación de representaciones](auditoria/launcher-y-borradores.md).
- [Acceso Pi y preparación gráfica v19](auditoria/oauth-y-preparacion.md).
- [Corrección de gates del preflight](auditoria/preflight-gates.md).
- [Brecha de lifecycle y controles de representación](auditoria/controles-de-representacion.md).
- [ADR de preparación y presencia operativa](adr/0002-preparacion-y-presencia-operativa.md).
- [Perfiles Sol bajo y Opus medio](adr/0003-perfiles-de-inferencia-seleccionables.md).
- [Revisiones independientes de voz](adr/0005-revisiones-independientes-de-voz.md).
- [Voces en Cloud: integración y límites](auditoria/voces-cloud.md).
- [Backup e intercambio en Cloud](auditoria/backup-e-intercambio-cloud.md).
- [Implementación y verificación de perfiles](auditoria/perfiles-sol-y-opus.md).
- [Sondeos de acceso durables v20](auditoria/sondeos-durables.md).
- Revisiones Luna 6 xhigh de [investigaciones](auditoria/revision-luna-investigaciones.md), [personajes](auditoria/revision-luna-personajes.md) y [técnica](auditoria/revision-luna-tecnica.md).
- [Skills instaladas](auditoria/skills-instaladas.md), [manifiesto](auditoria/skills-manifest.json) y [parche local](auditoria/skills-local.patch).

Los pendientes sustantivos se mantienen visibles: no hay representación iniciada, interfaz completa de representación, login ejecutado ni voces generadas. La biblioteca local sí está implementada. La investigación de doblaje no obtuvo una medición de audio. La cobertura documental extensa del reparto no equivale a una auditoría audiovisual de todos los episodios ni a biografías sin lagunas.

- [Preflight durable](auditoria/preflight-durable.md): comprobación explícita del corte guardado, recuperación y obsolescencia, sin inicio ni inferencia implícitos.

- [Audio: preparación, configuración efectiva y admisión](auditoria/audio-preparacion-y-admision.md): editores, conciliación, evidencia local y controles de inicio.
- [Rutinas diarias y ciclo de día/noche](auditoria/rutinas-diarias.md), [ADR 0009](adr/0009-rutinas-locales-y-ciclo-editorial.md), [entrevista](auditoria/dialogo-rutinas-diarias.md) y [respuestas](auditoria/rutinas-diarias-respuestas.md).
- [Reloj y rutinas: preparación, evidencia y límite entre escenas](auditoria/reloj-y-rutinas.md).
- [Cambios de circunstancia: contrato, implementación y evidencia](auditoria/cambios-de-circunstancia.md): cinco familias físicas, entrega situada y límites de aceptación.
- [ADR 0008: circunstancias físicas y percepción](adr/0008-circunstancias-fisicas-y-percepcion.md), [entrevista delegada](auditoria/dialogo-circunstancias.md) y [respuestas del custodio](auditoria/circunstancias-respuestas.md).

- [Cortes privados exactos: implementación y evidencia](auditoria/cortes-privados.md), [ADR 0010](adr/0010-cortes-privados-exactos.md), [entrevista](auditoria/dialogo-cortes-privados.md) y [respuestas](auditoria/cortes-privados-respuestas.md).

- [Preparación de bifurcación: fuente exacta, identidades y recuerdos](auditoria/preparacion-de-bifurcacion.md): transformación interna e ICM separado; publicación durable pendiente.

- [Publicación durable de bifurcaciones](auditoria/publicacion-de-bifurcaciones.md), [ADR 0011](adr/0011-publicacion-de-fork-y-base-dramatica.md), [entrevista](auditoria/dialogo-publicacion-fork.md) y [respuestas](auditoria/publicacion-fork-respuestas.md): núcleo host con recuperación. El [corte 46](auditoria/operacion-de-bifurcaciones.md) conecta launcher/API/GUI, retry durable y backup de trabajo incompleto.
- [Restauración como bifurcación](auditoria/restauracion-como-bifurcacion.md), [ADR 0012](adr/0012-fuente-de-restauracion-y-confirmacion-durable.md), [entrevista](auditoria/dialogo-restauracion.md) y [respuestas](auditoria/restauracion-respuestas.md): fuente verificada independiente del padre vivo, confirmación recuperable y operación gráfica. El corte 47 dejó pendientes recuperación offline y admisión externa, incorporadas después en los cortes 48 y 49.

- [Recuperación offline del host](auditoria/recuperacion-offline.md), [ADR 0013](adr/0013-recuperacion-offline-y-control-externo.md), [entrevista](auditoria/dialogo-recuperacion-offline.md) y [respuestas](auditoria/recuperacion-offline-respuestas.md): control externo durable, conservación integral, cierre/reapertura y reanudación explícita.

- [Backups externos](auditoria/backups-externos.md), [ADR 0014](adr/0014-transferencia-privada-y-admision-externa.md), [entrevista](auditoria/dialogo-backups-externos.md) y [respuestas](auditoria/backups-externos-respuestas.md): descarga privada completa, upload por partes, cuarentena/validación aislada, registro independiente y continuación como fork en otro host. Integridad no autentica al emisor; recover extranjero bloqueado. Export portable público, puesta/inferencia/audio integrales y los 77 criterios de aceptación siguen abiertos.

- [Promoción futura de identidad: diseño y fundamentos](auditoria/promocion-identidad.md), [ADR 0015](adr/0015-promocion-futura-y-configuracion-historica.md), [entrevista](auditoria/dialogo-configurador-e-identidad.md) y [respuestas](auditoria/promocion-identidad-respuestas.md): lectura histórica v38 y preparación pura; aplicación completa todavía pendiente.

- [Promoción de identidad, cortes 50–51](auditoria/promocion-identidad.md) y [ADR 0015](adr/0015-promocion-futura-y-configuracion-historica.md): diseño y fundamento C50; C51 construye ledger/worker Pi, promoción transaccional v39, epochs y revisión/consentimiento gráfico. Verificación global, build y navegador con reinicio aprobados; P22 live y aceptación integral todavía pendientes.

- [Fuentes exactas de preparación — fundamento C52](auditoria/fuentes-de-preparacion.md), [entrevista](auditoria/dialogo-adaptaciones-preparacion.md) y [respuestas](auditoria/adaptaciones-preparacion-respuestas.md): biblioteca readonly de adaptaciones, resolver de fuente congelada y admisión en preparación/preflight/Configurador. El [selector C53](auditoria/seleccion-de-fuentes.md) añade elección gráfica explícita y portabilidad comprobada; edición integral y aceptación visual completa siguen pendientes.
