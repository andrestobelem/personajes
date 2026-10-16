# CONTROL: un informe, tres versiones

Puesta editorial sintética en Washington D. C., 20 de junio de 1966, 09:00 UTC−04:00. Run `803a8675-2ad0-47ed-9d76-c7f8a64743a1`, configuración Ready 7. No corresponde a un episodio emitido. Tres espacios: Oficina, Pasillo y Archivo de CONTROL. Dos objetos editoriales sin valor de verdad confirmado: un aviso sin firma y un registro de mantenimiento.

## Preparación comprobada

Max, 99 y el Jefe se prepararon con el Configurador real, cada uno en su propio trabajo. Se usaron el perfil OpenAI Codex OAuth `gpt-6.1-sol`/`low` y la preparación recomendada del siguiente pendiente. Trabajos aceptados y aplicados completos: Max `917be10b`, 99 `17373dc5` y Jefe `371ac67b`. Cada uno trae las nueve secciones y la ubicación en la Oficina.

Las biografías separan evidencia documental de hipótesis editorial y conservan vacíos y contradicciones. No importan episodios posteriores al corte, como el matrimonio de Max y 99 o la vida familiar del Jefe. Ninguna sección cita `sourceRefs`, porque este corte no admite referencias documentales: todo quedó como adaptación declarada.

Después vinieron la validación Ready (revisión 7), las memorias `initialize-empty` de los tres actores (job `51719826`) y el preflight `c9a0532b`, con 16 controles aprobados. Inicio a las 17:28 UTC del 16 de octubre de 2026. Narrador y audio desactivados; sin interlocutores humanos.

## Lo ocurrido

27 eventos y 11 parlamentos del proveedor, sin diálogos escritos por el operador.

- **Apertura:** 99 pregunta quién dejó el aviso. El Jefe admite que no lo sabe y reparte tareas: 99 averigua quién programó la prueba y Max, quién dejó el aviso.
- **Investigación de 99:** recorre el Pasillo y el Archivo, observa el registro de mantenimiento y vuelve. Cita su texto, aclara que no tiene fecha ni firma y que no acredita el estado actual del circuito.
- **El Jefe se corrige:** reconoce que se adelantó al mandarla a buscar al responsable sin una pista.
- **Max:** va al Pasillo y al Archivo sin hablar con nadie más. Su observación del registro no está confirmada en el registro público.
- **Reposo:** los tres eligen esperar sin pedir continuar. El último pulso termina sin iniciativas pendientes y la representación sigue `running`, pero inactiva.

Guion: [control-un-informe-tres-versiones-…-c33.fountain](../output/control-un-informe-tres-versiones-803a8675-2ad0-47ed-9d76-c7f8a64743a1-c33-132ec7c7addb9a69.fountain), commit 33, SHA-256 `132ec7c7…`.

## Fallas encontradas y corregidas durante la función

- `16df141`: un actor con una iniciativa `pending` actuó por otra causa y pidió continuar. Eso violaba `actor_initiatives_one_open_per_actor` y suspendía el pulso. Ahora la iniciativa anterior queda reemplazada (`superseded-by-later-turn`).
- `53eadbc`: las observaciones directas no se convierten en experiencias, así que el Continuista no podía verificar lo que 99 había leído. Marcaba la revisión como incompleta y el turno seguía bloqueado en cada reintento. Ahora el contexto del Continuista incluye las observaciones ya entregadas al actor.
- Un `wait` de Max falló una vez con `execution-failed` al confirmarse. El reintento posterior lo confirmó y la causa no quedó identificada. El diagnóstico del coordinador ahora informa el actor y el prefijo del código de error.

## Límites de la evidencia

No es una obra completa: es el primer tramo hasta el reposo, sin cierre de escena ni de episodio. Tampoco se probó la intervención humana, porque la puesta no tiene interlocutores humanos configurados. El reposo muestra que, cuando todos esperan, nadie aporta una causa nueva. Seguir requiere una decisión de dirección: una circunstancia, una intervención humana o el cierre estructural. Tras cada reinicio del host fue necesario reabrir las memorias, pausar, correr un preflight nuevo y reanudar.
