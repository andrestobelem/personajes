# Skills instaladas y adaptadas al modelo

Fecha de verificación: **14 de octubre de 2026**. Alcance: este repositorio, en `.agents/skills/`. No se modificó configuración global ni el repositorio local `pstack`.

Las cuatro skills están instaladas, con selección implícita habilitada para el modelo. `grilling` es la dependencia de la skill solicitada `grill-with-docs`. Las tres solicitudes del usuario quedan cubiertas: `domain-modeling`, `grill-with-docs` y TypeScript de Cursor pstack.

## Inventario y procedencia

| Skill | Función y uso | Fuente fijada |
|---|---|---|
| [domain-modeling](../../.agents/skills/domain-modeling/SKILL.md) | Clarificar el lenguaje del dominio; mantener glosario y registrar decisiones arquitectónicas cuando corresponda. | [Matt Pocock](https://github.com/mattpocock/skills/tree/d80fa0f4ebe0c5714af0adf8670336065233ecc6/skills/engineering/domain-modeling), commit `d80fa0f4ebe0c5714af0adf8670336065233ecc6`. |
| [grill-with-docs](../../.agents/skills/grill-with-docs/SKILL.md) | Cuestionar un diseño y documentar los términos y decisiones resueltos. | [Matt Pocock](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/grill-with-docs), commit `49dd158d1076134a641b33efb035946536778336`. |
| [grilling](../../.agents/skills/grilling/SKILL.md) | Entrevista de diseño por rondas de preguntas cuyas dependencias ya estén resueltas. | [Matt Pocock](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/grilling), mismo commit que `grill-with-docs`. |
| [typescript-best-practices](../../.agents/skills/typescript-best-practices/SKILL.md) | Tipos de dominio, uniones discriminadas, validación en fronteras, narrowing y tratamiento exhaustivo en TypeScript. | [Cursor pstack](https://github.com/cursor/plugins/tree/ce649c03ac3b75b6ae80cbd15b7e2c536caedb5a/pstack/skills/typescript-best-practices), commit `ce649c03ac3b75b6ae80cbd15b7e2c536caedb5a`. |

La procedencia de TypeScript se identificó en `skills-lock.json` del proyecto local `pstack`. Se instaló la versión oficial fijada por commit; difiere de esa copia local, que se consultó sin modificarla. El manifiesto conserva la entrada original del lock como evidencia de descubrimiento.

Cada carpeta incluye su licencia MIT: Matt Pocock para sus tres skills; Lauren Tan para la skill y los principios de Cursor pstack. Los recursos originales de `domain-modeling` —formatos de glosario y ADR— y los ejemplos de TypeScript se conservaron.

## Adaptaciones locales

- Las cuatro configuraciones `agents/openai.yaml` declaran `policy.allow_implicit_invocation: true`. Se eliminó `disable-model-invocation: true` donde existía. También se retiró `paths` del frontmatter TypeScript, específico del origen, conservando la selección por lenguaje en su descripción.
- `grill-with-docs` compone sus dependencias leyendo los archivos locales de `grilling` y `domain-modeling`. No exige una herramienta `Skill` ni comandos de otro editor.
- Las entrevistas respetan decisiones y autorización ya dadas. Guardar investigaciones o instalar la skill no activa por sí mismo un interrogatorio nuevo. Las preguntas se concentran en las decisiones materiales del diseño solicitado.
- TypeScript incluye una referencia local con los principios de tipos y fronteras que necesita. No requiere instalar el resto de pstack. El origen de esos principios, su commit y hashes se conservan en el manifiesto.
- Se corrigió un ejemplo de TypeScript: `durationMs: number` admite valores negativos y no finitos; usar inicio más duración no impone por sí solo una duración válida. Tanto la tabla principal de `SKILL.md` como la referencia exigen validar esa condición en el constructor o esquema de frontera.

La selección implícita permite al modelo aplicar una skill cuando corresponda a la tarea; no garantiza que todo turno deba usarla. Su disponibilidad automática se actualiza en el **próximo turno** del entorno. Los archivos ya pueden leerse directamente.

Estas son skills del asistente que desarrolla el proyecto. Su instalación no entrega herramientas de desarrollo a los personajes ni las incorpora automáticamente a los system prompts de los actores. La carga de recursos de cada actor pertenece a la implementación de `obra`.

## Reproducción y verificación

El [manifiesto](skills-manifest.json) registra repositorios, commits, rutas, hashes SHA-256 originales y finales, dependencias y resultados de validación. El [parche local](skills-local.patch) contiene todas las modificaciones sobre los directorios originales, incluidas licencias y recursos agregados.

Para reproducir en un destino vacío:

1. Descargar cada ruta de origen en el commit indicado mediante `skill-installer/scripts/install-skill-from-github.py`, usando `--dest <repo>/.agents/skills`. No usar `main` como referencia móvil.
2. Aplicar `docs/auditoria/skills-local.patch` desde la raíz del repositorio.
3. Comparar los archivos finales con los hashes del manifiesto y ejecutar `skill-creator/scripts/quick_validate.py` para cada carpeta.

Validación realizada:

- Las **4 skills** pasan el validador de frontmatter y estructura de `skill-creator`.
- Los cuatro YAML de interfaz se parsean y habilitan la invocación implícita; los prompts de ejemplo referencian el nombre correcto de la skill.
- Los enlaces locales reales y las dependencias existen. Se excluyeron de esta comprobación las rutas ficticias de ejemplos encerrados en bloques de código.
- Los hashes originales coinciden con los archivos publicados en los commits fijados.
- El parche se aplicó a copias temporales limpias de los originales y reprodujo **todos los hashes finales** del manifiesto.

La comprobación demuestra integridad de archivos, configuración y reproducción. No pretende demostrar que un modelo siempre seleccionará la skill adecuada ni que todos los ejemplos TypeScript constituyen un programa completo compilable.
