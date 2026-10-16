# Continuidad: resultados de intentos y canales

El objetivo general sigue activo: implementar, revisar y continuar hasta completar el producto. El usuario pidió velocidad y usar agentes sólo cuando aceleren. Este corte corrigió un bloqueo real de agencia; no completa los 77 requisitos ni acredita un episodio televisivo completo.

## Estado confirmado

- Rama `main`, base `3892c0b`, numerosos cambios locales de varios turnos. Conservarlos; no hubo commit/push en este corte.
- [Resultado privado del intento](../docs/auditoria/resultado-privado-de-intentos.md): guard local de canales, modalidad gestual en proyección, feedback privado durable para jobs actorales `notApplied`, reconsideración y supresión de ciclos idénticos. Sin evento público ni Experience falsa, sin backfill histórico.
- Global: 1476 pruebas, 1475 aprobadas, 0 fallidas y 1 omitida. Comando `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4 npm run verify`; log `/private/tmp/personajes-action-feedback-final-verify.log`. Typecheck/build/diff aprobados.
- GUI verificada: «Entre escenas» al cierre, conversación y guion conservados. [Captura](../docs/auditoria/resultado-intentos-entre-escenas.png). No hubo inferencia del proveedor en este corte de pruebas.

## Host y representación

4182 sigue como host del trabajo; no intervenir 4173. PID observado `70954`, exec `98875`, log `/private/tmp/personajes-action-feedback-server.log`; verificar antes de operar. Se reinició con ensayo detenido y cero jobs actorales/Configurador activos. Directorio privado e ICM conservan los valores de la [entrega de biografías](2026-10-16-biografias-encarnadas.md); no trasladar credenciales.

«CONTROL: el sello extraviado», run `6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f`, permanece `stopped`, configuración 4, commit 16/world 12/seq 9/estructura 3. [Evidencia](../docs/representaciones/el-sello-extraviado.md) y [guion](../docs/output/control-el-sello-extraviado-6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f-c16-70285ec80d4db743.fountain). Seis parlamentos, sello tomado y acuerdo provisional; Director consideró insuficiente la evidencia de clímax. No reescribirlo ni atribuir aceptación retrospectiva a su gesto final rechazado.

## Siguiente avance hacia el producto

Preparar una puesta más rica que permita verificar un episodio completo, con canales compatibles con las capacidades concedidas, conflicto que los personajes puedan transformar mediante herramientas disponibles y biografías admitidas para la fecha/continuidad. El mecanismo de historia/deseos ya está en runtime; la curación exhaustiva de los otros 25 y la evaluación artística de los dos activos siguen pendientes. Conservar la separación entre investigación, vida admitida y recuerdos vividos. No repetir ensayos mínimos como prueba de cierre integral.

Mantener los pendientes amplios de [PENDIENTES](../docs/PENDIENTES.md) y la matriz de cobertura; la regresión nueva acredita esta cadena, no toda la agencia, GUI, audio, proveedores o fidelidad del catálogo. Para interfaz usar «Volver a los controles» antes de operar fuera de la vista completa.
