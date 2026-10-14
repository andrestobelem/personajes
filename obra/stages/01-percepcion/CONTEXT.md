# Percepción

Responsable: **Escenario**.

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| [Continuidad](../../_config/continuidad.md) | Reparto activo y corte | Delimitar escena y participantes |
| [Estado del escenario](../../escenario/output/estado.md) | Posiciones, canales y condiciones pertinentes | Calcular acceso perceptivo |
| [Reglas](../../escenario/references/reglas.md) | Espacio y reloj | Aplicar alcance, atención y rutinas |
| `personajes/<slug>/output/entrada.md` | Pendientes entregados no procesados | Preservar mensajes recibidos sin leer memoria privada |

## Process

1. Para el actor solicitado en el pulso, determinar qué puede percibir ahora desde su ubicación y por sus canales disponibles.
2. Preparar observaciones descriptivas con su origen. Separar lo visto/oído de una inferencia; no comunicar intenciones, pensamientos o afiliaciones ocultas.
3. Agregar el paquete a su entrada y conservar los anteriores no procesados. Una inicialización cita la configuración; un cambio del escenario cita un evento confirmado.
4. Registrar destinatario, alcance temporal y ruta del paquete en el manifiesto de etapa.

## Outputs

Entrada individual del actor y manifiesto `output/registro.md`. Cada paquete sigue la [plantilla de percepción](../../templates/percepcion.md).

El coordinador es el único que actualiza el manifiesto local `output/registro.md`, con los IDs y rutas entregados por el responsable de etapa. No copia contenido privado en él.

## Cierre

Paquete acotado, fuentes identificadas, sin secretos ajenos ni desaparición de entregas pendientes.

La mera existencia de un archivo en `output/` no significa que esta etapa esté terminada. El cierre requiere estado explícito y comprobaciones satisfechas.
