# Preparación de una puesta

## Inputs

| Archivo | Sección | Propósito |
|---|---|---|
| [Instancias Pi](../_config/instancias-pi.md) | Separación por personaje y coordinación del pulso | Preparar asociación individual sin iniciar sesiones |
| [Agentes](../_config/agentes.md) | Proveedor, modelo, razonamiento y estado de autenticación | Respetar `openai-codex` por login, sin fallback silencioso |
| [Continuidad](../_config/continuidad.md) | Estado y condiciones | Resolver lo que falta para empezar |
| [Escenas](../references/escenas.md) | Personajes y formas de acción | Admitir acción solitaria y silencio |
| [Narración](../_config/narracion.md) | Habilitación y audiencia | Decidir si la puesta incluye voz en off |
| [Reparto](../personajes/README.md) | Personajes seleccionados | Ubicar fichas de configuración |
| Dossier de cada seleccionado en `docs/personajes/get-smart/` | Hechos previos al corte y límites | Preparar identidad sin inventar canon |
| [Escenario](../escenario/references/reglas.md) | Espacio y reloj | Fijar circunstancias y causalidad |
| [Voz y ritmo](../_config/voz-y-ritmo.md) | Español de doblaje, registros y tiempos | Configurar actuación sin métricas inventadas |
| [Línea dramática](../direccion/references/linea-dramatica.md) | Marco actual | Elegir una orientación de puesta |

## Process

1. Fijar corte temporal, fecha diegética inicial, lugar y marco histórico-geográfico, elenco activo de uno o más personajes, situación de partida y objetivo general de la puesta. Distinguirlo de metas individuales y de un posible objetivo compartido dentro de la ficción.
2. Seleccionar hechos de los dossiers anteriores al corte. Para cada actor, distinguir experiencia propia, información recibida y hechos que desconoce. Marcar elaboraciones nuevas y vacíos sin convertirlos en pasado canónico.
3. Preparar identidad operativa, modo de hablar en español de doblaje de acuerdo con época y lugar, recuerdos iniciales, metas, vínculos vigentes y capacidades. No cargar toda la investigación en el contexto de actuación.
Una escena con un solo personaje puede avanzar mediante acción, espera o silencio; no agregar un segundo personaje ni un diálogo para habilitarla. La voz en off es opcional y se configura aparte.
4. Instanciar lugares, posiciones, inventarios, hora, rutinas y reglas de duración. Configurar orden de resolución del elenco activo y asociación prevista de cada personaje con su instancia Pi propia. No reutilizar una sesión para varios personajes.
5. Verificar consistencia cruzada. Marcar preparada cuando estén satisfechas las condiciones de continuidad y entregar la preparación al Coordinador. Sólo el Coordinador verifica ese cierre y actualiza el cursor a etapa 01.

## Outputs

Configuración completa y estados iniciales explícitos entregados al Coordinador; el Configurador no escribe el cursor. Preparar no significa que haya ocurrido un evento: los registros de representación permanecen vacíos hasta ejecutar el primer turno.

La preparación documental no ejecuta el login ni prueba una cuenta. El proveedor ya está elegido; no se vuelve a presentar la elección entre API key y Codex como abierta. Antes de una futura ejecución real, el runtime debe autenticar y comprobar modelo/razonamiento efectivos según su contrato.

## Cierre

Todos los activos tienen contexto suficiente y acotado; nadie conoce el futuro del corpus ni instrucciones del director como hechos propios. Si una decisión creativa queda abierta, se registra una propuesta identificada como propuesta y no se simula su aprobación o su ejecución.
