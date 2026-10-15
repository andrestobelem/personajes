# S06 — Voces, sonido y ritmo

**Versión 1.0 — especificación, no implementación.** Alcance de VOZ-01–07, DIR-03, UI-02/03/05/06, MEM-09 y ensayos P05/P07/P15/P20/P21. Depende de [PRD 1.0](../PRD.md), [decisiones del producto](../auditoria/decisiones-producto-prd.md), [S02](02-persistencia-e-icm.md), [S03](03-pi-y-coordinacion.md), [S04](04-api-y-autoridad.md) y [S05](05-interfaz.md). La versión elegida para la puesta y sus adaptaciones tienen autoridad sobre defaults de esta spec. Los defaults de host propuestos aquí son decisiones de implementación reversibles, no elecciones atribuidas a la persona usuaria.

La aplicación ofrece una capa de voz que transforma contenido público ya confirmado en audio y lo conserva ligado a su publicación. Pi propone/selecciona el texto; la revisión y el Escenario fijan si se publica; ElevenLabs produce audio. Una receta de diseño no es una voz creada, un ID de proveedor no es una identidad ficticia y ningún archivo de audio confirma por sí mismo una acción ni una emisión.

## 1. Alcance y reglas

- Español es requisito; la variedad concreta se declara por puesta. Una sugerencia editorial marcada como propuesta puede servir para actuación textual, pero **bloquea toda llamada de Voice Design y TTS** hasta que el operador confirme una variedad. La voz seleccionada también debe comprobarse contra esa convención. Un efecto animal no lingüístico de Fang no depende de variedad de habla. (PRD VOZ-01/04/07, DP-09.)
- La capacidad Voice Design/guardado/TTS/reproducción/subtítulos se incluye en el producto por DP-02; se puede apagar por puesta. Audio apagado conserva íntegros el texto, la actuación y el replay textual. Por decisión reversible del integrador, una puesta nueva comienza con audio desactivado; habilitar audio es un cambio visible y versionado. No implica crear voces automáticamente.
- No se crean ni guardan voces en masa. El operador solicita cada preview, aporta su texto, escucha y elige una opción concreta; sólo una acción separada guarda esa opción en la biblioteca. No se clona ni se apunta a intérpretes, doblajes o muestras existentes.
- El texto enviado a TTS es exactamente el diálogo/narración publicado en su versión durable. S06 no corrige, reformula, traduce ni reinterpreta lo escrito. Cambiar el texto requiere otra revisión/publicación; el artefacto sonoro anterior permanece asociado a su versión fuente.
- Voz y sonido son efectos de presentación. No alteran el Escenario, no entregan una frase al reparto, no crean memoria y no convierten recepción nula en recepción efectiva.
- El producto no fija conteos, segundos por réplica, pausas obligatorias, velocidad ni acento a partir de los videos investigados. La medición audiovisual de *Get Smart* sigue pendiente según la [investigación de ritmo](../investigaciones/get-smart-ritmo-youtube.md).

## 2. Configuración y datos

### 2.1 Versión de voz de una puesta

La pantalla **Sonido y voces** muestra el estado y permite editar una versión de configuración antes de iniciar; una modificación durante la corrida crea revisión nueva, queda en el journal y sólo aplica a publicaciones posteriores. Una generación ya solicitada conserva su revisión y parámetros originales. Todas las variantes de unión usan el discriminante literal `kind`, incluidos slots y variedad. Los enums de estado técnico son campos de estado, no sustituyen ese discriminante. Los siguientes contratos son normativos en S06; el modelo de dominio/DTO de implementación se deriva de ellos y no debe mantener una segunda definición más permisiva.

| Contrato | Unión válida y campos obligatorios |
|---|---|
| `SpanishVariety` | `proposed`: `label`, `source="editorial-proposal"`; o `confirmed`: `label`, `source="operator"`, `confirmedBy` (identidad autenticada del operador) y `confirmedAt`. Ningún otro cruce de `kind/source` es válido. |
| `AudioMode` | `{kind="disabled"}`; o `{kind="enabled", language="es", ttsMode, ttsModelId, outputFormat, subtitles}`. `ttsMode` es `automatic-after-publication` o `manual-per-publication`. Decisión reversible del integrador: default de puesta nueva `disabled`; al habilitar, default `automatic-after-publication`, con elección manual disponible. |
| `SpeakerSlot` | `disabled`; o `enabled-unbound`; o `enabled-bound {speechBindingId}`. Se indexa por identidades con capacidad de habla en la puesta, no por el catálogo completo. `enabled-bound` exige binding existente, modelo/idioma compatibles y evidencia de prueba escuchada. |
| `NarratorSlot` | `absent`; o `enabled-unbound`; o `enabled-bound {speechBindingId}`. Narrador habilitado para salida hablada necesita binding validado, pero su canal textual/publicación no depende de ese binding. |
| `SoundEffectSlot` | `disabled`; o `enabled-unbound`; o `enabled-bound {soundBindingId}`. El binding se refiere a un efecto no verbal autorizado, nunca a un `voiceId`. |
| `VoiceConfig` | `{revision, spanishVariety, audioMode, speakerSlots, narratorSlot, soundEffectSlots}`. Si `audioMode.kind="enabled"`, Voice Design/TTS requieren `spanishVariety.kind="confirmed"`; SFX no lingüístico sigue gate separado. Slots pueden conservar una binding aunque la configuración general de audio esté apagada. |

Un `SpeechBinding` es la unión `{kind="speech", owner: {kind="character", id: SpeakableCharacterId} | {kind="narrator"}, provider="elevenlabs", voiceId, voiceName, voiceDescription, language="es", ttsModelId, varietyLabel, configRevision, validationEvidenceId, provenance}`. El binding final sólo se construye tras aceptar una prueba de voz/modelo español escuchada por el operador y exige `validationEvidenceId`. Antes existe `SpeechBindingDraft={kind="unvalidated", bindingDraftId, owner, providerVoiceId, ttsModelId, varietyLabel, configRevision, source, provenance, voiceSnapshot}`; ese candidato no exige evidencia inexistente y el slot permanece `enabled-unbound`. El draft conserva `source` discriminado de selección (voz guardada local o voz de catálogo), `provenance` normalizada por host y `voiceSnapshot` inmutable con ID remoto, nombre, descripción, idioma y revisión/hash del catálogo. La aceptación deriva del draft durable, no consulta ni infiere otra procedencia desde el ID remoto. Draft y final son objetos distintos con IDs marcados distintos; la aceptación crea el final y conserva procedencia del candidato. `provenance` es unión `{kind="created-by-this-app", savedVoiceId, designModelId}` o `{kind="existing-provider-voice-selected", providerCatalogRef}`: no exigir modelo de diseño desconocido para una voz existente. Un `SoundBinding` tiene forma distinta: `{kind="nonverbal-effect", sourceId, artifactId, configRevision, provenance}`; no tiene `voiceId`, `voiceName` ni modelo TTS. Ninguno almacena key/token ni URL con credenciales. Los expedientes fuente conservan receta/investigación; estas asociaciones versionadas no mutan canon ni ficha original.

`SpanishVariety` propuesta no autoriza petición Voice Design/TTS, aunque exista voz seleccionada o la puesta esté habilitada. El error identifica el campo pendiente y mantiene el resto editable. La interfaz conserva qué valor se sugirió, cuál eligió el operador y quién/cuándo lo confirmó; no etiqueta un default como decisión humana.

Una receta es texto curatorial sin efecto externo, con hash/fuente y estado de revisión. La biblioteca expone la cobertura de recetas separadamente de los estados `sin voz`, `preview solicitada`, `opciones disponibles`, `voz guardada`, `voz no disponible` y `audio generado`. Un prompt/documento nunca se muestra como prueba de escucha.

### 2.2 Artefactos y solicitudes

El journal descrito en S02 extiende `media`/`jobs` para poder reanudar y auditar operaciones sin volver a actuar:

| Entidad | Campos/invariante necesarios |
|---|---|
| `voice_operations` | `operationId`, tipo (`design-preview`, `save-voice`, `tts`, `sfx`), usuario/canal host, config revision, proveedor/modelo, estado, fechas, `attempt`, cancelación, error sanitizado; cada click recibe clave idempotente local. |
| `voice_previews` | `previewId`, operation, ID generado por proveedor, descripción, texto de muestra exacto + origen operador, variedad confirmada y hash, modelo de diseño, duración/media type, archivo temporal/hash, estado y opción elegida. |
| `speech_bindings` / `sound_bindings` | Unión discriminada por `kind` y propietario; voz remota sólo se registra después de guardar o seleccionar explícitamente una existente. Nunca tratar SFX como voz de habla. |
| `audio_artifacts` | `artifactId`, publicación/narración o evento fuente, hash y revisión del texto, actor/narrador/Fang, binding/config revision, modelo, formato, proveedor, archivo/hash/duración, timestamps/alineación/subtítulos, operación y estado. |

Estados terminales y no terminales no se reutilizan entre capas. Preview reproducible no significa voz guardada; voz guardada no significa TTS probado; TTS remoto devuelto no significa artefacto local durable; artefacto durable no significa que ya se oyó en la interfaz. Se guardan respuestas técnicas necesarias y metadatos mínimos; se excluyen credenciales, prompts de actor/thinking y contenido privado de otro actor. El audio y el texto de preview se guardan fuera del repo, bajo el directorio privado de datos de S02, con límites de retención/exportación expuestos al operador.

## 3. Credenciales y frontera de host

La clave/token ElevenLabs es un secreto del host en almacén privado/configuración secreta host-side, nunca en React, URL, query string, estado persistido de navegador, SQLite ICM, export, backup o log. El frontend manda un `operationId` y parámetros permitidos al servidor local; sólo el adaptador server-side adjunta credencial al request del proveedor. UI de credenciales admite introducir/reemplazar, prueba de conexión, estado presente/ausente y borrar; no vuelve a mostrar el valor una vez guardado. Mensajes y logs sanitizan headers, cuerpos y URLs.

La autenticación OAuth de `openai-codex` para Pi y la credencial de ElevenLabs son independientes. Vencimiento OAuth impide inferencias Pi nuevas según PRD/S03; no impide cargar catálogo local, escuchar medios guardados o reintentar una tarea mecánica de proyección. Vencimiento/ausencia de secreto ElevenLabs impide nueva llamada al proveedor, pero no borra publicación/audio anterior. No se activa fallback a otro proveedor, modelo o voz.

## 4. Flujo administrativo de Voice Design

El recorrido es accesible completamente en GUI; terminal no es necesaria.

1. **Abrir ficha o narrador.** En Biblioteca → Voces, el operador selecciona una identidad o Narrador opcional y ve receta, procedencia, variedad y estado. Fang se identifica como efecto no verbal; no se ofrece un control de voz humana.
2. **Confirmar convención.** Si la puesta conserva `proposed`, la pantalla informa que la propuesta no habilita Voice Design ni TTS y ofrece confirmar/editar la variedad. Para Voice Design se exige confirmación registrada antes de enviar. La descripción de voz debe repetir la variedad que el operador acaba de confirmar; una discrepancia bloquea envío hasta editar y revisar. SFX no lingüístico mantiene su autorización separada.
3. **Preparar la muestra.** Un campo multilinea requiere texto original en español provisto o seleccionado expresamente por el operador, de 100–1000 caracteres conforme al endpoint. Se muestra conteo, idioma/variedad, vista previa exacta y procedencia. No se precarga ni remite automáticamente ninguna muestra de `obra/`, una línea investigada, diálogo de episodio o texto del actor. No se llama `auto_generate_text`; no se adjunta audio de referencia.
4. **Revisar descripción y modelo de diseño.** Descripción de 20–1000 caracteres, editada/confirmada por operador, compatible con la receta y sin referencia a persona/intérprete. El selector sólo presenta modelos que el endpoint verificado admite y su estado/capacidad; modelo desconocido o incompatibilidad detiene la operación. La documentación consultada enumera `eleven_multilingual_ttv_v2` y `eleven_ttv_v3`; no se fijan para siempre si la API evoluciona. El idioma de la muestra y del perfil es español (`es`); variedad concreta sigue siendo la confirmada por la puesta. [Voice Design API](https://elevenlabs.io/docs/api-reference/text-to-voice/design).
5. **Solicitar previews explícitamente.** Junto al botón se informa que la operación contacta ElevenLabs y puede consumir créditos del plan; si la cuenta no informa precio exacto, indicar que no se pudo estimar. No inventar un precio fijo. El click en **Generar previews** es la autorización operativa para esa petición y hace `POST /v1/text-to-voice/design` desde servidor; no se agrega un modal redundante. El campo `text` contiene el texto exacto elegido, `voice_description` la descripción aprobada, `auto_generate_text=false`, `stream_previews=false`; no hacer retry automático ante timeout ambiguo. API documenta que respuesta es una lista de previews con `generated_voice_id`, audio, tipo, duración e idioma; el número recibido se presenta dinámicamente, sin asumir tres. La guía de diseño recomienda tres opciones, pero esa cardinalidad no forma parte del schema de respuesta.
6. **Escuchar y comparar.** Reproducir cada opción sólo a demanda, con controles accesibles, nombre neutral (“Opción 1…”) y texto de muestra visible. Comparación comprueba inteligibilidad en español, convención confirmada, diferenciación, timbre, naturalidad y adecuación a varias intenciones de la receta. Si la respuesta incluye idioma, validar `es`; el dato no sustituye escucha. Feedback visual/audio describe evidencia del archivo, no certifica acento por metadata. Un preview escuchado no se asigna aún a la identidad.
7. **Elegir una sola opción.** El operador marca explícitamente una preview concreta. El botón aparte **Guardar voz seleccionada** muestra identidad, descripción, muestra y opción elegida; sólo entonces servidor hace `POST /v1/text-to-voice` con `generated_voice_id`, `voice_name` y `voice_description`. El resultado `voice_id` se registra en la biblioteca local de voces guardadas sólo tras respuesta válida y commit. Guardar no crea binding ni lo asigna automáticamente a la identidad; esa selección es la operación explícita del paso siguiente. [Create a voice](https://elevenlabs.io/docs/api-reference/text-to-voice/create).
8. **Seleccionar binding y prueba TTS.** El operador elige explícitamente la voz guardada o una existente para personaje/narrador; el host crea el candidato de binding aún no habilitado. La UI comprueba el `voice_id`, modelo compatible con TTS y soporte de español (`es`), y muestra su relación de uso con la variedad confirmada. Para modelo/voz existentes ofrece una muestra original en español elegida por operador; en todos los casos la prueba TTS usa texto elegido explícitamente, muestra coste disponible y se solicita mediante botón. La escucha y aceptación del operador produce `validationEvidenceId`; sin ella el binding no queda habilitado para escenas. La prueba crea un artefacto separado, fuera del replay de obra y sin modificar escena. Se puede revertir binding en una revisión nueva; no borrar silenciosamente voz remota.

Si ningún preview sirve, “Volver a editar” conserva el grupo como rechazado/no elegido y no guarda voz; modificar una sola dimensión por vuelta facilita comparación. Otra generación es otra petición explícita y puede consumir crédito adicional. La UI informa resultado y coste sólo cuando el proveedor devuelve datos verificables; no calcula tarifas.

## 5. TTS de diálogo y subtítulos

### 5.1 Disparador y aislamiento respecto de la actuación

En una puesta nueva `AudioMode.kind="disabled"` según decisión reversible del integrador (§2.1). Al habilitar audio, la UI informa en línea que la modalidad automática genera audio para futuras publicaciones y puede consumir créditos; el propio control **Habilitar audio** autoriza ese comportamiento sin modal repetido. No se promete cancelación remota garantizada. La modalidad queda en `automatic-after-publication` por defecto, con opción visible de cambiar a `manual-per-publication`. En modo automático y con binding válido, se sintetiza cada publicación nueva de diálogo/narración en cola posterior al commit, sin bloquear el commit o avance de Escenario. En modo manual, el botón **Generar audio** de una publicación es la autorización de esa solicitud. En ambos modos, reproducir el archivo requiere gesto explícito; la interfaz nunca hace autoplay. Apagar y volver a encender audio no genera audio retroactivo para el historial: sólo aplica a publicaciones posteriores. La generación sólo corre cuando:

1. Hay publicación de diálogo/narración exacta, confirmada, durable e idempotente (S02); una propuesta no publicada o resolución sin emisión nunca produce TTS.
2. La puesta tiene audio habilitado, variedad confirmada, binding con evidencia de aceptación, `language="es"`, modelo con `can_do_text_to_speech=true`, español anunciado en su catálogo de `languages` y formato validado.
3. El texto de publicación y el binding se congelan en la solicitud; envío al endpoint de TTS ocurre una vez por esa combinación y el usuario ve estado “en cola”.

Se prefiere por réplica `POST /v1/text-to-speech/{voice_id}/with-timestamps`, que devuelve audio y alineación por carácter; así los subtítulos sincronizados se derivan del mismo audio/texto. [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). La alternativa sin timestamps sólo se usa por incompatibilidad expresamente visible; no se presentan tiempos inventados como alineación real. El adapter fija `model_id`, `output_format` y demás settings por revisión. No acepta modelo default implícito del proveedor si difiere del guardado; comprueba compatibilidad actual voz/modelo. No cambia modelo automáticamente.

Cada voz se procesa separada por `publicationId`; no se agrupan varias personas en un solo request que diluya atribución, reintento, voz o replay. Las distintas voces pueden generar en paralelo bajo límite configurable de cola, pero los mensajes de UI mantienen orden de publicación/escena. Si se añade futuro endpoint de diálogo multi-voz, será otra spec/decisión y debe preservar `publicationId` por segmento; no se requiere para esta entrega.

La respuesta del servicio nunca sustituye el texto en pantalla. El operador siempre puede leer el texto publicado aunque TTS no arranque, falle o falte voz. El reproductor habilita audio cuando el archivo fue guardado y validado. Respuesta HTTP exitosa sin archivo completo/checksum no es artefacto reproducible.

### 5.2 Subtítulos

La fuente del subtítulo es el texto exacto publicado. Al recibir `alignment.characters`, `character_start_times_seconds` y `character_end_times_seconds`, validar longitud/alineación y construir cues deterministas a partir de intervalos de caracteres, espacios y puntuación, respetando límites legibles de línea; preservar mayúsculas, signos, acentos y texto fuente. Los límites de lectura son parámetros de presentación accesibles y no alteran contenido. El artefacto almacena cues y referencia/versionado del algoritmo.

Si el servicio no devuelve alineación o ésta falla validación, mostrar transcripción textual ligada al audio con estado **sin sincronización verificada**; puede reproducir texto corrido, no pintar una palabra como hablada en un instante inferido. No sintetizar de nuevo sólo para recuperar subtítulos. El operador puede ocultar/mostrar subtítulos sin cambiar audio. En contenido narrado, etiquetar Narrador; en diálogo, hablante confirmado. No mostrar deliberación/tags internos.

## 6. Narrador y fuentes de voz

El narrador es opcional y su canal es público, distinto del reparto. Una narración sólo se sintetiza luego de texto narrativo revisado/publicado y ligado a sus referencias (S02/S03). Puede narrar estado ficticio autorizado según [Narrador y voz en off](../diseno/narrador-y-voz-en-off.md); no pensamientos del modelo ni hechos no confirmados. No crea eventos, no se entrega como percepción al reparto y no genera memoria de actor. Se permite binding propio y revisión de configuración independiente. Narrador apagado no causa una sustitución automática por un personaje.

Para voz existente de proveedor, la interfaz consulta `GET /v2/voices` con paginación y muestra sólo metadatos permitidos por API; exige selección por ID + confirmación del operador. No asumir que campos como `accent`/idioma son evidencia acústica ni que la voz sigue habilitada en futuros requests. Confirmar variedad sigue siendo precondición. La consulta de voz no guarda ni modifica biblioteca remota. [List voices](https://elevenlabs.io/docs/api-reference/voices/search).

## 7. Fang y los gemelos

### 7.1 Fang

Fang no recibe `SpeechBinding` humano ni TTS. Su receta define efectos animales no léxicos. La documentación API actual para generación de sonido es `POST /v1/sound-generation` con `text` requerido, duración opcional entre 0.5 y 30 s, `prompt_influence` opcional de 0–1 y modelo `eleven_text_to_sound_v2` por defecto; la salida es un archivo de efecto. [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert). En la puesta inicial estos efectos están apagados y no se generan por cada acción automáticamente. El operador puede solicitar expresamente generar un efecto desde una descripción original revisada de ladrido, gemido o respiración canina, escuchar, aceptar y guardar un asset de librería del proyecto. No se exige variedad de habla para este efecto. El texto del prompt debe provenir de operador/receta revisada, no de diálogo de Fang.

La asociación de asset a un acontecimiento no verbal requiere que éste esté confirmado, incluya categoría de sonido explícita y sea audible para la vista/canal del observador. Sin acción/categoría, no se solicita SFX. Un sonido no dice “sí”, “no”, ni aporta hechos en idioma humano; no revela intención o emoción como verdad. SFX falla o falta: conservar acción/texto que ya existan y representar estado sonoro faltante. Como propuesta técnica, SFX usa cola y autorización separadas, sin el gate de variedad que aplica a voz española hablada.

La página de documentación enlazada por la investigación usa el slug `/text-to-sound-effects/convert`, pero su contrato actual indica que la llamada es `POST /v1/sound-generation`. Se consigna la ruta HTTP explícita aquí para evitar confundir el enlace documental con el endpoint.

### 7.2 Gemelos de la familia Smart

Los mellizos son dos identidades familiares documentadas, distinguidas como hijo e hija en el dossier compartido [Familia Smart](../personajes/get-smart/familia-smart.md). La aplicación conserva ambas identidades y cualquier ID existente; no las colapsa en una persona única. La evidencia actual no justifica convertirlas en instancias Pi autónomas, asignarles memoria vivida independiente, rasgos vocales individuales ni voces adultas de continuaciones. Si la escena requiere un sonido infantil no léxico, se trata como SFX familiar no atribuido a uno de los dos salvo evidencia/configuración futura explícita, y requiere solicitud del operador. No se inventan nombres ni palabras.

## 8. Ritmo, habla y silencio

La unidad de salida de audio es la publicación textual/sonora ya emitida, no el turno de pensamiento del actor. La actuación puede ser breve, extensa cuando la situación lo necesita, una acción, espera o silencio. No hay mínimo de palabras ni audio silencioso inventado para una pausa. Un fallo de red o TTS es espera técnica con diagnóstico; no se muestra como silencio interpretativo.

La configuración de escena puede declarar presupuestos blandos de longitud, pausa, interrupción, acción o silencio como preferencias de dirección, con origen y nivel (default, propuesta o elección operador). No se fijan cifras universales empíricas en esta spec. Rebasar un presupuesto informa al usuario/revisor y no corta una frase publicada, no rechaza una acción válida por conteo y no inventa cadencia cómica. La guía [Get Smart: ritmo](../investigaciones/get-smart-ritmo-youtube.md) confirma que las cargas localizadas no tenían audio/transcripción interpretable en la investigación; palabras/segundos/velocidad siguen sin medir.

Calibración futura documenta para cada segmento: ID/fuente y versión, escena/episodio cotejado, marcas temporales, hablante y confianza, palabras, función, acción/silencio, solapamiento y confianza. Mantiene clips/compilaciones separadas de episodio íntegro y doblaje autenticado. El baseline de veinte intervenciones en tres escenas es el piso metodológico propuesto por la guía, no un resultado ni representación estadística de la serie. Sólo tras escuchar audio interpretable se registran métricas y se puede revisar defaults; las mediciones no reescriben por sí solas reglas de actuación.

## 9. Cola, cancelación, error y recuperación

### 9.1 Estados

`queued → validating → submitted → response-received → artifact-persisting → ready`; terminales alternativos: `blocked`, `failed`, `cancelled`, `uncertain`, `orphaned`. La UI muestra tipo de trabajo, identidad, publicación/muestra fuente, configuración, posición relativa si se conoce, estado, tiempos, reintentar/descartar y coste reportado/no disponible. La cola de medios nunca ocupa ni reabre una cola de Pi; no genera una nueva versión de diálogo.

- Limitar concurrencia del host y ordenar TTS por número de publicación para reproducir el flujo. El límite es configuración técnica, no SLA del proveedor; no declarar tiempo de espera fijo a partir de latencias no medidas.
- Cancelar detiene reproducción local y señala abort/cancelación al adaptador si el transporte lo soporta. No se promete cancelar una generación que ya inició en ElevenLabs. Una respuesta tardía de una operación cancelada se conserva como `orphaned` si se recibió, no se asigna ni reproduce automáticamente; el operador puede inspeccionarla y descartarla. No se borra la publicación original.
- Timeout antes de saber si el proveedor ejecutó POST queda `uncertain`; no reintentar solo. La UI indica que el proveedor pudo generar/cobrar sin devolver resultado, ofrece reconciliar por historial/listado cuando haya ID/procedencia y requiere nuevo click explícito si no puede determinarse. Requests sin garantía de idempotency key remota no se repiten a ciegas.
- 4xx/5xx, auth/plan/rate limit, formato inesperado, archivo corrupto y disco lleno se presentan como errores del adaptador; no exponen credenciales ni eliminan texto/acción. En fallo de persistencia local tras respuesta, reconciliar artefacto/respuesta antes de pedir otro POST, con `operationId` y huella. La API observada no documenta una clave de idempotencia para estos POST.
- Autorización de TTS, preview, guardado y SFX se separa. Generar preview no autoriza guardar; guardar no autoriza activar audio de una representación; habilitar audio no autoriza previews nuevos.

### 9.2 Persistencia y replay

Antes de request, journal registra operación/id/config y reserva el job. Después de la respuesta, guarda bytes temporalmente, valida formato/size/duración, calcula hash y hace commit de metadatos/archivo antes de publicar estado `ready`. Uso de clave única local: `publicationId + textHash + voiceBindingRevision + modelId + outputFormat` para TTS; una segunda solicitud de operador puede crear un intento explícito pero no pisa artefacto anterior. Para preview: clave propia de solicitud; la selección y guardado son IDs independientes.

La UI posterior a un crash consulta journal, nunca vuelve a emitir POST automáticamente. Si el texto fue publicado pero media quedó `queued/interrupted`, muestra el diálogo y estado del audio como pendiente/fallido, ofrece reintento explícito desde el mismo texto/ID. Si audio está `ready`, abre archivo almacenado sin llamada externa. Si sólo existía un preview, no supone que la voz se guardó. El replay es lectura: reproduce exclusivamente artefactos almacenados del punto temporal seleccionado, no llama a Pi, TTS o SFX; OAuth caducado y credenciales ElevenLabs ausentes no bloquean su inspección.

La retención respeta S02: medios y secretos fuera del repo/ICM/export por defecto. Export/replay indica si los binarios están incluidos, ausentes o excluidos y conserva hash/procedencia. Snapshot no contiene key. No dejar audios temporales de preview en rutas compartidas. Limpieza/retención no puede borrar referencia histórica silenciosamente; marca `artifact-unavailable` preservando texto y metadata.

## 10. Verificación y criterios de aceptación

P21 se divide y evidencia por separado. Los tests locales con fixture no se describen como integración live; una llamada live exitosa no prueba calidad acústica ni calibración de ritmo.

| Nivel | Comprobación requerida | Qué demuestra / qué no |
|---|---|---|
| Unitario/local | Validación de variedad, límites y procedencia de muestra/descripción, estado de selección, modelo y schema; texto TTS idéntico al publicado; gates de secreto; validación de respuesta/base64/alignment; subtítulos y hashing; event/publication link; orden/dedupe; cola y transiciones; error, timeout `uncertain`, cancel tardía, reinicio/replay; Fang no verbal; gemelos sin actor/voz. Todo con fixtures/mocks explícitos. | Demuestra dominio/adaptador local y UX/control. No demuestra endpoint, entitlement, billing, voz real, calidad de acento o audio. |
| Integración live | Bajo credencial y cuenta controlada, una solicitud manual de Voice Design con texto original del operador y variedad ya confirmada; comprobar preview real, elección, guardado separado y `voice_id`; TTS de una publicación de prueba con alignments y playback; error/recuperación sin regeneración de diálogo. SFX de Fang se prueba en llamada separada sólo si se configura/selecciona esa capacidad. Registrar fecha/modelos/operación/costes devueltos/IDs sanitizados y artefactos, sin clave. | Demuestra la conexión y resultado de esa ejecución. Requiere operación real de cuenta; SFX live no bloquea cierre si la capacidad no se selecciona. No es parte de este draft y aquí no se ejecutó generación ni gasto. |
| Acústico/corpus | Escuchar previews y síntesis final con operador; verificar inteligibilidad y variedad elegida, diferenciación, ritmo y comportamiento para más de una intención; luego localizar y anotar corpus conforme §8, incluido cotejo de episodio completo/audio de doblaje. | Demuestra evaluación auditiva del material inspeccionado, no fidelidad global a los 138 episodios. Calibración de YouTube sigue pendiente: no se midió audio en la investigación vigente. |
| GUI E2E | Completar preparación/confirmación de variedad, abrir ficha, introducir muestra original, solicitar previews, oír y escoger una, guardar voz, validar binding, publicar diálogo, obtener subtítulo/audio, apagar/reabrir puesta y hacer replay con servicio caído. Casos de voz faltante, no confirmación, costo/plan denegado, cancelación y narrador apagado. | Demuestra el flujo funcional visible completo; fixture GUI no reemplaza gate live. |

Aceptación semántica mínima:

1. Sin variedad confirmada, el contador de llamadas live queda en cero para Voice Design/TTS y UI explica bloqueo. Un SFX no lingüístico sólo puede solicitarse por su autorización administrativa separada.
2. Sin texto de muestra aportado/seleccionado por operador, no hay request Voice Design. Se envía exactamente la muestra mostrada, con `auto_generate_text=false`; ninguna línea de `obra/` se envía automáticamente.
3. Se reciben N previews y se pueden reproducir de forma independiente; guardar permanece deshabilitado hasta selección explícita. Tras guardado, se distingue `generated_voice_id` de `voice_id` y el binding apunta al segundo.
4. El texto de una publicación que pasa a TTS conserva exactamente hash/versión; una aprobación sin publicación no crea audio. Error del proveedor no retira palabras/efecto ya confirmado ni vuelve a llamar al actor.
5. Subtítulos están sincronizados sólo si hay alineación válida. Replay sólo lee/reproduce artefactos guardados, aun sin OAuth ni secreto de ElevenLabs.
6. Fang sólo dispone de efectos no léxicos autorizados; gemelos siguen entidad no agente y no reciben habla adulta ni memoria individual inventada.
7. Una operación incierta no se reenvía automáticamente; una cancelada no modifica el evento/texto y una respuesta tardía no se asocia sin resolución explícita.
8. No se declaran medidas de ritmo, preview, voz guardada, prueba live o calidad acústica sin sus evidencias respectivas.

## 11. Contratos de proveedor verificados y límites

Consulta de fuentes primarias ElevenLabs realizada el **14 de octubre de 2026** para esta spec. El adapter debe volver a verificar rutas, permisos, límites/formatos y modelo soportado contra documentación/tipos actuales al implementarse; no asumir que un default remoto permanecerá estable.

| Operación | Contrato de referencia actual | Uso en S06 |
|---|---|---|
| Diseño Voice Design | `POST /v1/text-to-voice/design`; `voice_description` 20–1000 chars, `text` 100–1000 si se usa; `model_id` TTV v2 o TTV v3; response previews array con `generated_voice_id`, base64 audio y metadatos. | Request host-only, muestra operador obligatoria para el producto, lista dinámica. [API](https://elevenlabs.io/docs/api-reference/text-to-voice/design). |
| Guardar preview | `POST /v1/text-to-voice` con `voice_name`, `voice_description`, `generated_voice_id`; response `voice_id`. | Sólo después de elección y confirmación separada. [API](https://elevenlabs.io/docs/api-reference/text-to-voice/create). |
| Modelos y lengua | `GET /v1/models`; cada modelo puede exponer `can_do_text_to_speech` y lista `languages`. TTS admite `language_code` ISO 639-1, pero la documentación advierte que puede ignorarse si no es compatible y no se admite en multilingual v2. | Validar `es` y capacidad antes de habilitar binding; no confiar en un código ignorado. La variedad regional se valida escuchando la muestra. [API](https://elevenlabs.io/docs/api-reference/models/list), [TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). |
| TTS con timing | `POST /v1/text-to-speech/{voice_id}/with-timestamps`; devuelve audio base64 + alineación y alineación normalizada por carácter. | Método preferido para artefacto y cues de subtítulo. [API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). |
| TTS sin timing | `POST /v1/text-to-speech/{voice_id}`; devuelve archivo audio; default de `model_id` documentado es Multilingual v2. | Alternativa explícita si la función con timing no está disponible; modelo configurado siempre explícito. [API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). |
| Efectos | `POST /v1/sound-generation`; `text` requerido, `duration_seconds` opcional 0.5–30, modelo por defecto `eleven_text_to_sound_v2`, salida MP3. | SFX separado, nunca TTS. La URL enlazada es la página de docs, no el path de request. [API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert). |

La documentación API marca header `xi-api-key` como opcional en algunos schemas; la app no interpreta eso como llamada anónima ni transmite credenciales al browser. El proveedor puede exigir autenticación/plan por otro mecanismo y eso debe verificarse en integración. Las fuentes citadas no definen cancelación remota ni idempotencia para operaciones `POST`; esta spec no promete ninguna. La documentación de Voice Design retorna un array, mientras la guía de interfaz recomienda tres previews; se implementa sobre el array real, sin depender de cardinalidad fija.

## 12. Trazabilidad, decisiones y evidencia pendiente

- La guía de Voice Design recomienda tres previews; el schema oficial vigente tipa `previews` como lista sin fijar cardinalidad. No se contradicen como resultados posibles; la interfaz muestra exactamente el número que retorna la API.
- La URL de documentación de Sound Effects usa el slug `/text-to-sound-effects/convert`; el endpoint HTTP declarado en esa página es `POST /v1/sound-generation`. Es una URL de docs y una ruta de request distintas, no un enlace roto.
- Decisión reversible del integrador registrada en esta spec: audio apagado en puesta nueva; al habilitar, TTS automático sólo para publicaciones futuras, con modo manual disponible, reproducción siempre bajo gesto y sin backfill. No es una preferencia atribuida a la persona usuaria.
- VOZ-03 exige receta de Fang como efectos. La creación live de SFX queda como complemento opcional y explícito; sólo se incluye en gate live si se configura/selecciona, sin convertirla en bloqueo del producto cuando no se usa.
- La calibración acústica está pendiente de acceso y escucha de YouTube; recetas y fixtures no la sustituyen. No se autoriza en este borrador ningún request a ElevenLabs ni se incurre en gasto.

## Readiness efectiva y admisión local

El preflight consulta `VoiceRuntime.readPreflightReadiness` local, sin importar configuraciones, generar artefactos ni llamar al proveedor. La configuración sonora efectiva tiene precedencia sobre el audio inicial congelado para esta comprobación. La evidencia de habla enlaza aceptación, prueba congelada, escucha, procedencia y bytes; una referencia histórica sin ese enlace requiere validación nueva. SFX exige su asset/aceptación exactos. Credencial presente significa sólo disponibilidad local, no acceso live probado.

La admisión de start/resume/step vuelve a evaluar esa evidencia de manera síncrona justo antes del CAS de lifecycle, sin intercalar awaits. Así, cambiar configuración sonora, credencial o prueba después de un preflight no habilita un inicio con datos anteriores. Replays conservan el recibo; pausa/stop/close no dependen de este gate. El panel permite modo/slots/cuotas y conciliación explícita de base sin sintetizar; [evidencia del corte 42](../auditoria/audio-preparacion-y-admision.md).
