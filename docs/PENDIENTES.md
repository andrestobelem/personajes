# Qué falta para terminar el producto

Estado al 14 de octubre de 2026. Lista de entregas integrales pendientes, ordenada para llegar a una obra observable e interactiva. Las partes existentes no se cuentan como inexistentes: biblioteca, preparación guardada, validación, preflight, dominio del Escenario, memorias y cadena actoral tienen implementación y pruebas parciales. PRD y specs tienen cierre documental. La aceptación de los 77 requisitos todavía no está cerrada.

## Implementación y verificación pendientes

1. **Límites operativos de llamadas al modelo — parcial.** El ledger registra llamadas y tiempo de transporte medido/reservado, con timeout y concurrencia; Actores y Continuista comparten sus reservas. Al agotarse el límite, ante una llamada incierta o un historial cuya duración se desconoce, bloquea nuevas inferencias conservadoramente. El preflight lee el ledger y existe `GET /runs/{id}/budget`. La preparación Ready lo inspecciona, aunque todavía no ofrece un tablero continuo durante la representación. Esto no mide tokens ni costo monetario; tampoco incluye aún Director, Narrador, Voice Design, TTS o efectos de sonido, que requieren cuotas y mediciones diferenciadas. Falta conectarlo a la vista activa y demostrar la operación integral. Requisitos: TIM-04, ACT-11, NFR-06.

2. **Inicio y controles de representación.** Parcial: el journal v24 conserva una época durable por pulso/job actoral; v25 añade fecha real de creación sin inventarla para corridas históricas. Las escrituras nuevas de Actor y Continuista comprueban la época; pausar invalida los claims activos y reintentar crea una generación nueva. Jobs antiguos cuya época no se puede demostrar quedan bloqueados para retry explícito. El runtime aborta y espera una corrida sin cerrar las demás. `RunView`, su ETag, el lector host-owned, los handlers HTTP, el gate fresco de preflight y el CAS durable están compuestos; la configuración pública se proyecta sin fences internos. El runtime se agenda o cancela después de cada transición, y una negativa de agenda provoca una pausa compensatoria. Falta implementar el pulso único durable y añadir la barra de control en la GUI; también alinear la ruta dedicada `/start` de la spec con el handler local actual `/controls`. Requisitos: ESC-01, TIM-02, UI-07, UI-09, P03, P16, P17.

3. **Preparación completa desde la interfaz.** Terminar y probar el recorrido de continuidad, curación actoral, reparto, Escenario e identidad humana hasta iniciar una puesta coherente. Completar importaciones de memoria, adaptaciones y secciones aún sin editor. Existen editores y guardado/reapertura; falta aceptación del recorrido integral. Requisitos: CAT-05, CAT-06, CAT-07, ESC-01, UI-09.

4. **Actuación real y roles administrativos.** Completar Director, Regidor y Configurador según sus responsabilidades; conectar decisiones a circunstancias, evolución y progresión autorizadas. Actores, Continuista y coordinador tienen una cadena probada con transportes controlados; falta verificar su actuación real, iniciativa, silencio, reformulación, fidelidad situada y resistencia a inyecciones. Requisitos: ACT-01, ACT-04, ACT-05, ACT-06, ACT-07, ACT-08, ACT-09, ACT-10, ACT-11, ACT-12, CAT-08, MEM-01, MEM-10, NFR-04.

5. **Escenario gráfico durante la obra.** Mostrar lugares, personajes, objetos, puertas, inventario y movimientos confirmados; navegar entre espacios y escenas de uno o varios participantes. Hay reglas operativas y planos de preparación; falta la representación visual en ejecución. Requisitos: ESC-02, ESC-03, ESC-04, ESC-05, ESC-06, ESC-07, ESC-08, UI-02.

6. **Conversaciones e intervención humana visibles.** Publicar conversaciones en vivo, consultar filtros y estados, elegir tu presencia/canal e intervenir desde la interfaz. Verificar que sólo oye quien corresponde y que emisión, recepción y creencia se distinguen. La API de intervención y entrega existe; falta el recorrido conversacional completo en GUI. Requisitos: UI-03, UI-04, UI-06, ESC-05, MEM-02, MEM-03.

7. **Ficha, memoria y evolución consultables.** Inspeccionar lo que un personaje sabe, cree y recuerda, su procedencia y cambios; completar selección, resumen y olvido activo sin borrar la historia. Observar evolución de identidad, vínculos y objetivos con evidencia. Hay expedientes y memoria privada; falta el inspector de representación completo. Requisitos: UI-05, CAT-02, CAT-08, MEM-02, MEM-03, MEM-04, ESC-09.

8. **Dirección y dramaturgia.** Registrar etapas y sus evidencias, rectificaciones, asuntos abiertos, actos y escenas; permitir metaindicaciones y cambios de circunstancia autorizados. Completar cierre de escena/episodio y consecuencias persistentes. Requisitos: DIR-01, DIR-02, DIR-04, UI-11, ESC-09, ESC-10.

9. **Reloj, rutinas y ritmo.** Integrar día/noche, disponibilidad y convocatoria por rutinas; definir operación del avance temporal y comportamiento fuera de línea. Medir el corpus audiovisual de Get Smart mediante escucha/anotación y aplicar ritmo sin imponer una longitud universal de respuesta. Existen reglas y duraciones de acciones; falta el recorrido temporal completo y la calibración audiovisual. Requisitos: TIM-01, TIM-03, ACT-06, VOZ-02, VOZ-06.

10. **Narrador y voces.** Implementar narrador opcional, voz en español diferenciada, Voice Design, escucha/selección/guardado, binding validado, síntesis, reproducción y subtítulos. Conservar texto cuando el audio está apagado o falla; tratar Fang y sonidos no verbales según su naturaleza. Las recetas están documentadas; no hay síntesis real acreditada. Requisitos: DIR-03, VOZ-01, VOZ-02, VOZ-03, VOZ-04, VOZ-05, VOZ-06, VOZ-07, UI-03.

11. **Historia, replay, exportación y recuperación completa.** Consultar cortes históricos, reproducir sólo artefactos guardados y probar backup/restauración coherentes de journal, memorias, sesiones y medios. Completar importación/exportación desde GUI y operaciones de recuperación sin repetir actuación. Hay persistencia y recuperación de componentes; falta el recorrido integral. Requisitos: MEM-05, MEM-06, MEM-07, MEM-08, MEM-09, UI-10, ESC-10, NFR-03.

12. **Catálogo y versiones con aceptación visual completa.** Verificar todos los expedientes, avatares, fuentes y referencias; completar adaptación/importación/exportación con historial y conservación del original. La biblioteca ya funciona; faltan recorridos de aceptación y edición completos. Requisitos: CAT-01, CAT-02, CAT-03, CAT-04, CAT-06, CAT-09, UI-10, NFR-08.

13. **Acceso real a servicios.** Probar login/acceso y sesiones independientes con el perfil elegido; completar configuración de acceso Anthropic desde GUI y verificar el flujo ElevenLabs. Sol 6.1 low y Opus 5.5 medium ya se seleccionan y validan en el SDK con transporte controlado. Eso no acredita acceso real de una cuenta. Requisitos: ACT-02, ACT-03, ACT-12, UI-06, UI-09, NFR-09.

14. **Operación, accesibilidad y aceptación final.** Completar actualizaciones en vivo, interfaz usable por teclado, estados/fallos legibles, aislamiento y ejecución reproducible; probar que la UI sigue operable durante inferencias. Ejecutar los 25 escenarios y revisar uno por uno los 77 criterios con evidencia del nivel correspondiente. Requisitos: UI-01, UI-08, NFR-01, NFR-02, NFR-04, NFR-05, NFR-07, NFR-09, NFR-10.

## Datos para la primera obra

La primera representación del usuario aún necesita circunstancias concretas: fecha/hora y lugar ficticios, continuidad, reparto y conflicto/propósito, además del nombre e historia de su identidad ficticia propia. Esto se configura en el producto; no impide seguir implementándolo. Las escenas sintéticas de prueba no sustituyen esa elección.

## Evidencia y seguimiento

- [PRD](PRD.md), [specs](specs/README.md) y [matriz individual](auditoria/trazabilidad-prd.md) conservan los criterios completos.
- [Progreso de implementación](auditoria/implementacion-progreso.md) registra los cortes ya verificados. El corte v21 pasó 364 pruebas con ICM real, sin fallos ni omisiones, y se operó en navegador.
- [Preflight durable](auditoria/preflight-durable.md) distingue preparación válida de ejecución disponible.
- [Tiempo acumulado de inferencia](adr/0004-tiempo-acumulado-de-inferencia.md) documenta el ledger v22 y sus límites.

La lista cubre los 77 IDs del PRD; un ID puede intervenir en más de una entrega. No es un porcentaje de avance ni una estimación de horas.
