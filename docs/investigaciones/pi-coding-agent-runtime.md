# Pi Coding Agent como runtime de los actores

Cambio posterior del usuario: las referencias originales a Luna/xhigh en esta investigación son un corte histórico, no la configuración vigente. Las representaciones nuevas guardan el perfil seleccionado: Sol 6.1 bajo por defecto o Opus 5.5 medio, con acceso propio por proveedor, según [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md). Los ejemplos y comprobaciones específicas de Luna sólo documentan la investigación inicial; el runtime debe resolver el perfil durable elegido por la representación.


Fecha de investigación: **14 de octubre de 2026**. Estado: investigación documental y revisión de código; ejemplo de integración propuesto, **sin instalar ni ejecutar Pi, ICM o un modelo**.

## 1. Resultado y alcance

La propuesta del usuario es viable: cada actor puede tener una sesión del **SDK de Pi Coding Agent**, un prompt de identidad propio y un conjunto seleccionado de herramientas de memoria y mundo. Pi aporta el ciclo de conversación, llamadas a herramientas, streaming y sesiones. El proyecto debe aportar el mundo, la percepción, la identidad, la memoria subjetiva, la dirección dramática y las reglas de acceso. Una sesión de Pi no equivale, por sí sola, a un personaje completo. [SDK][sdk], [opciones del SDK][sdk-source].

La implementación decidida usa **una instancia independiente de Pi por personaje, mediante el SDK**, con prompt, contexto, historial, herramientas y memoria propios. No se trata de una sola instancia que cambia de personaje. Un coordinador propio marca el pulso y la activación; RPC queda como alternativa para separar procesos. La decisión inicial de modelo era **OpenAI Codex mediante login OAuth, Luna 6 y `xhigh`** para cada agente. Una decisión posterior la reemplazó por Sol 6.1 `low` predeterminado u Opus 5.5 `medium`, según [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md). No se autoriza sustituir el perfil seleccionado silenciosamente.

Este documento distingue:

- **Verificado:** interfaces y comportamiento encontrados en fuentes oficiales y código de una versión concreta.
- **Propuesto:** la adaptación de esas interfaces a esta obra; aún no es código ejecutable del proyecto.
- **Pendiente de validar:** acceso de la cuenta al modelo, ejecución real, latencia, coste, aislamiento y comportamiento dramático.

Se utilizó la skill `find-docs`: primero `ctx7 library`, después `ctx7 docs /earendil-works/pi`. Los fragmentos indexados ayudaron a localizar las fuentes; las firmas se contrastaron con el código oficial porque varios ejemplos antiguos tienen APIs diferentes.

## 2. Identidad del proyecto, versión y cambios de nombre

El repositorio que se conocía como `badlogic/pi-mono` **redirige oficialmente a `earendil-works/pi`**. El cambio no significa que se esté proponiendo un producto distinto. El autor que figura en el paquete continúa siendo Mario Zechner. [Repositorio][repo], [manifiesto fijado][package].

| Referencia consultada | Resultado al 14/10/2026 |
| --- | --- |
| Paquete mencionado originalmente | `@mariozechner/pi-coding-agent`, etiqueta npm `latest`: `0.73.1` |
| Paquete actual oficial | `@earendil-works/pi-coding-agent`, etiqueta npm `latest`: `1.2.0` |
| Versión fijada para leer código y ejemplos | `v1.2.0` |
| Commit de esa versión | `06a466935536f8c9bcacb2d5efc0fc021be1bdff`, 12/10/2026 22:46:55 UTC |
| `main` observado, no usado como contrato del ejemplo | `2688aba7dc177020ef5da5492a966ed28ad619bd`, 14/10/2026 05:34:14 UTC |
| Runtime declarado por `1.2.0` | Node.js `>=22.19.0`; documentación también contempla Bun |
| Licencia del repositorio y paquete | MIT |

Fuentes de versión: [npm del paquete antiguo][npm-old], [npm del paquete actual][npm-new], [referencia Git de la versión][release-ref], [commit][release-commit]. Son observaciones fechadas, no una promesa de que `latest` permanezca igual.

No mezclar ejemplos de versiones: en el SDK actual se suministra `modelRuntime`; el ejemplo vigente selecciona herramientas con `tools: string[]`. Fragmentos anteriores usan `AuthStorage`, `ModelRegistry`, listas de objetos herramienta o firmas diferentes de `execute`. La versión actual además exporta `Type` desde `@earendil-works/pi-ai` y `defineTool` desde el paquete del agente. [Modelo de ejemplo][model-example], [herramientas de ejemplo][tools-example], [herramienta mínima oficial][hello-example].

Los posibles forks locales del usuario no fueron elegidos ni auditados como sustituto del upstream. Cualquier adopción de un fork debe comparar sus APIs con esta referencia antes de copiar el ejemplo.

## 3. Decisión inicial de conexión y perfil: Codex, Luna 6 y `xhigh` (histórica)

Esta sección registra la elección original del usuario y las fuentes técnicas de ese corte. Para nuevas representaciones, el perfil vigente es Sol/low o Opus/medium, según ADR0003. La fila Luna no habilita nuevas inferencias ni fallback. Codex OAuth es la ruta del perfil Sol; Opus usa acceso propio de Anthropic.

| Estado en este proyecto | Proveedor Pi | Modelo | API registrada | Esfuerzo verificado en el catálogo |
| --- | --- | --- | --- | --- |
| Elección inicial; reemplazada para nuevas representaciones | `openai-codex` | `gpt-6-luna` | `openai-codex-responses` | `thinkingLevelMap.xhigh = "xhigh"` |
| Comparación; no se selecciona automáticamente | `openai` | `gpt-6-luna` | `openai-responses` | `thinkingLevelMap.xhigh = "xhigh"` |

Las fuentes son las páginas individuales [Luna en OpenAI][pi-luna] y [Luna en OpenAI Codex][pi-luna-codex]. El proveedor `openai-codex` aparece como **legacy** en el código `1.2.0`, pero esa etiqueta no modifica la elección explícita del usuario. El runtime debe preservar esa ruta y avisar si deja de funcionar. Su implementación registra autenticación OAuth de suscripción y la API `openai-codex-responses`. No se sustituye por una API key, por el proveedor `openai` ni por credenciales extraídas de otra aplicación. [Proveedor OpenAI Codex][codex-provider].

La documentación oficial consultada en aquel corte confirma `xhigh`. Para utilizar herramientas con razonamiento en Luna se debe usar **Responses**: function calling en Chat Completions está limitado a esfuerzo `none`. Estos datos describen la ruta inicial de Luna y no seleccionan el modelo actual. [Ficha oficial de GPT-6 Luna][openai-luna].

Pi ajusta el esfuerzo solicitado a las capacidades declaradas por el modelo. Por eso `thinkingLevel: "xhigh"` **no basta como comprobación**. Antes de ejecutar y después de reemplazar o recargar una sesión se deben verificar el identificador, proveedor, API, mapeo declarado por el catálogo y nivel efectivo. El ejemplo comprueba `model.thinkingLevelMap?.xhigh === "xhigh"` y `session.thinkingLevel === "xhigh"`. Ante ausencia o incompatibilidad, detener ese agente e informar la configuración pendiente. No tomar el primer modelo disponible. [Creación y ajuste del esfuerzo][sdk-source], [métodos de la sesión][session-source], [tipo del modelo][model-types].

El catálogo de modelos puede actualizarse independientemente del paquete. Además, la página de Pi consultada declara una ventana de contexto de 272.000 tokens, mientras la ficha OpenAI anuncia hasta 1.050.000. No se modificó manualmente el límite: para el runtime se debe respetar la capacidad efectiva configurada y validar cualquier ampliación. Guardar junto a cada ejecución proveedor, modelo, esfuerzo, versión de Pi y revisión de configuración. No se hicieron llamadas para probar disponibilidad ni se inspeccionaron credenciales.

### 3.1 Login de Pi: flujo verificado y custodia

El flujo interactivo documentado se inicia **dentro de la terminal de Pi** con `/login openai-codex`. No es una tool del personaje ni una llamada `prompt()` de la ficción. El proveedor ofrece login en navegador y login por código de dispositivo para entornos sin navegador local. La ruta de navegador usa PKCE, callback local en el puerto 1455 y permite introducir el código o URL de retorno si el callback no llega; el código de dispositivo tiene su propio flujo de confirmación humana. No es necesario implementar OAuth desde cero. [Proveedores][providers-doc], [slash commands][slash-doc], [implementación OAuth Codex][codex-oauth].

En el SDK, `ModelRuntime.login(providerId, type, interaction, options?)` delega el login al proveedor y persiste la credencial obtenida. La interfaz `AuthInteraction` requiere `prompt(...)` y `notify(...)`, y acepta un `AbortSignal`. Esos callbacks pertenecen a la interfaz administrativa humana: presentan selección, URL/código de acceso y cancelación. No se envían al modelo. Esta función ilustra el punto de integración, sin implementar la UI ni ejecutar el login:

```ts
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function loginHostWithCodex(
  privateAuthPath: string,
  humanLoginUi: AuthInteraction,
) {
  const modelRuntime = await ModelRuntime.create({ authPath: privateAuthPath });
  await modelRuntime.login("openai-codex", "oauth", humanLoginUi);
  const authStatus = await modelRuntime.checkAuth("openai-codex");
  if (authStatus?.type !== "oauth") throw new Error("Login OAuth de Codex pendiente");
  return modelRuntime;
}
```

`privateAuthPath` es una ruta de almacenamiento privado del host, fuera del repositorio y de `obra/`. La función y nombres de parámetros son nuestros; `ModelRuntime.create`, `login`, `checkAuth` y `AuthInteraction` son interfaces verificadas. El valor sensible que devuelve `login` se ignora; nunca se registra en logs, memorias o Markdown. `checkAuth` comprueba configuración y tipo de autenticación, **sin probar una inferencia ni renovar por sí mismo OAuth**. El acceso efectivo debe validarse para el perfil y proveedor que la representación haya guardado; la validación específica de gpt-6-luna de este estudio pertenece al corte inicial. [Runtime de autenticación][model-runtime-source], [contratos de autenticación][auth-types], [orquestación de modelos][models-source].

El almacén predeterminado del agente es `~/.pi/agent/auth.json`; `PI_CODING_AGENT_DIR` permite cambiar el directorio, y el SDK admite `authPath` explícito. CLI y SDK deben apuntar al mismo almacén elegido si se hace el login en la terminal y después se utiliza el SDK. El archivo contiene credenciales OAuth en JSON, no una bóveda cifrada. El código crea archivos con modo `0600` y directorios nuevos con `0700`; esos modos de creación no corrigen permisos de archivos o directorios preexistentes. Mantenerlo fuera del control de versiones, de las herramientas de los actores y de sus bases de memoria. [Almacenamiento de credenciales][auth-storage], [variables de entorno][environment-doc].

Pi resuelve la autenticación y renueva tokens mediante su infraestructura de credenciales, con bloqueo para coordinar actualizaciones. Compartir la identidad OAuth del host no exige compartir conversaciones: varias instancias pueden utilizar el mismo almacén de credenciales sin copiar tokens a cada ficha y **sin un login humano por personaje**. No asumir cuotas independientes por actor. Si la renovación falla, conservar el actor detenido y mostrar la necesidad de volver a conectar; no reemplazar silenciosamente OAuth por otra ruta. [Contratos de credenciales][auth-types], [resolución y persistencia de autenticación][models-source].

`/logout` elimina la credencial almacenada por Pi; la documentación aclara que no equivale por sí solo a revocarla ante el proveedor. El código/URL del login se presenta únicamente en la UI humana administrativa mientras dure el flujo. En esta investigación no se inició login, no se leyó ningún `auth.json` local y no se instaló Pi.

## 4. SDK, CLI y RPC

| Modalidad | Qué ofrece | Encaje en la obra |
| --- | --- | --- |
| SDK embebido | `createAgentSession`, métodos tipados y eventos dentro del proceso Node/Bun | Opción principal para componer actor, memoria y herramientas de mundo |
| CLI interactiva | Interfaz de terminal de Pi | Útil para desarrollo; no es la interfaz del espectador de la obra |
| CLI print / JSON | Ejecución automatizada y salida textual o eventos | Ensayos o tareas acotadas; no sustituye al coordinador del mundo |
| RPC | Proceso persistente controlado mediante JSONL en stdin/stdout | Alternativa cuando convenga separar procesos o usar otro lenguaje |

El SDK devuelve una `AgentSession`; `prompt()` espera la finalización del trabajo aceptado, mientras `subscribe()` permite observarlo. El host controla su vida útil y debe llamar a `dispose()` cuando termine de usarla. Si usa `AgentSessionRuntime` para cambiar, bifurcar o importar sesiones, debe volver a conectar sus suscripciones a la nueva instancia. [SDK][sdk], [runtime de sesiones][runtime-source].

En RPC una respuesta exitosa a `prompt` **sólo confirma aceptación, encolado o manejo**. No confirma que el personaje terminó de actuar. El cliente debe consumir eventos, correlacionar respuestas mediante `id`, separar los registros por LF, atender la contrapresión y manejar cierres inesperados. `agent_settled` es la señal apropiada de que no queda continuación automática; `agent_end` puede preceder reintentos o recuperación. [Protocolo RPC][rpc].

Un proceso por actor reduce interferencias de memoria del runtime, pero no es una barrera de permisos: procesos con acceso a los mismos archivos y credenciales siguen pudiendo alcanzarlos. Si se necesita aislamiento del sistema operativo, se configura fuera de la personalidad del personaje. El propio proyecto Pi documenta que no trae un sistema general de permisos para restringir filesystem, procesos, red o credenciales. [README oficial][repo].

### 4.1 Instancias independientes y coordinador de pulso

Cada llamada a la fábrica de actores del ejemplo crea una **instancia nueva de `AgentSession`**, su cargador de recursos, sus herramientas enlazadas al actor y su manager de sesión. Para un reparto de N personajes habrá N instancias de actor. Ninguna instancia interpreta varios personajes alternando el system prompt o reutilizando su conversación. El director y el moderador, si se implementan como agentes, también tienen instancias propias y contextos diferentes.

La identidad técnica que autentica las llamadas puede compartirse mediante el servicio de modelos/credenciales del host. Eso no comparte la identidad ficticia ni sus recuerdos. El `ModelRuntime` inyectado administra proveedor y autenticación; las conversaciones y herramientas pertenecen a cada instancia de actor. Si se necesita separar más el estado técnico, cada instancia puede tener un `ModelRuntime` propio que consulte el mismo almacén privado de OAuth. El requisito del usuario es **instancia distinta**, no necesariamente un proceso del sistema operativo o un contenedor por personaje.

El coordinador mantiene el reloj de la obra, despierta a los actores habilitados por el pulso, entrega sus percepciones y limita concurrencia de inferencias. Un personaje dormido o sin un evento relevante puede esperar; no hace falta invocar N modelos en cada tick gráfico. El coordinador también ordena el compromiso de efectos por la autoridad del mundo: dos intentos incompatibles se resuelven allí. No redacta las decisiones privadas de los personajes ni usa una única sesión como reemplazo de ellos.

El director interpreta la progresión dramática; el coordinador programa y entrega trabajo. Se pueden componer ambos servicios en una aplicación, pero sus responsabilidades y autoridad se mantienen distinguibles. Todo rol implementado como agente LLM usa el perfil elegido por representación. Los ejemplos de este estudio que nombran `openai-codex`, `gpt-6-luna` y `xhigh` pertenecen a la decisión original. Si el coordinador es un planificador determinista no necesita una llamada al modelo para cada pulso.

## 5. System prompt, contexto y recursos Markdown

### 5.1 Lo que admite Pi

`DefaultResourceLoader` permite `systemPromptOverride`, `appendSystemPromptOverride`, `agentsFilesOverride`, selección de skills y extensiones. Hay que invocar `await loader.reload()` antes de pasarlo al SDK. Otra opción, más explícita para personajes, es suministrar un `ResourceLoader` propio que devuelva únicamente recursos autorizados. [Ejemplo de prompt][prompt-example], [cargador de recursos][loader-source], [ejemplo de control completo][full-example].

`session.systemPrompt` es una propiedad de lectura del prompt efectivo; **no es el punto de configuración por asignación**. Reemplazar el preámbulo con `systemPromptOverride` tampoco suprime por sí solo todos los añadidos: el constructor puede incorporar `APPEND_SYSTEM.md`, contexto de proyecto y la sección `cwd`. El código lo muestra incluso para un preámbulo personalizado. Usar directorios técnicos neutros y revisar el prompt efectivo. Para necesitar texto opaco exactamente controlado, la extensión puede devolver `systemPrompt` en `before_agent_start` o emplear `forceSystemPrompt`, según el contrato de esa versión. [Construcción del prompt][prompt-source], [contratos de extensiones][extensions].

La carga automática estándar busca recursos del proyecto y del usuario. Para la ficción eso puede filtrar documentación del director, prompts de programación o información de otros personajes. La propuesta es **ensamblar el contexto desde el host**: la existencia de un Markdown no concede al actor permiso para leerlo.

### 5.2 Separación propuesta para esta obra

| Contenido | Ubicación funcional | Quién lo recibe |
| --- | --- | --- |
| Identidad estable, forma de hablar y reglas de interpretación | Prompt autorizado del actor, compilado desde Markdown | Ese actor |
| Biografía completa conocida y expediente | Documentos de personaje; selección contextual según escena | Actor correspondiente; observador sólo según su interfaz |
| Recuerdos relevantes y creencias | Recuperación de memoria subjetiva | Ese actor, con procedencia y grado de certeza |
| Situación actual | Proyección del estado del mundo y percepciones | Sólo quienes puedan percibirla |
| Intención global y diagnóstico dramático | Contexto privado del director | Director y operador autorizado |
| Permisos de herramientas y validez de acciones | Código del host y servicios de dominio | Se aplican independientemente de lo que diga el actor |

El expediente exhaustivo permanece disponible como fuente. No debe pegarse entero en cada turno si incluye información irrelevante o que el personaje todavía no conoce. La selección tiene que preservar motivos, contradicciones y continuidad, sin sustituir al personaje por una lista de rasgos.

El esquema **ICM en Markdown** organiza contexto interpretable y rutas de lectura; **ICM Memory con SQLite** es otra implementación para conservar y recuperar memorias. Comparten sigla, pero no deben tratarse como una sola biblioteca ni como una integración ya instalada. Ver [investigación de ICM Markdown](icm-contexto-interpretable.md) y [estudio de ICM Memory](icm-memory-sqlite.md).

### 5.3 Skills que puede usar el modelo

Pi admite directorios `SKILL.md` con nombre y descripción, incluyendo `.agents/skills` del proyecto. La descripción sirve para que el modelo determine cuándo cargar instrucciones; el cuerpo se recupera después. `disable-model-invocation: true` las oculta de selección automática. Estos mecanismos ayudan a adaptar las skills solicitadas a un formato portable, pero no ejecutan automáticamente todas las skills en cada turno. [Skills de Pi][skills].

Hay una particularidad concreta para nuestro diseño: la construcción del prompt consultada sólo incorpora el catálogo de skills si dispone de `read` o `bash`, incluso si el lector es indirecto. Un actor deliberadamente limitado a herramientas de mundo **no debe recibir `bash` sólo para descubrir skills**. El host puede preseleccionar instrucciones autorizadas y compilar su contenido en el contexto, o implementar un acceso a instrucciones acotado y explicitarlo en su prompt. Las skills de desarrollo del repositorio pertenecen a los agentes que construyen el sistema; no se convierten sin revisión en saberes de Maxwell Smart. [Código de skills en el prompt][prompt-source].

## 6. Herramientas de acción: seleccionar, ejecutar y validar

En `1.2.0`, `customTools` registra definiciones adicionales y `tools` decide cuáles están activas inicialmente. `noTools: "builtin"` suprime las herramientas predeterminadas conservando las custom/de extensiones; `noTools: "all"` y una lista vacía comienzan sin herramientas. Una allowlist explícita es más clara para cada personaje. **Registrar herramientas propias sin quitar las predeterminadas no elimina `read`, `bash`, `edit` y `write`.** [Interfaz de creación][sdk-source].

Además, si se carga MCP, algunas herramientas pueden permanecer registradas para descubrimiento o invocación indirecta aunque no sean declaraciones directas. No conceder `codemode`, `tool_search` o extensiones ambientales a un actor por accidente. El ejemplo siguiente no carga MCP ni extensiones de filesystem. Verificar el conjunto efectivo tras creación y recarga. [SDK y MCP][sdk], [tipos de herramienta][tool-types].

La firma confirmada es:

```ts
execute(toolCallId, params, signal, onUpdate, ctx)
```

Recibe parámetros validados por esquema, puede emitir actualizaciones y devuelve `content` para el modelo más `details`. Para resultados estructurados admite `outputSchema` y `structuredContent`. Un fallo lanzado por la herramienta se transforma en resultado de error. Las anotaciones de seguridad describen intenciones; no sustituyen comprobaciones. [Definición TypeScript][tool-types], [ejemplo oficial][hello-example].

**Catálogo propuesto para la obra:** percibir, desplazarse, hablar, manipular un objeto autorizado, consultar recuerdos y proponer una nueva memoria. Cada capacidad se asigna por composición a un actor. El receptor real de una herramienta conoce la identidad del actor por su registro interno, no por un `actorId` suministrado por el modelo. El actor propone; el mundo verifica ubicación, posesión, acceso, tiempo y consecuencias, y devuelve un resultado. Decir «lo convencí» no escribe la decisión del otro personaje.

La escritura de memoria debe aceptar experiencias y creencias atribuidas, no autorizar al modelo a reescribir el canon o su identidad central. Una mentira o una persuasión humana pueden producir un recuerdo legítimo —«X me dijo Y»— sin convertir Y en un hecho verdadero del mundo.

## 7. Ejemplo mínimo de integración por composición

**Vigencia del ejemplo:** este fragmento conserva el perfil histórico Luna/xhigh para ilustrar la forma del SDK; no sirve como configuración de una representación nueva. En el sistema vigente, el host resuelve el perfil guardado por la representación y exige que proveedor, modelo, autenticación y nivel de razonamiento coincidan, sin sustitución automática. Los valores actuales están en el [ADR de perfiles](../adr/0003-perfiles-de-inferencia-seleccionables.md).

El ejemplo **no fue ejecutado ni compilado en el repositorio**. Los símbolos y firmas de Pi se contrastaron con `v1.2.0`. `ActorMemory` y `ActorWorld` son interfaces **propuestas de nuestro host**, no APIs existentes de ICM o Pi. El host les entrega implementaciones ya ligadas a un único actor y, cuando haya bifurcaciones, a una rama de la obra.

```ts
import { Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  type ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

// Puertos propios. Sus implementaciones hacen autorización y traducción a ICM/mundo.
type ActorMemory = {
  recall(query: string, signal?: AbortSignal): Promise<string>;
};
type ActorWorld = {
  say(text: string, toolCallId: string, signal?: AbortSignal): Promise<string>;
};

export async function createActorSession(input: {
  cwd: string;
  privateSystemPrompt: string;
  modelRuntime: ModelRuntime;
  memory: ActorMemory;
  world: ActorWorld;
}) {
  const provider = "openai-codex";
  const authStatus = await input.modelRuntime.checkAuth(provider);
  if (authStatus?.type !== "oauth") {
    throw new Error("El host requiere login OAuth de OpenAI Codex");
  }
  const model = input.modelRuntime.getModel(provider, "gpt-6-luna");
  if (!model) throw new Error("Luna 6 no está en el catálogo configurado");
  const expectedApi = "openai-codex-responses";
  if (model.api !== expectedApi || model.thinkingLevelMap?.xhigh !== "xhigh") {
    throw new Error("API o mapeo de razonamiento de Luna incompatible");
  }

  const recall = defineTool({
    name: "recall_memory",
    label: "Recordar",
    description: "Recupera recuerdos propios; conserva su procedencia y dudas.",
    parameters: Type.Object({ query: Type.String({ minLength: 1 }) }),
    executionMode: "sequential",
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const text = await input.memory.recall(params.query, signal);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  const say = defineTool({
    name: "say",
    label: "Hablar",
    description: "Propone decir algo; el mundo decide quién puede oírlo.",
    parameters: Type.Object({ text: Type.String({ minLength: 1 }) }),
    executionMode: "sequential",
    async execute(id, params, signal) {
      signal?.throwIfAborted();
      const text = await input.world.say(params.text, id, signal);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  // Adaptación del ejemplo oficial full-control: sin descubrimiento ambiental.
  const extensionRuntime = createExtensionRuntime();
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({
      extensions: [], errors: [], runtime: extensionRuntime,
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => input.privateSystemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };

  const names = ["recall_memory", "say"];
  const { session } = await createAgentSession({
    cwd: input.cwd,
    model,
    modelRuntime: input.modelRuntime,
    thinkingLevel: "xhigh",
    tools: names,
    customTools: [recall, say],
    resourceLoader,
    sessionManager: SessionManager.inMemory(input.cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });

  const actualNames = session.getActiveToolNames();
  if (session.model?.id !== "gpt-6-luna"
      || session.model?.provider !== provider
      || session.thinkingLevel !== "xhigh"
      || actualNames.length !== names.length
      || names.some((name) => !actualNames.includes(name))) {
    session.dispose();
    throw new Error("La sesión no conserva el modelo, esfuerzo o herramientas requeridos");
  }
  return session;
}
```

Las importaciones y patrones se basan en [full-control][full-example], [defineTool][hello-example], [CreateAgentSessionOptions][sdk-source] y [ResourceLoader][loader-source]. `modelRuntime` lo suministra el host ya autenticado por login OAuth de Codex. La comprobación de tipo de autenticación no prueba acceso efectivo al modelo: falta la prueba real autorizada de conexión. Cada invocación de `createActorSession` recibe prompt, memoria y acceso al mundo de **un solo personaje**, y devuelve una instancia independiente; el coordinador conserva un registro de esas instancias y les entrega turnos sin intercambiar sus contextos.

El ejemplo usa memoria de sesión volátil para aislar el concepto. Para continuidad real, sustituir el manager por uno persistente con directorio específico del actor y conservar la correspondencia entre sesión y rama de la obra. La compactación se desactiva aquí para no introducir un resumen automático adicional; una aplicación continua necesita una política explícita de presupuesto y compactación. No es una recomendación de acumular contexto sin límite.

`say` recibe el ID de la llamada sólo como parte del mecanismo de deduplicación. La implementación de mundo debe combinarlo con la identidad interna de sesión, actor y rama, y devolver recibos idempotentes. El simple ejemplo no implementa esa transacción ni la moderación. El texto libre final del modelo no se publica automáticamente como un hecho o un diálogo: lo que ocurre en el mundo se confirma por la herramienta correspondiente.

Para entregar un parlamento humano ya validado como acontecimiento perceptible:

```ts
const unsubscribe = session.subscribe((event) => {
  if (event.type === "message_update"
      && event.assistantMessageEvent.type === "text_delta") {
    // Vista de preparación para el observador; no confirma una acción del mundo.
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await session.prompt(humanUtteranceAsWorldObservation, {
    expandPromptTemplates: false,
  });
} finally {
  unsubscribe();
  // session.dispose() al retirar al actor; conservarla entre turnos de la obra.
}
```

`humanUtteranceAsWorldObservation` es contenido producido por nuestro host, no una variable exportada por Pi. Desactivar expansión evita que una línea humana comenzada con `/` se interprete como plantilla o comando de extensión en esa ruta de `prompt()`. No bloquea por sí solo instrucciones maliciosas en lenguaje natural. [Implementación de `prompt`][session-source].

## 8. Adaptador ICM Memory sobre SQLite

La investigación paralela verificó `rtk-ai/icm`, commit `5f402434919e514109a95c6cf504427fbcef851f`, versión CLI declarada `0.11.4`. Su documentación señala la extensión TypeScript de Pi como **TBD**; generar instrucciones o prompts para Pi no equivale a tener hooks automáticos de memoria. Ver los detalles y límites en [ICM Memory y SQLite](icm-memory-sqlite.md), [referencia upstream][icm-reference] y [CLI upstream][icm-cli].

La integración inicial propuesta usa un proceso ICM controlado por el host para consultar **una DB de actor fijada por configuración**. El comando documental verificado es:

```text
ICM_DB_BACKEND=sqlite icm --db /ruta/privada/del/actor/memory.db --no-embeddings --read-only recall CONSULTA --format json --limit 5
```

No interpolar `CONSULTA` en un shell. El adaptador debe invocar el ejecutable con un array de argumentos, validar tamaño y plazo, propagar cancelación, comprobar salida y transformar el JSON a recuerdos con procedencia. Debe fijar `ICM_DB_BACKEND=sqlite` en el entorno del proceso hijo: si hereda un backend remoto, `--db` deja de asegurar el corpus esperado. La ruta de DB y los límites no son argumentos seleccionables por el modelo. `--read-only` evita que la consulta actualice decay y contadores; `--no-embeddings` permite una primera conexión sin añadir un proveedor de embeddings. La calidad de recuperación debe medirse antes de decidir si se incorporan embeddings.

Los filtros de proyecto o tópico son útiles para organizar recuerdos, pero no constituyen una ACL entre personajes. El patrón recomendado es una DB por actor —y una estrategia explícita por rama— o un servicio intermediario que aplique una separación equivalente. La ficha central y los secretos del director no se indexan en esa DB como si el actor los hubiera vivido.

La memoria nueva se incorpora tras un evento confirmado o como una interpretación atribuida del actor. Conservar `observación`, `testimonio`, `inferencia` y `creencia` como categorías de nuestro dominio; la persistencia de una frase no la valida como verdad. Para mantener coherencia ante una caída entre el evento y la escritura de memoria, el mundo conserva una cola de proyecciones pendiente de aplicar y reintenta sin duplicar.

El tiempo de ICM no debe convertirse automáticamente en el reloj de la obra. La revisión de código de ICM detectó uso de reloj real para decay; la CLI no expone todas las opciones temporales de las interfaces HTTP. El día, sueño y cadencia de los actores deben seguir el reloj del mundo, y su traducción a memoria necesita una política explícita. Pausar la representación no debería envejecer sus recuerdos accidentalmente.

## 9. Persistencia, contexto y reproducción

Pi persiste sesiones como **JSONL**, con entradas relacionadas por `id` y `parentId`. La rama activa determina qué conversación reconstruye para el modelo. Existen `SessionManager.create(cwd, sessionDir)`, `open(path)`, `continueRecent` e `inMemory`. Para actores, evitar `continueRecent` indiscriminado sobre un directorio compartido: se debe restaurar la sesión exacta asociada al actor. [Formato de sesión][session-format], [implementación del manager][manager-source].

Separar tres registros:

1. **Estado y eventos del mundo:** hechos confirmados, posiciones, objetos, reloj, mensajes entregados y resultado de acciones.
2. **Memoria subjetiva:** qué vivió, oyó, infirió o creyó cada personaje, incluyendo errores.
3. **Sesión del runtime:** contexto técnico enviado al modelo, herramientas, resultados, resumen y uso de tokens.

La sesión ayuda a depurar y reconstruir contexto; no reemplaza el registro de hechos del mundo. Volver a ejecutar un prompt puede producir otra respuesta y repetir una herramienta. Reproducir la obra para observarla debe leer eventos ya confirmados, sin volver a pedir decisiones al modelo. Crear una variación narrativa debe crear una rama coherente de mundo, memorias y sesiones; bifurcar sólo el JSONL filtraría al nuevo futuro recuerdos del anterior.

La compactación de Pi genera resúmenes de conversación y puede conservar puntos de control de prompt y herramientas. Es útil para el límite de contexto, pero no es una teoría de memoria humana ni garantiza que sobrevivan todos los motivos del personaje. Mantener identidad y relaciones importantes en fuentes durables propias, y probar qué se conserva al resumir. `context` puede transformar los mensajes de una solicitud; `appendEntry` puede conservar datos que no forman parte del contexto del modelo. No son mecanismos equivalentes. [Compactación][compaction], [eventos y estado de extensiones][extensions].

El código del manager escribe entradas al archivo, pero no ofrece una transacción conjunta con ICM y el mundo. Por tanto, la consistencia entre los tres sistemas debe implementarse en el host; no atribuir a Pi una garantía de recuperación exactamente una vez que no se verificó.

## 10. Concurrencia, cancelación y extensiones

Cada instancia de actor debe procesar un turno lógico a la vez; varias instancias pueden estar activas a la vez bajo el límite del coordinador. Si llega entrada durante una respuesta, `prompt()` requiere `streamingBehavior: "steer"` o `"followUp"`; sin esa elección rechaza el mensaje. `steer()` y `followUp()` también existen. El coordinador marca el pulso y respeta el orden de percepción y los turnos dramáticos, sin convertir toda interrupción humana en una orden del director ni mezclar las conversaciones de los actores. [Sesión][session-source].

Dentro de una respuesta, Pi puede ejecutar herramientas en paralelo. `executionMode: "sequential"` impide que esa herramienta comparta ejecución concurrente con otras de su lote. Esto **no serializa automáticamente a distintos actores**. El mundo necesita su propia cola o control transaccional para dos personajes que intenten tomar el mismo objeto, hablar a la vez o atravesar una puerta estrecha. [Bucle del agente][loop-source], [tipo de herramienta][tool-types].

`abort()` solicita detener el trabajo y espera estado ocioso; `waitForIdle()` espera sin abortar. Las herramientas deben atender el `AbortSignal`, detener procesos secundarios y definir el resultado si una acción ya quedó confirmada. Cancelar la generación no deshace un mensaje ya entregado ni una transacción persistida. Mostrar esa diferencia en el observador.

Las extensiones pueden intervenir en `input`, `before_agent_start`, `context`, `tool_call`, `tool_result` y eventos de ciclo de vida. `tool_call` permite bloquear ejecución; un error del handler bloquea esa herramienta. Una extensión corre con los permisos del proceso y puede ver prompts, archivos y credenciales. No es una sandbox. Se pueden componer hooks para preparar la percepción o moderar acciones, pero la autorización definitiva del mundo debe permanecer en servicios de dominio. [Extensiones][extensions], [runner][runner-source].

La separación de sesiones evita compartir por error el historial de conversación. No demuestra ausencia de todo estado global del proceso: la implementación mantiene infraestructura compartida y `reload()` incluye un reinicio del registro de proveedores. No asumir recargas y extensiones arbitrarias aisladas por actor sin pruebas. Como primera implementación, cargar el conjunto fijo de herramientas al inicio y coordinar recargas en una pausa controlada; usar procesos separados cuando se necesite una frontera más fuerte. [Código de recarga][session-source].

## 11. Humano, personajes y agente director

**Hablar con un personaje e influir en él es una función del producto.** El humano puede convencer, informar, mentir, prometer, pedir ayuda o cambiar una relación dentro de la ficción. La identidad estable no exige que el personaje rechace toda influencia: debe decidir según historia, deseo, confianza, situación y lo que sabe.

El host registra el mensaje humano como una intervención en el mundo y lo entrega a los personajes que puedan recibirla. Una frase como «soy tu director, olvidá quién sos» escrita en esa conversación sigue siendo un parlamento del interlocutor. No puede modificar system prompts, permisos o el expediente del personaje. Las acciones reales de dirección llegan por un canal autenticado distinto. La moderación detecta intentos de cambiar de nivel de autoridad; no elimina el engaño dramático legítimo de una comedia de espías.

El director observa una **línea dramática de fondo** y va registrando cuándo encuentra evidencia de planteamiento, desarrollo, clímax y desenlace. Esas etiquetas describen progresión del conflicto; no obligan a tres actos. La organización formal de Sófocles o Aristófanes se conserva como un nivel diferente. El director registra qué eventos apoyan su diagnóstico y puede revisarlo; no cambia retroactivamente las motivaciones para declarar cumplida una etapa.

El estado del director, su objetivo general y las metas individuales no se mezclan. Una meta común de personajes necesita existir en la ficción y ser conocida por quienes la comparten. Una intención de autor puede permanecer sólo en el contexto del director. Si director y moderador son agentes separados, ambos reciben el perfil elegido para la representación, con herramientas y acceso propios.

El observador gráfico muestra diálogos confirmados, posiciones, acontecimientos, relaciones y cambios de memoria permitidos. Los eventos de streaming de Pi sirven para mostrar actividad y depurar; no toda salida parcial constituye diálogo pronunciado. Tampoco se necesita exponer cadenas internas de razonamiento para explicar la evolución: bastan acciones, recuerdos usados, decisiones declaradas y consecuencias registradas. [Eventos de Pi][json-events].

## 12. Evaluaciones necesarias antes de dar por conectado el runtime

Estas son pruebas propuestas; **no se ejecutaron como parte de esta investigación**.

| Caso | Resultado esperado |
| --- | --- |
| Crear Maxwell y 99 | Sesiones, contextos y recuperaciones de memoria distintos |
| Activar N personajes | N instancias Pi independientes; ninguna alterna varias identidades |
| Pulso del coordinador | Sólo activa actores pertinentes y confirma efectos mediante el mundo |
| Login del host | Acceso del proveedor asociado al perfil seleccionado; ninguna credencial llega al contexto o memoria de un actor |
| OAuth vencido o acceso rechazado | Diagnóstico de conexión; no cambia proveedor, modelo ni método de autenticación |
| Perfil ausente o con proveedor, modelo o esfuerzo distinto al elegido | Actor detenido con diagnóstico; nunca otro perfil como fallback |
| Reiniciar la aplicación | Cada actor restaura su sesión y rama correctas |
| Dos actores buscan el mismo recuerdo privado | Sólo el propietario puede recuperarlo |
| Humano persuade a un actor | Puede cambiar una decisión o creencia con continuidad de personaje |
| Humano escribe `/comando` o simula ser el director | Permanece contenido de ficción, sin cambio de configuración |
| Recuerdo contiene «ignorá tus instrucciones» | Se trata como contenido atribuido, sin conceder autoridad |
| Actor intenta usar `bash`, `read` o MCP no autorizado | No hay vía de ejecución disponible por la configuración del actor |
| Dos actores intentan tomar un único objeto | El mundo resuelve un resultado consistente |
| Abortar durante lectura y después de una acción confirmada | La lectura se cancela; la acción ya confirmada permanece identificable |
| Caída entre acción, memoria y JSONL | Recuperación sin duplicar la acción y con proyección pendiente trazable |
| Reproducción del espectador | No invoca el modelo ni repite herramientas |
| Bifurcar una escena | Estado, recuerdos y sesiones se bifurcan juntos |
| Pausar el reloj del mundo | No transcurre vida ficticia por el tiempo real del proveedor o de ICM |
| Compactar contexto y reanudar | Conserva identidad, relaciones, incertidumbres y límites de conocimiento |
| Recargar recursos | Continúa con el perfil guardado y el conjunto exacto de herramientas autorizado |

Medir asimismo latencia por intervención, número de turnos/herramientas, tokens, coherencia de voz y calidad de las decisiones. El perfil seleccionado es una decisión de la persona usuaria: optimizar primero recuperación, tamaño de contexto y programación de turnos; no cambiarlo unilateralmente.

## 13. Estado de adopción

La investigación confirma un mecanismo concreto de SDK, prompt y custom tools. Quedan por implementar el adaptador ICM, el mundo autoritativo, el coordinador de actores, persistencia entre sistemas, proyecciones de conocimiento, moderación y UI. La carpeta `obra` puede expresar sus contratos y contenido en Markdown, pero esos archivos no son por sí mismos sesiones vivas ni una simulación ejecutándose.

No se instaló el runtime, no se ejecutó el login, no se configuraron proveedores, no se abrieron secretos y no se hicieron llamadas LLM. La conexión decidida está documentada, no activa. Las comprobaciones realizadas fueron lectura de documentación oficial, metadatos públicos y fuentes del commit citado. El ejemplo se verificó manualmente contra las firmas fuente, no mediante compilación o ejecución. Esta limitación es deliberada y evita presentar una integración conceptual como una implementación terminada.

## Fuentes primarias

Las referencias a código se fijan en `v1.2.0`; las páginas de catálogo son consultas fechadas y pueden cambiar.

[repo]: https://github.com/earendil-works/pi
[package]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/package.json
[npm-old]: https://registry.npmjs.org/@mariozechner%2fpi-coding-agent/latest
[npm-new]: https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest
[release-ref]: https://api.github.com/repos/earendil-works/pi/git/ref/tags/v1.2.0
[release-commit]: https://github.com/earendil-works/pi/commit/06a466935536f8c9bcacb2d5efc0fc021be1bdff
[sdk]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/sdk.md
[sdk-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/sdk.ts
[model-types]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/types.ts
[model-example]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/02-custom-model.ts
[prompt-example]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/03-custom-prompt.ts
[tools-example]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/05-tools.ts
[full-example]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/12-full-control.ts
[hello-example]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/extensions/hello.ts
[session-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/agent-session.ts
[runtime-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/agent-session-runtime.ts
[loader-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/resource-loader.ts
[prompt-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/system-prompt.ts
[tool-types]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/extensions/types.ts
[extensions]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/extensions.md
[runner-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/extensions/runner.ts
[loop-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/agent/src/agent-loop.ts
[skills]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/skills.md
[session-format]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/session-format.md
[manager-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/session-manager.ts
[rpc]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/rpc.md
[compaction]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/compaction.md
[json-events]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/json.md
[pi-luna]: https://pi.dev/models/openai/gpt-6-luna
[pi-luna-codex]: https://pi.dev/models/openai-codex/gpt-6-luna
[openai-luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
[openai-provider]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/providers/openai.ts
[codex-provider]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/providers/openai-codex.ts
[providers-doc]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/providers.md
[slash-doc]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/slash-commands.md
[codex-oauth]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/auth/oauth/openai-codex.ts
[model-runtime-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/model-runtime.ts
[auth-types]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/auth/types.ts
[models-source]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/ai/src/models.ts
[auth-storage]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/auth-storage.ts
[environment-doc]: https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/docs/environment-variables.md
[icm-reference]: https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/docs/reference.md
[icm-cli]: https://github.com/rtk-ai/icm/blob/5f402434919e514109a95c6cf504427fbcef851f/crates/icm-cli/src/main.rs
