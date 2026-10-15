# Selector de cortes documentales de continuidad

Implementación del 15 de octubre de 2026. «Nueva preparación» ofrece ahora las tres entradas previstas: blanco, ensayo sintético y continuidad documentada. La tercera permite elegir un corte y su revisión, revisar fuentes y límites y cargar una propuesta editorial de continuidad. No carga una representación guardada ni reconstruye un episodio de televisión.

## Fuentes y alcance de los dos cortes iniciales

| Corte | Evidencia consultada | Límite conservado |
|---|---|---|
| Preparativos de la boda de Max y 99, revisión 1 | [Apple TV, sinopsis española de *With Love and Twitches*](https://tv.apple.com/us/episode/with-love-and-twitches/umc.cmc.5yr8eis7zcn0gpo9z9hj1tblq?l=es&showId=umc.cmc.35nx4sbfbivaor70liush6pv4): boda prevista y dificultades para llegar al altar. | La ceremonia consumada permanece indeterminada en este corte. |
| Presentación de Hymie por KAOS, revisión 1 | [Apple TV, sinopsis de *Back to the Old Drawing Board*](https://tv.apple.com/us/episode/back-to-the-old-drawing-board/umc.cmc.49vtacltota1xby2kioyqv318?showId=umc.cmc.35nx4sbfbivaor70liush6pv4): creación del robot para secuestrar a un científico de CONTROL. | No establece el resultado del plan ni la posterior lealtad a CONTROL. |

Se verificaron las páginas del distribuidor; no se visionaron aquí los episodios ni se cotejaron guiones. Las fechas del catálogo no son fechas diegéticas. Estos cortes contienen únicamente la evidencia seleccionada para ellos; no sustituyen los expedientes ni afirman que el resto del corpus carezca de información adicional.

## Contrato implementado

`documented-continuity-cuts.ts` contiene un catálogo acotado con ID exacto, revisión, título, descripción, fuentes, alcance, incertidumbre e hitos. Los hechos respaldados tienen estado `reached`; los que la fuente seleccionada no establece conservan `undetermined`. La fábrica valida la selección y genera una continuidad con hash sobre sus campos, estados y referencias. Nombre y continuidad quedan `proposed/source: editorial`; las demás secciones conservan el borrador vacío y los defaults generales.

Los títulos, alcance e incertidumbre se conservan en la descripción de continuidad; las URLs HTTPS exactas en las referencias de cada hito. El hash incluye esos datos. No se añaden campos persistidos nuevos ni se reescriben configuraciones anteriores. Guardar y reabrir usa el contrato de borradores existente. Editar la continuidad usa el editor y su recálculo de hash, sin modificar el catálogo original.

El catálogo y sus fuentes, hitos y referencias se congelan profundamente al cargar el módulo. Los borradores creados son copias editables independientes. La revisión detectó que los títulos inicialmente sólo se mostraban en el selector: se corrigió para conservarlos también al guardar, junto con alcance e incertidumbre.

El selector muestra fuentes y límites antes de permitir cargar el corte. La operación sólo construye la edición local; no escribe, hace login, llama a Pi ni inicia una obra. Falta elegir momento, lugar, reparto y presencia humana y curar a cada actor. No hay contexto actoral ni experiencias creadas por la selección. El compilador privado toma los datos admitidos para cada actor y su vista situada; no serializa la continuidad global como conocimiento compartido.

## Verificación y límites de aceptación

Las pruebas cubren catálogo y referencias válidas, rechazo de URLs no HTTPS o fuentes ajenas, selección desconocida y UUIDs inválidos/repetidos, hash, independencia de borradores, vacío de fecha/mundo/reparto y persistencia de incertidumbres y fuentes tras reiniciar SQLite. Las propuestas y las secciones vacías bloquean Ready, sin crear un mundo operativo.

La prueba React montada recorre las tres entradas, revisa enlaces y límites, carga un corte y comprueba el payload de guardado y la ausencia de acceso a servicios. La revisión independiente comprobó el aislamiento del prompt actoral y las fronteras anteriores. La aceptación con cuenta real, inferencia y representación completa sigue pendiente.

En navegador, con build de producción y host privado de prueba, se verificaron elección del corte de Hymie, fuente enlazada, propuesta local, guardado en revisión 0, validación bloqueada y reapertura tras recargar. La continuidad conservó el título de Apple TV, alcance y límites; las referencias mantuvieron sus URLs y los hitos sus estados «Ya ocurrió» e «Indeterminado». Fecha, mundo y reparto siguieron pendientes. No se realizó login ni inferencia.

Verificación global con ICM 0.11.4 y `TMPDIR=/private/tmp`: **1.188 pruebas aprobadas, cero fallos y una omitida exclusiva de Linux** (1.189 totales). Después de reforzar conservación de títulos e inmutabilidad, aprobaron las 23 pruebas focales de cortes, GUI y preparación, TypeScript y build (476 módulos). El objetivo y la aceptación integral de los 77 criterios siguen abiertos.
