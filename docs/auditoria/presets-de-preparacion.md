# Puntos de partida de la preparación

Implementación del 15 de octubre de 2026. «Nueva preparación» abre un selector con puesta en blanco, ensayo sintético Max/Hymie sobre Fibonacci y cortes documentales versionados. El tercer punto de partida fue incorporado después del corte inicial descrito aquí; su contrato, fuentes, verificación y límites están en [cortes documentales](cortes-documentales-de-continuidad.md).

La fábrica `createPreparationPreset` construye un candidato local. La opción sintética propone fecha y diferencia UTC explícitas, sala, canal, escena candidata, continuidad de adaptación, reparto, línea dramática, reloj y variedad española. La fecha de ficción no deriva del reloj del equipo ni de la emisión de un episodio. Cada dato creativo conserva `kind: proposed` y `source: template`; aceptar o editar una sección registra una elección del operador. Los defaults generales conservan la procedencia del integrador. La plantilla no autentica proveedores, invoca modelos, envía una pregunta ni inicia una representación.

Max y Hymie se seleccionan por identificadores exactos del catálogo, sin sustitución aproximada. El reparto no trae personajes preparados. Los objetivos sugeridos se muestran únicamente al operador y no se insertan como deseos o conocimiento. No se importa identidad, dossier, recuerdos, capacidades o biografía desde la plantilla. La curación de identidad, habla y antecedentes sigue siendo explícita; el ensayo no reemplaza expedientes exhaustivos por identidades breves. Tampoco inventa la identidad ficticia del usuario.

El mapa conserva sala, canal y escena candidatos, dejando pendiente colocar a los actores después de curarlos. Se evitó un bloqueo observado durante la implementación: una entidad provisional `notPrepared` con el mismo personaje impediría colocarlo usando el flujo existente. La prueba recorre confirmación de continuidad, curación explícita de prueba y colocación de ambos, obteniendo un snapshot válido sin recuerdos añadidos.

Se reutilizan guardado autenticado, control de revisiones, captura inmutable del intento, conciliación y validación existentes. El host asigna el ID durable y adapta el ID del mundo candidato. Las propuestas sobreviven al cierre y reapertura de SQLite; guardar no crea un mundo operativo ni hace actuar al reparto. Las propuestas pendientes y la falta de curación bloquean la promoción a Ready.

## Evidencia y límites

- `tests/preparation-presets.test.ts`: seis pruebas con schemas reales y SQLite, incluyendo identidades ausentes/ambiguas, UUIDs repetidos, independencia entre puestas, persistencia y curación/colocación posterior.
- `tests/preparation-presets-ui.test.tsx`: componente React montado en JSDOM; elección, cancelación, edición en blanco, protección de cambios, creación sintética, confirmación de una sección y envío explícito del borrador. No se hace OAuth, acceso al modelo ni inicio.
- Revisión independiente: 16 pruebas focales aprobadas incluyendo las siete nuevas y las de edición/reintento existentes, sin bloqueantes encontrados. La cobertura del reintento ante respuesta perdida es genérica del cliente; no se presenta como un recorrido GUI específico del preset.

El recorrido en navegador usó un host privado de prueba, catálogo real y la build de producción. Se observaron el selector, la propuesta sintética, guardado en revisión 0, validación bloqueada por propuestas/curación incompletas y reapertura tras recargar la página, conservando la fecha y el estado editorial. No acredita login, inferencia ni una representación real; la aceptación integral del producto sigue pendiente.

La revisión visual detectó explicaciones que desplazaban la acción principal fuera del primer pantallazo; se movieron a un desplegable y se volvió a verificar la build, el selector y el guardado/validación. Verificación global con `TMPDIR=/private/tmp` e ICM 0.11.4: **1.182 pruebas aprobadas, cero fallos y una omitida exclusiva de Linux** (1.183 totales). Después del ajuste de presentación, TypeScript, 16 pruebas focales y la build de 475 módulos volvieron a aprobarse. La aceptación general de los 77 requisitos permanece abierta.
