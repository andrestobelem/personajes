# Selección de Sol bajo y Opus medio

Actualización posterior: el [corte v20](sondeos-durables.md) conecta el sondeo a journal, launcher, HTTP y GUI. Los límites de integración descritos aquí corresponden al corte anterior. El acceso live sigue sin acreditar.

Actualización de autenticación: el [corte de OAuth dual](oauth-dual.md) reemplaza la descripción de credenciales de este documento. Tanto OpenAI Codex como Anthropic requieren login OAuth; una API key de Anthropic ya no satisface preflight ni access-check.


Corte del 14 de octubre de 2026. La [decisión explícita del usuario](../adr/0003-perfiles-de-inferencia-seleccionables.md) reemplaza el requisito inicial de Luna/xhigh para nuevas inferencias.

## Alcance implementado

El dominio tiene dos perfiles seleccionables, estrictos por proveedor/API/modelo/esfuerzo, sin fallback. Cada borrador nuevo conserva explícitamente Sol bajo como valor inicial; el operador puede elegir Opus medio. El perfil viaja a Ready y a los workers actorales y administrativos; el journal comprueba que el perfil de sesiones y revisión coincida. Nuevos contextos del Continuista incluyen el perfil en su hash. Los snapshots y registros históricos sin campo o con perfil compacto Luna se conservan sin agregar defaults ni reescribir hashes; no autorizan nuevas inferencias de Luna. La recuperación de una aceptación anterior puede terminar un commit con sus pruebas durables sin llamar al modelo.

En el corte anterior a OAuth dual, el preflight de Anthropic podía aceptar una API key del host y el panel sólo administraba OAuth de Codex. Esa descripción es histórica y quedó reemplazada: hoy ambos perfiles requieren login OAuth del proveedor elegido; ver [OAuth dual](oauth-dual.md). Un receipt de otro proveedor, perfil o credencial no acredita acceso. La selección del perfil Anthropic no inicia por sí sola una sesión OAuth.

Se añadió un puerto host de sondeo explícito sin personajes, herramientas ni sesión persistente. Su integración en un job durable/HTTP/GUI y receipts de preflight aún está pendiente. La construcción del puerto no hace llamadas; fallos/timeout/cancelación o resultado incierto no se convierten en aprobación. Las pruebas con transportes controlados no acreditan acceso live ni calidad de actuación.

## Evidencia de interfaz

Host temporal `/tmp/personajes-model-choice-ZxnjkS`, puerto 52944, sin ICM de representación configurado. En navegador real: un borrador nuevo mostró GPT-6.1 Sol bajo, se eligió Claude Opus 5.5 medio, se guardó y se recargó/reabrió con la misma selección. La captura `/tmp/personajes-model-choice-ZxnjkS/opus-elegido.jpg` registra el resultado. SQLite confirmó un borrador y cero WorldRuns, eventos y jobs OAuth. No se inició una puesta ni se autenticó una cuenta.

## Fuentes y límites

[OpenAI: GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) confirma gpt-6.1-sol y low. [Anthropic: migración de Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide) confirma claude-opus-5-5 y medium, con pensamiento adaptativo y esfuerzo configurable. El SDK Pi 1.2.0 instalado ofrece los dos modelos con sus mapas de esfuerzo. Disponibilidad de catálogo no demuestra entitlement de cuenta ni una inferencia exitosa.

La comprobación local distingue payload efectivo y respuesta del SDK. Para Opus 5.5, Pi puede expresar el esfuerzo efectivo mediante un ajuste system por turno; un valor global del payload por sí solo no prueba el esfuerzo solicitado. Para OAuth, la metadata de catálogo sin refresh al abrir el host puede estar desactualizada: no reemplaza el resultado actual de checkAuth/getAuth cuando se solicita una ejecución explícita.

## Gate y revisión

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` aprobó TypeScript y **310 pruebas**, cero fallos y cero omisiones; log `/tmp/personajes-model-choice-final-verify.log`. `npm run build` aprobó 389 módulos (log `/tmp/personajes-model-choice-final-build.log`); conserva aviso de bundle mayor de 500 kB. La revisión independiente recorrió configuración/UI, workers/journal/contexto y Pi/sondeo, con suites focales verdes. Las pruebas usan ICM y SDK reales donde corresponde, con credenciales sintéticas y fetch/SSE controlados para modelos. No certifican acceso, calidad, latencia o coste de cuentas reales.

Los pendientes del producto siguen incluyendo sondeo durable/API/GUI, preflight e inicio/control integrados, tiempo acumulado, representación/conversación visibles, Director/narrador, voces/ritmo, replay/backups y los 77 ensayos de aceptación integrales.
