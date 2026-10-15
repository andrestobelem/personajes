# Presupuesto durante una representación activa

## Conducta verificada

El ledger común del journal reserva solicitudes y tiempo real de transporte para las sesiones Pi de Actor, Continuista, Director, Narrador/revisor y Configurador. Las cuotas de Voice Design, TTS y SFX se guardan y concilian en el servicio durable de voz; RunView las agrega como presupuesto separado. `GET /runs/{id}/budget` expone el ledger de inferencia, no fusiona los dos libros.

La prueba de aceptación C59 en [representation-runtime.test.ts](../../tests/representation-runtime.test.ts) crea una obra con SQLite/ICM reales, entrega una intervención humana a una sesión Pi con transporte controlado y fija el presupuesto en una solicitud. La primera solicitud llega al transporte; la siguiente se deniega antes de despacharse. Al terminar el trabajo, el runtime deja la representación en pausa, no publica un hecho por el intento denegado y conserva en RunView el perfil elegido, el estado agotado, una llamada usada y cero disponibles. La vista de estado renderizada muestra la pausa y el presupuesto agotado, sin sugerir cambio automático de modelo.

`npm run verify` pasó con TypeScript y **1.170 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux** (1.171 totales), incluida C59, usando ICM 0.11.4. `npm run build` también pasó y transformó 473 módulos.

## Límites

El transporte Pi está controlado: la prueba no inicia sesión ni llama a OpenAI/Anthropic. No acredita medición de tokens o costos del proveedor ni ejecución real de Voice Design/TTS/SFX. La condición `job-inactive` que queda al cerrarse el pulso es genérica; la señal específica de presupuesto que se muestra al operador en esta vista es el lifecycle en pausa y el saldo agotado de RunView.
