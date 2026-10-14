# Revisión del PRD de producto

Este archivo conserva la primera revisión (R1, PRD v0.1) y las revisiones incrementales R2–R7. Los veredictos anteriores son históricos; el estado vigente figura en R7.

Revisión de `docs/PRD.md` v0.1 contra la constitución, el glosario, la cobertura de pedidos, la interfaz y arquitectura, decisiones abiertas y el diálogo PRD. Alcance de esta pasada: completitud del producto, coherencia entre los requisitos y aceptación, y si los recorridos abarcan las decisiones configurables sin atribuir preferencias nuevas al usuario.

## Veredicto de R1 (histórico)

**No aprobar todavía.** El documento ya cubre la mayor parte del dominio y preserva decisiones duras: una instancia Pi por personaje, `openai-codex` por OAuth, `gpt-6-luna` con `xhigh`, perspectiva situada, la diferencia entre Escenario/escenografía/escena, actor/revisión/publicación, GUI completa y sonido opcional configurable. El diálogo también queda incorporado como evidencia, sin atribuir al usuario las propuestas del custodio.

Los bloqueos de esta revisión son criterios funcionales que aún no están fijados en el propio PRD, además de una brecha importante entre 74 IDs de requisitos y el plan de 15 ensayos sin trazabilidad por ID. Las decisiones propuestas abajo son reversibles y no requieren abrir otra ronda humana.

## Hallazgos que bloquean aprobación

### P1 — La preparación como actor del Método carece de aceptación verificable

**Ubicación:** §1, línea 7; `ACT-04` y `ACT-05`; pruebas de §9.

**Problema:** el usuario pidió que los actores se preparen como actores del Método. `ACT-04` enumera identidad, circunstancias, memoria, deseos, escucha y relación, pero no nombra esa orientación ni fija cómo comprobar que esas dimensiones cambien la actuación. `Fibonacci` prueba respuestas desde saberes configurados; `Evolución` prueba registrar una transformación, pero no comprueban escucha, objetivo/táctica ante obstáculo, ni que la riqueza biográfica condicione el argumento.

**Corrección requerida:** incorporar a `ACT-04` una regla explícita de adaptación funcional del Método, sin atribuir experiencia sentida al modelo ni confundir escuelas teatrales. Añadir un ensayo que mantenga el texto de una petición y cambie relación/circunstancias/objetivo relevante: evaluar elecciones, escucha, táctica, voz y consecuencias; considerar válida la divergencia situada y no exigir una salida literal única.

**Evidencia:** `docs/constitucion.md` §3; `docs/diseno/actores-personajes-y-fichas.md` §2 y §6; cobertura C06, C07 y C10; investigación `docs/investigaciones/actuacion-del-metodo.md`.

### P1 — La interfaz no concreta qué secretos puede consultar el observador ni el estado inicial de esa vista

**Ubicación:** recorrido §4.2; `UI-05` y `UI-06`.

**Problema:** «cambios autorizados» y «acceso a secretos» delegan la decisión central a una política futura. No se sabe qué muestra la vista inicial, si la memoria interna queda oculta hasta una elección explícita, ni quién configura la autorización. Esto deja incompleta la frontera entre observar y comunicar al reparto.

**Corrección requerida:** hacer explícita en el PRD una matriz de superficies y destinatarios: vista escénica inicial; vista interna ampliada con advertencia/selección de observador; modo de interlocución; modo de dirección; configuración/mantenimiento. Inspeccionar información privada no produce evento ni la añade al contexto de actores. El texto enviado al personaje sólo recibe los datos que el usuario incluyó en su mensaje. Añadir aceptación sobre el secreto de 99: observador lo consulta, Max no lo recibe; si el usuario lo cuenta en diálogo, Max recibe ese testimonio con procedencia, no el contenido del panel ni su verdad confirmada.

**Evidencia:** `docs/constitucion.md` §5 y §7 y casos de §12; D09–D11; propuesta explícita de vista escénica inicial y vista interna optativa registrada en `docs/auditoria/dialogo-prd.md`, R1.3.

### P1 — La puesta no define qué campos son obligatorios y cuáles son propuestas editables

**Ubicación:** §4.1, líneas 46–50; `ESC-01`; grupo D01–D07 en §8.

**Problema:** §4.1 habla de fecha/hora, zona, lugar, continuidad, divergencias, reparto, posiciones, relaciones, antecedentes, metas y tools; `ESC-01` agrega conflicto, propósito y reglas como si todos fueran obligatorios. La matriz deja algunos de esos valores abiertos, pero no distingue campos requeridos para iniciar de valores que pueden seguir como borrador o proponerse en una plantilla. La frase «datos obligatorios» no define el criterio de bloqueo.

**Corrección requerida:** incluir una tabla de estado por campo (`obligatorio para iniciar`, `opcional`, `propuesta editable`, `no inventable`), con validación visible. Como mínimo, no iniciar sin continuidad elegida, fecha/hora ficticia, lugar y al menos un personaje preparado; si conflicto/propósito/reglas también son bloqueantes, explicitar por qué y cómo se satisfacen sin forzar el desenlace. Los defaults deben marcarse como propuestas y confirmarse o editarse. Añadir un caso: intento de comenzar sin lugar ni reparto → inicio deshabilitado, lista de faltantes, ninguna escena o memoria creada.

**Evidencia:** D01–D07, D22 y las ocho decisiones previas a escena; `docs/auditoria/dialogo-prd.md`, R1.4; `obra/README.md` (configurar una escena antes de actuar y no inferir campos pendientes).

### P1 — Pausa, paso, cancelación y cierre remiten a una especificación futura en lugar de fijar sus efectos

**Ubicación:** §4.3, línea 60; `TIM-02` y `TIM-03`; pruebas Circadianidad y Error/reanuda.

**Problema:** el recorrido ofrece iniciar, pausar convocatorias, continuar, avanzar un paso, detener y cerrar; pero la semántica se deja para «la especificación». `TIM-02` dice que la pausa congela tiempo y nuevas convocatorias «según spec» sin definir qué pasa con inferencias o propuestas en curso, ni qué unidad avanza un paso. Detener y cerrar tampoco tienen efectos diferenciados. Esto puede producir diferencias entre reloj ficticio, estado del mundo, acción tardía y animación.

**Corrección requerida:** fijar en el PRD, al menos, la semántica base configurable: pausa del visor/replay frente a pausa de la corrida; pausa de corrida congela reloj y nuevas convocatorias; tareas en curso quedan visibles y no producen efecto hasta revalidarse al reanudar; avance por paso define qué ciclo/etapa ejecuta; detener cancela convocatorias nuevas pero conserva eventos confirmados; cerrar finaliza la corrida sin borrar historia. Definir de forma explícita si se permite avance fuera de línea (propuesta actual: desactivado). Añadir pruebas de acción que retorna durante una pausa y de cierre con trabajos en curso.

**Evidencia:** `docs/diseno/interfaz-funcional-y-visual.md`, «Pausar, continuar y avanzar»; D08/D27/D28; recomendación de reloj congelado y pasos explícitos en `docs/auditoria/dialogo-prd.md`, R1.4 y R2.2.

### P1 — El PRD no excluye de forma expresa efectos externos desde tools diegéticas

**Ubicación:** `ESC-06`, `ACT-10`, `NFR-09`; grupo D13–D17 de §8.

**Problema:** se prohíben shell, lectura privada y escritura arbitraria, pero no se define la regla para tools conectadas que produzcan efectos reales externos (p. ej., enviar mensajes, cambiar un sistema o accionar una API). D17 conserva como recomendación que las tools de personajes no tengan efectos reales en la primera puesta. Integrar Pi como coding agent y un adaptador de ElevenLabs vuelve necesario delimitar catálogo y destinatarios, más allá de prompt injection.

**Corrección requerida:** elevar a regla inicial que las tools de actores producen efectos sólo dentro del Escenario y que no ejecutan efectos externos reales; cualquier integración externa de dirección/configuración debe estar en un catálogo de host distinto, con autorización y efecto visible. No es necesario vetar el adaptador TTS de reproducción que actúa sobre un diálogo ya publicado. Añadir una prueba de una tool diegética que intenta enviar una petición externa y verificar que no hay llamada ni efecto fuera de la corrida.

**Evidencia:** constitución §6; D17 (propuesta de primera puesta); `obra/AGENTS.md` (herramientas de mantenimiento no son capacidades ficticias); separación de frontend/runtime/adaptadores en `docs/diseno/organizacion-de-pi-y-escenario.md`.

### P1 — La cobertura de pruebas no traza los requisitos funcionales a evidencia de cierre

**Ubicación:** §5, línea 66; tablas de requisitos; §9, líneas 211–231.

**Problema:** hay 74 IDs funcionales/no funcionales y 15 ensayos amplios, pero ningún ensayo identifica los IDs que cubre. Varias obligaciones quedan sin evidencia nombrada en el plan, como import/export versionado, prueba real del flujo OAuth y del perfil efectivo, funcionamiento/aislamiento de ICM SQLite, backup/restauración, interfaz accesible por teclado, accesibilidad del catálogo completo, licencias/procedencia de assets y límites de presupuesto. A la vez §231 exige cobertura requisito por requisito; el plan presente no permite demostrarla.

**Corrección requerida:** asignar IDs estables a los ensayos y añadir columna/lista de `requisitos cubiertos` que incluya todos los CAT/ESC/ACT/MEM/DIR/TIM/UI/VOZ/NFR. Para cada ID indicar la clase de evidencia exigida (unidad, integración local, E2E GUI, credencial/proveedor real, revisión de recurso o pendiente externo). Si un requisito no se puede probar todavía, el cierre debe quedar pendiente con criterio de desbloqueo; no marcarlo implícitamente cubierto por un escenario cercano.

**Evidencia:** afirmación de §66 y cierre §231; lista de 15 ensayos en §9; V01–V12 y pruebas de aceptación de constitución §12.

### P1 — La línea dramática está registrada pero no tiene una vista requerida de producto

**Ubicación:** §1, §4.3; `DIR-01`; `UI-01`/`UI-05`.

**Problema:** el PRD asigna al Director registrar etapas con evidencia, pero no exige que la interfaz permita seguir la línea dramática ni consultar por qué una etapa se propuso o rectificó. `UI-05` cubre cambios del personaje y `UI-01` nombra dirección en el recorrido general, sin criterio observable para ese artefacto.

**Corrección requerida:** añadir una capacidad UI explícita para ver línea de fondo, etapa propuesta/revisada, eventos que la sustentan, personajes afectados, asuntos abiertos y fecha ficticia; mostrar la lectura del Director junto a hechos sin confundirlos. Aceptación: una lectura puede marcarse «sin evidencia suficiente», revisarse después y conservar la rectificación; rechazar un giro no obliga a alcanzar la etapa esperada.

**Evidencia:** constitución §9; `docs/diseno/dramaturgia-y-direccion.md`, secciones «La línea dramática de fondo» y «Registro de la dirección»; `docs/diseno/interfaz-funcional-y-visual.md`, fila «Seguir la línea dramática»; decisión D30.

## Hallazgos de alcance a precisar

### P2 — «Biblioteca documental» carece de requisito verificable para las investigaciones y sus fuentes

**Ubicación:** §2, línea 19; §4.1, línea 46; `CAT-01` y `CAT-02`.

**Problema:** el producto promete una biblioteca documental y el recorrido permite abrir expediente y fuentes, pero los IDs sólo cubren los 27 dossiers, familia, apéndice y materiales del personaje. No se especifica si las investigaciones temáticas, paper, bibliografía, fuentes y límites de consulta deben aparecer navegables en la GUI. No se debe resolver esto haciendo accesible todo el corpus al contexto de los personajes.

**Corrección requerida:** decidirlo como alcance de la biblioteca dentro del PRD mediante criterio observable: incluir el índice de investigaciones/fuentes con documento, procedencia y límites de evidencia, o declarar que ese archivo vive en repositorio de configuración y no forma parte de la UX habitual. Si se expone, mantener permisos de Configurador/investigador separados del contexto de actor.

**Evidencia:** constitución §10–11; I01–I14 de `docs/auditoria/conversacion-y-cobertura.md`; instrucción raíz de `AGENTS.md` sobre un documento por investigación y límites explícitos.

### P2 — La prueba de producto no cubre explícitamente los límites de evidencia y temporalidad del canon

**Ubicación:** `CAT-05`, `CAT-06`, `ACT-09`; §9.

**Problema:** hay tests de secreto, Fibonacci y una escena tardía, pero no hay caso explícito que compruebe un personaje situado antes de una revelación canónica, una identidad con nombre civil desconocido, o el acceso UI a fuentes que distinguen canon, testimonio, interpretación y adaptación. `CAT-05` expresa el criterio general, pero la aceptación puede pasar sin demostrar estos límites.

**Corrección requerida:** agregar a la matriz de aceptación los casos ya fijados en constitución §12: Max anterior a matrimonio/hijos y la pregunta por identidad desconocida de 99 o los gemelos. Exigir etiqueta de vacío/adaptación y demostrar que la UI permite consultar procedencia. No convertir desconocimiento documental del investigador en amnesia del personaje.

**Evidencia:** constitución §§2, 5 y 12; modelo de ficha, separación canon/adaptación y vacíos; CAT-05/06/09.

## Aspectos que pasan esta revisión

- Se mantienen como requisitos explícitos la GUI funcional/visual completa, los 27 expedientes, instancias Pi independientes, OAuth `openai-codex`, `gpt-6-luna`/`xhigh`, perspectiva situada, reloj circadiano, español de doblaje, recetas ElevenLabs, agencia, posibilidad de escenas solitarias y ausencia de sustitución silenciosa del perfil.
- El sonido está correctamente planteado como integración opcional y configurable; el PRD pide playback/subtítulos cuando se habilita y distingue voz/receta/audio reales. No impone voz audible en cada escena ni clonación.
- Los recorridos cubren preparación, observación/participación, pausa/reanudación, replay, historial, dirección y fallos. Hay aceptación específica para secretos, inyección, propuesta/publicación, concurrencia sobre objetos, recuperación, evolución y acceso caducado.
- Los enlaces locales presentes en `docs/PRD.md` resuelven: 9 de 9 comprobados.

## Criterio al cierre de R1

Reabrir el veredicto cuando el PRD incorpore los siete hallazgos P1 o responda con evidencia que alguno ya esté cubierto en otra especificación normativamente enlazada. Los P2 deben resolverse como decisión de alcance o aceptación antes de dar por trazada la cobertura documental. La revisión no se considera conforme por la mera existencia de nombres de requisitos o de casos relacionados: cada comportamiento importante debe tener criterio de cierre comprobable.

## R2 — revisión de PRD v0.2 y trazabilidad

**Alcance:** lectura completa de `docs/PRD.md` v0.2 y `docs/auditoria/trazabilidad-prd.md`, cotejadas con las fuentes y respuestas de las dos rondas conservadas en `docs/auditoria/dialogo-prd.md`. Revisé criterios y casos, no sólo la aparición de términos. También comprobé enlaces relativos, cobertura individual de IDs y estados de evidencia.

**Veredicto vigente:** no quedan hallazgos funcionales abiertos en esta revisión de completitud del PRD. Los nueve hallazgos de R1 se resolvieron en contenido y aceptación observables:

| Hallazgo de R1 | Resultado en v0.2 |
|---|---|
| Método como preparación actoral sin aceptación | Resuelto en `ACT-04` y `P08`: evalúa escucha, táctica, voz y consecuencias ante cambios pertinentes, sin exigir divergencia ni una escuela teatral única (§5.3 y §9). |
| Vista del observador y secretos indeterminados | Resuelto con superficies y efectos separados en §4.5 y con caso de secreto de 99 en `P06`; consultar el panel no comunica ni crea percepción. |
| Campos bloqueantes de la puesta | Resuelto en tabla §4.4 y preflight de `P03`; campos requeridos, vacíos explícitos, datos no inventables y ausencia de llamada al modelo si falta algo obligatorio. |
| Efectos de pausa, paso, detención y cierre | Resuelto en §4.6 y `TIM-02`/`P16`; se distingue corrida de visor, pulso acotado, propuestas en curso y eventos confirmados. |
| Tools diegéticas y efectos externos | Resuelto en §4.7 y `ESC-06`/`P11`; las tools del actor quedan dentro del Escenario y las integraciones de host tienen autorizaciones separadas. |
| Cobertura de 74 requisitos con 15 pruebas sin mapa individual | Resuelto y ampliado: la v0.2 contiene 76 IDs y 25 ensayos; la matriz enumera cada ID con fuente, ensayo(s), aceptación y estado. |
| Línea dramática sin superficie de producto | Resuelto con `UI-11` y `P19`; la vista distingue evidencia, lectura insuficiente y rectificación sin forzar la etapa. |
| Biblioteca sin alcance para investigaciones | Resuelto con `CAT-09` y `P01`; pide navegación de 16 investigaciones, paper, fuentes y límites, separada del contexto de actores. |
| Límites de evidencia/canon sin casos temporales explícitos | Resuelto en `P02`; contempla Max antes de hechos futuros y nombres civiles/gemelos no comprobados como vacíos o adaptaciones, no como amnesia ni canon inventado. |

La revisión de trazabilidad encontró 76 requisitos únicos en PRD y matriz, sin IDs ausentes, duplicados ni extra. Los 25 ensayos aparecen al menos una vez en el mapa, todos los destinos `P01`–`P25` son válidos, y cada requisito tiene al menos un ensayo. Los 76 estados dicen «Pendiente; diseño escrito, no prueba ejecutada»; eso coincide con el PRD, que no presenta resultados como aprobados. Los 10 enlaces locales del PRD y 77 de la matriz resuelven.

**Hallazgos abiertos, acotados:** hay errores editoriales de espaciado que no alteran los criterios pero dificultan la lectura: `Versión0.2` y `las16` en la matriz; `las16`, `27expedientes`, `16investigaciones`, `28avatares`, `dosintentos`, `máximo3versiones`, `sinPi`, `sinfallback`, `rolLLM`, `sincredencial`, `Fangefectos`, `sinsobrescritura`, `segundoestado`, `sinsecretos`, `porrequisito`, `otrosensayos` y `de§4.6` en las tablas y el cierre del PRD. Recomiendo corregirlos editorialmente. Además, la fila `CAT-09` de la matriz enlaza al índice del reparto como fuente; éste acredita expedientes y enlaza algunas investigaciones, pero no es el índice de las 16 investigaciones. Añadir `../README.md` (índice de documentación) y, si se quiere fundamentar el carácter requerido, `../constitucion.md` daría una fuente directa. Son correcciones editoriales/de trazabilidad, no bloqueos de producto ni de cobertura; no afectan la correspondencia completa de IDs con ensayos.

El cierre del **PRD** puede considerarse conforme a esta revisión de alcance y aceptación, sujeto a esa limpieza editorial. Esto no aprueba specs ni implementación: siguen abiertas las 76 pruebas; P18 y los ensayos live dependen de acceso real, P21 de voz/credenciales y audio interpretable, y el documento marca expresamente esos resultados como pendientes. No se afirma que haya runtime, GUI, login, memoria conectada, reproducción de audio ni escena ejecutados.

**Hashes SHA-256 de los documentos revisados en esta pasada:**

- `docs/PRD.md` v0.2: `1427ff0b0734d6cd41d485449384b539c1fb8fab96d7fc73766ddbf2295a613c`
- `docs/auditoria/trazabilidad-prd.md`: `ddbb343d055b076d8f7eac2751a244bab5c611d9aad27e1864c5f8c1dd8dfe67`

## R3 — cierre de cambios v0.3

La v0.3 aclara en §4.7 dos resultados distintos: una resolución sin emisión, que conserva la causa del intento sin frase pronunciada ni recepción atribuida; y una emisión confirmada con recepción nula o parcial, que sólo queda en la memoria de la audiencia efectiva. `P10` pide probar ambos caminos por separado y distinguirlos de la entrega técnica/proyección. La precisión es coherente con los requisitos y los casos ya asentados; no requiere reabrir decisiones.

La fila `CAT-09` de la matriz ahora enlaza a `docs/README.md`, el índice que enumera las 16 investigaciones. Se cierra el hallazgo de fuente de R2. La cobertura sigue en 76 IDs y 25 ensayos, sin requisito ni prueba sin correspondencia.

Quedan pequeños residuos tipográficos en el texto de las pruebas (`apéndices,16` en `P01`, `civil99` en `P02`, `secreto99` en `P06` y `de§4.6` en `TIM-02`). Además, la nueva aceptación de `P10` comprueba recepción nula/parcial, que también cae bajo `ESC-05`; el requisito ya está probado por `P05` y `P06`, pero no aparece en la columna de IDs cubiertos por `P10`. Si se pretende que `P10` también cuente como evidencia de `ESC-05`, añádase ese ID a la fila P10 y `P10` a la fila ESC-05 de la matriz. Es un ajuste menor de trazabilidad, no una brecha de aceptación del requisito.

Este cierre sólo revisa el contenido del PRD v0.3 y su mapa; no revisa specs ni certifica ejecución. Los estados de aceptación permanecen pendientes y el PRD mantiene explícitas las dependencias externas.

**Hashes SHA-256 revisados en R3:**

- `docs/PRD.md` v0.3: `64986907e58c80435979b5512ba749a8ff3a38a813be64a3ab616703b8a8307a`
- `docs/auditoria/trazabilidad-prd.md` v0.3: `752180250899a68ba67f7b3c01dfde36599f343f197e243018275e624466c310`

## R4 — cotejo de atribución y recorridos v0.4

La separación entre `VOZ-03` (recetas documentadas), `VOZ-07` (flujo administrativo explícito de preview/selección/guardado) y `VOZ-04` (capacidad TTS incluida por DP-02, apagable por puesta) es coherente con el alcance y las fuentes. `P21` ya distingue cobertura de recetas, validación local, solicitud live, elección/guardado, síntesis y calibración; cada parte conserva su evidencia. El cierre global sigue pendiente hasta validar el flujo live, aunque una puesta individual use sólo texto. No se crean voces automáticamente ni se afirma ejecución.

También son consistentes: el inventario 27/16 se presenta como corpus versionado actual, no máximo del dominio; zona horaria/calendario se derivan del lugar cuando sea posible o se declaran, sin bloquear una fecha/hora ficticia que ya se eligió; `P08` exige casos comparados multivuelta con rúbrica sin imponer transformación; y `ACT-12` separa la persona observadora humana de cualquier componente que infiera con LLM. El plan mantiene 77 requisitos únicos, los 25 ensayos y todos los requisitos con al menos un ensayo; todas las referencias de padres a IDs internos son válidas, las filas tienen clases E/D/P reconocibles y cada derivación declara sus padres. Los estados continúan pendientes y los enlaces locales de la matriz resuelven.

**Hallazgo abierto de trazabilidad:** algunos cambios atribuidos explícitamente a decisiones del integrador no están citados en las filas de requisito afectadas. `DP-03` establece que las cifras 27/16 son sólo el inventario versionado actual, pero `CAT-01`, `CAT-07` y `CAT-09` no enlazan esa decisión (CAT-01/CAT-09 expresan el inventario; CAT-09 hoy cita DP-01). `DP-06` incluye la derivación/convención horaria de `ESC-01`, cuya fila no lo cita. `DP-05` declara que el observador es humano y no rol LLM, pero la fila `ACT-12` tampoco lo cita. Añadir la referencia DP correspondiente y marcar P en la composición de clase si esa parte de la aceptación es una decisión del integrador, o retirar esos requisitos del campo «Requisitos relacionados» de la DP si la relación no es normativa. Los comportamientos ya están descritos; el hallazgo es de atribución/procedencia en la matriz, no una pregunta ni una nueva decisión de producto.

Quedan residuos editoriales menores en v0.4: `paper y28 avatares` en P01 (falta un espacio) y `de§4.6` en TIM-02; pueden corregirse sin alterar alcance. La ruta de configuración de voz está exigida por VOZ-07/P21 y es compatible con el recorrido general de biblioteca/configuración; la especificación posterior puede concretar la pantalla y navegación.

R4 revisa sólo el contenido de producto, procedencia y plan. No revisa specs ni código y no declara pruebas de implementación ejecutadas.

**Hashes SHA-256 revisados en R4:**

- `docs/PRD.md` v0.4: `1d45f5ee80cd771a1d17b463a820edf02b6cb96168b6f0b9410b244d5f6755f9`
- `docs/auditoria/trazabilidad-prd.md` v0.4: `36394b72fb35707c22a2bbb90697f58d11a254521dedd08fe4006229d258fdba`
- `docs/auditoria/decisiones-producto-prd.md`: `c7ba9b7c51f8dc2cb2cf01102e989be7c1c942043129befc05cf2ca5285507c2`

## R5 — cotejo final de atribución y criterios v0.5

La v0.5 corrige las referencias a DP-03/06/05/02/07 y las clases de requisito pertinentes. Las nueve decisiones del integrador quedan identificadas por separado y no se atribuyen al usuario. El audio tiene estados coherentes: VOZ-03 exige recetas; VOZ-07 cubre la capacidad administrativa de preview/selección/guardado; VOZ-04 incluye el adaptador TTS por DP-02 y permite desactivarlo por puesta sin retirar la obligación de validación live global. MEM-09/P15 autorizan reproducir audio almacenado durante replay y excluyen generar síntesis nueva. Los criterios siguen describiendo pruebas futuras, no resultados ejecutados.

La estructura mantiene 77 requisitos únicos en PRD y matriz, los 25 ensayos y una fila de ensayo por requisito; los 77 estados están literalmente marcados «Pendiente; diseño, no prueba ejecutada». Los enlaces locales revisados resuelven. Quedan dos brechas puntuales entre los comportamientos descritos y la aceptación comprobable:

### P1 — P10 no comprueba que el límite de reformulación sea configurable

**Ubicación:** `ACT-08`, `P10`, `DP-08`; fila `ACT-08` de la matriz.

**Problema:** `ACT-08` y DP-08 dicen que el límite se configura antes de la puesta, con tres versiones como valor por defecto. P10 sólo exige «máximo 3 versiones», que puede leerse como techo fijo y no verifica que un límite alternativo configurado se aplique. La fila de matriz atribuye esta capacidad a P10, así que la cobertura actual no prueba la configurabilidad declarada.

**Corrección requerida:** precisar que tres es el default, declarar el rango admitido en el contrato y probar el valor configurado además del default: al agotarlo no se genera otra versión, no se aprueba una versión no revisada y se conserva el estado pendiente técnico. Si tres también es un máximo duro, declarar expresamente ese rango y probar el rechazo de valores fuera de él.

### P1 — P05/P07 no verifican la convención de variedad española de la puesta

**Ubicación:** `VOZ-01`, `P05`, `P07`, `DP-09`; fila `VOZ-01` de la matriz.

**Problema:** el PRD exige variedad seleccionada/declarada, y DP-09 permite conservar una propuesta editorial identificada mientras se elige. Las aceptaciones de P05 («voz española situada») y P07 (reacciones según saberes y motivos) no comprueban ninguna de esas condiciones. `P03` contiene la preparación de la puesta, pero no incluye `VOZ-01` ni exige el campo; por tanto no hay ensayo que demuestre la declaración o que distinga una propuesta visible de una selección confirmada. P21 tampoco cubre `VOZ-01`, aunque DP-09 lo enumera entre sus ensayos relacionados.

**Corrección requerida:** añadir una aceptación de puesta que compruebe la convención explícitamente elegida o, si sigue pendiente, una propuesta editorial visible y etiquetada; no atribuir una variedad concreta al usuario. Incluir `VOZ-01` y el ensayo correspondiente en las columnas de cobertura de PRD y matriz. El flujo de voz debe usar la convención efectiva de esa puesta.

Estos dos hallazgos son omisiones acotadas de criterio/prueba, no preguntas humanas nuevas ni reapertura de las decisiones DP-08/DP-09. Tras corregirlas, no identifico otra brecha de alcance o coherencia en los cambios de v0.5. Esta pasada revisa producto, trazabilidad y plan; no revisa specs ni acredita implementación, login, GUI, síntesis, escucha del corpus o pruebas ejecutadas.

**Hashes SHA-256 revisados en R5:**

- `docs/PRD.md` v0.5: `e4303bc165211828da27d82ab3effc57da9ba8a07c8b9049d2adf88fd7d91ae8`
- `docs/auditoria/trazabilidad-prd.md` v0.5: `4a3ba5491b4f0d425631aa13c4878d632ef5fc2b76d66b3b631462300286fd03`
- `docs/auditoria/decisiones-producto-prd.md` v0.5: `e8b0c4821c926b42ccb22ace19dbfdfb3e59e00e5dffde21312f8ba176e43085`

## R6 — cotejo de correcciones R5 y flujo de audio v0.6

La v0.6 resuelve ambas brechas de R5. `ACT-08`/DP-08 fijan dos reformulaciones como default, permiten reducir el límite a cero o una y conservan tres versiones totales como techo. `P10` comprueba el default, una reducción y el rechazo de un valor por encima del techo; la salida incompleta permanece sin aprobar. El criterio ya no presenta tres versiones como un límite configurable que pueda excederse.

`P05` comprueba que la convención de variedad esté declarada y que una propuesta editorial permanezca etiquetada hasta su elección; `P07` verifica que la propuesta no se atribuya a una elección humana. El PRD, la matriz y `requisitos-prd.json` declaran versión 0.6. Matriz y JSON mantienen VOZ-01 relacionado con P05/P07 y ACT-08 con P10; sus 77 IDs, clases, criterios de aceptación, ensayos planeados y estados de evidencia coinciden. Cada requisito conserva al menos un ensayo, los 25 ensayos P01–P25 están presentes y los 77 estados siguen pendientes de implementación/prueba. Los enlaces locales revisados resuelven.

### P1 — P21 no liga preview y síntesis a la variedad confirmada de la puesta

**Ubicación:** §4.4, `DP-09`, `VOZ-01`, `VOZ-04/07` y `P21`; guía [ElevenLabs, diseño de voces](../investigaciones/elevenlabs-diseno-de-voces.md), introducción y sección «Flujo para crear y probar una voz».

**Problema:** el flujo de la puesta puede conservar una propuesta editorial de variedad sin elección, y P05/P07 prueban correctamente que se distingue de una selección humana. Sin embargo, P21 sólo pide una solicitud explícita de preview, elección/guardado de voz y síntesis live; no establece que la variedad se confirme antes del preview ni que la síntesis use la variedad confirmada. La guía de diseño de voces indica que idioma y variedad regional deben confirmarse antes de generar audio y que el preview debe cotejar la variedad. Por tanto, P21 podría pasar aunque la capacidad sonora genere una voz mientras la convención sigue sólo como propuesta.

**Corrección requerida:** hacer que P21 exija una variedad seleccionada/confirmada antes de cualquier preview o síntesis de audio; si sólo hay propuesta editorial, mantener la capacidad bloqueada hasta esa confirmación. Comprobar que preview y audio usan la convención confirmada y registrar esa selección en la configuración de voz. Mapear VOZ-01 a P21 en el PRD, la matriz y el JSON si P21 aporta esa evidencia. Esto no fija una variedad por el usuario ni impide que cada puesta use sólo texto.

**Dictamen:** las dos brechas de aceptación de R5 quedan resueltas y matriz/JSON están alineados, pero la aceptación del flujo de audio mantiene el hallazgo concreto anterior. No recomiendo cerrar la revisión del PRD ni pasar a specs hasta que P21 describa esta precondición y quede trazada. Tras esa corrección, el PRD podrá pasar a specs; eso no aprobará las specs ni afirmará ejecución de producto o pruebas.

**Hashes SHA-256 revisados en R6:**

- `docs/PRD.md` v0.6: `8c8a794bd3f70748f58e1d7c3e67735319b7eeaf070465cf683fc3d6f564f183`
- `docs/auditoria/trazabilidad-prd.md` v0.6: `5f2ee4da9be32787bd62cdf1b99cca39d5aa81085b9e639ed8e7dfd3cff41a3e`
- `docs/auditoria/decisiones-producto-prd.md` v0.6: `3ccad8e3d8965f5672335da599d9d70667bc09db724ba1ca3268e1818d7eb3a3`
- `docs/auditoria/requisitos-prd.json` v0.6: `bb3d90ce4b0fdf6813f97631845dfa182a4b33d57c5fccc916e320ea724b493d`

## R7 — cierre v0.7 y pase a specs

La v0.7 resuelve el hallazgo de R6: la variedad regional confirmada es precondición de preview y síntesis en §4.4, VOZ-04/VOZ-07 y DP-09; una propuesta sin confirmar bloquea esas llamadas. P21 ahora prueba la precondición y comprueba que preview/síntesis correspondan a la convención elegida; VOZ-01 queda mapeado también a P21 en el PRD, la matriz y el JSON.

P24 ahora incluye CAT-02 y prueba un import/export de ida y vuelta comparando los campos indicados del expediente: ficha, biografía, vínculos, recuerdos, identidad, voz, metas, capacidades, fuentes, vacíos y discrepancias. La matriz relaciona CAT-02 con P01/P24 y el JSON coincide con ese mapeo. Esto convierte la preservación en aceptación verificable, sin presentar la prueba como ejecutada.

El cotejo estructural confirma versión 0.7, 77 requisitos únicos con clases, criterios, ensayos y estados coincidentes entre la matriz y `requisitos-prd.json`, 25 ensayos P01–P25 y evidencia pendiente en las 77 filas. Los enlaces locales de PRD, matriz y decisiones resuelven.

**Dictamen:** no encuentro un bloqueo de producto restante en el alcance revisado. El PRD puede pasar a specs. Este pase no aprueba las specs: contratos, modelo de datos, autoridad, persistencia, OAuth, runtime, interfaz y adaptadores deberán recibir su propio cotejo y evidencia. No se afirma implementación ni pruebas ejecutadas.

**Hashes SHA-256 revisados en R7:**

- `docs/PRD.md` v0.7: `ab189ca2c1a620165ac15007afced6cb6f35a3a2cf6305f4189251113e2b7de5`
- `docs/auditoria/trazabilidad-prd.md` v0.7: `b7fa1c28a0fd07f5a45a40bbf44b635dbd645bda4badd9a51404593b16f3430f`
- `docs/auditoria/decisiones-producto-prd.md` v0.7: `a06de04d4c38476a3a834dd8dcbfba5c60181d3a14c9cf54078590b550446ae4`
- `docs/auditoria/requisitos-prd.json` v0.7: `d2a3603c369c3a17006a97a37f0e63b3096ecd0c1579266d38e97b9f0db3e95f`

## Fuentes navegables

[PRD revisado](../PRD.md), [constitución](../constitucion.md), [glosario](../../GLOSSARY.md), [cobertura de pedidos](conversacion-y-cobertura.md), [diálogo PRD](dialogo-prd.md), [interfaz](../diseno/interfaz-funcional-y-visual.md), [matriz de decisiones](../diseno/decisiones-abiertas.md), [ficha amplia de personajes](../diseno/actores-personajes-y-fichas.md), [actuación del Método](../investigaciones/actuacion-del-metodo.md), [dramaturgia y dirección](../diseno/dramaturgia-y-direccion.md), [organización Pi/Escenario](../diseno/organizacion-de-pi-y-escenario.md), [índice del reparto](../personajes/get-smart/README.md), [workspace de la obra](../../obra/README.md), [AGENTS.md de la obra](../../obra/AGENTS.md), [README del proyecto](../../README.md) y [AGENTS.md del proyecto](../../AGENTS.md).
