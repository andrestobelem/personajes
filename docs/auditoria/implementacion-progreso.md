# Implementación: progreso y límites de evidencia

El objetivo completo sigue activo. Los cierres documentales de PRD y S01–S07 se conservan como antecedentes; ambos están en revisión desde el 15 de octubre. La implementación y su revisión continúan. Este registro no reemplaza la matriz de 77 requisitos.

## Corte 42: preparación sonora, configuración efectiva y admisión

El editor inicial reemplaza la sección de audio sin controles; el panel de voces ahora edita modo, slots y cuotas, y ofrece conciliación explícita cuando cambia la preparación base. Referencias opacas se conservan sin presumir vigencia y guardar no genera audio. El navegador verificó Ready r1, configuración sonora r1, edición de base r2, conciliación sonora r2 y reapertura/apagado en r3 conservando cuota 2.

Se corrigieron el puerto de readiness siempre no disponible, la comparación contra audio inicial congelado y el uso de un preflight anterior tras cambiar voces. La comprobación efectiva local valida credencial/evidencia/artefactos sin proveedor y se repite síncronamente antes del CAS de start/resume/step. Replay y pausa conservan su semántica. [Contrato, límites, pruebas y captura](audio-preparacion-y-admision.md).

Gate: TypeScript y **694 pruebas: 693 aprobadas, cero fallidas y una omitida por requerir Linux**. Build: 446 módulos. No se hicieron llamadas a servicios reales ni se acreditó P21 live. El objetivo y la aceptación de los 77 requisitos siguen abiertos.

## Corte 41: rutinas diarias locales y ciclo de día/noche

Se implementó recurrencia diaria con ventanas nocturnas, resolución fixedOffset/IANA y política compatible explícita, compartida por preflight/acción/percepción/convocatoria. El ciclo editorial configurable se muestra al corte observado y se mantiene separado de iluminación y memoria. La agenda no genera infinitos días vacíos si no hay fronteras actorales. Una revisión independiente detectó y permitió corregir la entrega indebida del horario editorial al actor.

La GUI guardó y validó un descanso 22:00→07:00 con ciclo 06:00/18:00; el historial mostró día y noche según el commit con luz material constante. El selector inicial que ocultaba la variante diaria hasta elegir política se corrigió y tiene regresión. Tres días de SQLite, replay/reopen y cadena diaria hasta conversación se probaron con ICM real y Pi SDK de transporte controlado. [Diálogo, contrato, pruebas, capturas y límites](rutinas-diarias.md).

Gate: TypeScript y **671 pruebas: 670 aprobadas, cero fallidas, una omitida por requerir Linux**. Build: 443 módulos. No hubo proveedor live. Permanecen abiertos la aceptación temporal integral, el entorno reproducible IANA entre hosts y los restantes criterios del producto; el objetivo sigue activo.

## Corte 40: preparación del reloj y bloqueo entre escenas

La GUI permite elegir avance automático desde un borrador manual o vacío, aplicar un máximo por salto explícito y guardar/reabrir/validar. Rechaza vacío, fracciones y enteros inseguros sin habilitar un guardado incompleto. El recorrido visual conservó 86.400.000 ms y promovió Ready en revisión 1 sin iniciar.

Una auditoría delegada reprodujo que el reloj avanzaba después de cerrar la última escena; ahora planificador y journal exigen escena activa abierta y no crean eventos/commits/convocatorias entre escenas. Se corrigieron dos contradicciones de S02/S03 sobre rutinas ya conectadas. [Pruebas, captura y límites](reloj-y-rutinas.md).

Gate: TypeScript y **645 pruebas: 644 aprobadas, cero fallidas y una omitida por requerir Linux**. Build de 438 módulos. Recurrencia diaria, calendario día/noche, servicios reales y aceptación integral siguen pendientes. El objetivo continúa activo.

## Corte 39: cinco familias de circunstancias y percepción situada (v33)

Dirección puede cambiar puerta, iluminación, disponibilidad de dispositivo, condición ambiental y aparición de objeto de catálogo. Se confirman con CAS conjunto, recibos durables, scope y exclusión de trabajo en vuelo; el estado ya vigente deja sólo registro administrativo. Las percepciones no inventan hablante ni entregan órdenes al reparto. La entrega y cadena Actor/Continuista hasta conversación se verificaron con SQLite/ICM reales y Pi SDK de transporte controlado.

El panel, el catálogo y el ambiente inicial se operaron en navegador con datos sintéticos; se corrigió un fallo del editor encontrado en ese recorrido. Se comprobó una operación sin cambio durante pausa y la actualización automática del ledger. Ver [contrato, pruebas y captura](cambios-de-circunstancia.md) y [ADR 0008](../adr/0008-circunstancias-fisicas-y-percepcion.md).

Gate: tipos y **640 pruebas: 639 aprobadas, cero fallidas, una omitida por requerir Linux**. Build: 436 módulos. No hubo acceso o inferencia de proveedores reales. La aceptación integral sigue abierta y no se cierra ningún criterio PRD por sumar este corte.

## Corte 38: revocación de Dirección y formulario operable

El ledger admite `revokeMetaIndication` con destino de la misma corrida y alcance idéntico. La operación agrega un evento administrativo con CAS y recibo idempotente: conserva la indicación original, el mundo y las percepciones. Los turnos que ya congelaron una revisión de Dirección mantienen su contexto; los cortes posteriores excluyen la indicación revocada. Se rechazan destino ausente, alcance alterado y segunda revocación por otra operación. No requiere migración del almacenamiento JSON existente.

El panel permite seleccionar destinatario y escribir desde un borrador vacío; habilitar edición ya no depende de haber completado ese mismo formulario. Los rechazos HTTP definitivos liberan la operación pendiente incluso tras remontar; una respuesta incierta conserva su clave. Registrar o revocar confirma el resultado antes de recargar historial: una falla de lectura posterior no crea otra operación. Revocar conserva el siguiente borrador. El host también valida NUL y límite UTF-8 del texto nuevo, separando ese contrato de escritura del schema histórico para permitir leer y revocar indicaciones antiguas. Una prueba reabre y revoca una fila legada de 4.002 bytes que era válida bajo el límite original de caracteres. El cliente completa el historial con revisión estable antes de deducir vigencia; una prueba de 1.001 eventos ubica la revocación en la segunda página y rechaza páginas faltantes o cortes mezclados.

El navegador integrado recorrió el build productivo con SQLite y una corrida sintética separada: activó Dirección, comprobó edición de formulario vacío y envío deshabilitado hasta completarlo, registró una indicación, escribió el borrador siguiente y revocó sin perderlo. El historial mostró original revocado y evento de retirada, revisiones 1 y 2. [Captura del resultado](evidencias/direccion-revocacion-20261015.png). No hubo llamadas a proveedores; ICM no estaba configurado en ese launcher de prueba. El build final verificó además una segunda indicación: pausar deshabilitó la nueva escritura y mantuvo la revocación operable; se confirmó la retirada sin reanudar. Los tests HTTP/SQLite cubren además alcance de sesión, CSRF, CAS, replay, target inválido y cortes anteriores; los de journal comprueban reopen, paginación y ausencia de efectos ficticios.

`TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con **590 pruebas: 589 aprobadas, cero fallidas y una omitida** por requerir Linux. TypeScript, build (433 módulos) y `git diff --check` pasaron.

La revisión de las circunstancias físicas se conserva por separado en [cambios-de-circunstancia](cambios-de-circunstancia.md). Siguen pendientes sus cinco familias, precedencia/reemplazo de indicaciones y aceptación integral de la obra. La revocación no acredita esas capacidades ni cierra los 77 requisitos.

## Corte 37: rutina hasta conversación y avance sólo en reposo

La cadena integrada usa ICM 0.11.4 local y el SDK Pi con transporte controlado: atraviesa dos ventanas consecutivas, confirma parlamentos actorales tras la revisión del Continuista y los lee desde la aplicación de conversaciones. Otro escenario recibe una respuesta humana durante la ventana y la procesa antes del descanso; un tercero solicita un paso sin estímulo, alcanza la siguiente rutina y vuelve a pausa tras un único pulso. Recuperar conserva reloj y conversación sin repetir actuación.

La revisión corrigió la aceptación actoral que exigía percepciones incluso a jobs convocados por rutina o meta. El inbox vacío sólo se admite con un enlace durable de convocatoria del mismo scope. El coordinador descarta convocatorias agotadas antes de decidir que está ocioso y solicita avance sólo tras agotar el trabajo procesable. El journal impide avanzar con pulsos o jobs en vuelo. La disponibilidad considera transiciones efectivas, incluido el regreso al estado predeterminado tras una ventana no disponible, y evita convocar dos veces por intervalos disponibles contiguos.

Cada avance invalida las ofertas vencidas en la misma transacción que reloj, eventos y recibo. Hay pruebas de expiración exacta, conservación de ofertas futuras/aceptadas, reapertura, replay y rollback ante una falla SQLite. La notificación de presentación incluye todos los eventos del avance.

`TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó: **575 pruebas, 574 aprobadas, cero fallidas y una omitida** por requerir Linux. TypeScript, build (433 módulos) y `git diff --check` pasaron. No se contactó a proveedores reales ni se verificó un recorrido visual en navegador en este corte. Recurrencia/calendario diario, fidelidad audiovisual y aceptación integral siguen pendientes; el objetivo y los 77 requisitos permanecen abiertos.

## Corte 36: reloj ficticio durable y convocatorias por ventana (v32)

El journal v32 registra avances del reloj como eventos `clockAdvanced` y commits del Escenario, en una transacción con su recibo durable. `advance-while-running` sólo avanza una corrida habilitada y en ejecución hasta un límite explícito alcanzable dentro de `maxAdvanceMs`; `manual-only`, una corrida pausada y la recuperación no hacen avanzar el tiempo. La migración amplía el ledger de convocatorias con causas e invitaciones `routine-boundary`, agrupadas e idempotentes por límite ficticio. Los commits de acciones que cruzan una ventana admiten la misma causa. La invitación llega al actor como metadato administrativo, con inbox vacío y revalidación de disponibilidad, identidad, presencia, preparación y escena abierta. La convocatoria por metas iniciales de v31 se conserva.

La suite completa con ICM local pasó con **565 pruebas: 564 aprobadas, cero fallidas y una omitida** por requerir Linux. `npm run typecheck`, `npm run build` y `git diff --check` pasaron. Las pruebas cubren límites, pausa, cruce por acción, replay tras reabrir SQLite y migraciones hasta v32. No se contactó a proveedores reales. Este corte no implementa recurrencia de ventanas, calendario día/noche ni una prueba de la cadena rutinaria hasta conversación; tampoco calibra el ritmo audiovisual de Get Smart. El objetivo y los 77 requisitos continúan abiertos.

## Corte 35: convocatoria inicial durable por metas

El journal v31 registra una causa técnica y sus invitaciones a actores con metas activas al iniciar, reanudar o solicitar un paso. Cada invitación se vincula a un job actoral con inbox vacío; no crea percepciones, eventos ni commits ficticios. El coordinador revalida identidad, meta, disponibilidad y pertenencia a escena antes del pulso y del claim; conserva el corte de admisión como procedencia y congela el corte confirmado vigente al reclamar. `start`/`resume`/`step` admiten la causa de forma idempotente, y el ledger permite recuperar el mismo pulso tras reiniciar SQLite. Pausa y stop preservan el trabajo reanudable; cerrar la corrida terminaliza las invitaciones técnicas abiertas.

La migración v30→v31 comprueba sus claves foráneas antes del commit y conserva el esquema tras reopen. `npm run typecheck` pasó; con ICM local, `npm run verify` terminó con **562 pruebas aprobadas, cero fallidas y una omitida** por plataforma. `npm run build` pasó con 433 módulos. `git diff --check` pasó. No se invocaron proveedores de inferencia reales. La convocatoria por ventanas, el avance automático y durable del reloj ficticio, la fidelidad/ritmo audiovisual y la aceptación integral de los 77 requisitos siguen pendientes.

## Corte 34: compositor gráfico de metaindicaciones

La vista de representación incluye un panel separado para activar la sesión Director con alcance de corrida o escena, seleccionar personajes preparados, escribir instrucciones privadas y consultar el historial durable. La lectura usa el ledger autenticado; los envíos fijan CSRF, ETag e idempotencia y conservan la misma operación si la respuesta queda incierta. El DTO público de escena incluye su membresía para filtrar destinatarios visibles. El panel explica que la guía no sustituye identidad, memoria, deseos ni punto de vista del actor; una indicación de escena fuera de la escena activa aparece como no vigente para turnos nuevos. No crea hechos, eventos ficticios, memoria ni convocatorias.

La revisión corrigió pruebas de migración que seguían considerando v29 como versión actual y añadió cobertura del cliente HTTP de Dirección. `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm TMPDIR=/private/tmp npm run verify` pasó: TypeScript y **559 pruebas aprobadas, cero fallidas y una omitida** (proceso zombie Linux, incompatible con macOS). `npm run build` pasó con 433 módulos; carga inicial 380,41 kB (116,42 kB gzip) y el chunk de preparación 211,79 kB (57,44 kB gzip). No se hizo recorrido manual de navegador ni hubo login/inferencia de proveedor real; quedan pendientes la revocación, precedencia, cambios físicos de circunstancias y aceptación integral de los 77 requisitos.

## Estructura episódica y escenas activas (15 de octubre de 2026)

El journal v29 persiste episodios, escenas y actos opcionales con revisión y operaciones idempotentes. El inicio de una corrida crea el episodio inicial y enlaza la escena configurada en la misma transición durable; los cierres estructurales conservan corte, consecuencias y líneas abiertas sin inventar hechos diegéticos. Cerrar una escena retira la presencia de sus participantes y conserva su ubicación. HTTP→SQLite acredita replay con ETag obsoleto, rechazo de lugar desconocido sin commit parcial y reconstrucción de la estructura en cortes distintos que comparten `worldSeq`. El panel presenta cortes y evidencia, limita los actos al episodio abierto y muestra estructura histórica inmutable junto al registro limitado al mismo `commitIndex`; cada evento, conversación, cambio estructural y observación Director permite abrir el corte exacto. La proyección de observaciones del Director resuelve cada `eventId` citado a su primer commit confirmado, valida integridad y pertenencia al corte, y desde el panel se puede abrir ese evento directamente con su `commitIndex`; la historia inicia en la secuencia citada para que el evento aparezca en la primera página. Cada observación muestra el commit al que se refiere junto a su fecha real de aceptación e identifica la lectura retrospectiva sin presentarla como tiempo ficticio. Faltan aceptación de navegador y proveedor live; el fork sigue pendiente.

`npm run typecheck`, `npm run build`, `git diff --check` y `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm TMPDIR=/private/tmp npm run verify` pasaron el 15 de octubre. La suite terminó con **554 pruebas aprobadas, cero fallidas y una omitida** (ensayo de proceso zombie Linux, no disponible en macOS); Vite transformó 430 módulos. La prueba de frontera del bundle confirma que los DTO del navegador no importan dependencias del host. Esta revisión agregó navegación desde evidencia citada del Director hasta el commit exacto y mantiene los mismos totales de prueba. No hubo inferencia de proveedor real; el Director ya expone sus observaciones aceptadas en la interfaz, pero no se acredita la aceptación integral de los 77 requisitos.

## Portabilidad local de las pruebas (15 de octubre de 2026)

La suite local fallaba en macOS porque `os.tmpdir()` devolvía `/var/folders/...`, alias de `/private/var/folders/...`; los servicios de backup y las pruebas de integridad de sesiones requieren raíces canónicas. Se canonicalizaron las raíces temporales de los fixtures de backup, intercambio, Narrador y sesiones administrativas, sin relajar las comprobaciones de seguridad del producto. Con `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify`, TypeScript pasó y la suite terminó con **545 pruebas aprobadas, cero fallidas y una omitida**: la prueba de un proceso zombie Linux real, incompatible con macOS. `npm run build` pasó con 426 módulos; la carga inicial queda en 380,41 kB (116,42 kB gzip) y preparación se separa en un chunk de 176,49 kB (48,32 kB gzip), junto con acceso e intercambio. El aviso por chunks mayores de 500 kB ya no aparece. Este gate local no acredita servicios externos ni cierra la aceptación de los 77 requisitos.

## Corte 33: Narrador con revisión independiente y canal público

Journal v28 exige un recibo de revisión independiente ligado a propuesta/contexto/corte exactos y a pruebas JSONL congeladas. Narrador y revisor tienen sesión, generación y cuota propias dentro del presupuesto agregado del pulso. Las pruebas distinguen emisión de verdad física y subjetividad registrada; cancelación, manipulación y ausencia de decisión bloquean publicar. La migración conserva sólo publicaciones históricas verificadas.

La composición productiva conecta Narrador después del Director. API autenticada y panel de voz en off muestran publicaciones por corte confirmado sin contexto ni revisión privados. El puente de voz usa texto/configuración/fecha originales y sólo notifica nuevas publicaciones; leer o recuperar no genera audio. **546 pruebas aprobadas, cero fallidas y omitidas**, tipos aprobados. Build aprobado: 426 módulos, bundle principal 765,14 kB y voces 47,67 kB, con aviso de tamaño pendiente. Launcher v28 respondió health y assets actuales. Chromium verificó seis aspectos de voz en off, aislamiento, error/recuperación e historia sin reinferencia; SDK controlado, cero proveedores reales. [Evidencia y límites](continuacion-cloud.md).

No hubo login, inferencia ni síntesis de proveedor real. El objetivo integral y los 77 criterios continúan abiertos; restore, iniciativa/rutinas y Configurador siguen parciales.

## Corte 32: integración local verificada y servidor operativo

Journal v27 compone Director con sesión/contexto/ledger propio y presupuesto común. Voces e intercambio usan datos privados, cuotas separadas, integridad y rutas de operador; Chromium verificó los flujos positivos con REST fixture, sin proveedores reales. Inspector opt-in distingue secuencia/revisión/commit y no importa reconocimiento actual en cortes históricos. SSE invalida lecturas públicas con fallback; backup detiene admisión y drena escritores reales. Restore y revisor productivo del Narrador siguen pendientes.

Se corrigió la recuperación de ownership Linux cuando el proceso anterior es zombie, sin matar ni liberar procesos vivos o ambiguos ni borrar datos. El launcher inició, respondió HTML/health/bundle, cerró y reabrió limpiamente y sirve el último build. **522 pruebas aprobadas, cero fallidas y omitidas**, tipos y build aprobados (422 módulos, 758,83 kB principal y 47,67 kB voces; aviso de tamaño pendiente). [Evidencia y límites](continuacion-cloud.md).

La ampliación v28 del revisor Narrador quedó preservada fuera del checkout ejecutable; planner de iniciativa/rutinas y Configurador siguen parciales. El objetivo no se cierra: no hubo login, inferencia de proveedor ni audio remoto, y los 77 requisitos todavía requieren aceptación integral.

## Corte 31: proyección pública, Escenario y compositor humano

RunView deja de transportar la configuración privada completa: la observación pública usa DTO propios para escenario, eventos, conversaciones y jobs, paginados y ligados a cortes confirmados. El plano SVG representa conexiones de forma esquemática explícita, sin inventar coordenadas. Transcript distingue emisión, audiencia efectiva, entrega y proyección de memoria, sin tratar palabras como creencias confirmadas. El compositor deriva identidad/canal de sesión, conserva intención incierta y borradores, y bloquea un nuevo envío si el lifecycle confirmado del padre ya indica pausa aunque el polling de Escenario aún esté atrasado.

Chromium con launcher y tres corridas sintéticas verificó **17 comprobaciones**, incluidas intervención publicada, filtro y preservación de borrador en pausa, sin errores JavaScript. Se corrigió un parser UUID que rechazaba IDs humanos válidos como `visitante-prueba`, y una carrera de lifecycle entre vistas. El build pasó con 407 módulos y bundle de 738,04 kB. Esta evidencia no es inferencia de proveedor ni aceptación integral de Escenario/conversación. Voces, roles administrativos e intercambio siguen en integración; el gate global de 406 pruebas corresponde al corte anterior.

## Corte 30: continuación Cloud, paso durable y controles gráficos

Checkout actualizado a main b6246e1; Node 24.19.0, ICM 0.11.4 Linux oficial verificado. Journal v26 conserva job de un paso, pulso único, presupuesto/CAS, recuperación conservadora y hashes originales/proyectados del preflight del corte actual. Controles gráficos muestran estado/budget y siguen el job durable. Chromium verificó bloqueos sin preflight, stop/cierre y aislamiento al cambiar de corrida con respuestas pendientes. **406 pruebas aprobadas en Cloud, cero fallidas y cero omitidas**, tipos y build aprobados. [Evidencia, límites y configuración guardada](continuacion-cloud.md).

No hubo login ni inferencia de proveedor real. El objetivo y los 77 criterios integrales permanecen abiertos; la siguiente integración conecta Escenario gráfico, conversación e intervención desde GUI.

## Corte 29: RunView host-owned y proyección del ledger

El host ahora conecta `GET /runs/{id}` y los controles lifecycle con el journal, el broker de preflight y el runtime de representación. `RunView` usa ETag con revisiones de configuración, Escenario y lifecycle; la lectura valida la configuración Ready hash-verificada y proyecta sólo campos públicos, agregando el snapshot y budget actuales. Start/resume requieren un preflight pasado y vigente antes del CAS y del despacho. Si el runtime rechaza el inicio, el host cancela y trata de dejar la corrida pausada. El `step` sigue bloqueado hasta contar con un job durable de pulso único.

La vista refleja llamadas usadas/reservadas y wall time medido/reservado/restante desde SQLite; historial desconocido e incertidumbre siguen visibles sin inventar saldo. Una nueva prueba de integración comprueba que una reserva durable aparece en `RunView`. También se actualizó el manifiesto al cambiar documentos registrados. `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **391 pruebas, cero fallidas y cero omitidas**, con ICM real. `npm run build` pasó con 397 módulos; permanece el aviso del bundle de 692.60 kB.

Este corte conecta API y runtime, no ofrece aún la barra de control ni el tablero de budget durante la representación. El pulso único, la ruta dedicada `/start` y los ledger/roles de audio siguen pendientes. No hubo login ni inferencia de proveedor; la aceptación integral de producto y los 77 requisitos continúa pendiente.

## Corte 26: estado y operaciones durables de lifecycle

La migración v23 añade revisión propia de lifecycle, fecha durable de cierre y namespace de idempotencia para controles. El modelo puro define transiciones de start, pausa, reanudación, step, stop y cierre; el journal aplica start/resume sólo con un preflight pasado, vigente y del mismo perfil/corte, y persiste el resultado para replay exacto. Una prueba SQLite recorre bloqueo sin receipt, start aprobado, pause, close, colisión de key y reapertura. También se corrigió la aceptación de journal v23 al reiniciar; las bases futuras se prueban con v24.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **385 pruebas aprobadas, cero fallidas y cero omitidas**, incluidos los gates de ICM real. `npm run build` pasó con 397 módulos; se mantiene el aviso de bundle mayor a 500 kB. En ese corte aún no había caso de uso host-owned, rutas HTTP, `RunView`/ETag, barra GUI, step durable, cancelación por corrida ni gate fresco en recovery; la cancelación por corrida quedó como base en el corte 27. Por eso el corte 26 acredita persistencia/política, no controles de representación utilizables.

## Corte 27: cancelación del coordinador por corrida

El supervisor del coordinador ahora mantiene un `AbortController` por corrida y ofrece `cancelRun`, que aborta y espera a sus workers sin cerrar el supervisor global. `createRepresentationRuntime` expone la operación al futuro caso de uso de control. La prueba de SQLite inicia un worker, cancela esa corrida, verifica la señal, espera la terminación y confirma el job cancelado. No se agregó una cerca de lifecycle dentro de cada transacción: hasta que se implemente la revisión/época, esta señal cooperativa no descarta todos los efectos tardíos ni habilita controles de UI.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó: TypeScript y **386 pruebas aprobadas, cero fallidas y cero omisiones**, incluidos los gates de ICM/SQLite reales. `npm run build` pasó con 397 módulos; Vite conserva el aviso de bundle JavaScript mayor a 500 kB. El faltante actualizado está en [PENDIENTES](../PENDIENTES.md) y los límites de lifecycle en [controles de representación](controles-de-representacion.md).

## Corte 28: cerca durable por época de lifecycle

La migración v24 agrega `lifecycle_revision` a pulsos y jobs actorales. Cada escritura nueva que pueda avanzar un turno comprueba, dentro de la misma transacción, que el job y su pulso sigan en la época vigente; incluye reserva/dispatch, sesiones de actuación, checkpoints, propuestas, aceptación, review Continuista y commit del Escenario. Pausar aumenta la revisión e invalida claims activos; al reanudar, sólo se rebasa el trabajo queued/accepted. Los trabajos interrumpidos requieren retry explícito con una generación nueva. Los registros previos sin una época demostrable fallan cerrados. El settlement de transporte ya despachado se conserva para medir el gasto real; un resultado tardío no publica el turno.

Las pruebas cubren rechazo de checkpoints tardíos después de pause/resume, invalidación por timeout, migración de jobs legados, retries y recuperación de pulsos. `npm run verify` pasó con TypeScript y **386 pruebas, cero fallidas y cero omitidas**, usando ICM 0.11.4 real/SQLite. `npm run build` pasó con 397 módulos; permanece el aviso del bundle de 687.59 kB. Este corte cierra la cerca en el journal, no el control operativo: aún faltan API, caso de uso, ETag, GUI, `step` durable y gate fresco antes de recovery.

## Presupuesto acumulado de inferencia (journal v22)

El journal reserva y mide wall time real por request para los workers Pi de actor y Continuista. La misma transacción aplica el límite agregado y la concurrencia. El runtime aplica timeout, bloquea tools/candidatos/reviews tardíos y espera el cierre real del transporte antes de liberar ownership. Los tramos cerrados conservan la duración exacta incluso con overrun; los despachados sin cierre sobreviven al restart como inciertos y bloquean nuevas llamadas. Historial anterior no medido queda `legacy-unknown`; el preflight consulta el ledger real y bloquea estados desconocidos, inciertos, agotados o desajustados. La corrida pausa por timeout o agotamiento sin insertar un evento ficticio.

La revisión focal independiente pasó **111/111**; `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó TypeScript y **381 pruebas con ICM real, cero fallos y cero omisiones**. Se añadieron `GET /runs/{id}/budget` y un panel visual de lectura en la preparación Ready. `npm run build` pasó con 397 módulos; permanece el aviso de bundle JavaScript mayor a 500 kB. Los SDK de actor y Continuista se probaron con transportes controlados y SQLite real; no hubo login ni inferencia real. Falta llevar el ledger a Director, narrador y operaciones de audio, mantener la vista en la representación activa e integrar inicio y controles operativos. El objetivo y los 77 requisitos integrales siguen pendientes.

## Vigésimo quinto corte: preflight durable desde preparación

La API, broker, adaptador host y GUI conectan la comprobación explícita del corte Ready guardado. El informe conserva resultados históricos, distingue vigencia y exige quince gates para aprobar. Cambios en configuración, Escenario, credencial o resultado posterior de acceso invalidan la comprobación anterior; reiniciar no la repite. La interfaz distingue preparación válida de disponibilidad para ejecutar.

TypeScript, **364 pruebas con ICM real, cero fallos y cero omisiones**, y build pasaron. Se operó el flujo en navegador con una preparación sintética: evaluar, reiniciar, recuperar y editar con informe obsoleto. [Auditoría y límites](preflight-durable.md). El host sigue bloqueando runtime del Director/narrador, tiempo acumulado y recursos pendientes; este corte no inicia una representación ni acredita inferencia live. Los 77 criterios integrales permanecen pendientes.

## Vigésimo cuarto corte: sondeo durable y acceso desde interfaz

El journal v20, broker y launcher conectan sondeos explícitos de Sol/Opus, con leases, CAS, receipts inmutables, namespace idempotente compartido y recuperación sin nueva llamada. La metadata pública separa aprobación, fallo e incertidumbre; los secretos y HMAC permanecen privados. El cierre espera al transporte real y no adopta resultados tardíos de un intento ambiguo.

La revisión corrigió readJob entre broker/HTTP, replay de completion tras reiniciar, mezcla de evidencias de trabajos distintos, vínculo del perfil en el cliente y contadores de uso. El navegador mostró auth-required en un host sin credencial y recuperó el mismo trabajo tras reiniciar. No hubo login, inferencia live ni representación.

TypeScript, **334 pruebas con ICM real, cero fallos y cero omisiones**, y build de 392 módulos pasaron. La [auditoría](sondeos-durables.md) conserva rutas, pruebas y límites. Falta preflight/inicio/control integrado, acceso live, credencial Anthropic desde GUI, tiempo acumulado, conversación/escena visibles, dirección, voz y recuperación integral. Los 77 criterios siguen pendientes.

## Vigésimo tercer corte: Sol bajo y Opus medio

Por pedido posterior del usuario, el perfil de nuevas representaciones es seleccionable: GPT-6.1 Sol low, predeterminado, o Claude Opus 5.5 medium. La selección llega al preflight, actor, Continuista, contexto hash y ledger; la autenticación se comprueba por proveedor. Luna queda para leer historia y recuperar aceptaciones durables sin inferir. Los registros anteriores conservan JSON y hashes.

El SDK real con transporte controlado verifica los dos modelos y su esfuerzo efectivo, incluido el ajuste por turno de Opus. Existe un puerto host de sondeo explícito sin sesión/contexto ficticio; falta conectarlo a jobs/receipts durables y HTTP/GUI. El navegador guardó y reabrió una selección de Claude en un host temporal, sin representación ni login.

TypeScript, **310 pruebas con ICM real, cero fallos y cero omisiones**, y build pasaron. La [auditoría de perfiles](perfiles-sol-y-opus.md) conserva pruebas, fuentes y límites. El objetivo y la aceptación integral de los 77 requisitos siguen activos.

## Vigésimo segundo corte: acceso Pi, editores y contexto propio

El journal v19 y el launcher conectan jobs administrativos OAuth y ModelRuntime compartido, con guía temporal por sesión local y metadata sin credenciales. Hay editores de continuidad, identidad humana, curación actoral y Escenario, incluida colocación explícita con objetivos, relaciones e inventario propios. La revisión corrigió filtración de hitos de dirección y conceder observación; el navegador detectó y corrigió el receptor de fetch en OAuth y guardado. El preflight ahora bloquea cualquier gate diferido.

TypeScript y **290 pruebas con ICM real, cero fallos y cero omisiones**, más build de 387 módulos, pasaron. El navegador confirmó consulta de acceso y guardado de un lugar con plano en un borrador sintético; SQLite mostró cero representación/eventos/sesiones/jobs/reservas. La [auditoría del corte](oauth-y-preparacion.md) conserva evidencia y límites.

Siguen pendientes acceso live, recorrido completo de preparación desde GUI, preflight e inicio/control durables, tiempo acumulado, representación/conversación visibles, dirección/narrador, ritmo/voz, replay/backups/restauración y aceptación de los 77 requisitos. No se hizo login ni inferencia real.

## Vigésimo primer corte: preparación gráfica, promoción y launcher

El launcher compone el runtime con una ruta ICM absoluta fijada por el operador y espera workers antes de liberar ownership. Las pruebas de procesos reales verifican arranque/cierre y ausencia de puestas inventadas. V17 guarda borradores con CAS/historial; v18 añade validación y promoción Ready atómicas, reportes y namespace idempotente compartido. Editar Ready invalida preparación; revalidar no descarta conocimiento ni actividad durables.

La API expone resúmenes sin configuración privada, receipts inmutables de creación/edición y lectura actual separada. La GUI guarda/reabre, permite configurar circunstancias y reparto previsto, muestra faltantes, conserva conflictos y reintenta respuestas perdidas con la misma clave y contenido. Ready deriva del estado durable y no inicia una obra. Se separaron los contratos del navegador de funciones Node del host.

La revisión independiente corrigió lectura de drafts completos sin reporte, pérdida de conocimiento confirmado y replay con cuerpo actual/ETag antiguo. El navegador detectó un encabezado ausente y nombres de pendientes indistinguibles; se corrigieron. El recorrido temporal guardó y reabrió una preparación tras reiniciar; SQLite confirmó un borrador/reporte y cero WorldRuns, eventos, sesiones actorales, jobs y reservas.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **251 pruebas aprobadas, cero fallidas y cero omitidas**. El build pasó con 379 módulos, sin externalización de Node crypto; conserva advertencia de bundle mayor de 500 kB. La [auditoría del corte](launcher-y-borradores.md) registra alcances y límites.

Faltan editores completos de curación, continuidad, Escenario, escenas/canales/posiciones, perfiles humanos y audio; preflight/OAuth/inicio/control desde GUI, actuación y conversación visibles, tiempo acumulado, dirección/narrador, ritmo/voz, historia/replay/backups y aceptación integral/live. Los 77 criterios y el objetivo completo siguen pendientes.

## Vigésimo corte: recuperación parental, JSONL y composición

El journal v16 reconcilia el claim nuevo con el terminal/propuesta originales y una revisión administrativa aceptada con `allow`. El worker consulta las pruebas antes de compilar, llamar memoria o crear sesión. Con pruebas completas termina aceptación/commit sin otra inferencia; las colas pendientes o inciertas quedan `recovery-required`. Terminal/propuesta se vinculan de forma inmutable, con backfill conservador; grant y aceptación/consumo son atómicos.

Dos revisiones independientes corrigieron la autoridad de grants huérfanos/alterados y la adopción de un leaf cuyo JSONL había desaparecido. Antes de adoptar un leaf se verifica el archivo por lectura local: ruta privada, UTF-8, header y versión, IDs y todas las cadenas de padres. Un JSONL inválido bloquea sin modelos ni eventos. El control es estructural: modificaciones válidas conservando IDs necesitan hashes independientes aún pendientes. Un commit ya aceptado conserva la autoridad del journal.

`createRepresentationRuntime` conecta entregas, proyección ICM, actores, Continuista y coordinador bajo el host existente. Una versión inválida o un fallo de memoria suspenden convocatoria; no inventan una búsqueda vacía. Se corrigieron tres ventanas de operación: health-check con outbox vacío, cierre que no esperaba operaciones públicas y waitForIdle que podía devolver antes de una actuación recién agendada. Las pruebas ejercitan cierre con CLI bloqueado y estabilidad de las colas.

`createPiOAuthPort` integra login/logout/status del mismo ModelRuntime con provider/tipo fijos, exclusión y cancelación, sin devolver credenciales ni errores sensibles. `accountAccess: not-verified` evita presentar metadata como prueba de acceso. Todavía faltan HTTP/UI de login; no se ejecutó autenticación real.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **225 pruebas aprobadas, cero fallidas y cero omitidas**. El build pasó con 369 módulos. Los tests incluyen JSONL de SDK real y faults de archivo/leaf/UTF-8/header, SQLite e ICM reales y transporte/modelo controlados. La [auditoría del corte](recuperacion-parental-y-runtime.md) registra evidencia y límites.

El launcher todavía no inicia la composición. Siguen pendientes API/GUI de puesta, representación y OAuth, tiempo acumulado, dirección/narrador, voces/ritmo, historia/replay/backups y ensayos integrales/live. Los 77 criterios y el objetivo completo siguen pendientes.

## Decimonoveno corte: ejecución Pi administrativa y receipts del Continuista

El journal v15 y `createContinuistaPiWorker` conectan un child administrativo con sesión Pi propia, contexto exacto, tool cerrada y presupuesto compartido con el actor/pulso. Un diagnóstico incompleto bloquea el child sin habilitar efectos. La revisión aceptada puede recuperarse desde un receipt durable sin otra sesión/modelo del Continuista.

La revisión independiente encontró tres ventanas de autoridad: doble despacho bajo una reserva, recuperación de un receipt sin comprobar sus referencias y terminal que nombraba una request anterior. Se corrigieron con precondición `reserved` y un helper común de pruebas durables usado al aceptar y recuperar: candidato/contexto, terminal, sesión, ambos leases originales, último request/input exactos completados y ausencia de pendientes/ambiguos. Rehashear referencias inexistentes no concede autoridad.

Los schemas/validadores de contexto y proyección se separaron en dominio para compartir el mismo contrato entre ensamblador y SQLite sin importar lógica de prompt en el adaptador. Los imports anteriores conservan reexports compatibles. El arranque de `openLocalHost` ahora recupera claims administrativos después de adquirir ownership; una prueba integrada verifica contexto/pulso conservados y ausencia de nuevo despacho.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **200 pruebas aprobadas, cero fallidas y cero omitidas**. El build pasó con 369 módulos. Los tests usan SDK Pi real, journal e ICM reales donde corresponde, y transporte/revisión controlados; no hay OAuth ni inferencia de Luna acreditados. La [auditoría del Continuista](continuista-pi-y-recibos.md) detalla garantías y límites.

Continúan pendientes reconciliar el terminal parental actoral ya completado antes de volver a generar, integrar los componentes al launcher, controlar tiempo acumulado y completar la GUI de puesta/representación, dirección, audio y recorridos integrales. Los 77 criterios de aceptación y el objetivo completo siguen pendientes.

## Decimoctavo corte: coordinador durable y contexto del Continuista

El journal v14 agrupa intenciones por causa de un commit real, crea su pulso y asigna jobs en una transacción. El ID y la cuota se conservan tras reiniciar; una segunda causa no entra en el inbox del primer job. Una entrega tardía añade al destinatario al mismo pulso. El cierre espera sus entregas y el commit exacto de los jobs aceptados; un retry explícito reabre el pulso bloqueado sin ampliar presupuesto.

`createCoordinatorPulseSupervisor` ejecuta el worker de forma serial por corrida, conserva las señales recibidas durante la actuación y recupera propuestas aceptadas una vez por pasada antes de consultar el cierre durable. La revisión detectó un posible bucle de recuperación y falta de disponibilidad circadiana. Se corrigieron: el supervisor no repite infinitamente accepted/existing, y el journal verifica disponibilidad efectiva con el reloj ficticio antes de asignar y despachar. Una entrada recibida antes de dormir queda pendiente hasta despertar; no se usa tiempo real para activarla.

El [contexto y tool del Continuista](pulsos-y-contexto-continuista.md) ya se construyen desde la propuesta exacta y la vista autorizada del actor. El paquete tiene hash y mapa de evidencia; la tool sólo registra un candidato local ligado a ese contexto, con replay exacto, cancelación y diagnóstico incompleto. Faltan ledger, checkpoints y terminal administrativo durables antes de que ese candidato pueda usarse en una sesión Pi productiva.

Se corrigieron también los límites de `RunBudgetSchema`: llamadas/run 0–100000, llamadas/pulso 0–256, concurrencia 1–8 y tiempo operativo máximo 0–31536000000 ms. Cero es una configuración válida que no permite solicitudes de esa categoría; las reservas coordinadas comprueban el caso de tiempo cero. La contabilización durable del tiempo acumulado para límites positivos sigue pendiente; no se presenta un timeout por job como equivalente.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **189 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build` pasó con 369 módulos. Se ejercitaron journal, SQLite e ICM reales; el transporte y el juicio del revisor están controlados en pruebas, sin OAuth ni inferencia de Luna. El launcher todavía no crea el coordinador ni una sesión LLM administrativa. La interfaz sigue siendo la biblioteca, sin puesta/conversación observable. Los 77 criterios integrales y el objetivo completo siguen pendientes.

## Decimoséptimo corte: worker actoral y recuperación de fallos

`createActorTurnWorker` conecta configuración hash-verificada, contexto y memoria propios, sesión Pi, propuesta durable, revisión exacta, reformulación, aceptación terminal y commit de Escenario. La factory productiva sigue siendo `createPiSession` con OAuth y el perfil obligatorio; las pruebas inyectan transporte local y una revisión controlada, incluida una sesión real del SDK con tools/resultados/checkpoints. No acreditan inferencia de Luna ni juicio LLM del Continuista.

El journal v13 conserva fallos como jobs `blocked` y asignaciones `released`, sin consumir el inbox ni reiniciar cuotas. El reintento explícito abre otra generación bajo el mismo pulso e incorpora entradas pendientes. La recuperación de un job con corte congelado no agrega mensajes tardíos. Si la propuesta ya fue aceptada, el worker recupera su receipt y termina el commit sin otro prompt. Las percepciones de otros actores generan intenciones de reacción; las propias no reactivan al emisor.

La revisión independiente detectó ejecución simultánea de una sesión y feedback sin diagnóstico. Se corrigieron con exclusión por corrida/personaje compartida entre workers del mismo journal, y [criterios fallidos públicos](diagnostico-publico-continuista.md) separados de la rúbrica evaluada. Los consumidores de `onCommitted` deben deduplicar por commit durable porque la recuperación puede repetir la notificación. Las [tools tipadas](tools-tipadas-y-reformulacion.md) se validan también con el SDK real y conservan versión/slot por reformulación.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **171 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build` pasó con 369 módulos transformados. Las pruebas incluyen migración v12→v13 con jobs poblados, reservas despachadas y cuota agotada; lectura de revisiones históricas sin cambiar hashes; fallo/retry, cancelación, rechazo, reformulación, recuperación accept→commit y exclusión concurrente.

El launcher todavía no convoca este worker: faltan coordinador y lifecycle durable del pulso, sesión administrativa productiva del Continuista, puesta desde GUI y conversación visible. El objetivo completo sigue activo y los 77 requisitos integrales permanecen pendientes.

## Decimosexto corte: puerto Pi y despacho con inputs durables

El journal v12 y `createActorPiRequestPort` conectan la interfaz de requests Pi con identidad, scope y lease host-owned. Reserva y despacho comprueban elegibilidad en la misma transacción que cambia su ledger. Cada reserva se atribuye al claim original; pausa, corte obsoleto o resultado incierto bloquean otro despacho. Checkpoints canónicos se guardan sin avanzar el leaf. Despachar exige checkpoint y candidato de input exactos, y repetir un estado ya `dispatched` no concede otro transporte.

La revisión independiente del agente `pi_port_review` detectó la falta de esa precondición de input; quedó corregida. También precisó el orden de reformulación: el Continuista revisa antes de aceptar el terminal final. Una prueba positiva vincula propuesta/revisión/terminal/receipt y commit con replay durable. El [informe del puerto](puerto-pi-y-frontera-de-despacho.md) detalla las garantías y límites. El worker, las sesiones reales y la interfaz de conversación siguen pendientes.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **153 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build` pasó con 369 módulos transformados. Las pruebas usan journal e ICM reales donde corresponde; los candidatos Pi de esta integración son fixtures, sin OAuth ni transporte de Luna.

## Decimoquinto corte: corte World completo congelado por job

La migración v11 amplía el claim durable: junto con el inbox exacto guarda `worldRevision`, `worldSeq` y `fictionalAt`. Al proyectar el mundo para el personaje, el host exige esos valores y reconstruye el snapshot histórico correspondiente. Una intervención que llegue durante la generación queda fuera del texto y del estado World que vio ese turno; la aceptación Pi exige el mismo corte entero. La recuperación de host conserva la revisión, secuencia, hora ficticia y percepciones.

Las pruebas de journal ya recorren una intervención posterior al claim, reconstruyen el estado histórico original pese a que el mundo avanzó, y verifican que restart preserve el corte. También recorren candidatos y aceptación con el corte congelado; la migración v1→v11 y el backfill v5→v11 quedan cubiertos. Este cambio elimina la mezcla de un inbox viejo con un snapshot nuevo, aunque una respuesta basada en un corte obsoleto aún tendrá que superar el CAS normal antes de modificar Escenario.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **151 pruebas aprobadas, cero fallidas y cero omitidas**; `npm run build` pasó con 369 módulos transformados. El test de ownership ahora también verifica que la recuperación de host conserva el JSON íntegro del corte congelado. Sigue sin haber conversación visible o inferencia real.

## Decimocuarto corte: lease en el registro de propuestas

`propose_action` arrastra ahora el lease autenticado del job hasta el journal. Al insertar una propuesta nueva, SQLite exige que el job siga `running` y que coincidan `ownerToken` y `claimToken`; si el job fue recuperado, terminó o pertenece a otra generación, el callback tardío no registra contenido. El commit de Escenario para propuestas con job requiere además el receipt Pi aceptado que confirma esa propuesta, versión y hash exactos. Una repetición idempotente de la misma propuesta ya guardada sigue recuperando su recibo. El flujo legacy que no usa jobs conserva su contrato.

Las pruebas usan un job actoral e inbox entregado, y comprueban rechazo sin lease y con owner incorrecto, registro con claim vigente, replay exacto y bloqueo de commit antes de aceptación Pi. También se verifica que la factory de tools propaga el lease sin permitir que lo elija el modelo. El siguiente límite sigue siendo conectar la ejecución Pi y la revisión del Continuista al dispatcher.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **151 pruebas aprobadas, cero fallidas y cero omitidas**. `npm run build` pasó con 369 módulos transformados. Estos gates siguen acreditando contratos locales; la conversación visible y la inferencia real no están conectadas.

## Decimotercer corte: inbox congelado por claim

La migración v10 congela, al reclamar por primera vez un job actoral, los IDs de percepciones ya entregadas y aún no consumidas. Una pregunta nueva que se entrega durante la actuación queda en cola para el job posterior; proyección y candidatos usan el inbox congelado y los candidatos quedan ligados al lease vigente. La recuperación conserva esos IDs, el job, la generación, el pulso y las reservas. La generación nueva para una inferencia ya despachada o ambigua sigue pendiente; S02 distingue ahora esa recuperación de lease de la interrupción de una request.

La prueba del journal crea una intervención después del claim, comprueba que la sesión sólo ve el inbox congelado y que la aceptación deja pendiente el mensaje nuevo. También se prueban el rechazo de un candidato con lease ajeno y la migración/idempotencia v10. Una prueba adicional abre `openLocalHost` con un job activo de un owner anterior y verifica que la recuperación lo reencola conservando sus IDs congelados.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **150 pruebas aprobadas, cero fallidas y cero omitidas**, incluidos los gates ICM reales. `npm run build` pasó con 369 módulos. El tramo de producción `queued → Pi → Continuista → commit Escenario` y la respuesta visible en la interfaz todavía no están conectados; los 77 criterios de aceptación permanecen `pending`.

## Primer corte ejecutado

`npm run verify` terminó con código 0: TypeScript 7.0.2 y **19 tests aprobados**. El corte incluye schemas/IDs, envelope canónico, journal SQLite inicial y catálogo/biblioteca. Las pruebas cubren owner/corte/hash, experiencia duplicada versus modificada, cuotas de varios jobs/pulso, reinicio en disco, no refund después de dispatch, schema futuro sin modificación; paridad y lectura íntegra de 27 expedientes, documentos/fuentes, 28 avatares, MIME/hash, traversal/symlink/size y roundtrip editorial.

Las pruebas SQLite usan archivos temporales reales. Esto es evidencia parcial para P12–P14: no prueba todavía CLI ICM, resolución del mundo, outbox, backups ni sesiones Pi. Las pruebas de catálogo son evidencia local de P01/P24: no prueban GUI, curación semántica ni actuación. No se marca ningún requisito integral como completo sólo por estas pruebas.

## Dependencias y reproducción del primer corte

[package.json](../../package.json) y [lockfile](../../package-lock.json) fijan dependencias reales. Host Node 24.18.0; Zod 4.6.5; React/DOM 19.3.0; Pi coding-agent/ai 1.2.0; TypeScript 7.0.2; tsx 4.23.15; Vite 8.3.3; tipos Node 24.19.1. El binario ICM aún no se instaló ni ejecutó.

npm del host tiene `min-release-age=7`. Zod/Vite se fijaron a versiones disponibles con esa antigüedad. Pi 1.2.0 fue publicado el 12 de octubre y corresponde al source/tag auditado; la instalación usó excepciones por comando, limitadas a los siete paquetes Pi de ese release: pi-ai, pi-coding-agent, pi-agent-core, pi-codemode, pi-mcp, pi-tui y pi-telemetry, bajo @earendil-works. No se cambió la configuración global de npm. La reproducción debe conservar esas excepciones si el release aún no cumple la antigüedad. El lockfile conserva integridades; `npm audit` de instalación reportó cero vulnerabilidades conocidas, sin afirmar auditoría del código externo.

npm bloqueó scripts de instalación de esbuild/fsevents conforme a la configuración del host. No se aprobaron ni ejecutaron esos scripts para sortearlo. tsx y los tests funcionaron con los paquetes instalados; el build de interfaz aún no se verificó.

## Trabajo pendiente al primer corte

Catálogo listo como adapter local; fábrica Pi y servidor HTTP local se implementan en responsabilidades separadas. Faltan motor de Escenario/resolución/percepción, configuración/curación y evolución, integración ICM y recovery completo, coordinación/dirección/narrador, flujos OAuth y audio, GUI completa y pruebas live/acústicas. Las pruebas locales no certifican cuenta, modelo efectivo en inferencia, voz ni ritmo de episodios.

## Segundo corte: TypeScript, biblioteca y CLI reales

El 14 de octubre, `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` terminó con código 0: chequeo de tipos y **55 pruebas aprobadas, sin omisiones**. `npm run build` también terminó con código 0. Este corte incorpora HTTP local, sesiones Pi sin inferencia, preparación privada, resolución pura del mundo y el adapter CLI ICM. La compilación y las pruebas no demuestran todavía una representación integrada.

Se aplicó [typescript-best-practices](../../.agents/skills/typescript-best-practices/SKILL.md): schemas en límites, variantes con `kind`, IDs con marca y errores por composición. Se eliminaron assertions innecesarias en errores HTTP, lectura de bytes y headers de pruebas; los argumentos de query conservan propiedades propias incluso para nombres especiales. Se corrigió la propagación de `attemptId` en eventos del mundo. Las suites cubren continuidad de Max, desconocidos de 99, voz no verbal de Fang, aislamiento de experiencias, audiencia y alcance, puertas, offers y dispositivos; siguen siendo pruebas de componentes.

`skipLibCheck:true` limita el chequeo a código propio: las declaraciones del SDK instalado tienen incompatibilidades NodeNext (imports JSON sin atributos y un tipo externo ausente). No se afirma haber validado todas las declaraciones de dependencias. Las pruebas de Pi crean sesiones reales del SDK en frío y ejercitan un transporte controlado; no hubo OAuth ni inferencia de Luna. No hay fallback de modelo ni relajación de tipos propios.

ICM 0.11.4 fue compilado desde el commit fijado en un directorio temporal aislado y ejecutado contra SQLite real. La [evidencia del adapter](ejecucion-icm.md) conserva versión, hash y límites. El journal/outbox y los receipts aún necesitan integración; estas pruebas no cierran P12. La ruta temporal del binario sirve para esta verificación, no es una instalación durable para usuarios.

La biblioteca fue abierta en el navegador local: catálogo y avatares reales, búsqueda por texto, lectura de Max y regreso al catálogo. Se corrigieron el DTO de búsqueda y la vista estrecha que dejaba el lector debajo de todo el reparto. Esa evidencia no certifica los flujos de configuración, actuación, audio, inspector, replay ni control de la interfaz completa. La presentación Markdown aún requiere mejora.

El objetivo sigue activo. La siguiente integración conecta experiencias inmutables, outbox y receipts sin asumir una transacción entre SQLite del journal e ICM. Continúan revisiones adversariales separadas de preparación y resolución del mundo.

## Tercer corte: integración local y revisión de autoridad

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó nuevamente: **90 pruebas aprobadas, cero fallos y cero omisiones**. El build Vite pasó. Se corrigieron los fixtures de journal: la versión futura es ahora 4 y una base v1 atraviesa las migraciones `[1,2,3]` conservando sus experiencias/outbox. No se omitieron fallos para obtener ese resultado.

La [integración de memoria](integracion-memoria.md) añadió outbox/receipt y recuperación por reapertura con CLI/SQLite reales. La [integración journal–mundo](integracion-journal-mundo.md) añadió registro de corrida, continuidad, propuesta/revisión exacta, resolución, eventos, percepciones y entrega en transacciones reales; una entrega confirmada crea la experiencia/outbox. Los ensayos verifican rollback SQL, dedupe tras reinicio y publicación bloqueada sin recibo. El gate no sustituye P12 ni representa ejecución Pi del producto.

Las revisiones independientes corrigieron [percepción y autoridad del mundo](revision-implementacion-mundo.md), [preparación](revision-implementacion-preparacion.md) y [Pi](revision-implementacion-pi.md). El actor ya no presenta su propia aprobación; el recibo host debe provenir del ledger del Continuista. El [puente de contexto](integracion-contexto-actor.md) conserva handles y contexto operativo filtrado, verifica identidad/corte y persiste conocimiento por CAS antes de exponerlo. Pi distingue checkpoint base del job, entrada de cada request y candidato terminal; ninguno avanza por sí mismo el leaf aceptado. Hay una revisión independiente adicional del journal v3 en curso.

El [ownership del host](ownership-host.md) se compuso con el journal en `openLocalHost` y con el launcher real. Se inició el servidor usando un directorio temporal privado; otro proceso con el mismo directorio y distinto puerto terminó con código 1 y diagnóstico seguro `ALREADY_OWNED`. La biblioteca siguió accesible en el navegador. Un gate abandonado por caída requiere revisión manual conservadora: todavía falta su recorrido de recuperación en GUI. Los workers de representación aún no están conectados al launcher.

El lector usa `react-markdown` 10.1.0 y `remark-gfm` 4.0.1, fijados en el lockfile y verificados contra documentación primaria mediante Context7. Muestra tablas/listas/énfasis y enlaces HTTP(S); una prueba SSR real confirma que no ejecuta HTML ni carga imágenes remotas del Markdown. Los enlaces relativos siguen como referencias textuales identificadas, pendientes de navegación mediante el catálogo. La GUI real se volvió a recorrer: ficha de Max con tablas y fuentes, cambio de sección mientras estaba abierta, investigaciones y lista de fuentes/paper. No se afirma haber recorrido toda la interfaz ni las 27 fichas gráficamente.

Se corrigió una inconsistencia editorial residual de S07: sus párrafos aún llamaban v0.1 a S04–S06 y dejaban G0 pendiente pese al cierre documental de las specs 1.0. Sólo se corrigió ese estado; no se cerraron los gates de producto. Sigue sin haber OAuth, inferencia real, audio ElevenLabs ni validación acústica de episodios. Tampoco hay todavía configuración/curación completa en GUI, coordinación de la obra, narrador, replay integral, backups o cobertura final de los 77 requisitos.

## Cuarto corte: vista diegética por personaje

`npm run typecheck` pasó. `node --import tsx --test tests/world.test.ts tests/preparation.test.ts` pasó **28/28**, sin omisiones. La vista completa del actor ahora incorpora su inventario, rutina, disponibilidad efectiva, capacidades, duraciones de acciones y tiempos de movimiento. También expone estado, efectos, duración y disponibilidad de las operaciones de dispositivos. En la proyección de otros personajes sólo aparece disponibilidad efectiva; no se entregan rutina, motivo privado ni inventario ajenos. El resolver rechaza cambios de iluminación fuera de la escena o en lugares que no son accesibles desde el corte vigente.

Este gate focal no comprueba aún la integración HTTP/GUI ni el ciclo de inferencia. En ese momento seguía en revisión el cursor de sesión Pi y la aceptación transaccional de turnos con las percepciones exactas de cada request. La suite global posterior a ese corte se registra en el quinto corte.

La revisión del runtime confirma que la interfaz actual sigue concentrada en biblioteca/lectura: el launcher abre el host y el journal, pero todavía no inicia workers de representación; HTTP aún no ofrece operaciones de puesta, pulso, actuación o dirección. Las pantallas completas de S05, el OAuth/inferencia real, el narrador operativo, voz/TTS, replay/historia integral, backup y prueba acústica de ritmo siguen fuera del alcance implementado. El espejo [requisitos-prd.json](requisitos-prd.json) conserva **77 estados `pending`** y ya enumera niveles mínimos por requisito y subresultados independientes de P21; falta ejecutar esas evidencias y cerrar los criterios integrales, sin convertir pruebas unitarias de componente en aprobación de producto.

## Quinto corte: cursor Pi durable y gate global

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó: TypeScript y **125 pruebas aprobadas, cero fallos y cero omisiones**. `npm run build` también pasó y transformó 369 módulos. La primera ejecución global después de integrar el cursor había revelado ocho fixtures de preparación que no incluían `inputPerceptionIds`; se corrigió el fixture de prueba y se repitió el gate completo con éxito.

La migración del journal a v5 agrega ledger de sesiones, candidatos de request/terminal, recibos de aceptación y consumo de percepciones por actor. El host acepta sólo candidatos terminales completados, verifica perfil/contexto/corte/candidatos de request y receipt de la última respuesta, y avanza el leaf aceptado mientras consume el inbox en una transacción. Retry de aceptación es durable e idempotente. El ledger impide registrar requests después del candidato terminal y exige que éste nombre el último request durable. Una sesión inicial cuyo archivo creció tras una caída se rota por CAS sólo antes del primer leaf aceptado; una sesión ya aceptada reabre desde su leaf confirmado. Las pruebas focales de journal, Pi, proyección y mundo-journal pasan 36/36. La proyección incluye los IDs exactos del inbox entregado y deja esos IDs fuera del texto del personaje.

Esta evidencia cierra el ledger local del cursor, no el ciclo de una representación. La resolución registrada en el journal aún restringe `origin_kind` a `actorAttempt`: una intervención humana o una dirección del meta-agente no pueden originar percepciones en este esquema. El launcher tampoco registra sesiones por actor, inicia workers ni conecta los turnos con Pi e ICM Memory. Siguen pendientes servidor de puesta/pulso/intervención, interfaz completa, OAuth e inferencia real, moderación ejecutable, voz/audio, replay y mapeo individual de los 77 requisitos. El gate global no convierte ninguno de ellos en terminado.

## Sexto corte: identidad ficticia propia para participación humana

Tras la elección expresa de la persona usuaria, el dominio distingue `HumanParticipantId` de `CharacterId` y define schemas para identidad, historia de vida y presencia `inScene` o `remote`, con lugar, posición y canal. `SessionMode.interlocutor` usa ahora el ID tipado. El glosario, D09, la continuidad de la puesta, la participación y S01/S04 documentan la decisión: identidad propia controlada por la persona, sin convertirla en actor Pi. La cobertura mantiene el pedido como parcial porque el perfil todavía no está integrado en la configuración persistente, no se valida contra el snapshot vigente y aún no hay ruta ni resolución durable de la intervención.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con **131 pruebas, cero fallos y cero omisiones**. `npm run build` transformó 369 módulos y terminó correctamente. Se movió `HumanParticipantIdSchema` a los valores básicos para evitar que el contrato HTTP importe el módulo de mundo y arrastre `node:crypto` al cliente; con ese límite corregido, el build ya no emite la advertencia de externalización ni supera 500 kB.

## Séptimo corte: perfil humano en la configuración durable

`RunConfigurationDraft` y `ReadyRunConfiguration` ahora contienen `humanParticipants`, con ausencia de participantes como default explícito y sin generar una identidad ficticia. El preflight valida unicidad de ID, escena inicial abierta cuando el perfil está `inScene`, lugar, coordenadas y un canal de habla habilitado en ese lugar. La configuración ya se guarda dentro de la configuración inmutable de `world_runs`; `readWorldConfiguration` la devuelve sólo tras verificar el hash del journal.

El launcher conecta el resolver de `PUT /session/mode` con esa lectura durable. Un modo `interlocutor` sólo se acepta si la corrida contiene el perfil y toda la `ReadyRunConfiguration` pasa validación semántica. También se comprueba que el scope de una sesión directorial exista. No se añade un perfil Pi ni se registra todavía una intervención como evento.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con **134 pruebas, cero fallos y cero omisiones**; `npm run build` pasó con 369 módulos. Además, `npm start` abrió un host en loopback con un directorio privado nuevo y `/api/v1/health` respondió; el proceso informó `runtime: unavailable`, por lo que este smoke test no prueba una corrida, login Pi ni intervención real. La cobertura ahora prueba persistencia/configuración, validación espacial/de canal, modo ligado al perfil y rechazo de configuración semánticamente inválida.

En ese corte no se cerraba la participación humana: faltaban edición/API/GUI de la configuración, evento y percepciones de origen humano, commit durable idempotente, testimonios privados y workers que convoquen las instancias Pi con los IDs recibidos. El journal estaba en v5 con `origin_kind='actorAttempt'`; no se simulaba la intervención como intento de personaje.

## Octavo corte: intervención humana en el dominio y commits generales

La capa de dominio ya resuelve intervenciones de una identidad ficticia propia contra una revisión exacta del Escenario. Comprueba escena abierta, presencia, lugar, canal, audiencia, alcance espacial de audición y disponibilidad de cada destinatario. La intervención produce un evento de origen humano y testimonios privados con nombre y palabras del participante; el testimonio no certifica verdad. El reloj avanza según la duración del habla y las ofertas vencidas se invalidan con eventos causales. Pruebas cubren destinatarios, broadcast, filtrado de biografía, canales y audiencia inválidos, corte obsoleto y vencimientos.

La migración v6 añadió `world_commits`, ledger general que reconstruye snapshots por corte y hace backfill verificable de commits actorales desde `world_resolutions`. La suite pasó con TypeScript y **139 pruebas aprobadas, cero fallos y cero omisiones**. `npm run build` pasó y transformó 369 módulos.

En ese corte aún no había conversación de extremo a extremo: no existían commit durable, ruta HTTP, worker Pi ni compositor GUI. La auditoría [de participación humana](participacion-humana.md) registró las fronteras y el siguiente corte v6→v7.

## Noveno corte: commit durable y API de intervención

La migración v7 hace nullable el `attempt_id` heredado de percepciones, preserva las filas e índices y valida las claves foráneas. Los lectores del inbox usan ahora `world_commits`, así que una percepción puede proceder de un commit humano sin inventar un `actorAttempt`. `human_intervention_receipts` hace durable la idempotencia por corrida/participante/clave.

`commitHumanIntervention` deriva el perfil de la configuración hash-verificada y confirma en una transacción el evento de origen humano, los efectos de reloj, el snapshot, las percepciones privadas, las entregas planificadas y el receipt. Los reintentos tras reabrir el journal devuelven los mismos IDs; si falla SQL, se revierte el conjunto. El receptor puede confirmar la entrega como `Experience.kind="testimony"`; esa experiencia entra en el corte Pi con la misma identidad y el consumo existente crea el outbox de ICM.

El host ofrece `GET /runs/{id}/intervention-context` y `POST /runs/{id}/interventions`, restringidos a una sesión interlocutora ligada al perfil configurado. La ruta de escritura requiere CSRF, `If-Match` de revisión World e `Idempotency-Key`; deriva identidad de la sesión, aplica contexto diegético filtrado y devuelve `202 HumanInterventionAccepted`. `202` sólo significa que el Escenario guardó la intervención y planificó la entrega: todavía no indica recepción Pi, turno generado ni respuesta publicada. No hay aún worker que reclame entregas y convoque la instancia, ni interfaz de escena que permita iniciar/observar esta conversación.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` terminó con código 0: TypeScript correcto y **142 pruebas aprobadas, 0 fallidas, 0 omitidas**, incluidos los gates ICM reales. El gate SQLite/journal local pasó, incluido rollback forzado, retry tras reapertura, delivery de testimonio, corte Pi, outbox y foreign-key check. La prueba HTTP cubre contexto, privacidad, CSRF, campos de autoridad rechazados, aceptación, replay y conflicto por reutilización de clave. `npm run build` pasó; Vite transformó 369 módulos.

La siguiente integración debe añadir intención de turno durable, worker de entregas/actuación y ciclo de respuesta del personaje; luego exponer estado y conversaciones en la interfaz principal. El contrato de voz, historia, pulso de obra y roles sigue documentado, pero no implica esos flujos implementados.

## Décimo corte: entrega recuperable y cola de turnos

La migración v8 crea una intención de turno por cada percepción humana efectiva. El commit la guarda como `awaitingDelivery`; `createDeliverWorldWorker` reclama la percepción, congela un testimonio con el ID/nombre/texto exactos, confirma la Experience y una fila en `memory_outbox` para ICM y, en la misma transacción, pasa la intención a `queued`. Si el host cae durante una entrega, `openLocalHost` recupera claims sólo después de adquirir ownership exclusivo. Se amplió el envelope de experiencia al máximo de 16.384 caracteres de intervención para no truncar el testimonio. El worker no invoca el CLI ICM, no llama a Pi ni consume la intención.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó: TypeScript correcto y **143 pruebas aprobadas, cero fallidas y cero omitidas**, incluidos los gates ICM reales. La prueba nueva interrumpe una entrega antes del acuse, reabre el host, reintenta con la misma percepción y verifica experiencia, outbox, dos intentos y cola durable. `npm run build` pasó; Vite transformó 369 módulos.

Sigue faltando asignar la intención a un pulso/job, despertar la instancia Pi propia del personaje, recuperar con memoria/contexto privados, aceptar el terminal Pi, ejecutar la revisión exacta del Continuista y comprometer/publicar la respuesta desde el Escenario. La GUI de escena tampoco está conectada a este ciclo. UI-04 permanece `pending` porque el recorrido conversacional y sus criterios completos todavía no están acreditados.

## Undécimo corte: supervisor de entregas en el host

El launcher crea un supervisor de entregas mecánicas. En el arranque recupera los destinatarios con entregas pendientes y agenda la percepción efectiva después de un commit humano aplicado. Agrupa trabajos simultáneos por corrida/personaje, limita cada lote y detiene los workers antes de cerrar el journal. Una falla de recuperación se registra con un diagnóstico sin contenido privado. Este supervisor sólo convierte percepciones confirmadas en Experiences/outbox y activa la intención `queued`; no abre una sesión Pi ni hace inferencia.

La prueba de reinicio ahora recorre el supervisor real: se interrumpe una entrega, se reabre el host, se recupera su destinatario y se comprueban el testimonio exacto, la Experience, el outbox y la intención; también se agenda una intervención posterior y se verifica su entrega. `PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **143 pruebas aprobadas, cero fallidas y cero omitidas**, incluidas las pruebas CLI/SQLite de ICM real. `npm run build` pasó y transformó 369 módulos.

La tabla `actor_turn_intents` conserva el estado de entrega y la asignación se registra aparte en el ledger de jobs. En este corte todavía no había lifecycle de jobs o pulsos ni un consumidor que enlace el presupuesto compartido con Pi.

## Duodécimo corte: ledger durable de actuación y tools aisladas

La migración v9 agrega `actor_turn_jobs` y `actor_turn_job_inputs`. El journal asigna intenciones entregadas al job, agrupa nuevas entradas sólo antes del claim y dentro del mismo pulso, serializa el claim entre workers y acepta el terminal únicamente con lease válido y el corte que contiene exactamente sus percepciones asignadas. La aceptación consume entradas, recibo de sesión Pi y job en una transacción; reintentar recupera el mismo resultado. Al abrir el host, ownership entrega un `ownerToken` nuevo y recupera claims anteriores sin cambiar job, generación, pulso ni reservas de cuota. Los registros de cuota de `pulses` ya existían; aún falta un coordinador que cree y cierre pulsos y un dispatcher que asigne trabajos de producción.

`createActorTools` implementa el par cerrado del personaje: `recall_memory` consulta sólo memoria propia hasta el corte validado y `propose_action` incorpora identidad, revisión y scope desde el host, registra la propuesta durable y deja explícito que todavía no es un hecho de Escenario. Ambas tools están probadas con límites y replay idempotente, pero aún no están conectadas a una instancia Pi ejecutada por el host. No hay inferencia ni OAuth real en este corte.

`PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` pasó con TypeScript y **149 pruebas aprobadas, cero fallidas y cero omitidas**, incluidos journal/job, recovery de claims y tools actorales con ICM 0.11.4/SQLite reales. `npm run build` transformó 369 módulos y terminó correctamente. En ese corte la suite de host aún no combinaba reinicio del host con un job activo; el ensayo integrado se agregó en el corte siguiente.

El tramo `queued → job durable → Pi → propuesta → Continuista → commit Escenario` sigue sin estar conectado en producción. El usuario todavía no puede conversar desde la interfaz; ésta sigue centrada en la biblioteca y muestra “Sin representación activa”. Los **77 requisitos del PRD permanecen `pending`** hasta demostrar sus criterios integrales. El gate actual acredita contratos locales, no conversación visible, OAuth, actuación de Luna, escena gráfica ni dirección dramática.

## Corte 44 — fuente exacta y preparación de bifurcación

Implementados lector de fuente exacta de SQLite, remapeo tipado de mundo/conocimiento, registro de identidades restaurable y recuerdos con procedencia. Se verificó proyección a ICM real separado sin modificar origen. [Evidencia y brechas](preparacion-de-bifurcacion.md). TypeScript, build y 737 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux. Falta configuración Ready derivada, job durable, publicación y API/GUI del fork; el objetivo integral y la aceptación de los 77 requisitos siguen activos y pendientes.

## Corte 45 — publicación durable de bifurcaciones

Implementados configuración Ready derivada, semilla dramática con procedencia y job durable v35. El runtime interno prepara SQLite ICM separados, verifica recuerdos y archivos, publica el destino en una transacción final y recupera interrupciones sin duplicar memoria ni alterar la fuente. La preparación heredada rechaza edición y validación ordinarias con conflicto explícito. [Evidencia, revisión y límites](publicacion-de-bifurcaciones.md). TypeScript y build aprobados; **785 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux**. La revisión independiente comprobó las correcciones de idempotencia, autoridad y evidencia. Falta componer este runtime en el launcher, API/GUI del fork y restauración desde backup; los ocho pasos del objetivo y la aceptación integral de los 77 requisitos siguen activos y pendientes.

## Corte 46 — operación gráfica y API de bifurcaciones

Compuestos launcher, API autenticada y panel para bifurcar un corte exacto, consultar y reintentar; journal v36 conserva recibos idempotentes de retry y protege la preparación heredada. La barrera de backup incluye SQLite/WAL y metadata de forks incompletos y se verificó recuperación offline sin cambiar IDs de memoria. El navegador comprobó selección histórica conservada, publicación, navegación al destino, recarga, continuación entre escenas y procedencia editorial. Detectó y permitió corregir la incompatibilidad entre UUID determinísticos de episodios/actos HTTP y el registro de fork. [Evidencia y límites](operacion-de-bifurcaciones.md). TypeScript, build y **815 pruebas aprobadas, cero fallos y una omitida exclusiva de Linux**. Restauración pública, edición derivada autorizada y aceptación integral de los 77 requisitos continúan pendientes; los ocho pasos del objetivo siguen activos.

## Corte 47 — restauración desde backup como bifurcación

Implementados lector de backup mediante copia privada, fuente respaldada congelada en journal v37, intención/confirmación durables, recuperación, API y GUI. Publicación y retry ya no dependen del padre vivo. Los ensayos con ICM real cubren origen avanzado y receptor sin padre, fuente desconocida preservada y bundles intactos; el navegador verificó backup multirun, selección, diferencias, confirmación, publicación, navegación y recarga. QA y revisión corrigieron colisión de cookies entre puertos y retry residual entre operaciones. [Evidencia y límites](restauracion-como-bifurcacion.md). TypeScript, build y **858 pruebas aprobadas, cero fallos y una omitida exclusiva de Linux**. Recuperación offline completa, admisión de backups externos y aceptación integral de los 77 requisitos siguen pendientes; el objetivo completo permanece activo.
