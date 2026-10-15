# Publicación durable de bifurcaciones: respuestas del custodio

Fecha: 15 de octubre de 2026. Intercambio real entre `fork_contract_audit` (entrevistador) y `fork_icm_audit` (custodio), coordinado por el agente integrador. Las respuestas clasifican requisitos, reglas derivadas y propuestas técnicas. No se atribuyen a la persona usuaria preferencias nuevas ni se afirma que el intercambio haya ejecutado una bifurcación.

Fuentes: [constitución](../constitucion.md), [ADR 0007](../adr/0007-estructura-episodica-y-bifurcacion.md), [S02: persistencia](../specs/02-persistencia-e-icm.md), [S05: interfaz](../specs/05-interfaz.md) y [preparación interna de bifurcación](preparacion-de-bifurcacion.md). Los límites de corte privado permanecen en las [respuestas previas](cortes-privados-respuestas.md).

## Ronda 1: integridad de la publicación

### Pregunta 1: estructura editorial fuera del snapshot

**Entrevistador.** ¿Se conservan episodios, actos y escenas activos o cerrados como una semilla editorial del destino, con identidades nuevas y procedencia, o se borran sus asociaciones para iniciar dramaturgia nueva? Recomienda la semilla explícita sin fabricar eventos locales de apertura o cierre.

**Respuesta.** Conservar la estructura confirmada del corte mediante una semilla editorial explícita. Borrar asociaciones convierte una escena activa en una escena heredada sin episodio y pierde una parte del estado que el fork dice preservar. La semilla mantiene estado, orden y agrupaciones; sus identidades nuevas y referencias a la fuente no significan que las aperturas o cierres hayan ocurrido otra vez en el destino. El corte local cero debe distinguir esa importación de un comando estructural nuevo.

**Clasificación y fuentes.** Preservar estado confirmado y comenzar una historia independiente son requisitos de continuidad formulados en ADR 0007 y S02. No perder estructura ni inventar acontecimientos es regla derivada. La representación como semilla editorial importada es propuesta técnica. S05, apartado 8.2, distingue episodios, actos y escenas; no existe una preferencia humana pendiente que justifique borrarlos.

### Pregunta 2: consecuencias y líneas con evidencia del padre

**Entrevistador.** Las consecuencias y líneas abiertas citan eventos que no existen como eventos locales del destino. ¿Se permiten referencias tipadas a fuente con corrida, corte y hash, distinguiéndolas en mutaciones futuras?

**Respuesta.** Sí. La evidencia importada conserva referencias comprobables al padre, sin crear copias ficticias de eventos ni IDs locales huérfanos. Una operación posterior debe admitir y conservar esa procedencia, o rechazar explícitamente una referencia que no puede verificar. No puede fingir un cierre local en el commit cero. Mantener una consecuencia abierta tampoco significa imponer cómo reaccionarán los personajes.

**Clasificación y fuentes.** La procedencia y la conservación de consecuencias son requisitos recogidos en la constitución y ADR 0007. No convertir evidencia en un acontecimiento nuevo es regla derivada. El formato tipado de referencias externas y su validación son propuestas técnicas compatibles con S02 y S05.

### Pregunta 3: destino entre escenas

**Entrevistador.** Si la fuente tiene `activeSceneId=null`, ¿Ready significa publicación coherente sin escena apta para actuar, preservando el intervalo hasta una apertura explícita?

**Respuesta.** Sí. El destino conserva el intervalo entre escenas y el estado abierto o cerrado de sus episodios. La publicación Ready acredita reconciliación y preparación, sin fabricar una escena ni habilitar por sí sola actuación. El inicio no crea otro episodio ordinal uno si ya existe estructura importada, no reabre un episodio cerrado y no inventa participantes. Los controles deben permitir la apertura estructural legítima que corresponda y bloquear inferencia y avance automático mientras no haya escena apta.

**Clasificación y fuentes.** Escena, episodio y corrida distintos, continuidad entre unidades y ausencia legítima de escena proceden de ADR 0007, S02 y S05. Preservar el estado y evitar actuación sin escena son reglas derivadas. La adaptación de gates Ready/inicio es propuesta técnica; no requiere una elección artística humana nueva.

### Pregunta 4: configuración sonora y evidencia histórica

**Entrevistador.** La configuración Ready de audio y el almacén de voces vivo pueden diferir. ¿Se preservan selección, variedad, modo y bindings verificables, sin copiar trabajos de TTS ni consultar al proveedor, con fallo explícito cuando falta evidencia?

**Respuesta.** Sí. Se toma la configuración fuente exacta, sin sustituirla por el último estado del almacén de voces. Se preservan el modo, la variedad y la selección verificables; cuando haga falta, se deriva una asociación técnica del destino con identidad y hash propios. No se copian trabajos, transportes ni artefactos TTS como si fueran publicaciones nuevas, ni se consulta al proveedor durante el fork.

Si la compatibilidad o la evidencia del corte no pueden comprobarse, el destino no se publica parcialmente como Ready: queda diagnóstico o conciliación explícita. Convertirlo silenciosamente a texto cambia la configuración elegida. Conservar una receta o binding tampoco acredita síntesis real ni evaluación acústica.

**Clasificación y fuentes.** Voz y modo elegidos, aislamiento y ausencia de sustitución automática pertenecen a los requisitos del proyecto. Temporalidad y no degradación silenciosa son reglas derivadas. El snapshot de evidencia y la nueva asociación técnica son propuestas; S02 exige publicación reconciliada, no un permiso para consultar o corregir el pasado desde el proveedor actual.

### Pregunta 5: preparación y antecedentes externos

**Entrevistador.** ¿Se conservan los antecedentes iniciales curados de otra corrida y las fuentes documentales, derivando una preparación para la nueva continuidad y recalculando hashes sin inventar vivencias?

**Respuesta.** Sí. La preparación del destino declara su derivación técnica, ajusta los campos tipados de continuidad y recalcula contexto y fences. Conserva los textos y fuentes documentales, además de la procedencia de la preparación original. Un antecedente externo curado continúa siendo ese antecedente: no se transforma en un evento nuevo del destino ni se borra su corrida de origen.

La coherencia de `initialExperience.continuity` puede requerir remapeo tipado, manteniendo su `source.runId` y procedencia original donde correspondan. No se busca ni reemplaza texto libre para fingir esa adaptación.

**Clasificación y fuentes.** Identidad, memoria propia y procedencia son requisitos de la constitución. No inventar experiencias ni reinterpretar el origen es regla derivada. La preparación derivada y su rehash son propuestas técnicas conforme al contrato S02 y los límites del corte 44.

### Pregunta 6: staging, recuperación y publicación completa

**Entrevistador.** ¿El destino queda sin exposición operativa hasta verificar manifiesto, fuente, configuración, estructura y todas sus bases ICM, preservando la misma operación e identidades ante reintento? ¿Se admite Ready parcial?

**Respuesta.** El destino no aparece como una representación publicada ni admite operaciones de actuación mientras siga en staging. La publicación final verifica el paquete completo y los receipts propios de ICM en una transacción que haga observable el cambio de estado. Reintento y recuperación conservan operación, destino y manifiesto; un fallo recuperable conserva el trabajo durable sin exponer media rama.

No se admite Ready parcial por faltar audio, configuración o estructura. Las sesiones Pi son nuevas y pueden crearse cuando realmente se vaya a actuar; publicar un fork no inicia inferencia. Se preserva la fuente y no se adopta una sesión anterior para aparentar continuidad.

**Clasificación y fuentes.** Independencia de la representación y memoria propia son requisitos. Aislamiento y atomicidad de la publicación observable son reglas derivadas. Los estados staging/ready/failed, la conciliación y la transacción final concretan el contrato técnico ya escrito en S02. Esta respuesta no certifica que estén implementados.

## Aclaración posterior: configuración inicial y audio efectivo

**Pregunta del integrador, con evidencia nueva.** `readForkSource` dispone de Ready inicial inmutable y su hash, pero no de una versión sonora efectiva por commit. ¿Puede derivarse la configuración del destino desde esa base, conservando el modo y dejando un binding como pendiente de conciliación, o debe bloquearse incluso una base inicial de audio apagado?

**Respuesta.** Puede publicarse una configuración **derivada y declarada** desde el Ready inicial inmutable. Eso no reconstruye el audio efectivo del commit. No hace falta bloquear una base inicial apagada únicamente por desconocer la historia posterior del ledger sonoro: la procedencia inicial sí es verificable, y su límite debe quedar explícito.

Si una selección `enabled-bound` necesita pasar a `enabled-unbound`, se conserva el modo habilitado, se registra la conciliación requerida y se bloquea el inicio o preflight mientras corresponda. No se cambia silenciosamente a texto, no se declara una voz validada y no se consulta el almacén vivo como evidencia del pasado. La procedencia y el diagnóstico deben estar en el registro durable y en la respuesta actual de operación; prometer un aviso en una interfaz futura no basta.

**Rectificación de alcance.** Las respuestas 4 y 6 exigían un paquete completo y rechazaban Ready parcial. Se precisa que el paquete completo puede contener una configuración derivada explícita con diagnóstico de audio no reconstruido históricamente y conciliación pendiente. El estado Ready de publicación no es aprobación para actuar. Lo que sigue prohibido es omitir datos del paquete, ocultar la derivación o afirmar una reconstrucción sonora que no puede probarse.

**Clasificación.** Propuesta técnica revisada ante evidencia del almacenamiento actual; mantiene la regla derivada de procedencia, la ausencia de fallback y la distinción entre publicación y ejecución. No atribuye una preferencia nueva al usuario. La reconstrucción exacta del audio efectivo histórico permanece pendiente.

## Estado y límites

Las seis preguntas recibieron respuesta sin introducir una preferencia humana nueva. La implementación debe aportar su propia evidencia de publicación durable, recuperación, aislamiento de memorias, estructura y audio; el acuerdo documental no acredita ninguna ejecución. Los cortes heredados sin memoria histórica verificable siguen no disponibles y no se completan con datos actuales.
