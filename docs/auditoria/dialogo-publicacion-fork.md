# Diálogo sobre publicación de una bifurcación

Fecha: 15 de octubre de 2026. Intercambio real entre `fork_contract_audit`, entrevistador, y `fork_icm_audit`, custodio del concepto, coordinados por el integrador. Se aplicaron [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md), [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) y el [procedimiento del proyecto](../diseno/procedimiento-grill-with-docs.md).

Las respuestas de agentes no se atribuyen al usuario. Las propuestas de implementación siguientes deben verificarse contra código y pruebas; registrar este diálogo no acredita que la bifurcación esté implementada.

## Fuentes y tensión comprobada

- [ADR 0007](../adr/0007-estructura-episodica-y-bifurcacion.md): nuevo run y continuidad desde un corte exacto; estructura separada de los hechos; ninguna escena o cierre ficticios.
- [S02](../specs/02-persistencia-e-icm.md): importación privada, staging durable, reconciliación y publicación verificadas.
- [S04](../specs/04-api-y-autoridad.md): autoridad e idempotencia de fork, lifecycle y comandos estructurales.
- [S05](../specs/05-interfaz.md), §8.2: estado histórico de episodios, actos y escenas y distinción entre continuar y bifurcar.
- [Constitución](../constitucion.md): conocimiento situado, voz, independencia actoral y procedencia.

El snapshot del Escenario no incluye episodios ni actos. Copiarlo sin la estructura editorial pierde asociaciones y estado operativo. Al realizar la entrevista, `openInitialEpisodeAtStart` exigía escena activa sin episodios previos y creaba el episodio ordinal 1; los comandos estructurales sólo admitían corridas running, paused o stopped. Estas restricciones necesitan reconciliarse con un destino publicado entre escenas y con estructura importada.

## Preguntas y respuestas efectivamente intercambiadas

### 1. Estructura heredada frente a dramaturgia vacía

**Pregunta.** ¿Conservar episodios, actos y escenas activos/cerrados de la fuente exacta como semilla editorial del destino, con IDs nuevos, procedencia y cortes locales cero, o mantener sólo la referencia al padre e iniciar una dramaturgia vacía? El entrevistador recomendó conservar la estructura y evitar eventos locales ficticios de apertura/cierre.

**Respuesta del custodio.** Conservar una semilla editorial explícita del corte, con agrupaciones y estados, IDs nuevos y procedencia. Borrar las asociaciones degrada la continuidad y no satisface un fork exacto. Los cortes locales cero deben identificarse como importados: no significan que los episodios se abrieron o cerraron nuevamente en el destino. Preservar estado es una regla derivada del requisito de continuidad; el mecanismo concreto de semilla importada es propuesta técnica.

### 2. Consecuencias y evidencia de la fuente

**Pregunta.** Las consecuencias y líneas abiertas pueden citar eventos que no existen como eventos locales del destino. ¿Se conservan referencias tipadas a run, corte y hash fuente sin crear hechos locales ficticios? ¿Deben los cierres y mutaciones posteriores reconocerlas?

**Respuesta del custodio.** Sí. La evidencia importada conserva su carácter histórico y su fuente; no vuelve a ocurrir en el hijo. Las mutaciones futuras deben admitir esa procedencia o bloquearse con causa explícita. Nunca deben convertirla en un ID local huérfano. Procedencia es requisito; evitar ficción duplicada es regla derivada; la representación tipada es propuesta técnica.

### 3. Destino publicado entre escenas

**Pregunta.** Si la fuente no tiene escena activa, ¿Ready puede significar publicación y preparación reconciliadas sin habilitar actuación automática? El entrevistador recomendó conservar `activeSceneId=null`, respetar el episodio abierto o cerrado y exigir aperturas explícitas.

**Respuesta del custodio.** Sí. Publicación no equivale a una escena apta para actuar. El destino conserva la ausencia de escena y la estructura de la fuente. El inicio no debe inventar un episodio ordinal 1 sobre una semilla existente ni reabrir un episodio cerrado. Se propone permitir el destino Ready entre escenas con diagnósticos, sin inferencia ni avance de reloj hasta disponer de una escena, y dar acceso al flujo legítimo de apertura de las unidades necesarias. No falta una preferencia artística que deba preguntarse al usuario.

**Comprobación del entrevistador.** Permitir únicamente que la validación Ready acepte una escena nula no resuelve el recorrido: también deben ajustarse los gates de comandos estructurales y el comportamiento de inicio para impedir un callejón sin salida o una apertura automática inventada.

### 4. Audio y configuración histórica

**Pregunta.** Si el audio de la configuración fuente y el almacén vivo de voces difieren, ¿se preservan modo, variedad, selección y bindings inmutables compatibles sin copiar trabajos TTS ni consultar al proveedor? La recomendación fue verificar el audio exacto y fallar o exigir conciliación explícita cuando falte evidencia, sin cambiar silenciosamente a texto.

**Respuesta del custodio.** Sí. Se preservan las elecciones verificables de la configuración fuente exacta y se realiza un reencuadre técnico con identidad/hash nuevos cuando sea necesario. El almacén vivo no sustituye evidencia histórica. No se copian trabajos, transportes ni síntesis ni se llama al proveedor. Una evidencia insuficiente requiere diagnóstico o conciliación antes de publicar Ready; convertir silenciosamente a textOnly cambia la configuración. Receta y binding tampoco prueban síntesis ni calidad acústica. Voz y modo elegido son requisitos; fidelidad temporal es derivación; snapshot/reencuadre son propuesta técnica.

### 5. Preparación y antecedentes anteriores

**Pregunta.** ¿Se conserva el contenido documental y los antecedentes autorizados de otras corridas mientras se deriva una preparación coherente con la continuidad nueva, recalculando contextos y fences sin inventar vivencias?

**Respuesta del custodio.** Sí. Se preservan textos y procedencia originales y se declara la adaptación técnica de la preparación. Las referencias tipadas a continuidad, incluida `initialExperience.continuity`, deben quedar coherentes con el destino. No se borra el `runId` fuente ni la procedencia del antecedente externo curado, que no se convierte en evento ocurrido nuevamente en el destino. Los hashes del contexto y sus fronteras se recalculan para la nueva configuración.

### 6. Staging y publicación completa

**Pregunta.** ¿El destino permanece inoperable y fuera del listado de representaciones publicadas hasta verificar manifiesto, fuente, configuración, estructura y todas las bases ICM privadas? ¿Se conserva la misma operación, destino y manifiesto durante replay y recuperación, sin publicar una rama parcial?

**Respuesta del custodio.** Sí. La transacción final publica sólo tras verificar el paquete entero y los archivos/receipts ICM propios. Un fallo recuperable conserva staging, sin exposición parcial. Se mantienen operación, destino y manifiesto estables. Las sesiones Pi son nuevas y pueden crearse al comenzar a actuar; el fork no llama modelos. No corresponde declarar Ready parcial por faltar audio, configuración o estructura. Independencia y memoria propia son requisitos; aislamiento y atomicidad observable son derivaciones; el mecanismo staging/ready/failed y la publicación final están propuestos en S02.

## Resultado y pendientes verificables

Se acordó conservar la estructura editorial exacta como estado importado con procedencia, sin fabricar historia local. Se conserva la diferencia entre destino publicado, preparación ejecutable y escena abierta. No se introduce una preferencia nueva del usuario ni se decide un argumento dramático.

La implementación debe acreditar al menos: semilla con episodio abierto y escena activa; episodio abierto entre escenas; episodio cerrado sin reapertura automática; actos y consecuencias con referencias fuente verificables; primera mutación estructural y replay desde el commit local cero; preservación de audio sin fallback silencioso; antecedentes externos curados; fallo y recuperación entre importación ICM y publicación; operación idempotente con el mismo destino; y sesiones actorales independientes al iniciar. Las rutas de restauración en modo fork deben reutilizar las mismas garantías, según ADR 0007 y S02.
