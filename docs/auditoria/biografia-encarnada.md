# Biografía dentro del personaje

Pedido reiterado el 16 de octubre de 2026: cada personaje debe contener identidad, historia de vida, memoria, deseos y goals. Antes de este cambio existían identidad curada, antecedentes, objetivos y memoria privada, pero faltaban una narrativa biográfica extensa y deseos explícitos dentro de la preparación efectiva del actor. Los expedientes de investigación no bastaban para cumplir ese pedido.

## Cambio implementado

La identidad preparada incorpora `lifeHistory` —narrativa Markdown, referencias a antecedentes, lagunas y contradicciones— y `desires` —descripción, qué está en juego, tensión y referencias a goals propios o compartidos—. Un deseo latente puede no tener todavía un goal operativo. Las referencias presentes deben resolver dentro de la preparación de ese personaje; los antecedentes deben ser admisibles en su continuidad.

El compilador del contexto actoral incluye estos campos junto con voz, capacidades, situación, metas y experiencias propias. El Continuista recibe la identidad correspondiente para revisar una propuesta situada. La historia de vida no crea experiencias SQLite ni incorpora recuerdos ajenos, fuentes de producción o acontecimientos futuros por el mero hecho de figurar en un dossier.

La ficha permite editar, guardar y reabrir una narrativa extensa sin recortarla. El límite declarado es 128 KiB UTF-8 para la narrativa; el transporte Pi admite el contexto compilado completo y rechaza un exceso explícitamente. No se usa un resumen silencioso como sustituto de la biografía.

Los nuevos borradores del host llevan `characterDefinitionPolicy: embodied-v1`; Ready exige historia y deseos para todos sus actores activos. Los borradores históricos conservan sus bytes y pueden incorporar esta exigencia mediante una operación explícita. La edición y evolución no pueden degradar una identidad rica a legacy ni borrar sus lagunas y contradicciones documentales. La admisión central del journal protege también las escrituras HTTP directas.

## Evidencia y límites

Verificación global final con ICM 0.11.4 real: `npm run verify`, **1469 pruebas, 1468 aprobadas, 0 fallidas, 1 omitida**; typecheck aprobado. Build y control de formato aprobados. El caso histórico mantiene el golden `777f330c30e7434b9a14ec609ecb26674659405e57f209cc97a505e096a963bb`. Los forks conservan la política de su fuente sin añadirla a fuentes legacy.

Las pruebas focales verifican conservación exacta de Markdown, límites UTF-8, copresencia de historia y deseos, referencias propias, contexto actoral con memoria SQLite propia, exclusión de investigación y memoria ajena, preservación en evolución, formulario de edición y opt-in explícito. Una revisión independiente reprodujo el bypass de borrado por journal y confirmó su rechazo después de corregirlo, sin cambiar identidad ni revisión almacenadas.

Esto verifica el mecanismo; no demuestra por sí solo calidad artística ni exhaustividad semántica. Tampoco significa que los 27 expedientes del catálogo ya estén curados para una puesta concreta. Su estado se detalla en [los contextos del reparto](../personajes/get-smart/estado-contextos.md). La [definición de agentes](../diseno/definicion-de-los-agentes.md) distingue qué recibe y qué puede hacer cada rol.

La propuesta pendiente `64448ac8-b0d4-41b0-9d05-201107f913de` de la puesta «CONTROL: el sello extraviado» se canceló explícitamente antes de inferir: sus instrucciones precedían esta ampliación. No se presenta esa propuesta como curación realizada. La aceptación real de una curación biográfica completa y una nueva representación con ella debe registrarse por separado.

La aplicación actualizada guardó esa puesta en revisión 3, conservando el borrador existente y activando explícitamente la exigencia de biografía y deseos completos. Se registró el trabajo de preparación `450f51aa-d333-4b83-bcf9-40adaa865041` con instrucciones ampliadas para Max y Hymie. Registrar o iniciar el trabajo no equivale a aceptar su propuesta ni a ejecutar una representación.

Ese trabajo terminó bloqueado: su primera propuesta utilizó una referencia no admitida y la herramienta la rechazó; la siguiente ronda no pudo despachar tras vencer la comprobación local de acceso. No se aplicaron sus datos. Este resultado no se cuenta como aceptación real de las biografías.

## Curación editorial guardada

El reintento `af93669c-da7e-423c-a8c2-7d9965b0d289` también terminó bloqueado: generó una propuesta pero confundió tratamientos de contradicciones documentales con eliminaciones de una identidad previa. Se aclararon el esquema y el feedback sin relajar el validador; 13 pruebas focales y typecheck aprobados después del global.

Para evitar otra generación completa, se revisó editorialmente su primera salida y se corrigió la lista administrativa de tratamientos: no había identidad anterior que modificar. Las secciones actorales quedaron expresamente atribuidas como adaptación editorial de una propuesta no aceptada automáticamente. Se validaron con el conversor puro y `prepareCharacter`, y se guardaron mediante PUT autenticado del host, con CAS sobre revisión 3. El recibo HTTP 200 confirmó **revisión 4**, con dos actores preparados: Max (2889 caracteres de historia, dos deseos y dos metas) y Hymie (2834 caracteres, dos deseos y dos metas). Ambos mantienen `initialExperience: none`. La conversión local pasó la validación estructural Ready; no se ejecutó la transición Ready del host ni la representación.

Este guardado es una edición explícita del operador; no fabrica una aceptación SDK del trabajo fallido. La narrativa delimita una continuidad sintética reducida y conserva lo desconocido. No acredita una biografía canónica exhaustiva de toda la serie ni la curación de los otros 25 personajes.
