# Arranque ordinario después de un cierre abrupto

15 de octubre de 2026. Brecha reproducida; pendiente de implementar.

En un directorio de ensayo vacío fuera del repositorio se inició el launcher real hasta recibir `serverReady`, se terminó su proceso con SIGKILL y se volvió a iniciar sobre la misma raíz. El segundo proceso terminó con código 1 y diagnóstico `serverStartFailed / ALREADY_OWNED`, antes de abrir HTTP. No existía una operación de recuperación de backup pendiente.

El ownership del host exige recuperación explícita: una antigüedad o un PID aparente no autorizan borrar el registro. Esa regla se conserva. La brecha es que el launcher no ofrece una vía gráfica de inspección y recuperación del dueño muerto para este caso ordinario. La recuperación offline ya implementada corresponde al intercambio de un backup que tiene una operación durable pendiente; no prueba este recorrido.

El control local del ejecutable ICM usa una exclusión SQLite distinta, liberada por el sistema al morir el proceso. Eso evita una segunda barrera persistente, pero no recupera el ownership del host de la obra.

El cierre de esta brecha requiere un arranque de control sin abrir el journal ni recrear una raíz ausente, diagnóstico seguro del ownership exacto, confirmación explícita ligada al nonce observado y rechazo de un dueño vivo o ambiguo. La reapertura debe conservar memorias, credenciales, sesiones, incertidumbre y trabajos confirmados, sin iniciar inferencia. Hace falta probar proceso muerto, proceso vivo, cambio del registro, repetición de la intención y caída durante la propia recuperación; no basta con el reinicio ordenado.
