# ADR 0004: tiempo acumulado de inferencia

## Estado

Implementada en el ledger común de journal para solicitudes de inferencia de todos los roles Pi: Actor, Continuista, Director, Narrador/revisor y Configurador. El presupuesto de audio se administra en cuotas durables independientes del servicio de voz. Los límites, la pausa y la proyección durante una obra tienen pruebas con transporte controlado; la aceptación integral con proveedor y servicios reales permanece pendiente.

## Contexto

S04 define presupuesto de tiempo LLM acumulado por representación, tiempo reservado y medido, concurrencia y timeout por solicitud. El campo persistido `RunBudget.maxWallTimeMs` expresa ese límite, pero hasta v21 sólo se rechazaba el valor cero: los valores positivos no estaban contabilizados. Actores y Continuista comparten las transacciones de reserva, por lo que medir cada worker por separado permitiría exceder el presupuesto compartido.

El reloj ficticio, el tiempo esperando una intervención humana y la preparación no consumen este recurso. Dos solicitudes simultáneas de dos segundos consumen cuatro segundos del presupuesto LLM. No equivale al tiempo durante el cual el servidor está abierto.

## Decisión

Reservar tiempo y un lugar de concurrencia en la misma transacción que reserva la llamada. El timeout configurable admite 1–300 segundos; las preparaciones nuevas usan 30 segundos como valor inicial editable. La lectura de historia sin este campo utiliza un helper semántico, sin insertar un default en el JSON validado ni cambiar hashes históricos.

Registrar cada tramo de transporte con una época de reloj monotónico y un crédito de duración idempotente. Reservar como máximo el timeout y el tiempo disponible. Medir hasta el cierre real del transporte, incluso si el SDK ya recibió un evento terminal. Una expiración bloquea efectos tardíos; la conciliación posterior conserva el consumo real, incluido cualquier exceso, sin transformarlo en una decisión ficticia.

Un reinicio no permite restar relojes monotónicos de procesos distintos. Un tramo enviado sin cierre queda incierto y conserva su reserva; no se devuelve ni se vuelve a enviar automáticamente. El historial con inferencias anteriores sin medición se declara desconocido. Sólo una historia probadamente vacía puede comenzar con cero medido. El host recupera grants nunca despachados tras adquirir ownership exclusivo; los ya despachados quedan inciertos hasta conciliación.

## Consecuencias

Un timeout permite devolver un diagnóstico acotado mientras el host conserva la responsabilidad de esperar un transporte que ignore cancelación. No se libera el escritor ni se acepta un resultado tardío por ese motivo. La pausa por presupuesto es estado operativo; no crea un acontecimiento del Escenario.

Esta contabilidad puede limitar la concurrencia cuando el tiempo disponible no alcanza para otra reserva completa. La conciliación libera el sobrante de solicitudes que terminan antes del timeout. Un consumo incierto exige recuperación explícita, conservando los límites y el perfil seleccionado.

El corte v22 conectó primero el ledger con Actor y Continuista y el preflight. Los cortes posteriores añadieron Director, Narrador/revisor y Configurador mediante la misma fábrica Pi. Un grant sin duración histórica demostrable, una request incierta, un presupuesto agotado o un desajuste de scope impiden otra llamada. El timeout pausa la corrida, invalida efectos tardíos y mantiene la reserva/concurrencia hasta que cierre el transporte real; entonces guarda la duración observada, incluso si excede el grant. `GET /runs/{runId}/budget`, la preparación Ready y RunView durante la representación exponen medidas/saldos; C59 prueba el agotamiento activo y la pausa con Pi SDK/ICM reales y transporte controlado. Las cuotas de audio persisten por separado y aparecen en RunView. No se cuentan tokens ni se estima costo, y falta aceptación con proveedor/servicios reales.

## Verificación requerida

Reservas concurrentes sin sobreasignación; suma entre roles; cierre y replay exactos; cancelación antes y después del envío; expiración y resultado tardío; consumo superior al grant visible; reinicio con tramo incierto; preflight sin cero inventado; pausa sin evento ficticio. El corte v22 pasó 111 pruebas focales y el gate global con TypeScript y 381 pruebas con ICM real, sin fallos ni omisiones; el build pasó. C59 añade aceptación integrada del runtime/UI al agotar cuota durante una intervención, con transporte Pi controlado. Estas pruebas locales no acreditan acceso real de cuenta, mediciones externas ni aceptación completa del producto.
