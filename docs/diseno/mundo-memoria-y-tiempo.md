# Escenario, conocimiento, memoria y tiempo

## El Escenario compartido

El usuario eligió **Escenario** para nombrar el mundo operativo. **Escenografía** designa su representación visual y material; **escena** es una unidad de acción con uno o más personajes. El nombre histórico de este archivo se conserva para mantener sus enlaces. La ruta operativa actual es [obra/escenario](../../obra/escenario/CONTEXT.md).

El mundo contiene lugares, recorridos, objetos, instituciones, recursos, personas y acontecimientos. Un objeto tiene ubicación, poseedor, estado y posibilidades de uso. Esas condiciones importan: un teléfono fuera de alcance no se usa como si estuviera en el bolsillo; una puerta cerrada puede ocultar una conversación; la oficina de CONTROL tiene horarios, accesos y reglas propias.

La investigación sobre [Balzac](../investigaciones/balzac-diseno-de-mundos.md) informa esta dimensión material y social. El mundo no es sólo un decorado para parlamentos: trabajo, dinero, jerarquías, reputación, tecnología y circulación de noticias crean resistencias y oportunidades. Cada implementación concreta debe declarar cuáles de esos sistemas modela realmente.

## Cuatro perspectivas que no se fusionan

| Perspectiva | Contenido |
|---|---|
| Estado del mundo | Lo que efectivamente ocurrió o existe dentro de la representación |
| Contexto del director | Línea dramática, posibilidades de puesta, secretos y objetivos de dirección |
| Experiencia del personaje | Percepciones, testimonios recibidos, recuerdos, inferencias y creencias |
| Vista del observador | Información elegida para seguir la obra, potencialmente más amplia que la de cualquiera de sus personajes |

El espectador puede ver que Siegfried oculta una llave. Max no lo sabe sólo porque ambos estén en la misma aplicación. Si alguien se lo cuenta, Max recibe un testimonio: puede confiar, desconfiar, investigar o ignorarlo. El mismo principio se aplica al usuario que entra a conversar y transmite información conocida desde su vista de observador.

La comunicación necesita emisor, destinatarios, lugar o canal, momento y condiciones de recepción. Hablar al público, susurrar a 99 y transmitir por radio a CONTROL son situaciones distintas. Un receptor mencionado en un mensaje no implica que haya podido escucharlo.

## Identidad, historia y memoria

La historia registra acontecimientos biográficos; la memoria registra cómo los conserva el personaje. La identidad da continuidad a valores, vínculos, modos de interpretar y contradicciones. Una revelación puede cambiar la interpretación de un recuerdo sin cambiar lo ocurrido. Un relato falso puede convertirse en creencia, pero su falsedad no debe desaparecer del registro del mundo.

La ficha amplia se desarrolla en [Actores, personajes y fichas](actores-personajes-y-fichas.md). Para recordar una experiencia interesa conservar el acontecimiento de referencia, cómo se recibió, qué interpretación tuvo, qué vínculo afectó, con qué confianza se sostiene y si fue revisada. Esto es una propuesta computacional y narrativa; no implica memoria sentida ni conciencia del sistema.

La biografía exhaustiva permanece disponible por capas. El actor carga lo pertinente a la escena: recuerdos vinculados al interlocutor, promesas pendientes, experiencias relacionadas y condiciones actuales. Introducir toda la investigación del reparto en cada turno destruiría el conocimiento situado y haría difícil distinguir una experiencia del personaje de una nota del investigador.

## Preparar una continuidad

Antes de representar una historia de Get Smart se selecciona una fecha o punto de continuidad. Un expediente que estudia cinco temporadas puede incluir matrimonio e hijos; un Max situado al principio de la primera temporada no puede recordarlos como experiencias previas.

La configuración transforma el dossier completo en identidad y antecedentes aplicables a ese momento. Los vacíos canónicos pueden permanecer desconocidos o recibir una invención de adaptación explícita. Las versiones originales se conservan para que una decisión creativa no pase a figurar como hecho encontrado.

## Ciclo circadiano

Requisito del usuario: el mundo tiene un ritmo circadiano. La primera definición funcional incluye día y noche, rutinas de trabajo, descanso, encuentros habituales y variaciones de disponibilidad. La simulación de necesidades fisiológicas detalladas es una posibilidad posterior, no una capacidad ya implementada.

Hay que distinguir tiempo real, reloj del mundo y tiempo dramático. El primero mide la ejecución; el segundo fecha acontecimientos; el tercero organiza atención y tensión. No están obligados a avanzar a la misma velocidad.

Una pausa de observación debe tener un significado explícito. Pausar una repetición visual no implica pausar el mundo. Cuando se incorpore un runtime se decidirá qué botón detiene la simulación, qué estado conserva y cómo se resuelven acciones en curso. La investigación de plataformas señala diferencias reales entre esas funciones.

Ejemplo de efecto causal: un encuentro ocurre de noche porque uno de los personajes cambia su rutina; el otro detecta la excepción y pregunta. El reloj afecta quién puede encontrar a quién, cuánto puede esperar y cuándo vence una promesa. No se exige que todos duerman a la vez ni que cada día cierre una trama.

## Observar y conversar

La interfaz requerida es completa y principalmente funcional y visual: permite comprender el Escenario y operar la obra con controles claros. Combina representación de lugares y personajes, conversaciones, ficha consultable y evolución temporal. El [diseño de interfaz](interfaz-funcional-y-visual.md) fija funciones y criterios; no elige todavía biblioteca, estilo o disposición definitiva. Al seleccionar un personaje se debería poder distinguir lo que sabe, lo que cree y el historial de cambios, según el modo de observación elegido. Las fuentes y eventos relacionados permiten entender por qué cambió una relación o un objetivo.

El usuario puede intervenir como interlocutor humano. Los demás personajes podrán escuchar o no según la escena; contestar, resistir o aceptar; y recordar la interacción. Negociar un acuerdo no equivale a ejecutarlo: promesa, aceptación y cumplimiento son acontecimientos diferentes.

El rol de director se presenta por otro canal. Esa separación debe resultar comprensible al usuario: «hablar en la escena» e «indicar una condición de la representación» producen efectos distintos. La interfaz gráfica aún no existe; la carpeta obra deja preparados sus contratos en Markdown.

## Condiciones de aceptación de una implementación futura

- Una conversación detrás de una pared no se convierte automáticamente en conocimiento de quien está fuera.
- Un mensaje recibido de otro personaje conserva su procedencia aunque se recuerde durante varios días.
- Cambiar la interpretación de un recuerdo mantiene el enlace al acontecimiento original.
- Una promesa incumplida puede afectar una respuesta posterior, con razones comprensibles.
- Dormir, trabajar o desplazarse modifica disponibilidad; pasar de etapa dramática no cambia por sí solo la hora.
- El historial mostrado en una repetición corresponde al momento seleccionado, sin filtrar memorias futuras.
- La participación humana tiene consecuencias posibles, sin garantizar obediencia ni conceder permisos administrativos.
