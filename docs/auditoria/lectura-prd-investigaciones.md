# Auditoría de lectura de investigaciones para PRD y especificaciones

Fecha de corte: **14 de octubre de 2026**. Propósito: entregar a la revisión del PRD y las especificaciones una lectura completa, individual y verificable de las 16 investigaciones, los materiales de fuente indicados y el estado técnico actual de Pi e ICM Memory. Esta auditoría es un insumo de producto; no atribuye las investigaciones al canon de los personajes.

Leí íntegros los 16 archivos de `docs/investigaciones/`. También leí íntegros `docs/fuentes/README.md`, la ficha, BibTeX y licencia MIT de ICM, el texto de Aristófanes aportado y el CSV de YouTube. Extraje el texto de las 21 páginas del PDF ICM y revisé visualmente sus figuras y diagramas en las páginas 5, 7, 8, 9 y 12. El PDF local conserva el SHA-256 declarado en su ficha. Consulté fuentes primarias actuales de Pi, OpenAI e ICM. No instalé software, inicié OAuth, ejecuté inferencias, generé voz ni modifiqué archivos de personajes.

En cada hallazgo se distingue la evidencia de fuente, la interpretación y su efecto sobre el producto. Una fuente teatral o una propuesta metodológica explica una decisión de diseño; no demuestra por sí sola una capacidad técnica. Las capacidades de runtime citadas son de documentación/código, no ejecuciones en la cuenta o máquina del proyecto.

## Lectura completa de las investigaciones

Cada elemento incluye SHA-256 del archivo leído, alcance de la evidencia que la propia investigación declara y la consecuencia concreta para PRD/especificaciones.

### Actuación del Método

Archivo: [actuacion-del-metodo.md](../investigaciones/actuacion-del-metodo.md)  
SHA-256: `101c637724258dd28827df9a3f1c3fc43bf10bc12aa96f999a9c8e2241e620c7`

Lectura íntegra. Su evidencia principal son páginas pedagógicas del Lee Strasberg Theatre & Film Institute; las referencias a Adler y Meisner son contextuales y no se leyeron libros completos. La investigación separa las escuelas y marca la adaptación a agentes como diseño propio. Para el producto, «Método» significa preparar al actor mediante circunstancias, biografía pertinente, escucha, motivación y respuesta. No significa afirmar emoción o experiencia humana del modelo. Las fichas son material de preparación, no parlamentos que deban recitarse.

### Aristóteles y creación de personajes

Archivo: [aristoteles-creacion-de-personajes.md](../investigaciones/aristoteles-creacion-de-personajes.md)  
SHA-256: `81f6bed198f46d0fe25d4ac6ce23d9a361e22baf20071e632d9a6f0be18d09b7`

Lectura íntegra; se consultaron directamente capítulos de la traducción de Butcher de la *Poética*, no un aparato filológico. Elección, causalidad, reconocimiento y consistencia sirven como criterios de lectura, no como obligación de producir tragedias o tres actos. La especificación debe enlazar decisiones con información disponible, alternativas y efectos; no medir profundidad por largo de ficha ni llamar «defecto fatal» a toda dificultad del personaje.

### Lajos Egri

Archivo: [lajos-egri.md](../investigaciones/lajos-egri.md)  
SHA-256: `ec5f12cc71aa1520b91bceb07c27b0956c7791eb177f0e8b682e1ca5be138058`

Lectura íntegra. La premisa se consultó en un extracto editorial; otras dimensiones y crecimiento proceden de nueve páginas parciales y de una exposición secundaria de diseño de juegos. No se leyeron completos los libros citados. La consecuencia para el PRD es permitir que dirección registre una pregunta o propósito de obra, pero separarlo de los objetivos de los personajes. Fisiología, sociología y psicología son dimensiones para investigar; no reglas deterministas que permitan inferir personalidad por clase, cuerpo u origen.

### Forster y Henry James

Archivo: [forster-y-henry-james.md](../investigaciones/forster-y-henry-james.md)  
SHA-256: `8cd0522cd0aa259251c6d09db0ac62827896f2c774cda07f289ba5abdb2dee3a`

Lectura íntegra; lectura directa de pasajes relevantes de *Aspects of the Novel* y «The Art of Fiction», no de los libros completos. La sorpresa convincente, el vínculo entre personaje y acontecimiento, y la selección de información son criterios cualitativos. No permiten inferir que una biografía extensa mejore automáticamente una actuación. El PRD debe evaluar elecciones y consecuencias reconocibles, sin convertir “redondo” en un estado interno medible.

### Propp y Greimas

Archivo: [propp-y-greimas.md](../investigaciones/propp-y-greimas.md)  
SHA-256: `2cb0ed81400fa7786e26684237c85226c086d2d6b2eb0209502ff2842ded8a8e`

Lectura íntegra. Propp se consultó mediante un extracto de capítulos y fuentes académicas; Greimas, mediante exposiciones académicas, no su obra completa. Funciones y posiciones actanciales son mapas opcionales de una búsqueda en cierto momento y desde cierta perspectiva. No describen identidad, personalidad ni una plantilla universal. El PRD debe impedir que «oponente», «ayudante» o «héroe» se vuelvan clases permanentes o permisos de conducta.

### Balzac y diseño de mundos

Archivo: [balzac-diseno-de-mundos.md](../investigaciones/balzac-diseno-de-mundos.md)  
SHA-256: `e34880ad0eb0357d101667e930b5e7f078372f606f838f19cc966a770ea26488`

Lectura íntegra. Se leyó el *Avant-propos* y el inicio de *Illusions perdues*; otras novelas se conocen por notas críticas institucionales, no por lectura completa. La aplicación útil es un escenario con instituciones, lugares, recursos, relaciones y consecuencias que conectan escenas. No atribuir a Balzac un simulador ni una teoría de permisos. El diseño debe guardar por separado estado real, identidad presentada y reconocimiento de otros.

### Sófocles: estructura dramática

Archivo: [sofocles-estructura-dramatica.md](../investigaciones/sofocles-estructura-dramatica.md)  
SHA-256: `5b54b134fbca57a61ae908a37e4c06edad8fa5e63ac466543c2b76565af360d7`

Lectura íntegra. Es una comparación de pasajes traducidos de *Edipo rey*, *Antígona* y *Filoctetes*, con contrastes de ediciones; no una lectura filológica integral. Aporta una razón para registrar quién dijo qué, quién lo recibió, con qué credibilidad y qué cambió después. Las etapas dramáticas pueden ser hipótesis revisables con evidencia; no se completan por tiempo o número de turnos y no obligan a una división en tres actos.

### Sófocles: personajes

Archivo: [sofocles-personajes.md](../investigaciones/sofocles-personajes.md)  
SHA-256: `53d653dba4982633a36c71bf795aee0928546771cc4042140451b571d7f93ec5`

Lectura íntegra. La matriz cubre escenas focales de siete tragedias en traducción; los límites textuales e interpretativos permanecen indicados. Para el producto, conservar obligación, relación, testimonio, percepción y efecto material separados. El silencio de Yole y otras lagunas no autorizan a inventar como canon una interioridad biográfica exhaustiva.

### Aristófanes: estructura y mundo

Archivo: [aristofanes-estructura-y-mundo.md](../investigaciones/aristofanes-estructura-y-mundo.md)  
SHA-256: `8e35b0719ec218bc066349015dab6a905a7943bfa79f073d9cba88411cfac1cc`

Lectura íntegra. Usa escenas y finales seleccionados de cuatro comedias y pasajes de contraste de *Las nubes* y *Las ranas*, más introducciones/extractos críticos; no coteja exhaustivamente el griego. El resultado es un repertorio variable de confrontación, coro, fiesta y cambio material, no una estructura requerida. Una victoria cómica puede repartir costos y consolidar poder. Las metas particulares pueden generar una iniciativa o alterar sus consecuencias; no se debe forzar agón, reconciliación ni final feliz.

### Aristófanes: personajes y voces

Archivo: [aristofanes-personajes-y-voces.md](../investigaciones/aristofanes-personajes-y-voces.md)  
SHA-256: `74de57094dadfc96e46fdabb0a0a5c382275e25febeb248300f24c2c27f87e4e`

Lectura íntegra, incluida la bibliografía y los límites agregados en la investigación. Se leyeron escenas de cinco obras en MIT; varios HTML examinados terminan antes del final. El informe luego cotejó finales en Baráibar y verificó que los `.pl.txt` de MIT sí los conservan. Los estudios críticos de Silk, Bowie y Konstan se consultaron en resúmenes o fragmentos. La comicidad causal, el estatus, la escucha y el poder sobre el procedimiento son material de diseño, no hechos neutrales sobre Atenas ni opinión unívoca del autor. Cada voz requiere situación, destinatario e intención; un coro no es narrador omnisciente por defecto.

### Entornos gráficos open source

Archivo: [entornos-graficos-open-source.md](../investigaciones/entornos-graficos-open-source.md)  
SHA-256: `414a17c461f5c2676bd32876f116b6dca8aa1b539865502e250bf14a94a89de4`

Lectura íntegra de repositorios, documentación y publicación de Generative Agents, con commits fijados en la fecha de consulta. No se instaló ni ejecutó ninguna plataforma. AI Town ofrece una escena 2D extensible y panel de conversación, pero la decisión observada recibe un mapa amplio, las conversaciones son de dos y falta un inspector narrativo completo. Smallville aporta percepción/rutinas e inspector, pero su vista pasada no garantiza estado mental histórico exacto y su stack es antiguo. AgentSociety 2 aporta trazas/replay e intervención, con UI cartográfica y una excepción de licencia comercial. Ninguna satisface todo el producto sin adaptación. El estudio no selecciona proveedor gráfico: la decisión de construir React + SVG 2D propio puede continuar sin depender de AI Town.

### ICM: contexto interpretable en Markdown

Archivo: [icm-contexto-interpretable.md](../investigaciones/icm-contexto-interpretable.md)  
SHA-256: `29866e7befe9ba0181754b381724680fc021073580e54033c880c03eb6d4beec`

Lectura íntegra del informe y consulta de §§1–7 del artículo, tablas/figuras relevantes y repositorio original fijado. La metodología ICM organiza contexto y entregables mediante carpetas y contratos legibles para flujos secuenciales revisados por personas. Es compatible con la obra como convención documental, pero no crea sesiones de Pi, memoria SQLite, aislamiento, concurrencia, transacciones, GUI o permisos.

El paper describe implementaciones reales con Claude Opus 4.6 y Sonnet 4.6; su observación de intervención es autoinformada en comunidad invitada (30 de 33 con patrón en U; figura con porcentajes aproximados 92/30/78), no una medición instrumentada. No hay comparación controlada con un prompt monolítico ni evaluación entre familias de modelos. La especificación no debe atribuirle mejoras empíricas de calidad, autonomía o costo. Las cinco capas son una organización útil; la evidencia no valida que por sí solas mejoren la interpretación de personajes.

### ICM Memory y SQLite

Archivo: [icm-memory-sqlite.md](../investigaciones/icm-memory-sqlite.md)  
SHA-256: `a71badc1a0635b36bb713571669617f37a2236432009d5dedc02880f625126cf`

Lectura íntegra del informe, documentación y código fijados al `5f402434919e514109a95c6cf504427fbcef851f`. Verifiqué además que ese SHA sigue siendo `HEAD` upstream y que `crates/icm-cli/Cargo.toml` declara `0.11.4`. Es un candidato a recuerdo/retrieval, no una fuente de verdad del escenario ni una frontera de permisos. `weight` no significa probabilidad de verdad, los hechos reemplazados no constituyen por sí solos una cronología íntegra, el reloj de mantenimiento usa UTC real y la búsqueda puede fusionar material parecido. Los filtros por topic/proyecto no son ACL.

La arquitectura debe mantener un registro de eventos autoritativo del mundo y derivar las percepciones/memorias privadas de cada personaje con procedencia, reloj ficticio y reintentos idempotentes. Una base SQLite por actor, seleccionada por el host y protegida por herramientas restringidas, da separación efectiva de corpus; una carpeta o filtro no. WAL admite lectores y un escritor por archivo; DB de actores distintas permiten separar escrituras, pero no crean una transacción conjunta entre todos los actores y el mundo. La extensión TypeScript específica para Pi sigue marcada como “TBD”; el adaptador de la obra sería propio.

### Pi Coding Agent

Archivo: [pi-coding-agent-runtime.md](../investigaciones/pi-coding-agent-runtime.md)  
SHA-256: `601592ebb48cf12221a2f3d3af7de2eab670e64821239932989ed778a2a0bee2`

Lectura íntegra del documento y verificación actual de paquete, tag, código fuente, SDK y catálogos públicos. La conclusión central sigue en pie: una sesión SDK separada por actor, con contexto, herramientas y memoria privados es viable; el coordinador ordena los turnos y el mundo confirma efectos. SDK compartido no equivale a compartir conversación.

Hay que configurarlo de forma explícita: Pi descubre contexto y herramientas por defecto; el actor necesita un `ResourceLoader` controlado por el host, herramientas allowlist y límites de proceso/red/archivos fuera de la personalidad. Instancias o sesiones independientes aíslan historial del modelo, pero Pi no es un sandbox del sistema operativo. La autenticación compartida del host no crea una memoria ni identidad compartida entre personajes.

### Get Smart: ritmo y YouTube

Archivo: [get-smart-ritmo-youtube.md](../investigaciones/get-smart-ritmo-youtube.md)  
SHA-256: `0cce0b6982b3a56b363b92675c8dbfabee532a3436ccf055426b7ce2dbcd4c4a`

Lectura íntegra. Se localizaron cuatro cargas; no hubo transcripciones disponibles ni audio interpretable, y sólo se inspeccionaron fotogramas. No existen turnos medidos, duración de réplicas, solapamientos, silencios ni autenticación auditiva del doblaje. La tabla de interacciones es una política cualitativa de diseño. No fijar un límite universal de palabras/segundos ni afirmar ritmo medido; la escucha y anotación de al menos 20 intervenciones en varias escenas y un episodio íntegro verificable siguen siendo investigación abierta. El español es requisito; la variedad regional aún requiere elección.

### Diseño de voces con ElevenLabs

Archivo: [elevenlabs-diseno-de-voces.md](../investigaciones/elevenlabs-diseno-de-voces.md)  
SHA-256: `47cb1f8f779e10e404e898ac8d99881e92621418d68fde77c5cd52ca8eb0b18d`

Lectura íntegra; consulta de documentación/API oficial al corte del informe. Hay recetas y líneas de prueba redactadas, pero ningún preview, audio, `voice_id` o doblaje generado. Las recetas describen voces originales y no imitan a los actores de la serie; la región propuesta todavía no está confirmada. El PRD debe representar por separado receta, voz guardada y audio generado, y atribuir acciones/estado narrativo al modelo de personaje, dejando la síntesis a ElevenLabs. El estado actual es preparación documental, no capacidad de voz funcionando.

## Materiales de fuentes conservados

| Archivo | SHA-256 | Lectura y hallazgo para producto |
|---|---|---|
| [docs/fuentes/README.md](../fuentes/README.md) | `ce528897805f6f85cb1945b27997832cb3bb3a8c1c8db8c8a1f73622c807d2ad` | Lectura íntegra. Declara alcance y procedencia de paper, texto aportado, CSV y avatares. Distingue correctamente fuentes descargadas de materiales que no se conservaron como copias de sitios. |
| [docs/fuentes/icm/README.md](../fuentes/icm/README.md) | `8b5691f1cfc888620984736a7bf03d0185a67619a3781bf2eab7735d492b9357` | Lectura íntegra. Identifica autores, versión 2, 21 páginas locales, 600.063 bytes y SHA. El comentario arXiv menciona 28 páginas; el archivo efectivamente conservado tiene 21. Separa licencia del artículo y código. |
| [docs/fuentes/icm/icm.bib](../fuentes/icm/icm.bib) | `d99ecb417089d53e5c3aa2375c283931eb1700e17b7666a41cb5122d1b9f21f3` | Lectura íntegra. Cita arXiv `2603.16021v2`, fecha y CC BY 4.0. La variante del título se aclara en la ficha. |
| [docs/fuentes/icm/icm-repository-MIT-LICENSE.txt](../fuentes/icm/icm-repository-MIT-LICENSE.txt) | `e55a39df67e3c95f6c394079262a21b194900911cda31acb40735f556c2bb63c` | Lectura íntegra. MIT cubre el repositorio de implementación y conserva aviso/copyright; no sustituye la licencia CC BY 4.0 del paper. No extender estas licencias a fuentes audiovisuales, avatares o contenido de personajes. |
| [docs/fuentes/icm/van-clief-mcdermott-2026-icm-arxiv-2603.16021v2.pdf](../fuentes/icm/van-clief-mcdermott-2026-icm-arxiv-2603.16021v2.pdf) | `7f57262dd6b74782f906f98fb66c09be7c0fa73931d164047dca8ae6d51bf95f` | Extracción completa de las 21 páginas con `pdftotext`; render e inspección de figuras de capas, carpetas, tokens, flujo y reporte de usuarios. Las cifras de uso son aproximadas y autoinformadas; el propio artículo declara límites de muestra, ausencia de comparación controlada y prueba de una familia de modelos. No presenta trazabilidad semántica como función terminada. |
| [docs/fuentes/aristofanes-personajes-texto-aportado.txt](../fuentes/aristofanes-personajes-texto-aportado.txt) | `4d7648013ef0e4b0f927839fb6a345bd407a99820eba456a9f91e2098423ea48` | Lectura íntegra (72 líneas, 17.810 bytes). Es una síntesis aportada por el usuario, no un texto primario de Aristófanes. No coincide byte por byte con `aristofanes-personajes-y-voces.md`: la investigación añade título, referencias de alcance y corrige el límite aparente de los HTML de MIT citando `.pl.txt`. La afirmación del README sobre cotejo contra el adjunto original no pudo verificarse aquí porque ese adjunto externo no está entre estos archivos. Mantener este texto como evidencia documental aportada, no como contexto automático de ningún personaje. |
| [docs/fuentes/youtube-get-smart/inventario.csv](../fuentes/youtube-get-smart/inventario.csv) | `93c94fe8eea374b4d411fc6a71f169393c5ade8f296e88ff2e77573661974d26` | Lectura íntegra; cuatro filas. Conserva URL, título, canal, fecha de carga, contador del reproductor y estado negativo de transcripción, medición de turnos e idioma autenticado. No contiene audio, guion ni evidencia cuantitativa de ritmo. |

## Verificación técnica actual: Pi, Luna e ICM Memory

### Pi y la configuración requerida

Comprobé con `npm view` que las versiones publicadas `latest` de [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) y [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) son `1.2.0`; ambos declaran Node `>=22.19.0`. `git ls-remote` resolvió el tag [Pi `v1.2.0`](https://github.com/earendil-works/pi/tree/v1.2.0) al commit `06a466935536f8c9bcacb2d5efc0fc021be1bdff`, el mismo que fija la investigación. Esto confirma que el ejemplo debe versionarse y compilarse contra ese SDK o una versión posterior compatible; no es un API inferido de fragmentos viejos.

El SDK documenta [`createAgentSession`, `ModelRuntime`, `SessionManager`, `ResourceLoader`, tools, eventos y estado observable de sesión](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/sdk.md). Una `AgentSession` posee su conversación, historial, modelo, tools y runtime de extensiones. El host puede crear una por personaje y usar un `SessionManager` persistente por actor; puede compartir el `ModelRuntime`/credencial del host sin compartir la conversación. El SDK no ofrece aislamiento del sistema operativo: el proceso conserva sus permisos.

El catálogo vigente de [Pi para `openai-codex/gpt-6-luna`](https://pi.dev/models/openai-codex/gpt-6-luna) declara API `openai-codex-responses`, proveedor `openai-codex`, razonamiento `xhigh` mapeado a `xhigh`, entrada texto/imagen y ventana de 272.000 tokens. El código de [`openai-codex.ts` en `v1.2.0`](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/src/providers/openai-codex.ts) etiqueta el proveedor **legacy**, usa `https://chatgpt.com/backend-api` y registra OAuth de suscripción ChatGPT Plus/Pro. La ruta no equivale al proveedor `openai` con API key.

La ficha oficial de OpenAI para [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) confirma esfuerzos `none`, `low`, `medium`, `high`, `xhigh` y `max`; indica que function calling con esfuerzo requiere Responses, mientras Chat Completions lo limita a `none`. Esa ficha API también anuncia 1,05 millones de contexto, pero no debe trasladarse al transporte Codex OAuth: para éste la especificación debe respetar el catálogo Pi de 272.000 y consultar en ejecución la configuración efectiva. El límite real de contexto no aumenta por elegir el modelo con el mismo nombre.

El login oficial de Pi se inicia con `/login openai-codex` o `ModelRuntime.login`; ofrece OAuth PKCE en navegador con callback localhost `1455` y flujo device code para equipos sin navegador. La credencial queda en el almacén `auth.json` del host. `checkAuth` sólo comprueba estado/tipo de credencial; no demuestra que la cuenta tenga acceso, cuota o una inferencia funcional con Luna. No inicié el login ni una llamada. La cuenta, acceso, límites, latencia y disponibilidad concreta de esta sesión siguen sin verificar. El runtime debe detenerse con diagnóstico si el provider/modelo/esfuerzo efectivo no coincide; no hacer fallback a API key, proveedor distinto, otro modelo o menos esfuerzo.

Al crear una sesión de personaje, seleccionar explícitamente el modelo `openai-codex/gpt-6-luna`, esfuerzo `xhigh`, herramientas allowlist y un `ResourceLoader` que sólo devuelva los recursos permitidos a ese actor. Comprobar en la sesión modelo, proveedor, esfuerzo y tools efectivos, también después de reanudar o recargar. Los directorios del repo no son un mecanismo de secreto: evitar herramientas de shell/lectura irrestrictas y proteger auth fuera del contexto de personajes.

### ICM Memory y SQLite

La revisión de código upstream más reciente sigue en [`rtk-ai/icm` commit `5f402434919e514109a95c6cf504427fbcef851f`](https://github.com/rtk-ai/icm/tree/5f402434919e514109a95c6cf504427fbcef851f), cuya cabecera CLI declara versión `0.11.4`. El [`README`](https://github.com/rtk-ai/icm) describe la memoria global por defecto y `icm init --per-project` para un archivo local al repositorio. La referencia de integración de ese commit marca para Pi una **extensión TypeScript “TBD”**; el modo MCP o las instrucciones Markdown no equivalen a integración automática de memoria con el SDK Pi.

El CLI expone `--db` para SQLite, `--no-embeddings` y `--read-only` para consultas como `recall`; el código advierte que `--db` se ignora si `ICM_DB_BACKEND` selecciona un backend remoto. El adaptador debe fijar `ICM_DB_BACKEND=sqlite`, ruta privada y argumentos como lista (sin interpolar la consulta en shell). Inicializar fuera del turno, serializar escrituras por base y dejar que el host elija el actor/DB. No dar al modelo ruta, actorId, SQL ni tools administrativas. Los filtros `topic`/`project` son organización de resultados, no ACL.

La base ICM conserva recuerdos/relaciones/conversaciones y sirve para recuperación. El evento del escenario (acción, resultado, percepción entregada) necesita una fuente autoritativa propia; los recuerdos por actor son proyecciones derivadas, atribuidas y reintentables. SQLite WAL admite lectores concurrentes, un escritor por archivo. DBs separadas por actor no hacen atómica una operación de mundo con escrituras a todas las memorias. El diseño requiere outbox/IDs estables, reintentos y estado visible cuando falle una proyección. Esto es requisito de arquitectura para implementación futura, no función presente de ICM.

## Efecto sobre el PRD y separación de pendientes

### Compromisos que el PRD debe preservar

- Una instancia/sesión Pi real por personaje, con contexto, historial, herramientas y memoria privados. El coordinador decide pulso/orden; no elige la respuesta del personaje.
- `openai-codex` con OAuth Pi, `gpt-6-luna` y `xhigh` efectivos para cada rol LLM requerido. El proveedor marcado legacy no autoriza una sustitución silenciosa; tratar los cambios del catálogo y del proveedor como compatibilidad que se verifica.
- Estado del escenario y registro de eventos como verdad autoritativa; percepción, creencia, testimonio y recuerdo como vistas por personaje. ICM Memory puede ser un proyector/retriever tras validar su integración; Markdown ICM es organización documental distinta.
- GUI completa, funcional y visual para preparar/observar/controlar la obra, conversar e influir, y entender cambios y fallos. La documentación Markdown y el inspector de una plataforma candidata no cumplen por sí solos ese requisito. La elección de React + SVG 2D propia permite implementarlo; AI Town sigue siendo comparación, no dependencia obligatoria.
- Identidad y biografía como causas potenciales de elecciones, no como texto que cada agente debe exponer; libertad para actuar, callar, rechazar, fracasar y cambiar con evidencia. El director registra etapas con acontecimientos que las sostienen.
- Recetas de voz, voces guardadas y audios generados como estados distintos. No fijar métricas de ritmo de TV hasta escuchar y anotar audio verificable.

### Investigación pendiente

| Pregunta o decisión aún abierta | Alcance exacto |
|---|---|
| Ritmo audiovisual | Identificar pista doblada en español con audio accesible; escuchar/anotar intervenciones y un episodio completo verificable. Sin esto, no hay cifras ni presupuesto de palabras validado. |
| Variedad de doblaje | Elegir español latino y variedad/registros concretos, o definir otra adaptación. La elección regional es creativa y aún no se confirmó. |
| Primera representación | Fecha, lugar, continuidad, reparto activo, conflicto y objetivos compartidos/propósito de obra. La investigación no los selecciona. |
| ElevenLabs | Evaluar voz y español mediante preview/audio, guardar `voice_id` sólo tras selección y producir audio. Actualmente sólo hay recetas. |
| Fuentes/personajes | Completar vacíos o conflictos de canon de los expedientes sin transformar el corpus de investigación en conocimiento de personajes. Cada adición debe declarar procedencia o ser adaptación. |
| Candidato gráfico | La comparación ya deja claras las brechas. Con decisión de UI propia, no hace falta reabrir adopción de AI Town para iniciar React/SVG; sólo verificar necesidades de producto al implementar. |

### Restricciones que exigen implementación o ejecución

| Capacidad que no está demostrada por los documentos | Verificación futura necesaria |
|---|---|
| Cuenta y OAuth Codex | Login humano en Pi, inspección segura del estado, llamada autorizada a modelo para verificar acceso/latencia; ninguna verificación se hizo aquí. |
| Configuración `xhigh` en sesiones reales | Crear sesión, comprobar proveedor, API, modelo, mapeo y esfuerzo efectivos después de inicio/reanudación; fallo visible sin fallback. |
| Aislamiento de personajes | Prueba que una sesión no ve expediente, recuerdos, secretos, tools ni archivos de otro actor; una DB distinta o prompt con “olvida” no basta. |
| ICM Memory con Pi | Implementar adaptador propio sobre CLI/API fija y probar recall en español, procedencia, inyección, deduplicación, reloj ficticio, escritura/backup/WAL y recuperación. No existe extensión Pi de ICM lista en la revisión upstream. |
| Fuente de verdad/transacciones | Implementar almacén y secuencia de eventos, recibos idempotentes y outbox; probar caída entre evento y proyecciones de memoria. ICM y JSONL de Pi no forman una transacción común. |
| Escenario y concurrencia | Resolver acciones confirmadas en el mundo; coordinar colisiones, turnos, reloj ficticio, interrupciones, cancelaciones y repetición sin invocar modelos. |
| GUI | Implementar los flujos completos sobre estado real, con render SVG y controles operativos; verificar que pausar, hablar y reproducir tienen efectos comprensibles. |
| Audio/ritmo | Generar/escuchar resultados y distinguir espera técnica de pausa teatral; todavía no hay archivo de audio validado. |

La lectura no concede autorización para inyectar teoría o expedientes de investigación en cada personaje. Los materiales de investigación y el texto aportado se conservan con su procedencia, mientras el contexto de un actor se construye sólo desde identidad, canon, puesta y percepciones accesibles a ese personaje.
