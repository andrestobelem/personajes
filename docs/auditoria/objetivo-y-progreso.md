# Objetivo activo y progreso verificable

## Encargo completo

1. Leer uno por uno todos los documentos.
2. Corregir errores e inconsistencias.
3. Escribir un PRD exhaustivo, completo y coherente.
4. Revisar e iterar el PRD hasta que esté exhaustivo, completo y coherente.
5. Después escribir las especificaciones.
6. Revisarlas e iterarlas hasta completarlas.
7. Implementar hasta terminar.
8. Revisar y volver a implementar hasta terminar.

El objetivo está activo. Al retomar no existían aplicación ni specs. Actualmente PRD y S01–S07 tienen cierre documental y existe una aplicación parcial: biblioteca gráfica local y componentes TypeScript de dominio, preparación, HTTP, Pi y persistencia. El producto completo continúa en implementación y revisión.

## Estado al retomar, 14 de octubre de 2026

| Paso | Estado actual | Evidencia o siguiente criterio |
|---|---|---|
| 1 | Corpus base leído individualmente; nuevos artefactos revisados por fase | 420 archivos inventariados, conclusiones individuales y responsables en [lectura de raíz](lectura-prd-raiz.md). Los hashes fijan versión y no sustituyen lectura. |
| 2 | Correcciones iniciales y del PRD aplicadas; revisión continúa al implementar | Alcance histórico actualizado; hallazgos y cambios documentados por cada pase. |
| 3 | PRD integral escrito | [PRD](../PRD.md), versión 1.0: 77 requisitos y 25 ensayos. |
| 4 | Revisión documental cerrada | [Cierre del PRD](cierre-prd.md), diálogo y tres revisiones con loops. No certifica producto. |
| 5 | S01–S07 escritas | [Índice](../specs/README.md): dominio/datos, persistencia/ICM, Pi, API/autoridad, UI, sonido y pruebas; matriz de los 77 IDs y sus ensayos. |
| 6 | Revisión documental cerrada | [Cierre de specs](cierre-specs.md): producto R2, concepto R4 y técnica R3, 77 IDs. No acredita producto ejecutado. |
| 7 | Implementación en curso | Biblioteca, Escenario, journal/ICM, actores/Continuista/coordinador y composición del launcher; API y GUI de borradores, validación/promoción Ready durables. Se verificó guardar/reabrir un borrador en navegador tras reiniciar, sin iniciar representación. También existen editores de curación, continuidad, Escenario y perfiles humanos, acceso Pi administrativo y selección de Sol bajo u Opus medio por representación y sondeos administrativos durables desde GUI. El preflight durable ya se consulta y ejecuta explícitamente desde una preparación guardada; conserva informes obsoletos al editar. Falta verificar el recorrido completo de preparación y actuación. |
| 8 | Revisión de componentes en curso | Último gate local previo al handoff: **391 pruebas con ICM real, cero fallos y cero omisiones**, y build aprobado (corte 29). La evidencia nueva de Cloud se registra por separado en [continuación Cloud](continuacion-cloud.md). Revisión independiente y recorrido de navegador corrigieron autoridad de preparación, replay y guardado. Existe HTTP/GUI administrativo OAuth sin autenticación real acreditada. Faltan validación live, acceso comprobado al modelo, interfaz completa, dirección/audio/replay/backups y aceptación de los 77 criterios; pruebas de componentes no sustituyen esa auditoría. |

## Reglas de evidencia

Una capacidad sólo se marca terminada con evidencia que cubra su alcance. Archivos escritos, compilación, tests de dominio, mocks, integración real, GUI operada, login y audio creado son evidencias distintas. Un mock no prueba acceso al perfil seleccionado ni fidelidad de doblaje. El cierre del objetivo requiere revisar todos los requisitos del PRD/specs frente al estado real.

La ausencia de credenciales o de una decisión de puesta no impide construir flujos configurables, adaptadores y pruebas independientes. Si una validación externa requiere al humano se registra el paso concreto; no se bloquea el resto ni se cambia el modelo/perfil requerido.

## Continuación Cloud

El handoff conserva los ocho pasos de este objetivo. El checkout se actualizó a `main` en `b6246e1f2c6ecedc7f0dc6869bfeb336f47bfd4b`; no hubo push. La herramienta de Goal formal no está disponible en esta tarea: el objetivo sigue siendo una instrucción vigente, no una fase cerrada. Ver [evidencia y revisión en Cloud](continuacion-cloud.md).
