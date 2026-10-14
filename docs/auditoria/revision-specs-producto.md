# Revisión cruzada de especificaciones de producto

**Ronda R1 — 14 de octubre de 2026.** Revisión documental de S05 contra PRD 1.0 y los contratos disponibles de S04, S06 y S07. No evalúa implementación ni evidencia de ejecución. Esta ronda no cierra la fase de specs; quedan hallazgos que requieren respuesta de sus autores.

## Snapshot revisado

| Documento | SHA-256 |
|---|---|
| `docs/PRD.md` | `affdbb0de5a24b78c297d6337917ff0320639e00ba2a34883e4b957a3afbe323` |
| `docs/specs/04-api-y-autoridad.md` | `f276c7e7009d881275556f771ac34fd3acb89376ce2bba2ddefa77f5f555b4f5` |
| `docs/specs/05-interfaz.md` | `c49184876b7ab793f51abf000c883e38beeeaf7af2d2191342ec8e18a74fe028` |
| `docs/specs/06-voces-y-ritmo.md` | `13f90fe3f381d0c94c27cff423547da5602eb5c10c93db5e0eacb2b9b6e0828e` |
| `docs/specs/07-verificacion.md` | `2161f43a6d47fe479829f772b2cef128b6b9750323b0a79acdb459aa973bea8a` |

Los hashes identifican sólo este corte; los autores pueden actualizarlos al resolver los puntos abiertos. S05 se alineó durante la revisión en el orden `validate → ready`, preflight sin prueba live implícita, sesión local separada de OAuth, ETag/`If-Match`, y privacidad de propuestas no emitidas. Se comprobó que sus enlaces locales resuelven y que `git diff --check` no informa errores.

**Errata R1:** se retira la observación que cuestionaba `/api/v1/session`. S04 declara que todas las rutas usan el prefijo `/api/v1` y que las tablas lo omiten por brevedad; por tanto, `/session` en la tabla es una ruta relativa a ese prefijo, no una ruta alternativa ni un bloqueo.

## Hallazgos abiertos

| ID / severidad | Evidencia y efecto | Resolución requerida |
|---|---|---|
| **XS-01 — bloqueante: falta el contrato API de Voice Design y guardado** | PRD VOZ-07 y S06 §§4–5 describen solicitud de Voice Design que produce previews con `generated_voice_id`, selección explícita y guardado que devuelve `voice_id` para crear un binding. S05 §§3.2 y 9 exponen ese recorrido. S04, en «OAuth, diagnóstico y voz», define `POST /voice-previews` como TTS temporal de una voz existente y dice que no crea ni guarda voces; también lista voces y configura bindings existentes, pero no especifica operaciones para Voice Design, obtener/reproducir sus resultados ni guardar la opción elegida. | Extender S04 con solicitudes/jobs/DTO y commits para diseño temporal y guardado/binding, incluyendo confirmación de variedad, muestra elegida, estados de error/reintento y separación entre `generated_voice_id` y `voice_id`; o corregir explícitamente S05/S06 sólo si el requisito PRD cambia. Hasta entonces no hay contrato para implementar VOZ-07 completo. |
| **XS-02 — bloqueante: esquema de modo de audio incompleto y duplicado entre S04/S06** | S06 §2.1 define `AudioMode` con desactivado/habilitado, modalidad automática o manual, modelo, formato y subtítulos; también separa slots de interlocutores, narrador y efectos. S05 §9 presenta selección automático/manual y subtítulos. S04 define `RunLimits.audioEnabled` y `PUT /runs/{runId}/voice-settings` con `{audioEnabled, spanishConvention, voiceSelections}`, sin modalidad, formato, modelo ni subtítulos. Así la UI no puede guardar toda la configuración que S06 exige y quedan dos lugares potenciales para `audioEnabled`. | Acordar un schema autoritativo de configuración versionada y reflejarlo de manera idéntica en S01/S04/S06; especificar qué campos son de límites de corrida y cuáles de voz. Incluir en la API los modos automático/manual y los ajustes requeridos por la puesta; conservar audio apagado como default reversible del integrador. |
| **XS-03 — importante: vista interna de propuestas carece de DTO detallado** | S05 §§3.1, 6.2 y 9 requiere que Inspector autorizado pueda mostrar el texto exacto no emitido, su versión/hash, veredicto/completitud y feedback privado disponible, siempre separado de conversación/replay. S04 `GET /runs/{runId}/proposals` sólo nombra `ProposalStatusView`, con estado/IDs públicos y texto exacto en vista interna; no define qué campos privados devuelve ni cómo se relacionan con Review. S01/S03/S02 sí describen proposal, veredicto, códigos/evidencias y completitud. | Precisar la variante interna del DTO con texto de versión exacta y datos de revisión permitidos (veredicto, códigos, refs, completitud y feedback disponible), su requisito de `observer-view=internal`, y confirmar exclusión de SSE, transcript público, replay público, herramientas y contexto de actores. La lectura privada no debe habilitar cambiar el veredicto ni publicar. |
| **XS-05 — menor: referencias temporales obsoletas en S07** | S07 P03 y P05 aún agregan «S04 previsto por título», pero S04 ya está creado. Su cierre también dice que las asignaciones deben cotejarse «cuando esté escrito» S04, aunque ahora la dependencia es una revisión cruzada del borrador existente. | Quitar las dos notas de “previsto por título” y reformular el cierre como cotejo de S04 borrador vigente antes del gate G0. La asignación provisional puede seguir pendiente de revisión. |

## Consistencia del recorrido S05

S05 ahora restringe la escena pública y el transcript a estados técnicos/IDs de propuestas no emitidas, sin mostrar contenido ni feedback privado. El Inspector opt-in autorizado puede consultar el contenido técnico con advertencia persistente, sin pronunciar, emitir, publicar, cambiar contexto ni exponerlo en replay público. S04 respalda esa frontera de visibilidad; queda por completar el DTO privado según XS-03. S05 también alinea pausa/reanudación, lectura histórica, variedad confirmada y reproducción sólo de audio almacenado con PRD/S04/S06/S07.

El layout de escritorio con navegación lateral, barra superior, escenario central, conversación lateral y paneles de contexto, su adaptación a anchos menores y los estados vacíos están declarados como decisiones reversibles del integrador, no como preferencias del usuario. No se encontraron bloqueos adicionales en esos recorridos en este corte.

No se declara terminada la revisión ni la fase de specs hasta que S04/S07 reciban los ajustes aplicables y se coteje el siguiente snapshot. Ninguna fila de ensayos se considera ejecutada por este informe.

## Ronda R2 — verificación de resolución

**Snapshot revisado: 14 de octubre de 2026.** Se cotejaron PRD 1.0 y S01–S07; el alcance de esta ronda fue resolver los hallazgos de producto R1, revisar la privacidad/API y el recorrido Voice Design de S05 contra S04/S06/S07, y comprobar que no quedara en S05 la antigua brecha declarada de Voice Design. Esta es una revisión documental, no una prueba de implementación ni de acceso live.

| Documento | SHA-256 |
|---|---|
| `docs/PRD.md` | `affdbb0de5a24b78c297d6337917ff0320639e00ba2a34883e4b957a3afbe323` |
| `docs/specs/01-dominio-y-catalogo.md` | `c14ec021efa6c0e85fdf837b1ba91a372f422bc8837f948ed30e995a4a4209ce` |
| `docs/specs/02-persistencia-e-icm.md` | `553d3c077fbe84a75acab44d7263e174d525d264fc6e046e1a70bd3d0434cadb` |
| `docs/specs/03-pi-y-coordinacion.md` | `88e56c487ef02085e8b8fc95c70061dc86934e4fdfb490a25b8431c745a2fdfa` |
| `docs/specs/04-api-y-autoridad.md` | `a74a31a073d19d4368f4fe0cacb15851bed0c7f57e29b4eafbfed47275a51baa` |
| `docs/specs/05-interfaz.md` | `763dd61f427b965c8770e00219a89bd47969970ca5b5b76f07229ae5403a702d` |
| `docs/specs/06-voces-y-ritmo.md` | `ef6f9f309ef9488628004e55baba9e8703a8846cce66f1f32feb43928459b278` |
| `docs/specs/07-verificacion.md` | `50f007056a481014ab0cc9d3bdbeb7be09bbca80a71ddbb9acfa1fa8d8a1ff70` |

### Resultado del cotejo

- **XS-01 resuelto:** S04 ahora define confirmar variedad, crear/consultar Voice Design y previews, reproducir media temporal, elegir y guardar por separado, y preparar/probar/escuchar/aceptar un binding. P21 enumera las mismas rutas live. Se corrigió S05 §9: guardar la voz no la enlaza; la voz existente o guardada pasa por un borrador y una prueba escuchada/aceptada antes de habilitar el slot.
- **XS-02 resuelto:** S04 usa `VoiceConfig` y las uniones normativas de S06 en una lectura versionada; su escritura reemplaza `audioMode`, slots de hablantes, narrador y efectos. La variedad se propone o confirma mediante operaciones separadas y `RunLimits` no contiene `audioEnabled`.
- **XS-03 resuelto:** S04 especifica `ProposalPrivateView` con texto/hash exactos, revisiones, códigos, completitud y feedback filtrado. La consulta exige Inspector opt-in y es de lectura; SSE, transcript, replay público, tools y actores quedan excluidos. S05 conserva la misma frontera: la escena pública sólo expone estado técnico/ID hasta que se confirma la publicación.
- **XS-05 resuelto:** S07 ya no describe S04 como futuro; registra que S04/S05/S06 están presentes y que G0 sigue pendiente de revisión documental/técnica. **XS-04 queda retirado por la errata R1:** `/api/v1` es el prefijo común y las rutas tabuladas son relativas.

No hallé un bloqueo adicional de producto en S05 ni contradicciones nuevas entre sus flujos de interfaz y S04/S06/S07 para los recorridos revisados. El pase de producto de esta revisión no afirma que la GUI, OAuth, ElevenLabs o los ensayos estén implementados o ejecutados. El delta técnico de presupuesto/stream wrapper en S03 sigue pendiente de la revisión técnica en curso; esta ronda no lo resuelve ni constituye cierre global de G0.

La comprobación documental incluyó una búsqueda de las referencias obsoletas de Voice Design/S04 en S05 y una revisión de espacios finales en ambos archivos; no se ejecutaron pruebas funcionales.
