# Handoff · preparación nueva y función completa con ICM

16 de octubre de 2026 UTC. Rama `main`, base `3892c0b`. Numerosos cambios locales y archivos nuevos, **sin commit ni push de este corte**; preservar todos. Objetivo activo: «7 - implementar hasta terminar; 8 - revisar y volver a 7 hasta terminar; usar subagentes cuando corresponda». No está completado ni pausado. Prioridad humana: ver una representación entera. La importación ampliada permanece en V2 y fuera del camino crítico.

## Entrega comprobada

[Una pregunta a tiempo](../docs/representaciones/pregunta-a-tiempo-icm.md) se creó desde preparación nueva ordinaria, sin fork/importación. Curación manual y separada de Max/Hymie, circunstancias e identidad ficticia provisional del visitante; nueve fuentes y diecisiete secciones ICM explícitas; guardado/Ready, SQLite independientes, sondeo real OpenAI Codex, dieciséis gates, Iniciar, conversación visible, desenlace del Director y cierre gráfico de escena/episodio. El asistente interpretó al visitante. Once emisiones habladas más tres esperas; 58 llamadas, 241.783 ms medidos, cero reservas. Sin topes de llamadas/tiempo acumulado; timeout por solicitud 30 s, concurrencia 1. Audio y narrador apagados.

Run `9a9ab007-b4f8-4775-af16-5f5fb58480ae`, configuración 1, detenida; escena `048e7df0-4122-49ee-94c8-0e8d50ed763a` cerrada en commit 16, episodio cerrado en commit 17; Escenario 17, secuencia 14, estructura 3. Reloj 1966-06-15 10:00:03 UTC−04:00. No hay que reanudarla para leerla. Queda pendiente en ficción consultar el origen del cartel. La transcripción, imágenes y [metadatos de integridad](../docs/representaciones/pregunta-a-tiempo-icm-integridad.json) viajan por Git; la función privada no.

## Código y verificación

[Auditoría](../docs/auditoria/preparacion-nueva-y-contexto-icm.md): panel de modo de preparación que conserva el editor y refresca fuentes; reconexión explícita ante 401/403 o respuesta incierta sin reenviar PUT; gate ICM durable y proyección pública de dieciséis checks; reparación de evidencia terminal del Configurador de evolución con paquete ICM y anclas históricas comprobadas sin transacciones anidadas.

**1364 tests, 1363 aprobados, cero fallos, una omisión exclusiva de Linux**. Typecheck y build finales aprobados; aviso de bundle mayor a 500 kB. `git diff --check` limpio. Usar `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4 npm run verify`; logs locales `/private/tmp/personajes-new-preparation-reconnect-global-final.log` y `/private/tmp/personajes-new-preparation-reconnect-build-final.log`. No repetir sin cambios o dudas concretas.

La función real acredita actores, Continuista y Director con contexto ICM: 29 paquetes, inspección readonly de JSON/checksums/scope, preparación actoral, contrato y corte de mundo. El Configurador se probó con SDK/proveedor controlado, no con inferencia real ni antes de Ready. La reconexión se verificó con React/HTTP/bootstrap reales bajo fallos controlados; no con expiración natural en navegador.

## Host y datos privados

App habitual `http://127.0.0.1:4182/`, PID observado `24536`; confirmar mediante lsof antes de operar. No tocar 4173. Log `/private/tmp/personajes-new-preparation-live-server.log`. Host carga backend de los fixes ICM; último build del frontend contiene la reparación final de reconexión. No se reinició el backend después de esa modificación exclusivamente gráfica. Datos `/Users/andrestobelem/Library/Application Support/Personajes`, ICM `/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`. Login OpenAI privado presente en este host. Ningún token, SQLite, sesión Pi o configuración privada se guarda en Git ni en este handoff. En otra máquina, autenticar mediante login; no sustituir por API key.

## Siguiente acción

La prioridad de función corta completa ya tiene evidencia desde preparación nueva. Continuar el alcance V1 central: Configurador anterior a Ready e inspección gráfica por rol/job de paquetes. Revisar [PENDIENTES](../docs/PENDIENTES.md) para ritmo/fidelidad, audio, Anthropic real y aceptación integral. No reabrir importación como requisito previo ni confundir implementación parcial con aceptación del producto.

Leer AGENTS, índice de docs, constitución, GLOSSARY y skills aplicables; TypeScript best practices para cambios TS. Si se necesita grill-with-docs nuevo, usar entrevistador y custodio del concepto según el procedimiento documentado. Conservar las decisiones existentes y las funciones previas. No marcar el goal completo por haber terminado este ensayo.
