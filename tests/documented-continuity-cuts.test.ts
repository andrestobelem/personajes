import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openJournal } from '../src/adapters/journal.ts';
import { createDocumentedContinuityDraft, DOCUMENTED_CONTINUITY_CUTS, DocumentedContinuityCutIdSchema, DocumentedContinuityCutSchema } from '../src/application/documented-continuity-cuts.ts';
import { validateRunConfiguration } from '../src/application/production-preflight.ts';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { RunDraftPatchSchema } from '../src/domain/world-journal.ts';

const runId = '00000000-0000-4000-8000-000000000001';

test('catalog is bounded, versioned and preserves the actual scope of the verified distributor synopses', () => {
  assert.equal(DOCUMENTED_CONTINUITY_CUTS.length, 2);
  assert.equal(Object.isFrozen(DOCUMENTED_CONTINUITY_CUTS), true);
  for (const cut of DOCUMENTED_CONTINUITY_CUTS) {
    assert.deepEqual(DocumentedContinuityCutSchema.parse(cut), cut);
    assert.equal(cut.revision, 1);
    assert.equal(Object.isFrozen(cut), true);
    assert.equal(Object.isFrozen(cut.sources), true);
    assert.equal(Object.isFrozen(cut.milestones), true);
    for (const source of cut.sources) {
      assert.equal(Object.isFrozen(source), true);
      assert.equal(Reflect.set(source, 'title', 'Tampered source'), false);
    }
    for (const milestone of cut.milestones) {
      assert.equal(Object.isFrozen(milestone), true);
      assert.equal(Object.isFrozen(milestone.sourceRefs), true);
      assert.equal(Reflect.set(milestone.sourceRefs, 'length', 0), false);
    }
    assert.throws(() => cut.sources.pop(), TypeError);
    assert.ok(cut.sources.every((source) => source.url.startsWith('https://tv.apple.com/') && source.scope.length > 0 && source.uncertainty.length > 0));
    assert.ok(cut.milestones.every((milestone) => milestone.sourceRefs.every((url) => cut.sources.some((source) => source.url === url))));
    assert.ok(cut.milestones.some((milestone) => milestone.status === 'reached'));
    assert.ok(cut.milestones.some((milestone) => milestone.status === 'undetermined'));
  }
  const wedding = DOCUMENTED_CONTINUITY_CUTS.find((cut) => cut.id === 'max-99-wedding-preparations');
  assert.equal(wedding?.milestones.find((milestone) => milestone.milestoneId === 'matrimonio-max-99-celebrado')?.status, 'undetermined');
  assert.ok(wedding?.sources[0]?.uncertainty.includes('fecha diegética'));
  const hymie = DOCUMENTED_CONTINUITY_CUTS.find((cut) => cut.id === 'hymie-kaos-introduction');
  assert.equal(hymie?.milestones.find((milestone) => milestone.milestoneId === 'hymie-lealtad-control')?.status, 'undetermined');
  assert.ok(hymie?.sources[0]?.uncertainty.includes('secuestro consumado'));
  assert.equal(DocumentedContinuityCutIdSchema.safeParse('max-99-wedding').success, false);
  if (!wedding) throw new Error('Missing catalog entry');
  assert.equal(DocumentedContinuityCutSchema.safeParse({ ...wedding, sources: [{ ...wedding.sources[0], url: 'javascript:alert(1)' }] }).success, false);
  assert.equal(DocumentedContinuityCutSchema.safeParse({ ...wedding, milestones: [{ ...wedding.milestones[0], sourceRefs: [] }] }).success, false);
  assert.equal(DocumentedContinuityCutSchema.safeParse({ ...wedding, milestones: [{ ...wedding.milestones[0], sourceRefs: ['https://example.org/unknown'] }] }).success, false);
});

for (const cut of DOCUMENTED_CONTINUITY_CUTS) {
  test(`${cut.id}: only editorial name/continuity are proposed; no fictional instant, world, actors or human identity invented`, async () => {
    const draft = await createDocumentedContinuityDraft({ cutId: cut.id, runId, uuid: randomUUID });
    assert.deepEqual(RunConfigurationDraftSchema.parse(draft), draft);
    const empty = createEmptyRunConfigurationDraft({ runId, revision: 0 });
    for (const [key, value] of Object.entries(draft)) if (key !== 'name' && key !== 'continuity') assert.deepEqual(value, Reflect.get(empty, key));
    assert.equal(draft.name.kind, 'proposed');
    assert.equal(draft.continuity.kind, 'proposed');
    if (draft.name.kind !== 'proposed' || draft.continuity.kind !== 'proposed') throw new Error('Expected editorial proposals');
    assert.equal(draft.name.source, 'editorial');
    assert.equal(draft.continuity.source, 'editorial');
    assert.equal(draft.continuity.value.kind, 'original');
    assert.equal(draft.continuity.value.revision, cut.revision);
    assert.deepEqual(draft.continuity.value.milestones, cut.milestones);
    assert.deepEqual(draft.continuity.value.inclusions, []);
    assert.ok(draft.continuity.value.label.length <= 1000);
    for (const source of cut.sources) {
      assert.ok(draft.continuity.value.label.includes(source.title));
      assert.ok(draft.continuity.value.label.includes(source.uncertainty));
    }
    const { contentHash, ...core } = draft.continuity.value;
    assert.equal(contentHash, createHash('sha256').update(JSON.stringify(core)).digest('hex'));
    const refs = draft.continuity.value.milestones.flatMap((milestone) => milestone.sourceRefs);
    assert.ok(cut.sources.every((source) => refs.includes(source.url)));
    assert.notEqual(createHash('sha256').update(JSON.stringify({ ...core, milestones: core.milestones.map((milestone) => ({ ...milestone, sourceRefs: [] })) })).digest('hex'), contentHash);
    const validation = validateRunConfiguration({ draft });
    if (validation.kind === 'ready') assert.fail('An unreviewed partial preparation cannot be Ready');
    assert.ok(validation.issues.some((issue) => issue.field === 'continuity' && issue.code === 'proposal-not-confirmed'));
    assert.ok(validation.issues.some((issue) => issue.field === 'fictionalAt' && issue.code === 'draft-field-empty'));
    assert.ok(validation.issues.some((issue) => issue.field === 'worldSnapshot' && issue.code === 'draft-field-empty'));
    assert.ok(validation.issues.some((issue) => issue.field === 'roster' && issue.code === 'draft-field-empty'));
  });
}

test('unknown cut and invalid/duplicate UUIDs fail explicitly without falling back to another continuity', async () => {
  await assert.rejects(createDocumentedContinuityDraft({ cutId: 'unknown', runId, uuid: () => { throw new Error('UUID must not be called'); } }));
  await assert.rejects(createDocumentedContinuityDraft({ cutId: 'hymie-kaos-introduction', runId, uuid: () => 'not-a-uuid' }));
  const duplicate = randomUUID();
  await assert.rejects(createDocumentedContinuityDraft({ cutId: 'hymie-kaos-introduction', runId, uuid: () => duplicate }), /repitió/);
  await assert.rejects(createDocumentedContinuityDraft({ cutId: 'hymie-kaos-introduction', runId, uuid: () => runId }), /repitió/);
});

test('same documented cut has stable source-bound continuity across independent preparations', async () => {
  const first = await createDocumentedContinuityDraft({ cutId: 'hymie-kaos-introduction', runId, uuid: randomUUID });
  const second = await createDocumentedContinuityDraft({ cutId: 'hymie-kaos-introduction', runId: randomUUID(), uuid: randomUUID });
  if (first.continuity.kind !== 'proposed' || second.continuity.kind !== 'proposed') throw new Error('Expected proposals');
  assert.deepEqual(first.continuity.value, second.continuity.value);
  assert.notEqual(first.continuity.proposalId, second.continuity.proposalId);
  first.continuity.value.milestones.pop();
  assert.equal(second.continuity.value.milestones.length, 2);
  assert.equal(DOCUMENTED_CONTINUITY_CUTS.find((cut) => cut.id === 'hymie-kaos-introduction')?.milestones.length, 2);
});

test('documentary proposal, milestone uncertainty and references survive SQLite restart without publishing a world', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personajes-documented-cut-'));
  const path = join(directory, 'journal.sqlite');
  let journal = openJournal({ path });
  try {
    for (const cut of DOCUMENTED_CONTINUITY_CUTS) {
      const draft = await createDocumentedContinuityDraft({ cutId: cut.id, runId: randomUUID(), uuid: randomUUID });
      const patch = RunDraftPatchSchema.parse(Object.fromEntries(Object.entries(draft).filter(([key]) => !['kind', 'schemaVersion', 'runId', 'revision'].includes(key))));
      const created = journal.createRunConfigurationDraft({ principalId: 'documentary-cut-test', idempotencyKey: randomUUID(), patch });
      if (created.kind !== 'created') assert.fail(`Unexpected save: ${created.kind}`);
      journal.close();
      journal = openJournal({ path });
      assert.deepEqual(journal.readRunConfigurationDraft({ runId: created.draft.runId }), created.draft);
      assert.deepEqual(created.draft.continuity, draft.continuity);
      if (created.draft.continuity.kind !== 'proposed') throw new Error('Expected preserved proposal');
      for (const source of cut.sources) assert.ok(created.draft.continuity.value.label.includes(source.title));
      assert.equal(journal.readWorldConfiguration({ runId: created.draft.runId }), undefined);
      const result = journal.validateRunConfigurationDraft({ principalId: 'documentary-cut-test', idempotencyKey: randomUUID(), runId: created.draft.runId, expectedRevision: 0 });
      assert.equal(result.kind, 'incomplete');
      assert.equal(journal.readWorldConfiguration({ runId: created.draft.runId }), undefined);
    }
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }); }
});
