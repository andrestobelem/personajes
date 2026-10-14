# Diseño de voces originales con ElevenLabs

**Estado al 14 de octubre de 2026:** se documentó el flujo y se redactaron prompts y líneas de prueba para revisión. No se generaron previsualizaciones, archivos de audio ni voces; no existe ningún ID de voz creado para este proyecto.

Esta guía traduce propuestas de interpretación para la serie original *Get Smart* (1965–1970) a descripciones que se podrían probar con Voice Design. Son voces nuevas de doblaje latinoamericano sugerido, no reconstrucciones acústicas ni imitaciones de Don Adams, Barbara Feldon, otros intérpretes o doblajes históricos. Las edades y timbres indicados en las fichas describen una voz percibida para la puesta; no agregan datos biográficos al canon. La variedad regional debe elegirse y confirmarse antes de generar audio.

## Qué hace cada modelo

Voice Design propone una identidad vocal a partir de texto y permite escuchar opciones. El modelo que crea esa previsualización pertenece al flujo Text to Voice; la API consultada admite `eleven_multilingual_ttv_v2` y `eleven_ttv_v3`, y declara `eleven_multilingual_ttv_v2` como valor predeterminado. La disponibilidad y los valores predeterminados de una integración pueden diferir del endpoint y cambiar con el tiempo; confirmar la selección efectiva en la interfaz y la documentación oficial antes de generar. [Referencia del endpoint de diseño](https://elevenlabs.io/docs/api-reference/text-to-voice/design), [modelos de ElevenLabs](https://elevenlabs.io/docs/overview/models).

La voz elegida se usa luego con un modelo de síntesis de voz (Text to Speech, TTS), que convierte el diálogo de cada turno en audio. Eleven v4, Eleven v3 y Eleven Multilingual v2 son ejemplos de modelos de síntesis; no son el mismo concepto que Voice Design ni deciden qué sabe o dice un personaje. El catálogo oficial consultado describe actualmente esos modelos y sus capacidades, pero no basta para establecer una recomendación universal de TTS para toda voz creada con Voice Design. Debe comprobarse el español y la variedad regional con la voz y el modelo realmente elegidos. [Tipos de voz y compatibilidad](https://elevenlabs.io/docs/overview/capabilities/voices), [modelos de síntesis](https://elevenlabs.io/docs/overview/models).

En esta obra, **la instancia Pi del personaje, con el perfil de inferencia elegido para la representación**, propone el parlamento. El anfitrión aplica las reglas del mundo y confirma qué mensaje se entrega; **ElevenLabs** da forma sonora al texto confirmado con la voz guardada y el modelo TTS configurados. Un `voice_id` identifica una voz de la biblioteca de ElevenLabs; no contiene memoria, personalidad, objetivos ni conocimiento del mundo.

## Flujo para crear y probar una voz

1. Elegir una ficha y revisar su propuesta de doblaje. Confirmar que el perfil sea una interpretación nueva, que el idioma y la variedad regional estén decididos, y que no use samples de un actor ni una voz existente como objetivo de imitación.
2. Preparar una descripción concreta y una línea original de previsualización. La guía oficial recomienda declarar idioma y variedad al principio, y combinar persona, emoción, timbre, ritmo y forma de entrega. El endpoint documenta descripciones de 20–1000 caracteres y texto de preview de 100–1000; las muestras de estas fichas están dentro de ese intervalo, aunque pueden alargarse para representar mejor la entrega. Siguen siendo borradores y no fueron aportadas por la persona usuaria. El conector ElevenLabs disponible en esta sesión exige una línea real y su idioma aportados por la persona usuaria; por eso esos borradores no se envían al conector. [Guía de Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design), [parámetros del endpoint](https://elevenlabs.io/docs/api-reference/text-to-voice/design).
3. En la aplicación, abrir **Voices → My Voices → Add a new voice → Voice Design**, o usar el endpoint de diseño correspondiente. Revisar los controles y costos mostrados antes de generar. La plataforma produce tres opciones de preview; la guía advierte que la calidad puede variar y que se cobra según el texto de previsualización. [Guía de Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design).
4. Escuchar las opciones con la misma línea y compararlas por inteligibilidad, naturalidad del español, variedad regional buscada, diferenciación entre personajes, consistencia del timbre percibido, ritmo y compatibilidad emocional con la ficha. Las tres opciones corresponden al flujo de la guía de interfaz; el contrato de API devuelve una lista de previews y el cliente no debe exigir una cantidad fija. La pronunciación y el acento deben verificarse en audio: el prompt es una hipótesis de diseño, no evidencia de resultado. [Contrato de diseño por API](https://elevenlabs.io/docs/api-reference/text-to-voice/design).
5. Si ninguna funciona, cambiar una dimensión por vuelta (por ejemplo, ritmo o resonancia), conservar la misma línea para comparar y luego probar otra línea original que cubra un contexto distinto. Las nuevas generaciones consumen créditos; no repetir hasta decidir qué problema se quiere corregir.
6. Solo después de que la persona usuaria elija una preview, guardar esa opción en la biblioteca. La API usa el `generated_voice_id` de la preview elegida para crear una voz y devuelve un `voice_id` permanente de biblioteca: son identificadores distintos. Registrar el `voice_id` guardado y el modelo TTS elegido en la configuración del proyecto únicamente después de esa decisión. [Quickstart oficial](https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/voice-design/), [endpoint para guardar una voz](https://elevenlabs.io/docs/api-reference/text-to-voice/create).
7. Probar la voz guardada con réplicas breves originales de distintas intenciones —informar, corregir, dudar, tranquilizar— y revisar el audio final. El texto propuesto por Pi, la validación y entrega del anfitrión, los controles de síntesis y la voz TTS son capas distintas; corregir la línea si el personaje dice algo indebido y ajustar la voz solo si el problema es sonoro.

La guía de fichas propone criterios y una vuelta de evaluación, no autoriza una generación. No se pasó ningún prompt ni muestra de este repositorio al conector ElevenLabs. Para Voice Design, la integración requiere que la persona usuaria proporcione efectivamente el idioma y el texto que se oirá; no se deben inferir ni inventar esos datos para ejecutar la herramienta.

## Criterios de evaluación comunes

- La voz se entiende en español y mantiene una variedad regional deliberada, sin derivar hacia un acento no solicitado.
- Timbre y ritmo distinguen al personaje sin convertir una característica de situación en una muletilla permanente.
- La muestra sostiene la conducta descrita en la ficha, no celebra el chiste ni anticipa resultados.
- La voz admite más de una intención emocional sin perder identidad, y las diferencias entre personajes no dependen de caricaturas étnicas, diagnósticos o referencias a intérpretes.
- La muestra es original y pertinente al personaje. No se toma una línea de episodio, película, doblaje ni archivo de audio.

## Excepciones no verbales

Fang requiere diseño de efectos animales, no Voice Design ni TTS humano. La API de Sound Effects genera audio desde una descripción de sonido; una propuesta puede pedir ladridos breves, un gemido o respiración canina, dejando el resultado sujeto a escucha y edición. No debe traducirse el ladrido a palabras. [Descripción general de Sound Effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects), [endpoint de generación de efectos](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

La URL anterior es la página de documentación; el endpoint HTTP que documenta al 14 de octubre de 2026 es `POST /v1/sound-generation`. No construir una ruta API a partir del slug de la documentación.

Los mellizos de la familia Smart se documentan en conjunto y no se convierten en agentes individuales. Si una escena necesita sonido infantil, puede evaluarse respiración, balbuceo o arrullo no léxico como efecto; no se asigna una voz adulta de películas posteriores ni se inventan palabras.

La receta opcional de narración externa está en [Narrador y voz en off](../diseno/narrador-y-voz-en-off.md). Las reglas de actuación y el estado de audio de la obra se mantienen en los documentos de diseño y configuración correspondientes.

## Fuentes oficiales consultadas

- [Voice Design: guía de prompts, previews y selección](https://elevenlabs.io/docs/eleven-creative/voices/voice-design).
- [API: diseñar una voz](https://elevenlabs.io/docs/api-reference/text-to-voice/design).
- [API: guardar una preview como voz de biblioteca](https://elevenlabs.io/docs/api-reference/text-to-voice/create).
- [Quickstart: flujo de dos pasos de Voice Design](https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/voice-design/).
- [Tipos de voz, idiomas y compatibilidad de síntesis](https://elevenlabs.io/docs/overview/capabilities/voices).
- [Catálogo vigente de modelos](https://elevenlabs.io/docs/overview/models).
- [Descripción general y endpoint de Sound Effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects), [API de generación](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

