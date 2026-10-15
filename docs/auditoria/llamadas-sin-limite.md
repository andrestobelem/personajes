# Llamadas sin límite y admisión del inicio

Pedido del usuario, 15 de octubre de 2026: «tampoc quiero límites de llamadas al modelo y ni de tokens».

Los campos `maxPiCallsPerRun` y `maxPiCallsPerPulse` admiten `null`, que significa ausencia de tope. No se sustituye por un número elevado. La preparación gráfica permite elegir esta opción; los contadores siguen registrando cada request. Las configuraciones históricas numéricas mantienen su significado, incluido cero como tope agotado. El journal conserva sus columnas históricas `max_calls` no nulas: cero es sólo el valor de almacenamiento cuando la configuración autorizada lleva null; las puertas de reserva y pausa consultan esa configuración para distinguir ambos casos. No se cambia el schema SQLite ni se reescriben representaciones anteriores.

No se añade una cuota de tokens a la actuación. Los límites propios del modelo/proveedor siguen existiendo. El sondeo técnico de acceso separado conserva su salida mínima acotada; no es un límite a los personajes. Timeout por request, concurrencia, tiempo acumulado configurado y recuperación conservadora de solicitudes inciertas son controles independientes. No se desactivan por elegir llamadas ilimitadas.

Además se corrige la composición del inicio: el broker devuelve un resultado de búsqueda (`found`/`missing`) y el lifecycle necesita un documento de preflight. `readLifecycleDocument` convierte únicamente un resultado encontrado, validado y con credencial vigente; una ausencia sigue sin autorizar inicio. La conversión no vuelve a evaluar ni ejecuta inferencias.

Pruebas de regresión: el broker real permite iniciar con un preflight aprobado y bloquea credencial cambiada; el journal admite 25 solicitudes con límites null, por encima de los antiguos topes de la fixture, sigue midiendo transporte y bloquea concurrencia. La comprobación gráfica y la actuación real se registran por separado: un preflight aprobado no demuestra una escena ejecutada.

## Fecha ficticia anterior a 1970

El intento de puesta de 1966 encontró `CHECK(fictional_at>=0)` en la activación de objetivos. Es un error de persistencia: la ficción usa milisegundos de época con signo, mientras que las fechas reales de registro siguen siendo no negativas. La migración v41 reconstruye transaccionalmente las tablas de causas de activación, invitaciones y avances de rutina, conservando filas y claves, permitiendo fechas y fronteras ficticias negativas y verificando todas las claves foráneas. Los lectores usan enteros con signo para esas fronteras. La validación de backups externos admite v41 y conserva admisión de v39/v40.

Se comprobó el inicio con una fecha de junio de 1966 en una prueba de regresión y sobre una copia SQLite aislada de la preparación real; la copia se eliminó al terminar y no ejecutó modelos. Estos ensayos no se confunden con actuación real. Un sondeo de acceso vencido puede producir `evaluation-failed` en vez de un diagnóstico de expiración específico; renovar el sondeo restaura el preflight. Queda pendiente mejorar ese diagnóstico.

## Ensayo real observado en este host

Representación `55cf5280-800f-44f9-8155-3b867d51334a`, configuración 4: llamadas por representación y por pulso sin límite; GPT-6.1 Sol / low con login OAuth; audio apagado. El tiempo acumulado sigue en 120 segundos y el timeout individual en 30 segundos, con concurrencia 1. La modificación pedida desactiva cuotas de llamadas, no esos controles temporales. ICM 0.11.4 conserva bases independientes para Max y Hymie.

Tras migrar v40→v41, el host confirmó inicio en 1966 y publicó dos comunicaciones, con ocho solicitudes reales entre actores y Continuista y aproximadamente 27 segundos de transporte medido. Ambos actores y sus revisiones fueron aceptados. Después, el Director quedó bloqueado con `execution-failed` antes de reservar una request, y el runtime pausó el pulso. No se presenta este ensayo como aceptación integral ni como Director live verificado. Se conservan el trabajo y los acontecimientos para diagnosticarlo; no se borran sesiones, no se vuelve a ejecutar el catálogo y no se atribuye la pausa a la cuota de llamadas.

Trabajo Director pendiente de diagnóstico: `e65cced0-24d9-4821-87c6-8a05c7e83b5c`, pulso `2fd1376b-4d73-4271-87c7-4172ac028907`. La captura de pantalla y los archivos de datos son locales al host, fuera del repositorio. El snapshot previo a la migración contiene sólo el journal, no es un backup completo del host y no incluye credenciales.

Verificación final del cambio: `npm run verify` con ICM 0.11.4 real: 1234 pruebas aprobadas, cero fallidas y una omitida por plataforma, de 1235 totales. Build gráfico aprobado. Esta evidencia no convierte el fallo live del Director en un resultado aprobado.

## Corrección del Director y reanudación

La sesión de producción de Pi escribe metadatos de modelo/razonamiento antes del primer prompt. El worker registraba ese leaf como base conversacional, pero el adaptador emite correctamente `job-base` con leaf null para una sesión fresh. El journal rechazaba esa discrepancia antes del transporte. Se registra null como base aceptada de la sesión nueva, sin borrar los metadatos ni relajar la validación de checkpoints.

Se añadió una regresión que crea la sesión de producción de Pi con OAuth sintético local y corta en la puerta de reserva antes de todo transporte remoto. La fixture controlada del Director usa ahora la misma semántica de base fresh. Los fallos informan sólo etapa/código seguros, sin contexto privado. Verificación completa posterior: 1235 pruebas aprobadas, cero fallidas y una omitida por plataforma (1236 totales).

El ensayo conservado volvió a pasar preflight sobre Escenario 3 y se reanudó con más de ocho llamadas registradas y límites null; la historia previa permanece. El trabajo antiguo bloqueado se conserva como diagnóstico histórico, sin reescribirlo como aprobado.

Continuación live posterior al arreglo: el panel mostró un nuevo trabajo Director **Aceptado**, otro en ejecución y el bloqueo original conservado en el historial. Max y Hymie publicaron nuevas comunicaciones; el contador superó 30 solicitudes con límites de llamadas null. El tiempo acumulado conserva el tope previo de 120 segundos y puede pausar el ensayo al agotarse; no se cambió esa política por el pedido de quitar cuotas de llamadas/tokens.

Corrección de la vista después del agotamiento: el transporte terminó con 120008 ms medidos frente a 120000 configurados. La proyección rechazaba ese exceso real de 8 ms y devolvía error a controles y estructura. Ahora conserva el uso real y satura el saldo en cero. Typecheck, dos pruebas del lifecycle (incluida una reserva de 1 ms con cierre real en 9 ms) y build aprobados; el navegador volvió a mostrar la pausa, el plano y seis comunicaciones conservadas. La escenografía actual sigue siendo un plano esquemático con marcadores, no una representación con avatares animados.

## Tiempo acumulado y observación en vivo · 15 de octubre de 2026

Por indicación posterior del usuario, `maxWallTimeMs` admite `null`, igual que las llamadas por representación y por pulso. Se conserva la medición real, la concurrencia y el timeout por solicitud de 30 segundos de esta puesta; no se usa un número enorme para simular ausencia de tope. La representación `5913e9db-53e6-436f-8dc2-c2395186a6d1` superó los seis minutos medidos sin agotar una cuota acumulada.

Se añadió recuperación explícita al reanudar actores bloqueados, idempotente y condicionada al preflight. La reanudación ordinaria conserva su comportamiento. Durante el ensayo se observó otro fallo distinto: propuestas con audiencia vacía para un canal dirigido. Las resoluciones `audience-invalid` no son diálogos emitidos; el historial público no las presenta como tales.

«Ver representación en vivo» aparta los controles de preparación y muestra el plano y las conversaciones confirmadas. Mantiene SSE con consulta de respaldo cada dos segundos, lectura de las páginas del rango reciente y desplazamiento automático del diálogo, desactivable para leer hacia atrás. No se publican propuestas privadas ni se simula escritura del personaje. Véase la [transcripción y estado del episodio](../representaciones/la-alarma-de-los-numeros.md).

La proyección actoral ahora comunica el `scope` real del canal y `propose_action` detecta audiencia vacía en `addressed` o no vacía en `broadcast` antes de registrar una propuesta. La omisión del campo se sigue admitiendo al leer proyecciones históricas; las nuevas lo incluyen. Esta validación devuelve información operativa al modelo, sin escribir su respuesta ni ampliar su audiencia ficticia. La respuesta dirigida a un participante humano sin handle continúa fuera del contrato actoral actual.

Verificación posterior a la vista en vivo y la validación de audiencia: `npm run verify` con ICM real 0.11.4, 1242 tests, 1241 aprobados, 0 fallos y 1 omitido por plataforma. Build y comprobación de whitespace aprobados. Las pruebas cubren SSE, respuesta antigua que no revierte el corte, seguimiento automático desactivable y corrección de destinatarios antes de persistir. No acreditan por sí solas un desenlace dramático.
