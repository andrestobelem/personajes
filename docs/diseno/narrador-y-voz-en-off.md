# Narrador y voz en off opcional

El narrador es una voz externa a la escena, disponible solo si la obra necesita contexto para quien la escucha. Los personajes no oyen esa voz, no pueden responderle y no la recuerdan. La narración no es una intervención dentro del mundo ni modifica lo que sucede.

## Alcance de conocimiento

La voz puede resumir hechos, estados y acciones que la obra haya establecido y que el narrador esté autorizado a conocer. No convierte razonamientos privados del LLM, cadenas de pensamiento, datos ocultos de implementación ni información todavía desconocida por el mundo en conocimiento narrable. Si un dato no está confirmado, el narrador debe omitirlo o marcar su incertidumbre; no rellena huecos del canon.

La voz tampoco crea sucesos: no anuncia una llegada que no ocurrió, no declara resuelta una misión antes de que lo esté ni cambia el resultado por describirlo. Su texto acompaña el estado ya autorizado de la escena. Una inferencia debe formularse como inferencia y no como hecho.

## Receta de Voice Design

La siguiente descripción es una propuesta original para probar una voz nueva, sin imitar narradores existentes. La variedad se sugiere y debe confirmarse antes de generar:

> Español latinoamericano neutro, variedad sugerida por confirmar. Voz adulta percibida, timbre medio-grave cálido y claro. Narrador externo sereno y preciso; ritmo pausado, énfasis discreto y emoción contenida. No participa en la escena. Puede expresar estados ficticios autorizados, sin exponer razonamiento interno del modelo.

> Muestra original propuesta: “La sala quedó en silencio cuando terminó la explicación. Sobre la mesa seguía el informe, con los datos conocidos y una pregunta que todavía nadie podía responder.”

La muestra sirve para comparar dicción y ritmo, no aporta una escena ni un hecho de la serie. Usar el flujo de la [guía central de Voice Design](../investigaciones/elevenlabs-diseno-de-voces.md): escuchar las opciones, revisar inteligibilidad y naturalidad, elegir una y guardar su ID solo después de la selección de la persona usuaria. No se ha generado ni guardado audio para este narrador.

