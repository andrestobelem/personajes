# Continuar con Claude

## Encargo y entrada

Continuar el desarrollo hasta completar el producto, revisando y corrigiendo con evidencia. Prioridad del usuario: ver una representación entera con agentes que interactúan libremente, biografías exhaustivas y exportación a guion. Usa agentes sólo si aceleran el trabajo. El goal de Codex no se transfiere automáticamente a Claude: este documento conserva su intención y los pendientes.

Leer en este orden: [AGENTS](../AGENTS.md), [README](../README.md), [índice documental](../docs/README.md), [constitución](../docs/constitucion.md), [glosario](../GLOSSARY.md), [pendientes](../docs/PENDIENTES.md), [PRD](../docs/PRD.md) y [specs](../docs/specs/README.md). La lista de continuación de PENDIENTES es la fuente del trabajo restante. Consultar la [entrega técnica anterior](2026-10-16-defaults-e-iniciativa.md) para el detalle del último corte. Para modificar obra, leer su AGENTS.

## Estado y límites

Repositorio `https://github.com/andrestobelem/personajes`, rama `main`. Este handoff se incluye en el commit solicitado por el usuario; obtener su SHA con `git log -1` después del push. No reescribir historia ni descartar cambios locales de la máquina receptora.

PRD y siete specs existen pero conservan revisión documental abierta; 77 requisitos y 25 escenarios pendientes de aceptación integral. Hay funciones cortas reales y guiones exportados; no equivalen al episodio completo con evolución que pide el usuario.

Última verificación del código: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4 npm run verify`, 1513 tests, 1512 aprobados, 0 fallidos, 1 omitido; build aprobado. La ruta del binario es propia de este host. Usar scripts de package.json y dependencias del lockfile; verificar runtime disponible en otra máquina.

Implementado recientemente: iniciativa propia durable v45 sin percepciones inventadas; privacidad de metadatos curatoriales; recuperación conservadora de admisión después de timeout; defaults elegibles de operación, curación, ICM, identidad humana y audio. La autonomía integral y generación de nuevas metas aún requieren trabajo/aceptación real.

## Próxima acción concreta

1. ~~Corregir el Escenario inválido del borrador «CONTROL»~~ Hecho en `d90c75f`: la escena no tenía `participantIds` porque hay cero actores colocados. El dato no se modificó; la validación ahora informa `scene-has-no-participant` (ver PENDIENTES). Al retomar, `npm start` en 4182 falló con `ALREADY_OWNED`: `host-ownership.json` registra el PID 298 (08:03 UTC), que ya no existe. Recuperar con `recoverHostOwnership` y el nonce registrado, que borra el registro sólo si el proceso no existe; respaldar antes `world.sqlite`. Esa recuperación espera la confirmación del operador.
2. Comprobar acceso real al perfil elegido y preparar un actor por trabajo con el Configurador. Revisar/aplicar sólo resultados completos. Después completar memoria, Ready y preflight.
3. Ejecutar y observar una obra completa; probar intervención humana, evolución e iniciativa libre y exportar el registro real a Fountain en docs/output.
4. Reconciliar documentación y completar las entregas restantes de PENDIENTES. Mantener estado y evidencia por requisito; corregir errores y continuar.

Último borrador privado: run `803a8675-2ad0-47ed-9d76-c7f8a64743a1`, revisión 3, Max/99/Jefe, cero actores preparados. Fecha de adaptación 1966-06-20 09:00 UTC−04, Washington, tres espacios y dos documentos sin valor de verdad confirmado. Dos trabajos del Configurador bloqueados; el último agotó timeout sin candidato aceptado. Detalle en [recuperación del Configurador](../docs/auditoria/recuperacion-configurador-tras-timeout.md). La recuperación nueva está probada con transporte controlado, falta acreditarla live.

## Dependencias privadas de esta máquina

Host 4182: último arranque sesión Codex 70269, log `/private/tmp/personajes-defaults-server.log`; comprobar proceso/puerto antes de usarlo. No tocar 4173. SQLite y OAuth en `/Users/andrestobelem/Library/Application Support/Personajes`, fuera de Git. ICM `/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`. Backup previo a v45 `/private/tmp/personajes-before-v45-20261016.sqlite`. Los archivos de /private/tmp son temporales y pueden desaparecer.

Git no lleva credenciales, SQLite ni sesiones Pi: otra máquina necesita preparación local/login y, para retomar exactamente la corrida, transferencia privada autorizada mediante el flujo de backup de la aplicación. Clonar sólo aporta código/docs, no la corrida. No publicar ni copiar secretos al repo. La URL del navegador o una prueba histórica no acreditan acceso actual.

Cada actor usa Pi, contexto, memoria SQLite e historial independientes. Perfiles de la aplicación: OpenAI Codex OAuth Sol 6.1 low predeterminado o Anthropic OAuth Opus 5.5 medium alternativo, sin fallback. Continuar el desarrollo con Claude no cambia automáticamente el modelo de los personajes. Sin cuotas acumuladas de llamadas, tokens ni tiempo; timeout individual y concurrencia siguen siendo controles separados.

El coordinador marca el pulso y el Director observa; las decisiones pertenecen a los actores. Admitir historia según continuidad, distinguir curación de conocimiento y conservar fuentes. Registrar resultados observados, sin fabricar escenas, biografías aceptadas, recuerdos ni inferencias exitosas.
