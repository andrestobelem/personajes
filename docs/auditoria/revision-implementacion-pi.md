# Revisión de implementación Pi

Nota de vigencia: este informe pertenece al corte anterior a [ADR0003](../adr/0003-perfiles-de-inferencia-seleccionables.md); su comprobación literal de `xhigh` describe el perfil inicial. El código vigente valida el perfil de la representación, Sol/low u Opus/medium, sin fallback.

Fecha: 14 de octubre de 2026. Alcance: `src/adapters/pi.ts` y `tests/pi.test.ts`, frente a S01–S03 y los paquetes Pi instalados `@earendil-works/pi-coding-agent@1.2.0` y `@earendil-works/pi-ai@1.2.0`. Consulté el skill local [TypeScript best practices](../../.agents/skills/typescript-best-practices/SKILL.md). No abrí login, no usé credenciales, no envié inferencias ni invoqué servicios externos.

## Hallazgos y correcciones

**Riesgo alto, corregido — el checkpoint de entrada podía parecer ya aceptado.** `persistCheckpoint` recibía el leaf actual del `SessionManager` dentro de `streamFunction`. La fuente instalada prueba que `_startRun()` prepara el prompt y después llama a `agent.prompt()` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1391–1417`); el loop emite el mensaje inicial antes de llamar a `streamFunction` (`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:43–57, 123–141`). `AgentSession` persiste mensajes en `message_end` mediante `SessionManager.appendMessage()` (`.../core/agent-session.js:752–769`). Así, el leaf visible a la primera request ya podía incluir la intervención de usuario. El nombre `persistCheckpoint` tampoco distinguía un candidato técnico del leaf `committed_leaf_id` autoritativo de S02.

Reemplacé esa interfaz por `recordCheckpointCandidate` y una unión discriminada: `job-base`, `request-input` y `terminal-candidate`. El job base se registra inmediatamente antes de `session.prompt()` y se deriva del checkpoint aceptado de entrada (`initial`/ningún leaf o el `committedLeafId` de `leaf`); cada request/ronda registra su entrada actual después de que Pi persistió los mensajes previos; el candidato terminal se registra después de que `session.prompt()` se asienta. El DTO sólo tiene `candidateLeafId`, sin campo `committedLeafId`, y el puerto declara que nunca avanza el leaf confirmado. Reserva, elegibilidad y transición llevan identidad discriminada (`actor` con `characterId` o `admin` con rol) y scope de corrida/pulso/job/generación; una referencia de request añade `requestSeq`. Esto deja el paso de resolución/aceptación exclusivamente al host.

La prueba local de SDK y transporte controlado comprueba que el candidato de request apunta al mensaje de usuario ya persistido y que, al terminar el prompt, el leaf apunta a la respuesta del asistente. Esa prueba fija el orden real de Pi sin simular ledger ni hacer inference.

**Riesgo alto, corregido — perfil y OAuth sólo se verificaban al crear la sesión.** `prompt()` ahora revisa elegibilidad, modelo y esfuerzo efectivos, settings cerrados y OAuth antes de invocar el SDK. El wrapper repite las comprobaciones de perfil/settings/OAuth para cada request antes de reservar y justo antes de cambiar la reserva a dispatch, porque una llamada a `session.prompt()` puede originar varias vueltas. Además valida el modelo/API del request y `options.reasoning === 'xhigh'` antes de reservar, por lo que una desviación produce un evento terminal sin consumir cuota ni llamar al transporte. No hay fallback de proveedor, modelo ni esfuerzo.

La configuración sigue cerrada en la factory: allowlist exacta de tools por actor/rol, `noTools: 'all'`, recursos ambientales deshabilitados, `SettingsManager.inMemory`, retries cero, compaction apagada y `cacheWarming: 'off'`. Se vuelven a revisar profile/tools y dichos settings antes de cada prompt/request. Es relevante porque el SDK `CacheWarmer.refresh()` puede llamar directamente a `ModelRuntime.streamSimple()` fuera de `agent.streamFunction` (`node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js:237–245`); modo `off` continúa siendo una condición de seguridad, no una optimización opcional.

**Riesgo medio, corregido — el cierre concurrente podía volver antes de `abort()`.** El primer `abortAndDispose()` ya esperaba `session.abort()` y luego llamaba `dispose()`, como exige S03. Ahora las llamadas concurrentes comparten la misma promesa de cierre y todas esperan el abort y la disposición. La fuente local confirma que `AgentSession.abort()` espera que el agente quede inactivo, mientras `dispose()` por sí solo sólo solicita abortar (`.../core/agent-session.js:996–1004, 1938–1951`).

**Corrección de contrato terminal.** Los fallos de gate, reserva, transporte y stream se convierten a un evento Pi `error`/`aborted`; el wrapper no deja escapar/rechazar el control asíncrono. El `AssistantMessage` terminal usa contenido vacío, metadatos del modelo efectivo, uso cero sólo para no-despacho, y error seguro. Se conserva `maxRetries: 0` en la llamada exacta al `streamFunction` original.

**Riesgo medio, corregido — ack incierto de transición a dispatch podía reciclar la cuota.** Si `transitionReservation(..., 'dispatched')` arrojaba, el flujo intentaba marcar `undispatched`. El host podría haber confirmado la transición antes de perderse su respuesta. Ahora un ack incierto pasa a `ambiguous` y el transporte no se invoca; el slot no se recicla. La prueba controlada fuerza el fallo del ack y verifica la transición conservadora y cero llamadas al transporte.

## Contrato para integrar en el host

El puerto host debe persistir el resultado de `reserveNextRequest({purpose, scope})` con contador de corrida y pulso atómicos, devolver secuencia durable y aceptar las transiciones idempotentes de esa misma referencia. Debe guardar `recordCheckpointCandidate()` como evidencia/candidato ligado al scope y a la identidad, sin escribir `actor_sessions.committed_leaf_id`. Sólo la transacción de resolución que haga durable el resultado/propuesta puede avanzar ese campo, tal como dispone S02. Al reiniciar, el host abre el `baseLeafId` aceptado y trata los candidatos/tail no aceptados como forenses. Ningún ledger SQLite ni resolución host se implementó en este cambio.

## Verificación y límites

- `node --import tsx --test tests/pi.test.ts`: 11/11 pasan. Incluye perfil/esfuerzo incompatible sin reserva/transporte, presupuesto agotado, cancelación previa/posterior, ack incierto de dispatch, ronda por request, manejo de transporte y orden de checkpoint con SDK local y fake transport.
- `npm run typecheck`: pasa.
- `npm test`: suite general informa 83 pases, 2 fallos y 5 gates ICM omitidos. Ambos fallos están fuera de esta revisión, en `tests/journal.test.ts`: el test de schema futuro no recibe la excepción esperada y el de migración v1→v2 observa una secuencia `3` adicional. La suite Pi pasa completa.
- El acceso OAuth real, entitlement, transporte de proveedor y P18 no se ejecutaron; la prueba de factory sin credencial sólo comprueba que la creación se bloquea. La prueba de sesión Pi usa SDK local y una función de transporte explícitamente controlada, sin inferencia remota. Tampoco se afirma persistencia del host ni aceptación/commit de candidates.

## Huellas cotejadas

| Archivo | SHA-256 |
|---|---|
| `docs/specs/02-persistencia-e-icm.md` | `d46d65acebf5021d49c27ece43f5caa38f4566fe82aec037c65e6b75544c55da` |
| `docs/specs/03-pi-y-coordinacion.md` | `2a5df346455547b137af4515220494eec81616d6df59a3ad00b536812885e1fb` |
| `src/adapters/pi.ts` | `032fb279a98360dd00b5e6fffebbf9d92b964ae59d2e1b04f160c343280b31f7` |
| `tests/pi.test.ts` | `f1b22fcf2ce8e218060c09c3c7a5bc7b67cfc3b2ed725fcbcb7301c457f00955` |
