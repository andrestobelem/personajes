import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import { WorldSnapshotSchema, WorldClockSchema } from '../src/domain/world-schema.ts';
import { WorldSnapshotSchema as HostWorldSnapshotSchema, WorldClockSchema as HostWorldClockSchema } from '../src/domain/world.ts';
import { HumanParticipantProfileSchema } from '../src/domain/interaction-schema.ts';
import { HumanParticipantProfileSchema as HostHumanParticipantProfileSchema } from '../src/domain/interaction.ts';

/** Audit literal static imports in the repository contract modules; dynamic imports fail closed. */
async function assertBrowserImportClosure(entryPath: string, visited = new Set<string>()): Promise<void> {
  const path = resolve(entryPath);
  if (visited.has(path)) return;
  visited.add(path);
  const source = await readFile(path, 'utf8');
  // Contract files use literal static imports. An uninspectable dynamic dependency fails closed.
  assert.ok(!/\bimport\s*\(/.test(source), `Dynamic dependency in browser contract ${path}`);
  const dependencies: string[] = [];
  for (const match of source.matchAll(/\b(?:import|export)\s+(?!type\b)([^;]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = match[1];
    const dependency = match[2];
    assert.ok(clause !== undefined && dependency !== undefined);
    if (clause.trim().startsWith('{') && clause.trim().endsWith('}') && clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}')).split(',').filter((part) => part.trim()).every((part) => part.trim().startsWith('type '))) continue;
    dependencies.push(dependency);
  }
  for (const match of source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
    assert.ok(match[1] !== undefined);
    dependencies.push(match[1]);
  }
  for (const dependency of dependencies) {
    assert.ok(!dependency.startsWith('node:'), `Browser contract imports Node dependency ${dependency} in ${path}`);
    if (dependency.startsWith('.')) await assertBrowserImportClosure(resolve(dirname(path), dependency), visited);
    else assert.equal(dependency, 'zod', `Unexpected runtime dependency ${dependency} in browser contract ${path}`);
  }
}

test('browser production and participation contracts have no transitive host dependencies', async () => {
  for (const entry of ['world-schema.ts', 'interaction-schema.ts', 'production.ts', 'http.ts']) {
    await assertBrowserImportClosure(new URL(`../src/domain/${entry}`, import.meta.url).pathname);
  }
});

test('host reexports use the same authoritative world and human schemas', () => {
  assert.equal(HostWorldSnapshotSchema, WorldSnapshotSchema);
  assert.equal(HostWorldClockSchema, WorldClockSchema);
  assert.equal(HostHumanParticipantProfileSchema, HumanParticipantProfileSchema);
});
