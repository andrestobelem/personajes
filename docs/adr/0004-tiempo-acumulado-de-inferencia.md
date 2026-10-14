# ADR 0004: tiempo acumulado de inferencia

## Estado

Implementada para las requests Pi de actores y Continuista en el journal v22. El control durable y el preflight tienen verificación local; el recorrido completo de inicio/operación y los demás roles del producto siguen pendientes.

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

El corte v22 conecta el ledger con los workers Pi reales de actor y Continuista y con el preflight. Un grant sin duración histórica demostrable, una request incierta, un presupuesto agotado o un desajuste de scope impiden otra llamada. El timeout pausa la corrida, invalida efectos tardíos y mantiene la reserva/concurrencia hasta que cierre el transporte real; entonces guarda la duración observada, incluso si excede el grant. `GET /runs/{runId}/budget` y el panel de inspección en una preparación Ready ya muestran las medidas. Falta mantener esta vista durante la representación activa, integrar cada rol directorial/narrativo y los presupuestos separados de Voice Design/TTS/SFX.

## Verificación requerida

Reservas concurrentes sin sobreasignación; suma de actor y Continuista; cierre y replay exactos; cancelación antes y después del envío; expiración y resultado tardío; consumo superior al grant visible; reinicio con tramo incierto; preflight sin cero inventado; pausa sin evento ficticio. El corte v22 pasó 111 pruebas focales y el gate global con TypeScript y 381 pruebas con ICM real, sin fallos ni omisiones; el build pasó. Esto verifica el ledger implementado, no los roles, GUI, acceso real o aceptación integral que siguen pendientes.
