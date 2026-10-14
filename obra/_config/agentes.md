# Configuración común de agentes

## Perfil por representación

La [decisión posterior del usuario](../../docs/adr/0003-perfiles-de-inferencia-seleccionables.md) establece GPT-6.1 Sol bajo como valor inicial y Claude Opus 5.5 medio como alternativa. El perfil elegido se guarda con la preparación y todos los roles LLM lo respetan; cada actor conserva su propia instancia. Los procesos mecánicos no requieren modelo.

| Perfil seleccionable | Proveedor / API Pi | Esfuerzo | Autenticación |
|---|---|---|---|
| `gpt-6.1-sol` | `openai-codex` / `openai-codex-responses` | `low` | OAuth Codex |
| `claude-opus-5-5` | `anthropic` / `anthropic-messages` | `medium` | Credencial propia de Anthropic admitida por el SDK |

Antes de una inferencia, comprobar el perfil efectivo y el acceso por proveedor. La incompatibilidad produce un diagnóstico visible; la selección no habilita fallback. Los registros Luna/xhigh se conservan para historia y recuperación sin nuevas inferencias. La ausencia de un perfil en un snapshot histórico conserva su significado anterior; elegir otro modelo requiere editar y validar explícitamente una preparación editable.

El catálogo SDK y los transportes controlados verificaron ambos perfiles. No se autenticó una cuenta ni se acreditó acceso live. Este workspace guarda contratos, no tokens ni credenciales. La [auditoría de implementación](../../docs/auditoria/perfiles-sol-y-opus.md) separa selección, autenticación, sondeo y actuación.

## Contexto de interpretación

El Coordinador entrega a cada actor sólo su paquete autorizado y lo invoca en una **instancia Pi distinta**, con contexto/system prompt, sesión, historial, memoria y herramientas independientes. No es opcional separar esas identidades ni basta con cambiar el prompt de una sola sesión. Compartir el perfil y la autenticación del host no comparte historias. Las carpetas por sí solas no hacen cumplir el aislamiento; la futura integración aplicará la [configuración de instancias](instancias-pi.md).

## Líneas técnicas investigadas

- [Pi como runtime](../../docs/investigaciones/pi-coding-agent-runtime.md): verificar compatibilidad efectiva antes de conectarlo.
- [ICM y memoria SQLite](../../docs/investigaciones/icm-memory-sqlite.md): investigación de una tecnología distinta de ICM como metodología de contexto. No se ha instalado una base SQLite por crear este workspace.

Este directorio conserva contratos y estado en Markdown. Una integración posterior deberá declarar qué almacén es autoritativo, cómo proyecta los archivos y cómo respeta los permisos; no habrá dos fuentes independientes del mismo estado.
