# Audio: preparación, configuración efectiva y admisión

Corte 42, 15 de octubre de 2026. Implementación y revisión de los controles locales; no acredita síntesis live, calidad acústica, fidelidad de doblaje ni aceptación integral de P21.

## Brechas encontradas

La preparación conservaba `ProductionAudio` sin editor. El panel posterior no permitía modificar modo, slots o cuotas. El host de preflight devolvía siempre `voice-runtime-unavailable`, y la evaluación consultaba el audio inicial de Ready aunque las voces tuvieran revisiones independientes. Un slot inicialmente sin vinculación podía seguir bloqueando aun después de validarlo. Si se editaba la preparación tras importar voces, el operador tampoco podía conciliar desde una sesión nueva porque no tenía la revisión preservada.

La revisión independiente encontró además que un preflight aprobado podía permitir iniciar después de cambiar audio, credencial o evidencia de voz: su fence cubría configuración de obra, mundo y acceso Pi, pero no las versiones independientes de presentación. La corrección no atribuye esas versiones a la configuración actoral ni modifica sus hashes.

## Implementación

El editor de preparación permite audio desactivado/activado, modo de síntesis, modelo indicado explícitamente, formato, subtítulos, slots de hablantes activos, efectos para identidades no verbales y narrador cuando corresponde. No inventa modelos ni acepta UUID de vinculación escritos a mano. Referencias anteriores se conservan opacas, sin afirmar vigencia; quitar una entrada es una elección explícita. Campos incompletos mantienen la edición y bloquean el guardado hasta aplicar. Variedad española se confirma por separado.

El panel efectivo agrega modo, síntesis automática/manual, modelos consultados o conservados, formato/subtítulos, slots y las tres cuotas. Guardar no genera audio; la consulta de modelos sigue siendo una operación explícita distinta. Cada escritura conserva CAS e idempotencia. Un refresco fallido conserva el formulario y la operación incierta; una revisión nueva exige cargar explícitamente lo guardado antes de otra escritura. Sin narrador elegible no se ofrece habilitarlo.

El contexto `GET /runs/{id}/voice-settings/reconciliation` devuelve snapshot preservado, `baseStale` y ETag, bajo el mismo acceso de operador que las otras rutas de voz. No concilia al leer. El botón de conciliación aplica el comando existente: conserva el modo anterior y filtra propietarios compatibles; no importa silenciosamente los cambios de audio del borrador. Después el operador modifica la configuración efectiva si lo desea.

El runtime expone una lectura síncrona local de readiness, sin importar versiones ni consultar proveedores. Usa la configuración efectiva si existe; de lo contrario deriva la inicial en memoria. Comprueba corrida, revisión/hash de base, credencial disponible y evidencia vinculada. Habla requiere recibo de aceptación íntegro, prueba congelada, escucha, procedencia y bytes exactos; efectos requieren asset y aceptación local. Referencias antiguas sin la evidencia enlazada deben volver a validarse: un UUID bien formado no acredita una voz.

Preflight consulta esa lectura incluso si el audio inicial estaba apagado y la versión efectiva lo activó. Antes de start/resume/step, la admisión vuelve a comprobarla de forma síncrona inmediatamente antes del CAS de lifecycle, sin espera entre ambas operaciones. El host tiene ownership exclusivo y las escrituras locales se serializan en ese proceso. Un cambio posterior al preflight no elude esta comprobación. Un replay conserva su recibo y no se vuelve a admitir; pausa/stop/close siguen disponibles. No hay consulta de modelo ni síntesis en esta comprobación.

## Evidencia

- [Preparación y preservación de referencias](../../tests/audio-preparation-ui.test.ts).
- [Cliente, CAS, reintentos, reconciliación y panel](../../tests/voice-settings-ui.test.ts).
- [Contexto de conciliación y SQLite real](../../tests/voice-reconciliation-routes.test.ts).
- [Readiness efectiva y prueba de vinculación local](../../tests/voice-preflight-runtime.test.ts).
- [Admisión antes del CAS y replay](../../tests/voice-lifecycle-readiness.test.ts).
- [Validación y proyección de diagnósticos](../../tests/production.test.ts).

El navegador operó una preparación sintética sin credenciales: activó audio manual, escribió un modelo de prueba, eligió PCM 16 kHz/subtítulos y desactivó la voz del actor; guardó y validó Ready en revisión 1. En Voces y sonido, habilitó el slot sin vincular y fijó cuota TTS 2, guardando revisión sonora 1. Editó el nombre de la preparación y la validó en revisión 2; el panel detectó fuente obsoleta y concilió a revisión sonora 2 conservando modo/cuota/slot. Tras reiniciar con el build final, reabrió lo guardado, apagó el audio y guardó revisión sonora 3; el narrador no elegible ofreció sólo apagado y la cuota permaneció en 2. [Captura final](evidencias/audio-configuracion-20261015.png). No se inició la representación ni se generó audio. La vinculación probada en la suite usa transporte de proveedor controlado, no una cuenta real.

Gate final: **694 pruebas, 693 aprobadas, cero fallidas y una omitida por requerir Linux**, con TypeScript y CLI ICM local configurado para la suite. Build de 446 módulos; `git diff --check` correcto. Los 77 requisitos siguen pendientes de aceptación integral; P21 live, calibración acústica y recorrido audiovisual completo conservan sus pendientes.
