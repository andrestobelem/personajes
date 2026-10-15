# Reloj y rutinas: preparación y límite entre escenas

Corte 40, 15 de octubre de 2026. Implementación parcial del ritmo circadiano requerido; no acredita TIM-01 integral ni un calendario diario.

## Brechas verificadas y correcciones

La política `advance-while-running` ya existía en dominio y runtime, pero el editor sólo mostraba esa opción si el borrador ya la tenía. Una preparación nueva podía elegir únicamente manual. El [editor de reloj](../../src/web/CircadianPolicyEditor.tsx) ahora ofrece ambas políticas y pendiente, con máximo por salto explícito. Valida milisegundos enteros seguros, distingue cero de vacío, conserva la edición inválida y bloquea guardar hasta aplicar la sección. No altera las acciones ni genera rutinas, escenas o llamadas a modelos por editar.

La auditoría delegada `circadian_gap_audit` encontró que el journal permitía avanzar tras cerrar la última escena, contra S02. Primero se reprodujo el defecto con una prueba SQLite y otra del planificador: ambas fallaron. La corrección verifica escena activa abierta en ambos límites; el journal responde `notApplicable/no-active-scene`. La prueba compara snapshot y cantidades de eventos, commits, avances, causas e invitaciones antes/después. No requiere migración ni reescribe snapshots históricos.

Se corrigieron dos afirmaciones obsoletas en S02/S03 que todavía declaraban desconectadas metas/rutinas. Su conexión y cadena hasta conversación ya estaban probadas en cortes anteriores. La revisión conserva los límites reales: intervalos absolutos, máximo por salto, sin reloj de equipo ni recuperación de tiempo fuera de línea; recurrencia diaria y calendario de día/noche siguen sin implementarse.

## Evidencia

[Pruebas del formulario](../../tests/run-draft-circadian.test.ts) cubren políticas desde vacío, preservación del original, cero, fracciones, negativos, vacío, entero inseguro, valor máximo exacto y configuración activa de sólo lectura. [Planificación](../../tests/actor-activation.test.ts) y [journal real](../../tests/world-journal.test.ts) cubren el bloqueo entre escenas.

El navegador integrado operó un launcher aislado con una preparación sintética y sin ICM: eligió automático desde manual, intentó aplicar sin máximo, vio el error y el guardado bloqueado; después aplicó 86.400.000 ms, guardó revisión 1, recargó la página, reabrió y verificó el valor exacto. Validar produjo Ready en revisión 1, sin iniciar la representación. [Captura del editor validado](evidencias/reloj-preparacion-20261015.png). Ese día como límite es dato sintético elegido para la prueba, no una decisión del usuario ni una rutina diaria implementada.

Gate: `TMPDIR=/private/tmp PERSONAJES_ICM_TEST_BINARY=/tmp/personajes-icm-0.11.4-audit/install/bin/icm npm run verify` terminó con **645 pruebas: 644 aprobadas, cero fallidas y una omitida por requerir Linux**. TypeScript y build de 438 módulos pasaron. No se contactaron proveedores reales. El producto completo y los 77 requisitos conservan aceptación pendiente.
