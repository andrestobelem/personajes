# Perfiles seleccionables de los agentes

Decisión explícita del usuario, 14 de octubre de 2026: «en vez de luna, podemos probar con gpt sol 6.1 bajo» y «también pongamos una opción para claude con opus 5.5 medium».

Los perfiles para nuevas representaciones son GPT-6.1 Sol bajo, predeterminado (`openai-codex`, `openai-codex-responses`, `gpt-6.1-sol`, `low`), y Claude Opus 5.5 medio (`anthropic`, `anthropic-messages`, `claude-opus-5-5`, `medium`). Ninguno habilita fallback. La elección se guarda por representación y se exige en actores y roles administrativos. No se cambia silenciosamente un perfil por falta de acceso ni se permite que contenido ficticio lo cambie.

La selección no comparte sesiones, prompts ni memorias: cada actor conserva su propia instancia Pi. Cambiar una preparación Ready invalida su readiness; una representación activa conserva su configuración. Los registros históricos Luna/xhigh permanecen legibles y se identifican como tales; no se reescriben sus hashes, sesiones, checkpoints ni experiencia para atribuirles el perfil nuevo.

Codex requiere OAuth. Anthropic necesita su propia credencial de host, API key u OAuth soportado por el SDK. No se pide ni se conserva una clave en el texto ficticio. El panel administrativo de login de OpenAI no configura Anthropic; elegir Claude tampoco realiza autenticación o una inferencia. La comprobación de acceso debe corresponder al proveedor, credencial y perfil seleccionados y realizarse como acción explícita.

Fuentes primarias: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) admite low; [migración de Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide) identifica claude-opus-5-5 y medium, con pensamiento adaptativo. El catálogo local del SDK Pi 1.2.0 registra los dos modelos y mapas low→low/medium→medium. Catálogo y documentos no acreditan acceso live de una cuenta ni calidad/latencia de actuación.

Esta decisión reemplaza el requisito inicial Luna/xhigh en la conversación, constitución y especificaciones. Las auditorías anteriores conservan el perfil de su corte como evidencia histórica; no representan el requisito actual.
