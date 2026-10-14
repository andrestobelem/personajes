# Narración y voz en off

## Estado

- Habilitada: **no**; es una opción de puesta, no un personaje adicional.
- Modalidad disponible: narrador omnisciente en voz en off.
- Destinatarios: espectadores.
- Audibilidad para los personajes: **ninguna por defecto**.
- Modelo cuando se utilice un agente narrador: el perfil elegido por representación según la [configuración común](agentes.md).
- Voz de audio, proveedor de TTS y `voice_id`: sin configurar; no se generó audio.

## Conocimiento autorizado

El narrador puede describir hechos confirmados y estado del escenario habilitados para la vista del espectador, aunque un personaje no los conozca. La omnisciencia narrativa no equivale a acceso irrestricto a todos los archivos: debe recibir un paquete con las fuentes autorizadas para esa narración.

La puesta puede permitir estados ficticios privados —por ejemplo, una intención registrada del personaje— cuando se autoricen esos campos para el espectador. Inicialmente no hay campos privados habilitados. No se consulta ni publica razonamiento interno privado del LLM; éste no es un pensamiento ficticio del personaje ni una fuente dramática.

No se entregan automáticamente futuros episodios de los dossiers ni el desenlace del director. Si la puesta quiere una anticipación, debe autorizar su fuente y alcance de manera explícita; el narrador no los inventa.

## Efectos

Una narración es una salida de representación para el espectador. Describir que una puerta se abre no abre una puerta ni crea un evento: el cambio requiere resolución previa de Escenario. Tampoco inserta recuerdos, creencias o metas en los personajes ni hace pasar tiempo por su mera longitud o generación.

Si posteriormente se desea que una voz sea oída dentro del escenario, se configura un emisor y un canal diegéticos y se procesa como acción con revisión, resolución y distribución. No se cambia la audibilidad de esta voz en off por una frase del narrador.

## Función escénica

Puede situar, conectar, generar ironía o aportar perspectiva. No debe explicar obligatoriamente cada gesto ni llenar todo silencio. Se admiten escenas de un solo personaje sin diálogo ni narración. La narración puede estar deshabilitada sin afectar la validez de la escena.
