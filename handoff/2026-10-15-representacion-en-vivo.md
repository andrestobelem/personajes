# Handoff · representación en vivo

Fecha: 15 de octubre de 2026, Argentina. Rama: `main`. Commit de implementación: [`5f794b2`](https://github.com/andrestobelem/personajes/commit/5f794b2). Este handoff se entrega en el commit siguiente; obtener su identificador con `git log -1 -- handoff/`.

## Pedido y objetivo

El usuario pidió preparar, ejecutar y observar una representación entera; después pidió ausencia de topes propios de llamadas, tokens y tiempo acumulado, y una vista en tiempo real. El pedido inmediato al escribir este archivo es hacer commit/push y dejar esta carpeta para continuar desde otras máquinas.

El objetivo general anterior del proyecto fue pausado expresamente por el usuario. Las pruebas del episodio se autorizaron después como trabajo concreto. Preservar esa distinción: retomar una tarea o leer este archivo no equivale a reactivar automáticamente el objetivo general ni a declararlo completo. El goal de Codex requiere su propio estado en la conversación de destino.

## Resultado y evidencia

- Se ejecutaron turnos reales de Max y Hymie, con instancias Pi y memorias ICM independientes, usando `openai-codex` / `gpt-6.1-sol` / `low` y login OAuth. El Director produjo observaciones aceptadas.
- La representación es **La alarma de los números · episodio de ensayo**, ID `5913e9db-53e6-436f-8dc2-c2395186a6d1`, configuración 0. La [preparación, transcripción y límites observados](../docs/representaciones/la-alarma-de-los-numeros.md) son la evidencia narrativa.
- Hymie concluyó que el cartel descrito era un ejercicio numérico, con siguientes términos 13 y 21; Max respaldó corregir la alarma preventiva. El visitante aceptó esa evaluación. Esto acredita resolución del intercambio, sin afirmar comunicación efectiva con un compañero fuera de escena.
- «Ver representación en vivo» muestra plano, conversación confirmada y trabajo activo. Usa SSE con consulta de respaldo cada dos segundos; permite desactivar seguimiento del último diálogo e intervenir mediante identidad ficticia.
- La vista es un plano con marcadores y texto. Audio apagado; no se acreditan animación de actores, voces, fidelidad cómica o ritmo audiovisual completo.
- Último estado observado: representación reanudada, Max trabajando y vista en vivo abierta en el host original. Consultar el estado durable actual antes de actuar: este archivo no certifica que siga ejecutándose.

Los cambios de runtime, migración v41, presupuestos sin tope, preflight, Director, recuperación explícita y canales están documentados en la [auditoría de la sesión](../docs/auditoria/llamadas-sin-limite.md). Para requisitos completos usar el [PRD](../docs/PRD.md), [specs](../docs/specs/README.md), [constitución](../docs/constitucion.md) y [pendientes generales](../docs/PENDIENTES.md), que conservan cortes de evidencia anteriores y deben contrastarse con esta auditoría.

Verificación de este código: `npm run verify` con ICM real 0.11.4: 1242 tests, 1241 aprobados, 0 fallos, 1 omitido por plataforma. Build aprobado. Las pruebas de la vista cubren actualización SSE, conservación del corte nuevo ante respuestas antiguas y seguimiento automático desactivable. Los logs temporales y capturas del host original no son artefactos portables.

## Próximos pasos

1. **Resolver el cierre estructural.** El diálogo llegó a una resolución, pero `closeScene` fue rechazado. En `src/adapters/journal.ts`, `applyDramaticStructureCommand` comprueba cualquier job en `queued/running/blocked`, incluidas generaciones históricas bloqueadas reemplazadas por un retry. Distinguir generaciones vigentes de historia, mantener el bloqueo ante trabajo vigente y agregar una regresión real. Recuperar o resolver explícitamente el turno vigente antes del cierre; conservar los fallos históricos.
2. **Finalizar el episodio con evidencia.** Consultar trabajos y eventos actuales; cuando proceda, cerrar escena y episodio mediante el contrato de estructura, detener conservando historia y actualizar la transcripción. No marcar objetivos alcanzados automáticamente. La operación de cierre fallida conserva su clave: revisar su semántica idempotente antes de reintentar.
3. **Corregir el diagnóstico de acceso vencido.** Un preflight con evidencia de acceso expirada puede terminar en `evaluation-failed` en lugar de un resultado bloqueado legible. Renovar «Comprobar acceso» resolvió el caso en este host; falta reparar la causa y probarla.
4. **Revisar interlocución y recuperación.** Enviar una intervención durante trabajo activo puede invalidar turnos y requerir «Reanudar y reintentar actores bloqueados». El control requiere pausa y preflight vigente. Su recuperación está probada, pero el recorrido todavía necesita operaciones manuales.
5. **Destinatario humano.** Los humanos pueden emitir una intervención con recepción efectiva del reparto. Las tools actorales actuales resuelven destinatarios mediante handles de personajes, no handles humanos. Los actores respondieron entre ellos sobre la consulta, y el operador vio el diálogo público. Falta diseñar/implementar recepción humana dirigida si se exige ese contrato; no afirmar que ya existe. La proyección nueva entrega `scope` del canal y la tool rechaza audiencia vacía en `addressed`, o no vacía en `broadcast`, antes de persistir.

## Preparar otra máquina

Usar Node compatible con `package.json` y las dependencias del lockfile:

```sh
npm ci
npm run typecheck
npm run build
npm start
```

El puerto predeterminado es 4173. `PERSONAJES_PORT` permite elegir otro; el host original usó 4182. `PERSONAJES_PRIVATE_DATA_ROOT` selecciona el directorio privado persistente de destino. Un directorio nuevo empieza sin las representaciones, sesiones ni memorias del otro equipo.

En Configuración → Acceso a Pi, realizar login con el proveedor elegido, comprobar acceso al modelo y configurar la ruta del CLI ICM 0.11.4 disponible en ese host. La configuración guardada del host prevalece sobre `PERSONAJES_ICM_BINARY`; ninguna ruta absoluta del equipo anterior debe suponerse válida en destino. Reabrir memorias existentes después de reiniciar conserva lo vivido; preparar bases vacías no es restaurar.

Para ejecutar los tests que requieren ICM real:

```sh
PERSONAJES_ICM_TEST_BINARY=/ruta/local/al/cli-icm npm run verify
```

Sin ese binario se omiten explícitamente esas pruebas. Revisar sus omisiones antes de equiparar el resultado al de este handoff.

Los tres topes de esta puesta son `null`: llamadas por representación, llamadas por pulso y tiempo acumulado. Conserva concurrencia 1 y timeout operativo de 30 segundos por solicitud; el consumo sigue midiéndose. No hay cuota propia de tokens actoral. No sustituir perfil ante fallos.

## Skills sugeridas

- `typescript-best-practices`: cambios de TypeScript, validación y límites del runtime.
- `domain-modeling`: cambios del contrato de escenas, destinatarios o recuperación que requieran revisar términos o ADR.
- `grill-with-docs`: sólo si hace falta resolver un diseño material. Seguir el procedimiento del repo con entrevistador y custodio separados.
- `writing-for-agents` y `handoff`: actualizar la continuidad para la siguiente máquina; el usuario pidió conservar estos handoffs dentro del repo.
