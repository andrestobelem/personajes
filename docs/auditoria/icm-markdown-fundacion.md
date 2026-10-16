# ICM Markdown: contratos, lectura y admisión

Corte del 15 de octubre de 2026. Implementación inicial del [plan](../diseno/plan-icm-markdown-runtime.md) y del [diálogo de admisión](../diseno/dialogo-icm-runtime-admision.md). No declara MEM-07 terminado ni acredita que los workers Pi estén recibiendo estos paquetes.

## Implementado

- [Contrato estructural](../../src/domain/icm-workspace-schema.ts) apto para navegador y [validación del host](../../src/domain/icm-workspace.ts): audiencia exacta por rol y actor, selección por IDs, snapshot con secciones y hashes verificables, paquetes ligados a corrida/configuración/job/generación y corte de mundo o preparación. Parsear la forma en la UI no acredita integridad criptográfica; admisión, lectura del journal, Ready y compilación la verifican en el host. El hash de identidad preparada sigue separado del hash ICM.
- [Lector](../../src/adapters/icm-workspace.ts): manifiesto explícito, IDs sin paths del cliente, previews individuales/agregados y admisión contra las fuentes del host. Rechaza fuentes ajenas, secciones inexistentes, enlaces simbólicos, archivos no regulares, UTF-8 inválido, límites excedidos y cambios durante lectura. No sigue enlaces Markdown ni carga identidades raw. Los límites son recursos de lectura del host, no cuotas de inferencia.
- Draft/Ready pueden conservar `icmWorkspace` sin modificar la forma ni los hashes de registros históricos ausentes. Una selección presente vacía o propuesta no promueve; Ready comprueba actores y cobertura de roles, incluido revisor si hay narración. La admisión de fuentes nuevas está conectada a la composición de producción; un checksum del cliente no prueba procedencia. La remoción de un snapshot configurado no permite volver silenciosamente al modo histórico.
- El preflight bloquea explícitamente una puesta con `icmWorkspace` mediante `icm-context-runtime-not-connected` mientras falta la entrega de paquetes a los workers. Guardar fuentes no habilita ejecutar con un prompt que las ignore. La ausencia histórica conserva su flujo anterior.
- El journal conserva el campo en las proyecciones de borrador tras fork o promoción. Una selección ya admitida se mantiene sin releer archivos mutables; el replay idempotente tampoco vuelve a resolverlos. La derivación de configuración de fork conserva el snapshot exacto y crea los nuevos fences de preparación.
- [Compilador](../../src/application/icm-context-compiler.ts): filtra fuentes por audiencia, conserva el Markdown seleccionado y separa política del host, contrato procedural y contexto autorizado. Render exige sello externo del paquete y fence de identidad para actores; un paquete rehasheado por un cliente no sustituye esos valores. La separación textual no es un sandbox: tools, schemas y journal siguen imponiendo autoridad.

El [revisor de narración](../../obra/revisor-narracion/CONTEXT.md) tiene contrato propio derivado de su worker existente. No reutiliza instrucciones del Narrador para autoaprobarse.

## Evidencia y límites

Las pruebas focales cubren integridad y rehash, exclusión de otro actor/Director, bytes exactos, admisión real desde la composición del host sin inferencia, replay y reinicio, conservación en configuración de fork y ausencia histórica. La revisión independiente encontró problemas de agregación de audiencias y extracción Markdown; se corrigieron con regresiones del lector. La verificación final se registra en el handoff vigente.

Resultado global final: **1306 tests, 1305 aprobados, cero fallos y una omisión exclusiva de Linux**, con ICM CLI real; typecheck y build aprobados. Se comprobó además el inventario real completo: 27 actores y cinco roles administrativos, 61 fuentes seleccionadas contando la etapa compartida por actor. La primera pasada global detectó la importación de crypto del host desde el navegador; el split de schemas y las verificaciones explícitas del host corrigieron el fallo antes de repetir la suite. Revisión independiente posterior sin bloqueantes nuevos.

La suite previa de backup entre hosts sigue siendo una regresión del flujo existente. No prueba todavía transferencia de paquetes ICM por job: esa persistencia aún no existe. Ninguna prueba de este corte ejecuta inferencia nueva con los contratos Markdown.

## Trabajo que continúa

1. Persistir los paquetes en journal antes del despacho, ligados a leases/jobs y autoridad durable; entregar al renderer sellos y fences desde esos registros, nunca desde parámetros del cliente.
2. Conectar Actor, Continuista, Director, Configurador y narración opcional. Conservar `noContextFiles`, tools y sesiones independientes; recovery y reformulación usan el paquete exacto guardado.
3. Agregar selección/preview/diferencias/conflictos en la GUI y exigir admisión a las puestas nuevas. La ausencia opcional permite leer históricos; el constructor actual aún no distingue obligatoriamente toda creación nueva de legacy. No presentar ese paso como resuelto.
4. Verificar reinicio, corrupción, cancelación, fork y backup con paquetes reales; comprobar recepción efectiva en Pi con transporte controlado y el recorrido gráfico.

La implementación permanece en journal v42: este corte no agrega tabla ni migración para paquetes. El objetivo integral y la aceptación de PRD/specs siguen abiertos.
