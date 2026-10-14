# Cierre documental de las especificaciones

S01–S07 versión 1.0 pasan a implementación. El cierre afecta el contrato documental, no acredita código, acceso a proveedores, GUI ni pruebas de producto. El objetivo completo sigue activo.

La revisión de [producto R2](revision-specs-producto.md), [concepto R4](revision-specs-concepto.md) y [técnica R3](revision-specs-tecnica.md) conservó hallazgos y correcciones. Se retiraron los falsos positivos sobre los gemelos y el prefijo de rutas. Los últimos ajustes cerraron el origen durable de voces, el warming de Pi fuera del contador y la cuota agregada por pulso. La edición de liberación sólo cambia las cabeceras de versión; la implementación debe mantener los contratos y registrar cualquier ajuste posterior.

La raíz cotejó 77 IDs únicos y sus ensayos contra JSON, sin diferencias, y 54 enlaces locales de specs sin roturas en el corte comprobado. [Registro de comprobación](comprobacion-specs-raiz.json) fija alcance: la sonda Node SQLite en memoria sólo confirmó APIs básicas, no durabilidad ni integración del producto. Los hashes de la tabla y de `specHashes` son snapshots históricos del cierre G0, no hashes actuales después de notas de implementación. `currentSpecHashes` conserva la huella vigente; la matriz ahora identifica evidencia parcial por requisito mientras los 77 criterios integrales siguen `pending`. G0 documental se cierra; G1–G6 requieren ejecución y revisión.

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
