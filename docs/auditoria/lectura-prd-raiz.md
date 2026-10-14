# Lectura de raíz, recursos y cobertura del corpus

La raíz leyó archivos de entrada, informes previos, manifiestos/parche, licencias y recursos de skills. La lectura de investigación, expedientes y contratos fue dividida por archivo entre agentes conforme al procedimiento autorizado. El [inventario base](inventario-base-prd.json) identifica versiones actuales y responsables; los informes de lectura registran conclusiones individuales. **Un hash o una asignación no demuestran lectura por sí solos**: la evidencia incluye contenido examinado y conclusiones.

| Archivo leído | SHA-256 actual | Conclusión |
|---|---|---|
| `.agents/skills/domain-modeling/ADR-FORMAT.md` | `944c92aa790e8fbdc9199640b170979abb8a34ba8d0fe18c2a01a63bce140ca0` | ADRs para decisiones reales con costo/contexto/alternativas; no por cada término. |
| `.agents/skills/domain-modeling/GLOSSARY-FORMAT.md` | `21dcc40cdec8e151a829b98ab1517c1867bc444e3665134a98c6983411996801` | Glosario breve de dominio, sin usarlo como spec técnica. |
| `.agents/skills/domain-modeling/LICENSE` | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` | Licencia MIT del autor de esa skill, preservada. |
| `.agents/skills/domain-modeling/SKILL.md` | `7b925d7b1e341a2eeae33ad68a8a8c0ab889a38ddd22a7598e4c240e5a7556a3` | Clarifica términos y registra decisiones cuando cumplen tres criterios. |
| `.agents/skills/domain-modeling/agents/openai.yaml` | `fa3b10d0a272ac1836a9a270596352e2b25ecd69ad36693ad1a93d5d716cb5f9` | Invocación implícita habilitada y prompt/nombre consistentes. |
| `.agents/skills/grill-with-docs/LICENSE` | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` | Licencia MIT del autor de esa skill, preservada. |
| `.agents/skills/grill-with-docs/SKILL.md` | `587981fb57e77c9abccaa699e0a5ae7d29d28b273325d36bdb1127d53fa428be` | Compone lectura local de grilling/domain-modeling y reutiliza decisiones asentadas. |
| `.agents/skills/grill-with-docs/agents/openai.yaml` | `e617dc5f5d19a4ab948a254da7226ea9772549ee3fc010f335e5fd6ba529c842` | Invocación implícita habilitada y prompt/nombre consistentes. |
| `.agents/skills/grilling/LICENSE` | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` | Licencia MIT del autor de esa skill, preservada. |
| `.agents/skills/grilling/SKILL.md` | `209fc0b5116a20c7d7a4ac2e47a5e652c9496d3da51f522fda79cce042aeedcd` | Entrevista por dependencias; datos verificables se investigan antes de preguntar. |
| `.agents/skills/grilling/agents/openai.yaml` | `cefe0227f8e508031ecdae31bab979ab3e86850baa2ccf38cbc8e155c2ef55bd` | Invocación implícita habilitada y prompt/nombre consistentes. |
| `.agents/skills/typescript-best-practices/LICENSE` | `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e` | Licencia MIT del autor de esa skill, preservada. |
| `.agents/skills/typescript-best-practices/SKILL.md` | `bf24871d30e7dacbaee922b37078288943ad7b47711c0b6d3b6b882a763627a5` | Buenas prácticas TypeScript: datos unknown, schemas, discriminantes, narrowing y pruebas reales. |
| `.agents/skills/typescript-best-practices/agents/openai.yaml` | `442adeb0a808906d399ea97e79a44a8247c9a8ec5a4643f600a7f56d3aa595f9` | Invocación implícita habilitada y prompt/nombre consistentes. |
| `.agents/skills/typescript-best-practices/references/patterns.md` | `ecfbdc19bd77f988fb7e3be064b96f8034ab1f61c9999c11e3202ae1f435feb9` | Ejemplos de tipos y límites; no programas completos compilables. Los schemas del software serán autoritativos y validados. |
| `.agents/skills/typescript-best-practices/references/principles.md` | `adef01289f8056a3b53f9beb72e99caad41bd3c561e2e6c5f22ca3dde05b5b96` | Validación de fronteras, composición, uniones discriminadas e invariantes numéricas. |
| `.gitignore` | `1a63c81fd090d26eb5fcb5a40b226c28e304d909aa0d1daf40104104522ecbec` | Ignora logs, deps y SQLite; almacenamiento privado adicional se definirá antes del runtime, sin credenciales en Git. |
| `AGENTS.md` | `d87a4dccc4866618f88f34e90026e12ecc1a3e826be0c95b537fa5880d9733ae` | Autoriza procedimiento entrevistador/custodio; preserva instancia Pi, perfil fijo, términos y evidencia de cierre. |
| `LICENSE` | `bd1c1016673d990a24c9afdd8d370efe2541c6209cca4e8fb33f0eda549abd37` | MIT del código propio; no extiende automáticamente derechos a fotografías/artículo/skills. |
| `README.md` | `fb16fff7fc6f5d4cb409801153c6192464c9248d448d85a3890debb9a790e499` | Entrada del proyecto; alcance activo actualizado a PRD/specs/implementación, estado real sin aplicación conservado. |
| `docs/README.md` | `20ee48168a80954f258ceab5a85f424569af38825e765622caf90154ac279518` | Índice navegable del corpus; enlaza PRD y progreso actuales, no se confunde con GUI. |
| `docs/auditoria/registro-de-agentes.md` | `2be8817e2ea6fbbe7a659d02e69aec073e837127d0a5ae977bab8c0d7cad0287` | Autores y límites históricos, sin reatribución de modelo a investigadores anteriores. |
| `docs/auditoria/revision-integral.md` | `490eff40cd2382a6b04ff368970c2b5f23869d3ce9c3b69cbf5bf6a6aaa2f46e` | Trece correcciones históricas, verificaciones de recursos y límites; no hay prueba de producto. |
| `docs/auditoria/revision-luna-investigaciones.md` | `9bdcc6b368f0e540eef19f0a9cf29c95b41a9193fbf7bd02ee5e0f37375cdb1f` | Precisión de atribución y fuentes, no auditoría filológica integral. |
| `docs/auditoria/revision-luna-personajes.md` | `f2758314db623f01d2a1fac7763fa1472e85eff4d40a40125510619fb26202f6` | Recetas, referentes y cobertura; no audio ni clonación realizados. |
| `docs/auditoria/revision-luna-tecnica.md` | `fcc115c312f341e1fdd220c066869d421c5c076949ec2e5e81d846bf0c3eaced` | Rectifica método Pi existente y preserva acceso efectivo como verificación pendiente. |
| `docs/auditoria/skills-instaladas.md` | `ad98ecb4b4d09edf6fda578ba278e32cf413e337c033ce4cb5000f4855c47a39` | Cuatro recursos locales reproducibles; elección implícita no entrega tools a actores. |
| `docs/auditoria/skills-local.patch` | `ec5ca4571cd4390265be5d446c157432e64811b21857a94e389991aa9d22c73b` | Adaptaciones de invocación/dependencias y duraciones validadas; licencias/principios incluidos. |
| `docs/auditoria/skills-manifest.json` | `7b1b0f2624176798a5b07fdec4dbc5f34885fd5e40d0eca85419b697de577f10` | Fuentes/commits/hashes y metadatos de16archivos instalados; no garantía de selección perfecta por LLM. |

## Integración de lecturas

- [Concepto](lectura-prd-concepto.md): definición, constitución/glosario, diseño y diálogo previo.
- [Investigaciones](lectura-prd-investigaciones.md):16informes, fuentes y PDF21páginas, verificación primaria Pi/ICM.
- [Personajes](lectura-prd-personajes.md):32documentos del reparto,217Markdown operativos y recursos; imágenes cotejadas como referentes/metadatos.
- [Obra](lectura-prd-obra.md):73Markdown fuera de personajes, estados y autoridades.

Los documentos corregidos después del registro inicial conservan ese hash histórico; la raíz revisó sus cambios y el inventario fija la versión actual. Los nuevos PRD, trazabilidad, diálogo y revisiones se leen dentro del loop; no se incorporan retroactivamente a la base inicial ni se considera que leer una auditoría sustituya a leer su fuente.

La cobertura del producto aún requiere specs, implementación y pruebas. La calibración audiovisual sigue pendiente; no se inventa evidencia acústica al cerrar esta lectura.
