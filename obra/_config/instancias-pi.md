# Una instancia Pi independiente por personaje

## Decisión de arquitectura

Cada personaje del reparto tiene una **instancia Pi distinta**. Los 27 contextos documentales corresponden a 27 identidades de instancia previstas; todavía no se creó ni inició ninguna. El Coordinador invoca las instancias pertinentes a la escena y al pulso, no interpreta sucesivamente a todos los personajes cambiando el prompt de una sola sesión.

## Separación requerida

Cada instancia de personaje conserva de forma independiente:

- Contexto y system prompt del personaje, con sus fuentes permitidas.
- Sesión e historial de conversación de Pi, sin reutilizar el historial de otro actor.
- Recursos de carga de contexto y gestor de sesión propios.
- Memoria subjetiva y alcance de almacenamiento propios, aunque compartan una implementación técnica.
- Herramientas habilitadas y permisos de acceso acotados al rol y al personaje.

Compartir el perfil elegido, código de herramientas o la autenticación del proveedor en el host no mezcla historiales, memorias ni permisos. La autenticación puede gestionarse fuera de los contextos de ficción; no se pasan tokens o credenciales a los personajes.

La separación entre **instancias SDK** y **procesos del sistema operativo** es una decisión de despliegue todavía abierta. No se prescribe un proceso, contenedor o máquina por personaje. Compartir proceso no autoriza compartir objetos mutables de sesión o memoria entre identidades.

## Asignación y activación

El identificador de personaje es su slug en el reparto y su contexto está en `personajes/<slug>/CONTEXT.md`. La futura integración mantendrá una asociación inequívoca entre ese slug y su instancia/sesión Pi. No se inventan aquí IDs reales de sesiones.

Preparar el reparto no exige ejecutar a los 27 en cada pulso. Se activan los personajes de la escena cuya percepción, mensaje, rutina o iniciativa requiera un turno. Una escena puede tener un solo personaje y su instancia sigue siendo independiente.

El Coordinador puede mantener un registro de estados de trabajo —pendiente, en curso, propuesta entregada— sin apropiarse de decisiones privadas. No agrega recuerdos, no decide una respuesta del actor y no reutiliza la sesión de un personaje ausente para interpretar otro.

## Otros roles

El Coordinador se mantiene separado de las instancias de los personajes. Director, Continuista y Regidor son responsabilidades de control que pueden combinarse entre sí según la integración, pero no se ejecutan cambiando el rol dentro del historial de un personaje. Narración y observación tampoco se inyectan en su contexto privado.

La [investigación de Pi](../../docs/investigaciones/pi-coding-agent-runtime.md) documenta las APIs y el login. Esto es un contrato de arquitectura en Markdown, no una factory implementada ni una prueba de aislamiento o autenticación real.
