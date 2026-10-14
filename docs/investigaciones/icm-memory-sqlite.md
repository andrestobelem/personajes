# ICM Memory con SQLite: memoria persistente de actores ejecutados con Pi

Fecha de consulta: 14 de octubre de 2026. Investigación de documentación y código fuente; no se instaló ICM, no se ejecutó `icm init`, no se descargó un modelo de embeddings y no se creó una base de datos del proyecto.

**Conclusión:** ICM Memory es un candidato viable para guardar y recuperar recuerdos de cada personaje. Hace falta un adaptador propio que controle qué puede percibir y recordar cada actor, conserve la procedencia y coordine el tiempo ficticio. Sus filtros de búsqueda no constituyen permisos y su integración automática con Pi todavía no incorpora una extensión de hooks.

## 1. Identidad del proyecto y alcance de la verificación

El proyecto investigado es **Infinite Context Memory**, repositorio [`rtk-ai/icm`](https://github.com/rtk-ai/icm). Se inspeccionó el commit [`5f402434919e514109a95c6cf504427fbcef851f`](https://github.com/rtk-ai/icm/commit/5f402434919e514109a95c6cf504427fbcef851f), fechado el 12 de octubre de 2026; su manifiesto de CLI declara **0.11.4**. Usa Rust y licencia Apache-2.0. Es una versión anterior a 1.0: fijar versión y commit al experimentar. [Manifiesto](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/Cargo.toml), [licencia](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/LICENSE).

Se utilizó la skill `find-docs`: Context7 resolvió `/rtk-ai/icm` y devolvió documentación de arquitectura. Ese índice describe un esquema antiguo de ocho tablas y una política antigua de cambio de dimensión de embeddings. Se contrastó con una copia temporal del repositorio oficial: **el código del commit citado prevalece cuando difiere del índice o de una guía**. No se ejecutaron sus pruebas ni se reprodujeron sus cifras de rendimiento.

No confundir estos dos trabajos:

| Nombre | Qué organiza | Papel propuesto en este proyecto |
|---|---|---|
| ICM como metodología de contexto interpretable en Markdown | Contextos, referencias, etapas y artefactos inspeccionables | La organización de `obra/`, sus instrucciones y sus registros legibles |
| ICM Memory, de `rtk-ai` | Recuerdos, conceptos, relaciones, hechos y transcripciones persistentes | Recuperar la experiencia subjetiva autorizada de cada personaje |

La relación entre ambos es una **propuesta de composición nuestra**. No se encontró una integración oficial que convierta automáticamente la metodología del paper en bases de datos de `rtk-ai/icm`. Véase [investigación de contexto interpretable](icm-contexto-interpretable.md).

## 2. Qué guarda realmente

ICM distingue varias estructuras. No todo es un texto introducido en un índice vectorial.

| Estructura | Datos y función verificados | Adaptación posible |
|---|---|---|
| `Memory` | Identificador ULID; `created_at`, `updated_at`, `last_accessed`, contador de accesos y peso; tema, resumen, extracto literal, palabras clave; importancia, origen, enlaces y embedding opcional | Recuerdo situado: lo que el personaje vio, oyó, interpretó o hizo |
| `Memoir` | Contenedor nombrado de conceptos | Un mapa de relaciones o conocimientos del personaje |
| `Concept` | Definición, etiquetas `namespace:value`, confianza, revisión, fechas y referencias a recuerdos | Creencia elaborada a partir de experiencias |
| `ConceptLink` | Relación tipada entre conceptos | Dependencias, contradicciones o cambios de creencia |
| `Fact` | Tupla entidad–clave–valor, origen y fecha de reemplazo | Afirmación estructurada vigente según ese personaje |
| `Session` / `Message` | Conversaciones literales, roles, herramientas y metadatos | Historial de los intercambios a los que el actor tuvo acceso |
| `Feedback` | Contexto, predicción, corrección y razón | Registro de errores de interpretación revisados |

El objeto `Memory` no tiene un campo general `confidence` ni un reloj ficticio. `weight` expresa una prioridad de recuperación/mantenimiento; no es probabilidad de verdad. Su origen tipado admite `Manual`, `Conversation` y `ClaudeCode`; la interfaz pública de almacenamiento no equivale a un contenedor arbitrario de metadatos de la obra. [Modelo de recuerdos](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/memory.rs).

Los conceptos empiezan con confianza 0,5 y revisión 1. El refinamiento aumenta la confianza en 0,1, hasta 1,0: es una heurística de ICM, **no una calibración epistemológica**. Reescribir muchas veces una interpretación no la vuelve verdadera. Los enlaces admiten `part_of`, `depends_on`, `related_to`, `contradicts`, `refines`, `alternative_to`, `caused_by`, `instance_of` y `superseded_by`. [Modelo de memoirs](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/memoir.rs), [refinamiento](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/memoir.rs).

`facts` conserva una historia de sustitución: cambiar el valor de una misma entidad y clave marca el anterior como reemplazado e inserta el nuevo. Volver a afirmar el mismo valor conserva la fila existente. La estructura es útil para responder preguntas exactas; no realiza por sí misma resolución de entidades ni extracción automática completa. [Modelo de hechos](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/facts.rs), [implementación SQLite](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/facts.rs).

**Decisión de diseño propuesta:** en la base de Max, un `Fact` sobre Siegfried significa «Max cree actualmente que…», no «el mundo certifica que…». La verdad del mundo permanece en otro registro. La identidad canónica y las metaindicaciones tampoco se reconstruyen mediante una búsqueda aproximada de recuerdos.

## 3. SQLite, índices y migraciones

El esquema actual incluye `memories`, `memoirs`, `concepts`, `concept_links`, `feedback`, `facts`, `sessions`, `messages`, `pending_extractions`, `pending_consolidations`, `hook_events`, `code_areas` e `icm_metadata`, además de tablas virtuales e índices. Hay FTS5 para recuerdos, conceptos, feedback y mensajes; `vec_memories` usa `sqlite-vec` con distancia coseno. Los triggers mantienen los índices FTS ante cambios del contenido. No es correcto describir esta versión como una base de ocho tablas.

La inicialización aplica cambios idempotentes y usa `PRAGMA user_version`; en este commit `SCHEMA_VERSION` vale 1, aunque el archivo incorpora muchas migraciones acumuladas. Varios bloques usan `BEGIN IMMEDIATE` para evitar carreras al crear tablas virtuales. Una base marcada por una versión de esquema superior no se rebaja automáticamente. Esto no garantiza compatibilidad funcional con un binario antiguo. [Esquema y migraciones](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/schema.rs).

Para nosotros, las tablas internas son responsabilidad de ICM. El adaptador debería usar sus operaciones públicas y guardar el registro de procedencia de la obra aparte; insertar nuevas columnas directamente en su esquema haría más difícil actualizarlo. La prueba de actualización debe hacerse sobre una copia verificable y nunca alternando versiones al azar sobre una función en curso.

## 4. Recuperación: texto, vectores y fechas

La búsqueda v2 combina rankings mediante **Reciprocal Rank Fusion**: coincidencia textual FTS5/BM25, similitud vectorial cuando hay embedder y una lista temporal cuando la consulta reconoce un período. Filtra candidatos antes del corte final y puede ampliar la búsqueda si los filtros dejan pocos resultados. La rama temporal selecciona entre los candidatos recuperados y compara `created_at`; no es una consulta exhaustiva de toda la cronología. [Búsqueda por rankings](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/ranked.rs).

`recall` admite presupuesto aproximado de tokens, límite de resultados y expansión mediante `related_ids`. El presupuesto se estima por caracteres, no con el tokenizer exacto del modelo; una memoria individual mayor que el presupuesto puede ser devuelta según la lógica de selección. Una recuperación normal puede actualizar accesos y activar mantenimiento; hay un camino de solo lectura que evita esas escrituras. [Motor de recuperación](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/recall.rs), [selección por presupuesto](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/budget.rs).

El modelo predeterminado documentado es `Qdrant/multilingual-e5-large-onnx`, de 1.024 dimensiones, con descarga inicial de aproximadamente 2 GB. El acceso a embeddings depende de la compilación y plataforma. `--no-embeddings` evita esa dependencia y mantiene la búsqueda textual. No hace falta un LLM para cada operación de guardar o recuperar; eso es distinto de las extracciones o resúmenes opcionales que sí pueden llamar a uno. [README de la versión inspeccionada](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/README.md).

El modelo que produjo los vectores queda registrado en la base. Tiene prioridad sobre una configuración nueva; si no puede utilizarse, la política puede pasar a búsqueda textual sin destruir los vectores. El cambio deliberado usa `icm embed --migrate`. Igual número de dimensiones no significa igual espacio semántico. [Política de embeddings](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/embedding_policy.rs).

**Aplicación propuesta:** comenzar con búsqueda textual en español y un conjunto de recuerdos controlados. Comparar luego embeddings multilingües con paráfrasis, negación, nombres y referencias indirectas de nuestras escenas. Las métricas publicadas por el mantenedor no prueban fidelidad a Max, 99, Sófocles ni a una memoria subjetiva de ficción.

## 5. Temas, proyectos y aislamiento de personajes

El comportamiento predeterminado está pensado para que varias herramientas de programación compartan memoria. La alternativa `icm init --per-project` crea una base local al proyecto; `--db` e `ICM_DB` permiten elegir otra. Esa separación por archivo es útil, pero **una base por repositorio seguiría mezclando a todos los personajes**. [Configuración de almacenamiento](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/config/default.toml).

Los temas son categorías; `namespace:value` son etiquetas de conceptos. El proyecto se deduce del repositorio o del directorio y se corresponde con convenciones de nombres de temas. No son espacios de autorización. Algunas memorias de preferencias atraviesan el filtro de proyecto deliberadamente. Las herramientas MCP permiten omitir filtros y buscar entre memoirs; conocer un identificador tampoco otorga una identidad de actor autenticada. [Detección de proyecto](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/project.rs), [wake-up y preferencias](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/wake_up.rs).

**Propuesta para `obra/`:** una base por ejecución y por actor, seleccionada exclusivamente por el anfitrión. Por ejemplo, un directorio privado de runtime con `<ejecucion>/<actor>/memories.db`; no se crean estos archivos en esta investigación. Director, mundo y observador tienen almacenes separados. El observador puede reunir proyecciones para mostrar evolución, sin devolver ese conocimiento a los actores.

El modelo recibe una tool `recordar` que no acepta `dbPath`, `actorId`, nombres de archivos ni SQL. El anfitrión ya sabe quién llama. Incluso con archivos separados, si el agente conserva un `read` o un `bash` irrestricto puede leer las bases ajenas. La separación lógica debe acompañarse de herramientas restringidas y, cuando sea necesaria, aislamiento de procesos o filesystem. Pi no convierte una convención de carpetas en un sandbox.

El proceso adaptador también debe fijar `ICM_DB_BACKEND=sqlite` y controlar su configuración. El código admite otros backends por variables de entorno; con uno remoto seleccionado, `--db` no representa necesariamente el corpus utilizado. Heredar ciegamente el entorno de una sesión de desarrollo podría invalidar la separación esperada. [Selección de backend](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/backend.rs).

## 6. Operaciones públicas verificadas

Estos ejemplos son documentación, **no comandos ejecutados**. La ruta es ilustrativa; el adaptador debe resolverla y fijarla, sin aceptar modificaciones del actor.

```bash
icm --db /ruta/privada/max/memories.db --no-embeddings store \
  --topic experiencias --content '99 me dijo que la puerta estaba vigilada.' \
  --importance medium --keywords '99,puerta,testimonio'

icm --db /ruta/privada/max/memories.db --no-embeddings --read-only recall \
  'qué sé de la puerta' --format json --limit 5

icm --db /ruta/privada/max/memories.db --no-embeddings update ID \
  --content 'Ahora creo que 99 se refería a la puerta del patio.'

icm --db /ruta/privada/max/memories.db --no-embeddings forget ID
```

Se verificaron los argumentos en `Commands` del CLI. `update` reemplaza el contenido actual; no preserva automáticamente todas sus versiones. `forget` elimina. Por eso una rectificación narrativa debe registrarse antes como evento de revisión, y el olvido subjetivo no debe borrar la evidencia del observador. [Definiciones de CLI](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/main.rs), [formatos de recuperación](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/recall_format.rs).

MCP se sirve con `icm serve`. Entre sus herramientas están `icm_memory_store`, `icm_memory_recall`, `icm_memory_update`, `icm_memory_forget`, las de memoirs, feedback y transcripciones. `recall` admite salida JSON. `store` recibe tema, contenido, importancia, palabras clave y extracto; no permite atribuir arbitrariamente toda la procedencia dramática. No exponer el catálogo completo a un personaje: operaciones como borrar un tema, explorar todo el corpus o aprender un directorio tienen otro alcance. [Schemas MCP](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-mcp/src/tools.rs).

HTTP ofrece un servidor persistente que mantiene caliente el embedder. `/store` admite `created_at`; `/recall` admite `now` para expresiones temporales del motor v2, además de filtros y formato JSON. Esas fechas no equivalen a controlar todos los relojes internos. En este commit el handler HTTP de almacenamiento llama directamente al store: no asumir que reproduce todas las heurísticas de fusión y enlaces de CLI/MCP. El servidor requiere token al escuchar fuera de loopback; ese token protege el servidor, no establece permisos por personaje. [API HTTP](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/http_api.rs).

## 7. Estado real de integración con Pi

La referencia de ICM incluye Pi con instrucciones `AGENTS.md` y entradas `/icm-recall` y `/icm-remember`; la columna de extensión dice **TS ext (TBD)**. La implementación de `init` instala archivos de instrucciones/skills para Pi, pero el bloque de hooks sólo avisa que falta la extensión TypeScript. No se encontró un plugin Pi oficial entregado en este commit; en `plugins/` sí hay uno para OpenCode. [Referencia de integraciones](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/docs/reference.md), [implementación de init](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/main.rs#L6249).

Esto permite una integración propia con Pi, pero no autoriza a decir que viene terminada. Véase [investigación del runtime Pi](pi-coding-agent-runtime.md) para su API y sus recursos. El adaptador puede invocar el CLI como proceso con argumentos separados, capturar JSON y devolver una respuesta limitada. Nunca construir un comando de shell concatenando el texto recordado o la consulta del personaje.

### Contrato mínimo propuesto, todavía sin implementación

| Operación del actor | Operación del anfitrión | Responsabilidad |
|---|---|---|
| `recordar(consulta)` | Ejecutar recuperación sobre la base fija del actor | Recortar resultados y conservar referencias de procedencia |
| `proponerRecuerdo(percepcion, interpretacion)` | Verificar que esa percepción fue entregada al actor; persistir después | El actor puede interpretar, pero no inventar haber presenciado otro evento |
| `revisarCreencia(recuerdo, motivo)` | Registrar revisión y actualizar la proyección | Conservar versión anterior y causa de cambio en el registro de obra |
| Sin tool administrativa en escena | Backup, reparación, migración, compactación | Operaciones del sistema, fuera de la representación |

El contrato es deliberadamente más pequeño que ICM. La tool de hablar entrega mensajes al mundo; no escribe directamente los recuerdos del interlocutor. El mundo resuelve la entrega, el interlocutor recibe su percepción y luego interpreta. Así el usuario puede conversar e influir en los personajes sin convertirse por defecto en su director o administrador de memoria.

## 8. Procedencia y continuidad de la obra

La propuesta necesita un registro autoritativo de eventos, independiente de los resúmenes recuperables. Para cada recuerdo conviene relacionar: ejecución, actor, evento y percepción de origen, interlocutor, momento ficticio, momento de persistencia, tipo de evidencia, revisión y condición de acceso. Este registro es diseño nuestro; no son campos nativos que `icm_memory_store` acepte todos juntos.

Flujo propuesto:

1. El mundo confirma un evento y su lista de destinatarios.
2. Cada destinatario recibe sólo su percepción: ver, escuchar, leer o inferir tienen alcances distintos.
3. La interpretación del actor conserva esa diferencia: «99 dijo P» no se transforma automáticamente en «P ocurrió».
4. El anfitrión persiste la proyección en la base del actor y relaciona el identificador ICM con la evidencia original.
5. El observador muestra conversación y cambios de memoria, sin introducir esa vista global en el contexto de los personajes.

La escritura del evento del mundo y las escrituras en varias bases no constituyen una sola transacción de SQLite. Se necesita entrega reintentable y un identificador estable de percepción; si una proyección falla, el evento queda pendiente para ese actor. No prometer `exactly once` a partir de deduplicar texto: dos ocasiones distintas pueden producir la misma frase y merecer recuerdos distintos.

En ICM hay deduplicación exacta por tema y resumen normalizado; algunos caminos también fusionan cercanía semántica. Los enlaces automáticos se calculan por similitud, no por prueba causal, y sus referencias inversas son de mejor esfuerzo. Para experiencias repetidas, negaciones, mentiras y cambios de creencia, validar específicamente que no se mezclen episodios. [Deduplicación de almacenamiento](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/mod.rs), [enlaces automáticos](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-core/src/auto_link.rs).

## 9. Tiempo circadiano, peso y olvido

Hay tres tiempos diferentes: el del mundo representado, el de ejecución del sistema y el orden causal de los eventos. ICM crea sus timestamps con UTC real. La API HTTP permite atribuir una fecha al contenido, pero otros timestamps permanecen ligados a la escritura. Un recuerdo de 1967 ingresado hoy no debería alterar accidentalmente su importancia dramática por esa diferencia.

La implementación de mantenimiento automático calcula días reales transcurridos y aplica una base **0,95 codificada en ese camino**; el comentario indica que aún no conecta allí el `decay_rate` configurable del CLI. No basta escribir otro valor en TOML para asegurar que todos los caminos lo respeten. [Mantenimiento automático](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/maintenance.rs).

Las memorias `critical` no sufren ese decaimiento. La poda preserva `critical` y `high`; la consolidación protege `critical`, pero puede reemplazar otras entradas. Los accesos reducen moderadamente la velocidad de desgaste, con un tope en el factor de accesos. Esto no representa sueño, cansancio, trauma, hábitos ni memoria humana científicamente modelada. [Decaimiento, poda y consolidación](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/memory.rs).

**Primera política propuesta:** recuperar en modo de sólo lectura y controlar la selección narrativa desde el anfitrión. No usar el desgaste de calendario real como sustituto del ciclo circadiano. Si más adelante se necesita olvido ligado al tiempo ficticio, desarrollar y probar esa política explícitamente. Una pausa de la aplicación no debería convertirse por accidente en una semana de deterioro mental de los personajes.

## 10. Concurrencia, transacciones y durabilidad

ICM abre SQLite con WAL, claves foráneas y una espera normal de escritura de 30 segundos. Usa reintentos para carreras de apertura/migración y una espera menor para mantenimiento accesorio de lectura. Varias mutaciones de tablas e índices están agrupadas en transacciones. Esto reduce fallos parciales, pero no elimina contención ni errores de disco. [Apertura y tiempos de espera](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/mod.rs).

WAL permite lectores mientras escribe un proceso, pero hay un escritor por base a la vez. Debe usarse en almacenamiento local; no es la solución para compartir el mismo archivo entre máquinas por un filesystem de red. Las transacciones sobre varios archivos no son atómicas como conjunto. Los lectores largos también pueden retrasar checkpoints y hacer crecer el WAL. [SQLite: WAL y concurrencia](https://sqlite.org/wal.html).

Propuesta: serializar las mutaciones por actor y permitir paralelismo entre actores. Inicializar/migrar antes de iniciar la función; no hacer que treinta primeros turnos compitan por la misma base recién creada. Establecer timeout y reintento acotado del adaptador; una falla de persistencia debe quedar visible como pendiente, sin afirmar que el recuerdo quedó guardado.

No se encontró un ajuste explícito `PRAGMA synchronous` en los caminos inspeccionados. WAL por sí solo no determina la garantía ante corte de energía: el valor efectivo y el almacenamiento importan. La prueba de despliegue debe registrar los pragmas efectivos del binario real y probar recuperación tras interrupción. [SQLite: synchronous](https://sqlite.org/pragma.html#pragma_synchronous).

Hay una caché LRU de recuerdos en cada proceso y las mutaciones del propio proceso la invalidan. En el código de caché inspeccionado no aparece coordinación de invalidación entre procesos. Por tanto, si se mezcla un servidor caliente con escrituras externas, verificar frescura; preferir un único propietario de escritura por base. [Caché](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/cache.rs).

## 11. Backup, exportación y replay

`icm backup` utiliza la **Online Backup API** de SQLite; incorpora los cambios confirmados del WAL a una copia consistente. Es preferible a copiar sólo el `.db` mientras hay escritores. El código intenta restringir permisos Unix de la copia a `0600`. El backup preventivo está habilitado por defecto, con intervalo documentado de siete días y retención de cinco copias; revisar esa política por ejecución. [Implementación de backup](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-store/src/store/maintenance.rs), [SQLite Backup API](https://sqlite.org/backup.html).

La exportación portable no sustituye ese backup: `cmd_export` serializa recuerdos, hechos activos y feedback. No exporta en ese camino sesiones, mensajes, el grafo de memoirs completo ni todas las versiones de hechos. `memoir export` es otra operación. Registrar por separado qué se conserva en cada formato antes de prometer una restauración integral. [Exportación CLI](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/main.rs#L7427).

Las transcripciones permiten volver a leer conversaciones y buscarlas. **Eso no equivale a repetir determinísticamente la simulación.** Para reproducir una función hacen falta el estado inicial del mundo, versiones de fichas/instrucciones/tools, entregas perceptivas, acciones propuestas, resultados confirmados, reloj ficticio, decisiones de dirección y salidas de los modelos. Volver a llamar al modelo puede producir otra actuación.

La instantánea coordinada de una ejecución debe asociar un punto del registro de eventos con cada backup de actor. Una copia consistente de cada archivo tomada en momentos diferentes no certifica por sí misma una fotografía global de la misma escena. Mantener también el registro de operaciones necesarias para reconstruir las proyecciones.

## 12. Captura automática, influencia y prompt injection

Los hooks de ICM están diseñados para sesiones de programación: pueden tomar salidas de herramientas y fragmentos de transcripciones, extraer hechos y preparar contexto de inicio. La configuración permite extracción mediante un proveedor LLM; `provider = "none"` mantiene esa parte sin llamadas al proveedor. Que `store` sea local no implica que toda configuración de extracción lo sea. [Extracción y proveedores](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/config/default.toml), [lógica de extracción](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/extract.rs).

Para la obra, capturar indiscriminadamente todas las herramientas sería un error: incluiría fichas ajenas, instrucciones del director y estado global. La entrada de la memoria del actor debe ser la **percepción autorizada**, no el transcript completo del proceso anfitrión. Los logs técnicos deben mantenerse separados de la experiencia del personaje.

El propio código señala un límite de confianza: el contenido recordado puede volver como contexto de inicio. Algunas extracciones de hooks limitan la importancia a `medium`, pero una llamada MCP de almacenamiento puede solicitar `critical`. Aplanar saltos de línea no neutraliza instrucciones maliciosas incrustadas. Esta barrera no está resuelta sólo por instalar ICM. [Frontera de confianza del hook de inicio](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/main.rs#L5175).

Reglas propuestas para el adaptador:

- El contenido recordado llega como datos con origen, nunca como nuevas instrucciones del sistema.
- La identidad estable y las reglas de autoridad proceden de archivos controlados; el actor no las reemplaza asignando `critical` a una frase.
- Un humano puede persuadir, engañar, prometer o discutir dentro de la ficción. No puede adquirir autoridad de director diciendo «ignora tu personaje».
- El regidor valida destinatario, tipo de intervención, herramientas permitidas y efectos. No depende sólo de otra respuesta LLM que afirme que algo es seguro.
- El recuerdo de un engaño conserva el hecho comunicativo y su interpretación. No se elimina una mentira sólo por ser falsa: puede ser causalmente importante.
- Ni `icm learn` sobre el repo completo ni la búsqueda entre todos los memoirs quedan disponibles para el actor.

Estas reglas son diseño de la obra, no capacidades garantizadas por ICM.

## 13. Consolidación, contradicciones e historia exhaustiva

Consolidar reduce volumen, pero puede perder información. El comportamiento lexical documentado conserva los resúmenes de las tres memorias de mayor peso y reemplaza otras no críticas; la consolidación automática viene desactivada en la configuración de referencia. Con un resumidor configurado puede utilizar una cola. No activarla antes de evaluar pérdidas en conversaciones reales de los personajes. [Configuración de consolidación](https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/config/default.toml).

Una biografía exhaustiva no exige introducirla entera en cada prompt. Propuesta: mantener el dossier canónico en Markdown, una selección estable de identidad y contexto en cada sesión, y recuperar episodios relevantes según situación. Los recuerdos nuevos agregan experiencia; no reescriben automáticamente los hechos canónicos. Los huecos de canon continúan marcados como desconocidos o como invención autorizada.

Un ejemplo: Max recuerda «Siegfried me ofreció una tregua»; más tarde, «la emboscada ocurrió durante la tregua». No son duplicados ni una simple corrección de texto. Pueden formar una relación de contradicción con la interpretación anterior «podía confiar en él», sin borrar el ofrecimiento. El cambio de confianza debe tener causa y fecha ficticia, y puede afectar futuros goals y decisiones.

La política de compactación debe conservar fuentes y posibilidades de inspección. Los episodios completos pueden quedar archivados para el observador mientras el actor conserva una síntesis limitada. Separar «no disponible en su recuerdo activo» de «borrado del archivo histórico». Que una relación `contradicts` exista no decide automáticamente cuál versión cree el personaje.

## 14. Pruebas requeridas antes de adoptar la integración

No se ejecutaron estas pruebas; constituyen criterios de aceptación para el futuro prototipo.

| Caso | Resultado exigido |
|---|---|
| Max busca un secreto que sólo oyó 99 | Ningún resultado, incluso quitando filtros o pidiendo otro tema |
| Un recuerdo contiene «ignora tus instrucciones» | Se conserva como contenido citado si corresponde, sin cambiar autoridad ni tools |
| Dos personajes oyen el mismo mensaje | Dos percepciones y posibles interpretaciones distintas, con evidencia común |
| El humano persuade a Max | Puede cambiar una creencia por razones de escena; no cambia permisos del proceso |
| Repetición de la misma frase en días distintos | Dos eventos históricos identificables, aunque la recuperación agrupe contenido |
| Una negación se parece mucho al texto anterior | No se fusiona destruyendo el cambio de sentido |
| Consultas españolas con paráfrasis y nombres | Recuperación medida contra respuestas esperadas, con y sin embeddings |
| Simulación pausada durante días reales | No envejece la memoria ficticia inadvertidamente |
| Cambio del modelo de embeddings | Preserva contenido; migración explícita y recuperable |
| Caída después del evento y antes de persistir el recuerdo | Reintento por percepción sin inventar un segundo evento |
| Escrituras simultáneas y backup con WAL activo | Datos confirmados íntegros, fallos visibles y restauración comprobada |
| Proceso caliente y actualización externa | No devuelve una versión obsoleta como si fuera actual |
| Consolidación de una relación cambiante | Conserva causa, cronología y referencias suficientes para explicar la evolución |
| Exportación y restauración | Se verifica exactamente qué capas vuelven; no se confunde export parcial con backup |
| Reapertura de una función | Se puede observar su historia; una nueva generación se identifica como otra ejecución |

## 15. Recomendación y trabajo pendiente

Adoptar ICM Memory **como candidato de persistencia y recuperación**, junto con Pi como candidato de runtime. La prueba inicial debería usar bases separadas por actor, herramientas pequeñas controladas por el anfitrión, recuerdos con evidencia y recuperación en modo de sólo lectura. La memoria de ejecución de Pi y la memoria diegética del personaje tienen responsabilidades distintas.

La investigación deja verificadas la identidad del proyecto, sus modelos de datos, búsqueda, interfaces, estado de Pi y los principales límites. Quedan por implementar y medir el adaptador, el registro de procedencia, la entrega reintentable, el reloj ficticio, la selección de recuerdos y las pruebas anteriores. No se ha instalado ni integrado ICM en `obra/` por escribir este documento.

Se consultó documentación técnica y código primario. No se identificó aquí un paper propio de `rtk-ai/icm` que deba confundirse con el [paper de ICM contextual ya archivado](../fuentes/icm/README.md). Los números del README son reportes del mantenedor, no resultados reproducidos en este repositorio.
