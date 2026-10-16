# Continuidad: biografías dentro de los personajes

El usuario reiteró que la biografía debe vivir dentro del personaje junto con identidad, historia, memoria, deseos y goals, y pidió definir cuidadosamente cada agente. El objetivo general continúa activo y no se declara terminado.

Leer [auditoría de biografía encarnada](../docs/auditoria/biografia-encarnada.md), [definición de agentes](../docs/diseno/definicion-de-los-agentes.md) y [estado de los 27 contextos](../docs/personajes/get-smart/estado-contextos.md). La entrega anterior del [Configurador de preparación](2026-10-16-configurador-preparacion.md) conserva arquitectura y pruebas previas.

## Código y alcance

`main`, base `3892c0b`, muchos cambios locales de varios turnos: conservarlos. No hubo commit/push en este corte. Los nuevos campos de identidad son `lifeHistory` y `desires`, con referencias validadas a antecedentes y goals propios. Actor y Continuista los reciben; la memoria privada SQLite sigue separada. La ficha permite editar Markdown completo. Los nuevos borradores exigen `embodied-v1`; los históricos conservan bytes, con opt-in explícito.

La protección contra degradación a legacy y borrado de lagunas/contradicciones está también en la admisión central del journal, con error HTTP 409. Las pruebas históricas comprueban el hash original retirando explícitamente los campos nuevos de su fixture legacy, sin cambiar el golden. Pi admite el contexto completo con límite explícito; no resume silenciosamente.

## Host y datos privados

Aplicación en `http://127.0.0.1:4182/`; no intervenir 4173. Proceso de este corte: PID 63337, sesión exec 35914, log `/private/tmp/personajes-biografia-live-server-final.log`. Verificar antes de actuar: el PID puede cambiar. Root privado `/Users/andrestobelem/Library/Application Support/Personajes`, ICM `/Users/andrestobelem/.local/bin/personajes-icm-0.11.4`. No portar credenciales.

Puesta `6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f`, «CONTROL: el sello extraviado», revisión 3, política encarnada guardada por GUI. Mantiene Max/Hymie seleccionados, ICM y perfil Sol 6.1 low/OAuth, cuotas acumuladas ilimitadas y timeout por request de 180000 ms. Todavía no equivale a Ready ni a una representación iniciada.

Se canceló sin inferir el trabajo viejo `64448ac8-b0d4-41b0-9d05-201107f913de`. El nuevo `450f51aa-d333-4b83-bcf9-40adaa865041` se registró y se inició explícitamente por GUI para proponer curación biográfica completa y Escenario, sin Fibonacci. Terminó bloqueado: la primera herramienta rechazó una referencia no admitida y el acceso local venció antes de la ronda siguiente. No se aplicó. Consultar cada estado exacto antes de otra operación; no registrar duplicados por timeout de observación.

## Continuación

Revisar la propuesta real, especialmente narrativa, continuidad, fuentes, lagunas, deseos y referencias a metas. No aplicar ciegamente ni describir una propuesta como experiencia vivida. La biografía de los 27 personajes no está automáticamente curada por tener dossiers. Después completar identidad ficticia humana, Ready, memoria, preflight y representación de principio a fin; exportar Fountain a `docs/output`.

La función anterior «El paquete equivocado» y su guion permanecen conservados. No reescribir funciones históricas para añadirles biografías nuevas ni atribuirles recuerdos que no tuvieron.

Verificación final: `npm run verify` con ICM real, 1469 pruebas /1468 aprobadas /0 fallidas /1 omitida, typecheck y build aprobados. Logs locales `/private/tmp/personajes-biografia-icm-final-verify.log` y `/private/tmp/personajes-biografia-build-final.log`.

Tras renovar acceso a Sol (prueba aprobada 2026-10-16T05:33:21.745Z), se inició explícitamente el nuevo trabajo `af93669c-da7e-423c-a8c2-7d9965b0d289` sobre revisión 3, con citas corregidas. Consultar estado; no confundirlo con el bloqueado anterior ni reiniciar mientras esté activo.

Corte posterior: af936… terminó bloqueado por ambigüedad de contradictionTreatments; schema/feedback ya aclarados en código (13 focales + typecheck verdes), aún requieren próximo restart para futuros jobs. Se revisó editorialmente la salida, se corrigió sólo el tratamiento administrativo y se atribuyeron las nueve secciones como adaptación explícita. Conversor puro + preparación y validación local pasaron; PUT autenticado/CAS guardó revisión **4**, dos actores preparados con biografía/desires/goals e initialExperience none. No se falsificó aceptación del job ni se hizo transición Ready del host. Continuar desde revisión 4; los otros 25 personajes aún no están curados.

## Corte siguiente: ensayo ejecutado y continuación tras observar

La puesta revisión 4 pasó Ready y preflight, ejecutó seis parlamentos, toma física del sello y espera; cerró escena/episodio y quedó `stopped`. Ver [evidencia completa y límites](../docs/representaciones/el-sello-extraviado.md) y [guion](../docs/output/control-el-sello-extraviado-6c6d2a1e-2572-4677-a4f1-ad31e13a2b4f-c16-70285ec80d4db743.fountain). Corte final commit16/world12/seq9/estructura3. Acuerdo provisional, función del sello pendiente; Director no reconoció clímax. No acreditar episodio televisivo completo ni calidad cómica integral.

Se corrigió falta de intención durable para observaciones propias. Pruebas integrales con replay/reapertura y recorrido real Hymie observecommit10→parlamento11 acreditan continuidad. No se backfillearon causas históricas. La reactivación del ensayo incluyó metaindicación privada (no despierta por sí sola) y aumento explícito de iluminación a bright por Dirección, recibida por ambos.

Host vigente4182: PID65187, exec19671, log `/private/tmp/personajes-sello-observe-fixed-server.log`; verificar antes de operar. Mantener4173 intacto. Regresión actual: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/Users/andrestobelem/.local/bin/personajes-icm-0.11.4 npm run verify`,1472total/1471pass/0fail/1skip; log `/private/tmp/personajes-observe-continuation-canonical-verify.log`. TMPDIRmacOS `/var/...` es symlink y las verificaciones de rutas lo rechazan; usar raíz canónica, sin debilitar protecciones.

Siguiente prioridad de agencia: la propuesta final de Max fue gesture nod por canal speech, rechazada channel-kind-mismatch sin realización pública. Configurar/seleccionar canales compatibles y permitir que un intento no aplicado tenga feedback propio durable para reconsiderar, sin loops ni hechos ficticios. Además la vista en vivo después de cerrar episodio queda sin plano por no haber escena activa: mostrar estado entre escenas claramente o navegación histórica. La biografía exhaustiva de los otros25 y aceptación amplia siguen pendientes. Objetivo activo, sin commit/push.

OperaciónGUI: la vista completa cubre los controles exteriores. Usar «Volver a los controles» ANTESdePausar/Detener/navegar; así se verificó pausaGUI. Los intentos de click sobre controles cubiertos no prueban fallo del producto.
