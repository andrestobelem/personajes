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

El objetivo está activo. Al retomar no existían aplicación ni specs. Los cierres documentales previos del PRD y S01–S07 se reabrieron el 15 de octubre para reconciliar cambios de dramaturgia y evidencia. Existe una aplicación parcial: biblioteca gráfica local y componentes TypeScript de dominio, preparación, HTTP, Pi y persistencia. El producto completo continúa en implementación y revisión.

## Estado al retomar, 15 de octubre de 2026

| Paso | Estado actual | Evidencia o siguiente criterio |
|---|---|---|
| 1 | Corpus base leído individualmente; nuevos artefactos revisados por fase | 420 archivos inventariados, conclusiones individuales y responsables en [lectura de raíz](lectura-prd-raiz.md). Los hashes fijan versión y no sustituyen lectura. |
| 2 | Correcciones iniciales y del PRD aplicadas; revisión continúa al implementar | Alcance histórico actualizado; hallazgos y cambios documentados por cada pase. |
| 3 | PRD integral escrito | [PRD](../PRD.md), versión 1.0: 77 requisitos y 25 ensayos. |
| 4 | Revisión reabierta el 15 de octubre | [Cierre del PRD](cierre-prd.md) conserva los informes previos y registra la edición posterior de Episodio, ESC-10 y P04/P13/P14/P15/P19; requiere reconciliar 77 criterios y trazabilidad antes del nuevo cierre. |
| 5 | S01–S07 escritas | [Índice](../specs/README.md): dominio/datos, persistencia/ICM, Pi, API/autoridad, UI, sonido y pruebas; matriz de los 77 IDs y sus ensayos. |
| 6 | Revisión reabierta el 15 de octubre | [Cierre de specs](cierre-specs.md): producto R2, concepto R4 y técnica R3 son cortes históricos. Corrijo contradicciones de rutas, evidencia P08/P21, cobertura ESC-10 y afirmaciones de pruebas; G0 debe volver a revisarse. |
| 7 | Implementación en curso | Biblioteca, Escenario, journal/ICM, actores/Continuista/coordinador y composición del launcher; API y GUI de borradores, validación/promoción Ready durables. Se verificó guardar/reabrir un borrador en navegador tras reiniciar, sin iniciar representación. También existen editores de curación, continuidad, Escenario y perfiles humanos, acceso Pi administrativo y selección de Sol bajo u Opus medio por representación y sondeos administrativos durables desde GUI. El preflight durable ya se consulta y ejecuta explícitamente desde una preparación guardada; conserva informes obsoletos al editar. Falta verificar el recorrido completo de preparación y actuación. |
| 8 | Revisión de componentes en curso | El corte previo pasó TypeScript, build y **554 pruebas aprobadas, cero fallidas y una omitida por ser exclusiva de Linux**. HTTP→SQLite comprueba replay durable con la misma clave y ETag obsoleto; lugar inexistente produce 422 sin commit parcial, y cerrar escena libera presencias. Stage, conversación, estructura y observaciones Director pueden navegar al `commitIndex` exacto; el replay reconstruye episodios/actos y filtra lecturas posteriores al corte. El Director publica interpretaciones aceptadas en un panel seguro, con cobertura de aplicación/SSR; falta aceptación de navegador. Faltan acceso live, recomendaciones, comparación visual, voz/replay integral/fork/backups y aceptación de los 77 criterios. |

## Reglas de evidencia

Una capacidad sólo se marca terminada con evidencia que cubra su alcance. Archivos escritos, compilación, tests de dominio, mocks, integración real, GUI operada, login y audio creado son evidencias distintas. Un mock no prueba acceso al perfil seleccionado ni fidelidad de doblaje. El cierre del objetivo requiere revisar todos los requisitos del PRD/specs frente al estado real.

La ausencia de credenciales o de una decisión de puesta no impide construir flujos configurables, adaptadores y pruebas independientes. Si una validación externa requiere al humano se registra el paso concreto; no se bloquea el resto ni se cambia el modelo/perfil requerido.

## Continuación Cloud

El handoff conserva los ocho pasos de este objetivo. El checkout se actualizó a `main` en `b6246e1f2c6ecedc7f0dc6869bfeb336f47bfd4b`. Tras autorización posterior del usuario se publicó el checkpoint `cd4873344677c853fb8e89a05594406c9aa90973`. No hay herramienta disponible para crear o consultar un Goal formal; la herramienta ahora visible sólo permite finalizar o bloquear uno existente. El objetivo de ocho pasos sigue vigente y no se ha declarado completo ni bloqueado. Ver [evidencia y revisión en Cloud](continuacion-cloud.md).

## Avance del corte 43 — 15 de octubre de 2026

Cortes privados exactos implementados en journal v34 e inspector histórico paginado; no hay reconstrucción del pasado con conocimiento/ICM actuales. Ver [evidencia, revisión y límites](cortes-privados.md). TypeScript, build y 713 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux; recorrido Chromium sintético verificado. Fork y aceptación integral de los 77 requisitos siguen pendientes.

## Corte 44 — fuente exacta y preparación de bifurcación

Implementados lector de fuente exacta de SQLite, remapeo tipado de mundo/conocimiento, registro de identidades restaurable y recuerdos con procedencia. Se verificó proyección a ICM real separado sin modificar origen. [Evidencia y brechas](preparacion-de-bifurcacion.md). TypeScript, build y 737 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux. Falta configuración Ready derivada, job durable, publicación y API/GUI del fork; el objetivo integral y la aceptación de los 77 requisitos siguen activos y pendientes.

## Corte 45 — publicación durable de bifurcaciones

Implementados configuración Ready derivada, semilla dramática con procedencia y job durable v35. El runtime interno prepara SQLite ICM separados, verifica recuerdos y archivos, publica el destino en una transacción final y recupera interrupciones sin duplicar memoria ni alterar la fuente. La preparación heredada rechaza edición y validación ordinarias con conflicto explícito. [Evidencia, revisión y límites](publicacion-de-bifurcaciones.md). TypeScript y build aprobados; **785 pruebas aprobadas, cero fallidas y una omitida exclusiva de Linux**. La revisión independiente comprobó las correcciones de idempotencia, autoridad y evidencia. Falta componer este runtime en el launcher, API/GUI del fork y restauración desde backup; los ocho pasos del objetivo y la aceptación integral de los 77 requisitos siguen activos y pendientes.
