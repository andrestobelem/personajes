import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../src/adapters/catalog.ts';
import { resolveCatalogReference } from '../src/adapters/catalog-links.ts';

test('las referencias del corpus sólo resuelven a recursos registrados y nunca a rutas arbitrarias', async () => {
  const catalog = await loadCatalog({ repositoryRoot: process.cwd() });
  const resolve = (reference: string) => resolveCatalogReference({ catalog, query: { sourceKind: 'character', sourceId: 'maxwell-smart', reference } });
  assert.deepEqual(resolve('siegfried.md#continuidad'), { kind: 'character', id: 'siegfried', title: 'Siegfried' });
  assert.equal(resolve('../../investigaciones/elevenlabs-diseno-de-voces.md').kind, 'document');
  assert.equal(resolve('../../../.env').kind, 'unavailable');
  assert.equal(resolve('file:///etc/passwd').kind, 'unavailable');
  assert.equal(resolve('//example.org/private').kind, 'unavailable');
  assert.equal(resolve('https://catalog.invalid/docs/personajes/get-smart/jefe.md').kind, 'unavailable');
  assert.equal(resolve('jefe.md?secret=value').kind, 'unavailable');
  assert.equal(resolve('bad%zz.md').kind, 'unavailable');
  assert.equal(resolveCatalogReference({ catalog, query: { sourceKind: 'character', sourceId: 'absent', reference: 'jefe.md' } }).kind, 'unavailable');
});
