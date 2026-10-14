import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { DocumentBody } from '../src/web/DocumentBody.tsx';

test('la biblioteca presenta tablas GFM y referencias externas sin ejecutar contenido de fuentes', () => {
  const html = renderToStaticMarkup(createElement(DocumentBody, { text: `## Evidencia

**Dato** y *propuesta*.

| Fuente | Estado |
| --- | --- |
| Serie | Pendiente |

[Fuente](https://example.org/source) [Ficha](jefe.md)
[Script](javascript:alert%281%29) [Credenciales](https://user:secret@example.org/)
![Seguimiento](https://example.org/pixel.png)
<script>globalThis.changed=true</script>
` }));
  assert.match(html, /<strong>Dato<\/strong>/u);
  assert.match(html, /<em>propuesta<\/em>/u);
  assert.match(html, /<table><thead>/u);
  assert.match(html, /href="https:\/\/example.org\/source"/u);
  assert.match(html, /rel="noopener noreferrer"/u);
  assert.match(html, /Referencia local: jefe.md/u);
  assert.doesNotMatch(html, /<script|<img|href="javascript:|user:secret/u);
});
