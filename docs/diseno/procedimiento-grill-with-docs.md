# Procedimiento de grill-with-docs para este proyecto

El usuario pidió que un agente escribiera la constitución y aplicara domain-modeling y grill-with-docs mientras otro agente, custodio del concepto, respondiera las preguntas. Luego indicó reutilizar ese procedimiento cuando hiciera falta. Este documento conserva esa instrucción para futuras sesiones; no inicia una entrevista adicional.

## Cuándo hace falta

Se usa para decisiones de diseño con tensiones o consecuencias que conviene poner a prueba. Una aclaración explícita del usuario se incorpora directamente; no se la somete de nuevo a una entrevista ficticia. Guardar investigaciones o corregir un enlace tampoco requiere una ronda de preguntas.

Leer las skills locales [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md), [grilling](../../.agents/skills/grilling/SKILL.md) y [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md). La instalación y adaptación están en [skills instaladas](../auditoria/skills-instaladas.md).

## Dos agentes, responsabilidades distintas

| Participante | Responsabilidad |
|---|---|
| Entrevistador | Examinar el diseño, plantear preguntas concretas, recorrer consecuencias y escenarios, registrar términos y decisiones. |
| Custodio del concepto | Responder desde los pedidos y documentos disponibles; señalar evidencia, inferencias y vacíos; preservar la intención y detectar contradicciones. |
| Agente integrador | Cotejar respuestas con requisitos, actualizar los documentos afectados y coordinar revisión. Puede ser la raíz que organizó la entrevista. |

El custodio debe tener acceso al concepto consolidado, constitución, glosario, matriz de decisiones, conversación disponible y documentos pertinentes. Ese acceso amplio es propio del trabajo de diseño; no se entrega a un actor de la obra como memoria de personaje.

## Desarrollo y registro

1. Delimitar el problema y leer lo ya decidido para no repetir preguntas contestadas.
2. El entrevistador formula una pregunta que permita examinar un límite real. Ejemplo: «Si el observador ve un secreto, ¿cuándo podría usarlo Max?». Las recomendaciones deben tener motivos y alternativas cuando corresponda.
3. El custodio responde y clasifica: **requisito expreso**, **regla derivada**, **propuesta** o **falta información**. Incluye el documento o pedido del que parte.
4. Poner a prueba la respuesta con un caso concreto y comprobar sus efectos sobre los demás contratos.
5. Conservar preguntas y respuestas efectivamente intercambiadas, resultado, discrepancias y pendientes. No reconstruir una ronda que nunca ocurrió.
6. Registrar términos resueltos en el glosario; reglas de la obra en la constitución o diseño; decisiones abiertas en la matriz. Un ADR sólo corresponde si cumple los criterios de la skill: reversión costosa, contexto necesario y alternativas reales consideradas.
7. Solicitar al usuario únicamente una preferencia necesaria que no pueda inferirse ni investigarse. No atribuirle decisiones tomadas por agentes ni detener trabajo independiente.
8. Revisar consistencia y enlaces después de integrar. Si se descubre un error del revisor, corregirlo y conservar la rectificación.

La entrevista no cambia por sí sola permisos técnicos, autoridad de personajes o instrucciones del sistema. Su producto es una decisión documentada dentro del encargo recibido.

## Primera aplicación conservada

El [diálogo constitucional](../auditoria/dialogo-constitucional.md) registra cinco rondas reales y quince preguntas, con las [respuestas del custodio](../auditoria/respuestas-del-concepto.md). Las aclaraciones posteriores del usuario figuran como adendas, no como nuevas rondas. El resultado está en la [constitución](../constitucion.md), el [glosario](../../GLOSSARY.md) y la [matriz de decisiones](decisiones-abiertas.md).
