# Cierre documental de las especificaciones

El registro siguiente conserva el cierre previo de S01–S07 versión 1.0. Ese corte habilitó implementación, pero no acredita código, acceso a proveedores, GUI ni pruebas de producto. La revisión G0 está reabierta el 15 de octubre de 2026 para reconciliar los cambios posteriores del PRD y nuevas discrepancias de evidencia; no se considera cerrada en el estado actual.

La revisión de [producto R2](revision-specs-producto.md), [concepto R4](revision-specs-concepto.md) y [técnica R3](revision-specs-tecnica.md) conservó hallazgos y correcciones. Se retiraron los falsos positivos sobre los gemelos y el prefijo de rutas. Los últimos ajustes cerraron el origen durable de voces, el warming de Pi fuera del contador y la cuota agregada por pulso. La edición de liberación sólo cambia las cabeceras de versión; la implementación debe mantener los contratos y registrar cualquier ajuste posterior.

La raíz cotejó 77 IDs únicos y sus ensayos contra JSON, sin diferencias, y 54 enlaces locales de specs sin roturas en el corte comprobado. [Registro de comprobación](comprobacion-specs-raiz.json) fija alcance: la sonda Node SQLite en memoria sólo confirmó APIs básicas, no durabilidad ni integración del producto. Los hashes de la tabla y de `specHashes` son snapshots históricos del cierre G0, no hashes actuales después de notas de implementación. `currentSpecHashes` conserva la huella del corte revisado; la matriz identifica evidencia parcial por requisito mientras los 77 criterios integrales siguen `pending`. G0 se cerró en ese corte y está reabierto ahora; G1–G6 siguen requiriendo ejecución y revisión.

| Archivo | Hash antes de cabecera 1.0 | Hash liberado |
|---|---|---|
| `docs/specs/01-dominio-y-catalogo.md` | `c14ec021efa6c0e85fdf837b1ba91a372f422bc8837f948ed30e995a4a4209ce` | `a54d237a5337d154ae0c403a887ec78647c1b81f8f1e9cfa73039c6cf087d34c` |
| `docs/specs/02-persistencia-e-icm.md` | `4f67202b0567bcd0400b7795870247b41409d19278c49d0a7bd811f809757f76` | `d46d65acebf5021d49c27ece43f5caa38f4566fe82aec037c65e6b75544c55da` |
| `docs/specs/03-pi-y-coordinacion.md` | `d8c2f3011c13cfad9cc0051a5d8af1851ee83dea40c32e62da8684ef3fc977d5` | `2a5df346455547b137af4515220494eec81616d6df59a3ad00b536812885e1fb` |
| `docs/specs/04-api-y-autoridad.md` | `7485b3bad7598976ae40b5e682f283584a3d33543491750024e1e6112c7c63be` | `7624ccbcffece372e63e84e0c6037ec08f68257c4be874ef855c29cb10e84fc2` |
| `docs/specs/05-interfaz.md` | `763dd61f427b965c8770e00219a89bd47969970ca5b5b76f07229ae5403a702d` | `ca2d1dd464452c38adaef21f8be3737c09ce53319257d04e1b310a5737ef5ab7` |
| `docs/specs/06-voces-y-ritmo.md` | `4f970e212f972eb1424b2ee4f80fab39c299b02f4fcbc2076962836f8205da06` | `1c05faf8ce57d7d17ed95f63843eb75b2eff28885401b3de51424ed6bd31ea08` |
| `docs/specs/07-verificacion.md` | `50f007056a481014ab0cc9d3bdbeb7be09bbca80a71ddbb9acfa1fa8d8a1ff70` | `5d9096aafb997c9c4e9bb9a10efc4572a0556b99207d36b663aec2f13cc69792` |
| `docs/specs/README.md` | `bac8b6d0a62fe1642124918d1e82ed7dc46211045eae3834001034db6aee2bd9` | `11f75c29eb576f22ff1e30dd2596a7e564ac84d32def091600d8172ced7d9d5c` |

## Revalidación documental R5 — 15 de octubre de 2026

La relectura de ESC-10 encontró referencias desalineadas en S02/S04/S05 y una abreviatura no verificable mecánicamente para NFR-10. Se corrigieron las descripciones del esquema lógico vs. v28 implementado, la equivalencia del fork de backup con el fork explícito, la aceptación de interfaz y la lista enumerada P01–P25. La matriz JSON conserva los 77 requisitos y sus asignaciones; ESC-10 apunta ahora a P04/P13/P14/P15/P19. Los hashes de `currentSpecHashes` en [comprobación](comprobacion-specs-raiz.json) se actualizan al corte revisado; los hashes históricos de liberación anteriores no cambian.

El pase R5 había vuelto a cerrar coherencia documental en su corte. La revisión actual detectó que ese cierre no contemplaba los últimos cambios de PRD ni verificaba por requisito los subresultados de P21, la cobertura de P08 o el contrato repetido de `/structure-events`. Se corrigieron algunas descripciones y se sigue revisando G0. La estructura episódica base ya llegó al journal v29, API autenticada y panel parcial; la reconstrucción histórica por `commitIndex` y los saltos desde eventos, conversaciones y cambios estructurales al commit exacto tienen pruebas de SQLite/HTTP, mientras Director histórico, comparación de cortes y fork durable siguen pendientes según ADR 0007 y [PENDIENTES](../PENDIENTES.md). G1–G6 continúan abiertos, y ningún requisito se considera aceptado por el cierre documental anterior.

## Revalidación documental R6 — 15 de octubre de 2026

Se comprobó de nuevo la relación entre las 77 filas de requisitos, sus ensayos y niveles mínimos. Las filas que dependen de un solo ensayo o de varios ensayos ordinarios coinciden con la unión indicada; NFR-10 conserva su papel de cobertura agregada. P21 queda dividido en seis subresultados con piso propio y estado independiente, y cada fila VOZ-01–07/NFR-08 especifica qué subresultado le corresponde. El espejo JSON ahora registra los niveles por requisito, las subclaves P21 y su piso/estado; las 77 aceptaciones permanecen `pending`, pues el cambio documental no ejecuta ensayos. Se actualizaron los hashes del corte actual en el espejo y en el registro de comprobación; los hashes históricos de liberación permanecen intactos. G0 sigue abierto para la revisión integral de S01–S07.

## Reconciliación posterior al ensayo live · 15 de octubre de 2026

S03 explicita que el guard estructural considera generaciones vigentes y conserva las negativas idempotentes; S04 aclara el diagnóstico de pruebas de acceso vencidas/futuras sin admitir ejecución y refleja la opción explícita de retry al reanudar. La [evidencia de implementación y cierre](cierre-ensayo-y-preflight.md) acredita esas reparaciones y el cierre del ensayo, sin cerrar G0 ni G1–G6. Los hashes de cortes documentales anteriores son históricos y no certifican este nuevo contenido; todavía se requiere la revalidación integral de las siete specs.
