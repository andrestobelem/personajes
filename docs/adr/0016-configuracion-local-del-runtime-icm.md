# Configuración ICM local y recomposición explícita

La selección del ejecutable ICM se conserva fuera del journal y de los backups de la obra, porque una ruta ejecutable pertenece a una máquina. La GUI inicia un trabajo durable que valida el CLI y recompone la producción inactiva sobre la misma raíz, sin llamar a recover ni iniciar actores; una selección nula guardada desactiva ICM y prevalece sobre el entorno.

El control local usa una conexión SQLite separada con una transacción de exclusión retenida durante el proceso. La liberación del bloqueo por el sistema al morir el proceso evita agregar un segundo registro persistente de ownership que impediría abrir el control gráfico después de un cierre abrupto. Esto no cambia el ownership explícito del host de la obra ni autoriza a recuperar su directorio automáticamente. Un registro legado de ownership del control no se ignora ni se roba.

La selección estable avanza sólo después de aplicar con éxito. Ante un fallo, se intenta recomponer la selección anterior y el trabajo conserva su diagnóstico y recibo original; los trabajos pendientes no se aplican automáticamente al reiniciar.
