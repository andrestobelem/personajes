# Revisión del PRD contra el concepto

Fecha: 14 de octubre de 2026. Revisión de `docs/PRD.md` versión 0.3 y `docs/auditoria/trazabilidad-prd.md` contra la constitución, el glosario, el concepto consolidado, las decisiones abiertas, la cobertura de la conversación y las respuestas reales del diálogo PRD.

| Artefacto | SHA-256 revisado |
|---|---|
| `docs/PRD.md` v0.3 (hash al cierre del pase) | `efaaeae2bdf062a8845bdf2acfac51cb325a209e8a2ca3623cd0ff79cf24ddb0` |
| `docs/auditoria/trazabilidad-prd.md` v0.3 (hash al cierre del pase) | `06ab05dc7e265bed1b008adbd6fbc1830f16ad73a1c3a216b22a0bd2db6409bc` |
| `docs/constitucion.md` | `543e71256501108c3842bc4f0e0204ba7e49d0cbd3f5bba9b068d65122ff54a3` |
| `docs/diseno/concepto-y-decisiones.md` | `6ecc3c91a9866dadf6be4b2becb9d1bebef30890b28d8285733a0a1eb5aa04b1` |
| `docs/diseno/decisiones-abiertas.md` | `c8015baedc300831142aec3d32194283ec7ba21fef03716e872521a3cddd67f3` |
| `docs/auditoria/conversacion-y-cobertura.md` | `427a4117ae2bfbb4e66a29988b693e7bd491d60951280a0ef3e6df2b56b05e88` |
| `docs/auditoria/dialogo-prd.md` | `058057b60e39f6de22f1e9415207877cb4bd236f6260b11e15989d98f056263a` |

## Dictamen acotado

El PRD cubre los compromisos centrales que cotejé: personajes con identidad y evolución, actuación situada, perspectiva separada, escenas solitarias y múltiples, dirección dramática, usuario como observador e interlocutor, doblaje en español, voces documentadas, narrador opcional, tiempo circadiano, GUI funcional y visual, Pi independiente por personaje, OAuth Codex, `gpt-6-luna`/`xhigh`, herramientas acotadas y separación entre contexto Markdown y memoria SQLite. Reconoce que el encargo activo incluye PRD, specs e implementación, en vez de mantener como límite la antigua fase documental.

Los 76 IDs funcionales/no funcionales del PRD tienen correspondencia visible en los 25 ensayos de cierre; no encontré un ID huérfano en esa matriz. No considero que esta comprobación de conteo certifique por sí sola la exhaustividad del concepto. Antes de cerrar el PRD, recomiendo resolver o acotar los puntos siguientes. Ninguno requiere una nueva pregunta humana: son correcciones de atribución, alcance o aceptación.

## Hallazgos y cambios necesarios

### PRD-C01 · Categoría y origen de cada requisito — prioridad alta

`docs/auditoria/trazabilidad-prd.md` asigna a cada ID una fuente principal, pero no indica si el contenido es requisito expreso, regla derivada o decisión de implementación del proyecto, ni suele enlazar al apartado exacto. Eso dificulta verificar la afirmación de PRD §2 de que conserva lo expreso sin atribuir decisiones de agentes al usuario.

**Cambio recomendado:** añadir a cada fila categoría y ancla precisa (por ejemplo, `constitución §10`, `cobertura T04`, `conversación E11` o `PRD decisión del integrador`). Para requisitos derivados, enlazar el requisito padre; para una decisión de producto, identificar quién la adoptó y cuándo. Conservar una entrada que permita descubrir requisitos expresos omitidos, no sólo relacionar IDs con ensayos.

### PRD-C02 · `ACT-12`: el observador no es por defecto un rol LLM — prioridad alta

`ACT-12` enumera «Observador» junto con Director, Configurador y otros posibles roles de modelo. El glosario define **Observador** como la persona que presencia la obra y consulta su evolución. Esa persona no se convierte en un rol agéntico por figurar en una lista de componentes. El Escenario es además una autoridad de dominio, no necesariamente un agente LLM.

**Cambio recomendado:** redactar el criterio como «todo componente que efectivamente invoque un modelo para inferencia usa el perfil fijado». Quitar `Observador` como rol modelado; documentar que las consultas, vistas y resoluciones mecánicas no requieren LLM. Si un producto posterior incluye un asistente LLM para el operador, distinguirlo explícitamente de la persona observadora y asignarle el perfil correspondiente. Fuentes: `GLOSSARY.md`, términos «Observador» y «Coordinador de la obra»; PRD §3/§5.3 ACT-12; constitución §10.

### PRD-C03 · Recetas de voz frente al flujo de ElevenLabs — prioridad alta

El requisito directo es que cada personaje tenga **una receta documentada** para crear su voz en ElevenLabs. La constitución §3 distingue receta, voz creada y audio generado; la auditoría de cobertura I14 dice que no se crearon previews, voces ni audio. En cambio, `VOZ-03` convierte «flujo de preview/selección/guardado» en parte de mantener las recetas. El diálogo PRD registra aparte que el integrador decidió incluir capacidad de TTS configurable; no registra una decisión humana de crear voces ni previews.

**Cambio recomendado:** separar (a) cobertura y consulta de la receta existente para cada identidad, incluida la receta de efectos de Fang, (b) capacidad de la aplicación para configurar una voz y solicitar previews/guardado, adoptada como decisión de producto si ése es el alcance del integrador, y (c) generación/reproducción TTS. El acceptance obligatorio de recetas debe verificar el conjunto del corpus, sin exigir que cada receta tenga una voz guardada. En `trazabilidad-prd.md`, enlazar `VOZ-03` al pedido I14/constitución §3, y señalar preview/selección como capacidad de producto añadida.

### PRD-C04 · TTS configurable y cierre de producto — prioridad alta

`VOZ-04` lo llama «opcional» y PRD §4.4 permite desactivar audio; pero §9 afirma que todos los IDs son necesarios para considerar el producto terminado, P21 exige «ElevenLabs real» y se indica que la falta de esa evidencia mantiene abierto el cierre global. La adenda del integrador en `dialogo-prd.md` resuelve que se incluye un adaptador configurable; la palabra opcional puede significar desactivable en una representación o excluible del producto, y el PRD no distingue estos sentidos.

**Cambio recomendado:** declarar que la **capacidad de integración** está dentro del alcance del producto por decisión del integrador y que cada puesta puede desactivarla; distinguir implementation acceptance (adaptador, errores visibles, texto intacto, reintento ligado al diálogo publicado) de validación live con cuenta/voz. P21 debe indicar cuáles partes son obligatorias sin credenciales y cuáles quedan pendientes de prueba live. Si el adaptador se excluye del corte publicado, debe quedar como alcance condicional y no bloquear el cierre de la interfaz textual/visual. No atribuir ninguna de estas decisiones a una respuesta del custodio.

### PRD-C05 · «27» describe el inventario actual, no una cantidad inmutable — prioridad media

PRD §1 y `CAT-01` usan 27 como cardinalidad normativa. Los documentos de concepto informan 27 expedientes actuales, pero `respuestas-del-concepto.md` aclara que el usuario eligió los personajes principales y recurrentes de la serie original, no una cifra inmutable. Los expedientes y apéndices deben conservar su identidad y separación sin hacer de 27 un límite del modelo de catálogo.

**Cambio recomendado:** decir «mostrar el corpus actualmente preparado (27 expedientes individuales, familia y apéndice multipartes, según el manifiesto de esta versión)». Aceptar paridad entre catálogo y fuentes versionadas; la cifra es un control del corte de datos, no una regla del dominio ni impedimento para añadir una adaptación/identidad revisada. La elección del elenco de una puesta sigue separada.

### PRD-C06 · Biblioteca de las 16 investigaciones — prioridad media

`CAT-09` y PRD §2 convierten la biblioteca navegable de las 16 investigaciones en requisito de la aplicación. La conversación pide conservar las investigaciones en documentos separados con fuentes y límites; no establece que el usuario de la aplicación necesite una biblioteca de investigación dentro de la GUI. Los expedientes sí deben estar disponibles para configurar personajes, y el PRD acierta al no darlos a los actores automáticamente.

**Cambio recomendado:** conservar la navegación documental como capacidad explícita de la biblioteca si el integrador la quiere para este producto, pero etiquetarla como propuesta/decisión de alcance del producto, no como requisito expreso. Separar la disponibilidad en repositorio de la obligación de exponer todos los papeles de investigación en la interfaz de actuación.

### PRD-C07 · Integración ICM y topología de memoria — prioridad media

La conversación y el diseño sí tratan integrar ICM Memory con Pi; la constitución también exige memoria privada por personaje y declara que ICM Markdown e ICM Memory/SQLite son investigaciones distintas. Sin embargo `MEM-01` prescribe «base privada por actor/corrida» como una sola exigencia. La base por actor es una recomendación técnica de la investigación y la dimensión adicional por corrida no aparece como una elección expresa. D25 conserva abiertas la fuente autoritativa, la relación de IDs, las proyecciones y el propietario de escrituras.

**Cambio recomendado:** mantener la obligación funcional de memoria persistente y aislamiento por actor; presentar ICM Memory/SQLite como la integración escogida para esta implementación si el integrador la adopta, y enviar el alcance por corrida, el número/ruta de bases y el vínculo con el journal al diseño de persistencia. Evitar atribuir esa topología a la constitución o al usuario. Fuente: conversación-y-cobertura T04; constitución §§5/10; decisiones abiertas D25–D27; investigación ICM Memory.

### PRD-C08 · Aceptación de actuación del Método — prioridad media

`ACT-04` y `P08` proponen comparar una misma petición con cambio de relación, circunstancia u objetivo. Es un buen escenario inicial, pero una sola comparación puede pasar por una diferencia superficial y no demostrar escucha, preparación desde biografía pertinente, continuidad ni influencia causal en decisiones posteriores. El concepto de actuación del Método es requisito adaptado al agente; no se debe evaluar como imitación de una escuela única ni por una frase exacta.

**Cambio recomendado:** que P08 use varias situaciones y más de una secuencia por personaje, incluya una consecuencia que modifique o no modifique razonablemente una táctica posterior, y evalúe con una rúbrica cualitativa documentada (circunstancia/objetivo, escucha y relación, elección, voz, consecuencia y continuidad). Incluir evidencia de casos y límites de lectura del revisor. Mantener explícito que no se exige divergencia ni transformación en todos los casos.

### PRD-C09 · Zona horaria como requisito de configuración — prioridad baja

PRD §4.1 y §4.4 exige seleccionar zona horaria. El usuario exige fecha y lugar; una zona horaria puede ser dato derivado del lugar y del calendario de la representación o una preferencia técnica. No hay una elección humana al respecto.

**Cambio recomendado:** requerir fecha/hora y localización diegéticas; mostrar zona horaria sólo si el runtime la necesita para cálculos, permitiendo derivarla de la localización o declarar explícitamente una convención cuando no corresponda a una zona real. No bloquear una escena por falta de un campo que el host pueda resolver sin cambiar el momento ficticio.

## Aspectos correctamente cubiertos

- La especificación no limita la interfaz a un chat: incluye biblioteca, puesta, Escenario visible, conversaciones, evolución, historia, dirección, pausa/reanudación, recuperación, accesibilidad y controles desde GUI.
- No confunde una escena solitaria con instancia compartida; ESC-04/P04 y ESC-04/P05 cubren escena de una persona y diálogo múltiple. Dos sesiones independientes son prueba de aislamiento, no cardinalidad mínima.
- La fecha/lugar/continuidad de una puesta no se inventan; los campos pueden quedar abiertos en un borrador, pero no se inicia con datos obligatorios ausentes.
- Separación entre expediente global, adaptación, contexto por continuidad, estado vivido y memoria subjetiva queda representada por CAT-05–CAT-08 y MEM-02–MEM-04/MEM-10.
- Pi, OAuth, perfil exacto para invocaciones de modelo, errores sin fallback, actor autónomo y coordinador del pulso están incluidos.
- Los modos de observación, interlocución y dirección, y el secreto visto por el observador, conservan su canal y procedencia.
- Diferencia propuesta, aprobación, emisión, recepción, entrega, publicación y audio; conserva eventos confirmados aunque haya OAuth vencido y replay no reejecuta modelos/tools/TTS.
- ICM de contexto en Markdown y memoria SQLite no se presentan como el mismo sistema. La fuente de hechos, backups y snapshots quedan en specs/decisiones técnicas.
- El ritmo audiovisual y el uso de audio no se declaran medidos sin escucha. El PRD marca la evidencia live como pendiente.
- La instrucción histórica «esta fase no implementa el producto» fue corregida; el PRD reconoce el mandato activo de continuar hasta implementar y revisar.

## Resultado para la siguiente versión

No encontré una omisión conceptual mayor en esta revisión. Antes de marcar el PRD cerrado, aplicar o decidir explícitamente PRD-C01–C09, priorizando el significado del cierre de TTS, la categoría de `ACT-12` y la separación entre receta ElevenLabs y flujo de creación. Luego actualizar hashes y volver a cotejar que los cambios no conviertan propuestas del integrador en elecciones humanas.

## Segunda revisión — PRD v0.4

Fecha: 14 de octubre de 2026. Relectura semántica del PRD v0.4, su trazabilidad y las decisiones del integrador contra la constitución, el concepto, las decisiones abiertas, cobertura, respuestas del concepto y diálogos conservados. No se revisó implementación: las 77 filas y los 25 ensayos continúan pendientes según sus propios registros.

| Artefacto | SHA-256 revisado |
|---|---|
| `docs/PRD.md` v0.4 | `1d45f5ee80cd771a1d17b463a820edf02b6cb96168b6f0b9410b244d5f6755f9` |
| `docs/auditoria/trazabilidad-prd.md` v0.4 | `36394b72fb35707c22a2bbb90697f58d11a254521dedd08fe4006229d258fdba` |
| `docs/auditoria/decisiones-producto-prd.md` | `c7ba9b7c51f8dc2cb2cf01102e989be7c1c942043129befc05cf2ca5285507c2` |
| `docs/constitucion.md` | `543e71256501108c3842bc4f0e0204ba7e49d0cbd3f5bba9b068d65122ff54a3` |
| `docs/diseno/concepto-y-decisiones.md` | `6ecc3c91a9866dadf6be4b2becb9d1bebef30890b28d8285733a0a1eb5aa04b1` |
| `docs/diseno/decisiones-abiertas.md` | `c8015baedc300831142aec3d32194283ec7ba21fef03716e872521a3cddd67f3` |
| `docs/auditoria/conversacion-y-cobertura.md` | `427a4117ae2bfbb4e66a29988b693e7bd491d60951280a0ef3e6df2b56b05e88` |
| `docs/auditoria/respuestas-del-concepto.md` | `1c8045d8169788ae9258a8ecab3715880065218ca50d008d5a6d99c419392df6` |
| `docs/auditoria/dialogo-constitucional.md` | `b244e9d89bca5c7e5a1a0a028145e75208b9441c62c8c85bd75ff4c0d102da2e` |
| `docs/auditoria/dialogo-prd.md` | `058057b60e39f6de22f1e9415207877cb4bd236f6260b11e15989d98f056263a` |

### Correcciones anteriores

PRD-C02–C09 quedan corregidos en lo sustantivo: el observador humano no es rol LLM; receta, administración de voces y TTS tienen alcances separados; capacidad TTS y su prueba live pertenecen al producto por una decisión atribuida al integrador; 27 y 16 son inventarios de un corte versionado; CAT-09/DP-01 y MEM-01/DP-04 distinguen alcance añadido de requisito original y elección de backend de topología; P08 prueba varias situaciones y secuencias; zona horaria no fuerza una elección arbitraria. El texto conserva como históricos los límites de fases previas y reconoce el objetivo activo de implementación.

C01 se atendió con clases E/D/P, anclas y padres para la mayoría de requisitos. El cotejo de aceptación descubre, sin embargo, tres aceptaciones compuestas cuya clase/fuente aún no queda representada con suficiente precisión; además, el tope de ACT-08 carece de una clasificación de origen adecuada:

### PRD-C10 · Aceptaciones compuestas con origen distinto — prioridad media

La matriz marca como **E** requisitos que incluyen criterios añadidos de distinto origen. En `CAT-02`, la aceptación «sin pérdida al importar/exportar» introduce el flujo de intercambio que `UI-10` y `DP-07` clasifican como decisión del integrador. En `ESC-04`, la escena de uno o más personajes es expresa (`C15`), pero la entrada tardía sin conocimiento retroactivo es una regla derivada del conocimiento situado (`Constitución §5`, `MEM-09`/`ESC-05`). En `VOZ-01`, hablar doblado al español y tener voz distintiva son expresos (`E09`, `C09`); exigir que cada puesta elija/deje declarada una variedad concreta no lo es: `Constitución §3` y `D18` la dejan abierta/propuesta.

**Cambio necesario:** separar esas partes en la aceptación, o reflejar las clases combinadas y enlazar los padres/decisión que les dan origen. Mantener el español como requisito expreso; tratar la variedad como convención editable del proyecto/puesta, con un default claramente etiquetado si se necesita para iniciar, sin presentarlo como preferencia humana ya elegida.

### PRD-C11 · Tope de reformulaciones clasificado como derivación — prioridad media

`ACT-08` está clasificado sólo como **D** y cita Constitución §8, `E06` y padres `ACT-07, ACT-10`. Esas fuentes sostienen revisar la respuesta y proteger autoridad/continuidad, pero no derivan el número exacto «dos reformulaciones/tres versiones». Ese límite aparece en `obra/references/revision-y-publicacion.md` y `D14` como **límite inicial propuesto del protocolo del workspace**, ajustable con evidencia. No es una decisión expresa del usuario ni una consecuencia lógica de ACT-07/10.

**Cambio necesario:** marcar el límite como decisión del proyecto (y registrarlo en la tabla de decisiones del integrador), o hacerlo configurable como política inicial sin atribuirle carácter derivado. La regla de no continuar indefinidamente y dejar un estado técnico visible puede conservarse como derivación, con fuente y padre propios.

### PRD-C12 · Alcance de TTS durante replay — prioridad baja

`MEM-09` acepta «No inferencia/tool/TTS en replay», mientras §4.3 dice que el replay no vuelve a llamar TTS y `VOZ-04` incluye reproducción. La intención aparente es no sintetizar de nuevo, pero la redacción puede prohibir reproducir un audio ya generado y persistido.

**Cambio necesario:** si la reproducción de audio guardado forma parte de VOZ-04, precisar «no invocar síntesis TTS durante replay; se puede reproducir el artefacto asociado ya guardado». De otro modo, indicar que replay es exclusivamente textual/visual. No se requiere otra decisión humana si se mantiene la misma distinción entre generación y reproducción.

### Dictamen acotado de R2

El cotejo sustenta que el PRD cubre el concepto conocido y no detecta otra omisión central en las áreas de GUI completa, Pi independiente/OAuth/perfil, memoria, separación canon-contexto-estado vivido, permisos, voz/recetas, persistencia/recovery, agencia o escenas solitarias y múltiples. Las decisiones añadidas están generalmente identificadas como decisiones del integrador y no se presentan como elecciones humanas. No considero aún cerrado el cotejo documental: deben resolverse PRD-C10–C12 y actualizarse las clases/anclas afectadas en la trazabilidad. El estado de implementación y los ensayos live siguen pendientes; este dictamen no acredita ejecución ni calidad del producto.

## Tercera revisión — PRD v0.5

Fecha: 14 de octubre de 2026. R3 revisa el cierre de las correcciones C10–C12 en PRD v0.5, trazabilidad v0.5 y decisiones del integrador, cotejando el origen y la aceptación de las filas afectadas. Esta revisión no certifica implementación ni modifica otros documentos.

| Artefacto | SHA-256 revisado |
|---|---|
| `docs/PRD.md` v0.5 | `e4303bc165211828da27d82ab3effc57da9ba8a07c8b9049d2adf88fd7d91ae8` |
| `docs/auditoria/trazabilidad-prd.md` v0.5 | `4a3ba5491b4f0d425631aa13c4878d632ef5fc2b76d66b3b631462300286fd03` |
| `docs/auditoria/decisiones-producto-prd.md` | `e8b0c4821c926b42ccb22ace19dbfdfb3e59e00e5dffde21312f8ba176e43085` |

### Estado de PRD-C10–C12

Las clases y procedencias se corrigieron: `CAT-02` separa lo expreso del intercambio añadido por DP-07; `ESC-04` enlaza su regla de entrada tardía con `ESC-05`; `VOZ-01` conserva como expreso el español y registra la convención de variedad como regla/decisión del integrador DP-09, sin atribuir al usuario una variedad latinoamericana. `ACT-08` enlaza su default configurable a DP-08, que declara la cifra como decisión del integrador y no como requisito humano. `MEM-09` y P15 permiten reproducir audio almacenado y prohíben nuevas inferencias, acciones o síntesis durante replay. Las referencias añadidas a DP-03, DP-06, DP-05 y DP-02 también corresponden al origen de las reglas afectadas.

### PRD-C13 · P10 contradice el límite configurable de ACT-08 — prioridad baja

ACT-08 y DP-08 dicen que el límite se configura antes de la puesta y que dos reformulaciones/tres versiones son el default. Sin embargo, P10 todavía exige «máximo 3 versiones» sin restringirlo al default. Leído junto con la configuración, esto puede convertir el valor inicial en un techo fijo y dejar sin prueba el comportamiento cuando la persona configura otro límite.

**Cambio recomendado:** P10 debe verificar explícitamente el default de dos reformulaciones/tres versiones y luego cambiar el límite y comprobar que el runtime aplica el valor configurado, sin publicar una versión no revisada. Si el producto pretende un techo duro de tres versiones, ACT-08/DP-08 deben decir que sólo se puede configurar un límite menor; hoy no lo dicen.

### Dictamen acotado de R3

C10–C12 quedan resueltos en los artefactos cotejados; no detecté nueva omisión conceptual ni falsa atribución humana. El v0.5 es coherente sobre procedencia de categorías, configurabilidad de la puesta y replay de audio guardado, salvo la inconsistencia de P10 descrita en C13. Recomiendo cerrar ese punto en la aceptación/prueba y actualizar hashes antes de declarar el PRD documentalmente cerrado. No hay base para declarar producto implementado: todos los ensayos siguen pendientes.

## Cuarta revisión — PRD v0.6

Fecha: 14 de octubre de 2026. R4 comprueba C13 y vuelve a cotejar el mapeo de aceptación de los cambios relacionados en PRD v0.6, trazabilidad v0.6, decisiones del integrador y espejo JSON.

| Artefacto | SHA-256 revisado |
|---|---|
| `docs/PRD.md` v0.6 | `8c8a794bd3f70748f58e1d7c3e67735319b7eeaf070465cf683fc3d6f564f183` |
| `docs/auditoria/trazabilidad-prd.md` v0.6 | `5f2ee4da9be32787bd62cdf1b99cca39d5aa81085b9e639ed8e7dfd3cff41a3e` |
| `docs/auditoria/decisiones-producto-prd.md` | `3ccad8e3d8965f5672335da599d9d70667bc09db724ba1ca3268e1818d7eb3a3` |
| `docs/auditoria/requisitos-prd.json` | `bb3d90ce4b0fdf6813f97631845dfa182a4b33d57c5fccc916e320ea724b493d` |

### Estado de PRD-C13

C13 queda resuelto. `ACT-08` y DP-08 limitan la configuración a cero, una o dos reformulaciones, con dos como default y tres versiones totales como techo. P10 comprueba el default, ambos valores reducidos y el rechazo de configuraciones que excedan el techo. P05/P07 verifican que la convención de español y una propuesta editorial queden etiquetadas sin atribuir una elección al usuario. La reproducción del audio almacenado sigue separada de una nueva síntesis.

El espejo `requisitos-prd.json` está en versión 0.6; cotejé sus 77 IDs con la tabla Markdown. Categoría, aceptación y ensayos planificados coinciden en las 77 filas. Hay 25 ensayos y todas las evidencias permanecen pendientes.

### PRD-C14 · La aceptación de CAT-02 no está cubierta por P24 — prioridad baja

`CAT-02` clasifica como E+P la conservación del expediente y su fidelidad «sin pérdida al importar/exportar», con origen añadido en DP-07. Sin embargo, la trazabilidad enlaza CAT-02 sólo a P01. P01 comprueba biblioteca/recursos y procedencia; el ensayo de intercambio es P24, cuya lista de requisitos incluye UI-10, MEM-07, MEM-08, CAT-06 y NFR-02, pero no CAT-02. Su resultado tampoco dice expresamente que se comparen todos los campos del expediente tras exportar e importar.

**Cambio recomendado:** enlazar CAT-02 también con P24 y hacer que el resultado de P24 verifique ida/vuelta sin pérdida de biografía, identidad, relaciones, recuerdos, voz, metas, capacidades, fuentes, vacíos y discrepancias; o separar esa aceptación para que P01 pruebe visualización y P24 pruebe preservación de datos. Mantener actualizados el Markdown y el espejo JSON.

### Dictamen acotado de R4

No encontré otra contradicción de alcance ni atribución de decisión humana en los cambios revisados; C13 está cerrado. El mapeo de CAT-02 a sus pruebas es el único residuo concreto que encontré en este pase. Recomiendo cerrarlo antes de declarar el PRD documentalmente revisado. No declaro implementación completa: las pruebas, el runtime, la GUI y las integraciones reales siguen pendientes.

## Quinta revisión — PRD v0.7 y cierre documental

Fecha: 14 de octubre de 2026. R5 coteja las correcciones C14 y de variedad de voz en PRD v0.7, sus decisiones de integrador, la trazabilidad y el espejo JSON.

| Artefacto | SHA-256 revisado |
|---|---|
| `docs/PRD.md` v0.7 | `ab189ca2c1a620165ac15007afced6cb6f35a3a2cf6305f4189251113e2b7de5` |
| `docs/auditoria/trazabilidad-prd.md` v0.7 | `b7fa1c28a0fd07f5a45a40bbf44b635dbd645bda4badd9a51404593b16f3430f` |
| `docs/auditoria/decisiones-producto-prd.md` | `a06de04d4c38476a3a834dd8dcbfba5c60181d3a14c9cf54078590b550446ae4` |
| `docs/auditoria/requisitos-prd.json` v0.7 | `d2a3603c369c3a17006a97a37f0e63b3096ecd0c1579266d38e97b9f0db3e95f` |

C14 queda resuelto: CAT-02 enlaza P01/P24; P24 verifica ida/vuelta y compara ficha, biografía, vínculos, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias. La tabla Markdown y el espejo JSON coinciden en categoría, aceptación y ensayos para los 77 IDs.

La convención de variedad también queda bien delimitada: el español es requisito expreso; el proyecto exige declarar una convención en la puesta, sin atribuir al usuario una variedad concreta. Una propuesta editorial identificada permite actuación textual, pero bloquea preview y síntesis hasta que la variedad se confirme. P05/P07 prueban la distinción y P21 incluye VOZ-01 y verifica que la convención usada en voz coincida con la seleccionada. Este gate de audio no impide una primera representación textual ni convierte la propuesta editorial en elección humana.

No encontré otro defecto concreto de procedencia, categoría, alcance o aceptación en el cotejo final. **Dictamen acotado:** la revisión documental del PRD queda cerrada y se puede pasar a escribir/revisar specs. La versión contiene 77 requisitos y 25 ensayos planificados; todos siguen pendientes de implementación/verificación. Este cierre no declara runtime Pi, OAuth, memoria SQLite, GUI, ElevenLabs, pruebas live ni producto terminado.
