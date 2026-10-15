import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareIdentityPromotion } from '../src/application/prepare-identity-promotion.ts';
import { configuratorValueHash } from '../src/application/configurator-context.ts';
import { configuratorEvolutionFixture } from './fixtures/configurator-evolution.ts';

test('identity promotion prepares only the future identity and exact configuration while preserving lived state and all inputs', async () => {
  const f = await configuratorEvolutionFixture();
  try {
    const request = { source: f.source, context: f.context, proposal: f.proposal, approval: f.approval };
    const before = JSON.stringify(request);
    const durableBefore = f.base.journal.loadWorld({ runId: f.source.snapshot.runId });
    const result = prepareIdentityPromotion(request);
    assert.equal(result.activation, 'requires-durable-boundary-and-new-session-epoch');
    assert.equal(result.nextCommitIndex, f.context.scope.kind === 'evolution' ? f.context.scope.anchor.source.commitIndex + 1 : assert.fail());
    assert.equal(result.snapshot.runId, f.source.snapshot.runId);
    assert.equal(result.snapshot.revision, f.source.snapshot.revision + 1);
    assert.equal(result.snapshot.seq, f.source.snapshot.seq);
    assert.deepEqual(result.snapshot.clock, f.source.snapshot.clock);
    assert.equal(result.configuration.configRevision, f.source.configuration.configRevision + 1);
    assert.deepEqual(result.configuration.worldSnapshot, result.snapshot);
    assert.deepEqual(result.configuration.continuity, f.source.configuration.continuity);
    for (const key of ['inferenceProfile', 'budget', 'audio', 'dramaticLine', 'humanParticipants', 'spanishVariety'] as const)
      assert.deepEqual(result.configuration[key], f.source.configuration[key]);
    for (const old of f.source.configuration.roster.preparedCharacters) {
      const next = result.configuration.roster.preparedCharacters.find(actor => actor.characterId === old.characterId);
      assert.ok(next);
      if (old.characterId !== f.characterId) { assert.deepEqual(next, old); continue; }
      assert.equal(next.identityVersion, old.identityVersion + 1);
      const { identity: _oldIdentity, identityVersion: _oldVersion, ...oldRest } = old;
      const { identity: _newIdentity, identityVersion: _newVersion, ...newRest } = next;
      assert.deepEqual(newRest, oldRest);
      assert.deepEqual(next.identity.value, f.proposal.kind === 'identity-promotion-proposal' ? f.proposal.identity : assert.fail());
      assert.equal(next.identity.provenance.kind, 'curator-declaration');
      if (next.identity.provenance.kind === 'curator-declaration') {
        assert.deepEqual(next.identity.provenance.sourceRefs, [], 'experience IDs remain attributed in the promotion, not disguised as documentary source refs');
        assert.equal(next.identity.provenance.authoredBy, f.approval.operatorId);
      }
      assert.equal(result.promotion.preparedHash, configuratorValueHash(next));
    }
    for (const old of f.source.snapshot.entities) {
      const next = result.snapshot.entities.find(entity => entity.entityId === old.entityId);
      assert.ok(next);
      if (old.kind !== 'character' || old.characterId !== f.characterId) { assert.deepEqual(next, old); continue; }
      assert.equal(next.kind, 'character'); if (next.kind !== 'character') assert.fail();
      const { preparation: _oldPreparation, ...oldRest } = old;
      const { preparation: _newPreparation, ...newRest } = next;
      assert.deepEqual(newRest, oldRest, 'mind, memories, goals, relationships, inventory and presence remain identical');
    }
    assert.deepEqual(f.base.journal.loadWorld({ runId: f.source.snapshot.runId }), durableBefore);
    assert.equal(JSON.stringify(request), before);
    assert.deepEqual(prepareIdentityPromotion(request), result, 'pure retry returns the same plan without effects');
  } finally { f.close(); }
});

test('identity promotion rejects stale snapshots, configuration and receipts before preparing another version', async () => {
  const f = await configuratorEvolutionFixture();
  try {
    const request = { source: f.source, context: f.context, proposal: f.proposal, approval: f.approval };
    assert.throws(() => prepareIdentityPromotion({ ...request, source: { ...f.source, snapshot: { ...f.source.snapshot, revision: f.source.snapshot.revision + 1 } } }));
    assert.throws(() => prepareIdentityPromotion({ ...request, source: { ...f.source, configuration: { ...f.source.configuration, configRevision: f.source.configuration.configRevision + 1 } } }));
    assert.throws(() => prepareIdentityPromotion({ ...request, proposal: { ...f.proposal, reason: 'Una propuesta diferente no está aprobada.' } }));
    assert.throws(() => prepareIdentityPromotion({ ...request, approval: { ...f.approval, contextHash: '0'.repeat(64) } }));
    assert.throws(() => prepareIdentityPromotion({ ...request, source: { ...f.source, cuts: f.source.cuts.filter(cut => cut.actorId !== f.characterId) } }));
  } finally { f.close(); }
});

test('an unchanged identity or a proposal that alters powers, memories or documentary unknowns cannot become a promotion plan', async () => {
  const f = await configuratorEvolutionFixture();
  try {
    const request = { source: f.source, context: f.context, proposal: f.proposal, approval: f.approval };
    const prepared = f.context.preparedCharacter; assert.ok(prepared);
    const proposal = { ...f.proposal, identity: prepared.identity.value };
    assert.throws(() => prepareIdentityPromotion({ ...request, proposal, approval: { ...f.approval, proposalHash: configuratorValueHash(proposal) } }), /IDENTITY_PROMOTION_NO_CHANGE/);
    for (const extra of [{ capabilities: ['shell'] }, { mind: { beliefs: [] } }, { identityVersion: 999 }, { unknowns: [] }, { evidenceIds: [] }])
      assert.throws(() => prepareIdentityPromotion({ ...request, proposal: { ...f.proposal, ...extra } }));
    const longReason = { ...f.proposal, reason: 'Motivo documentado. '.repeat(400).trim() };
    const longPlan = prepareIdentityPromotion({ ...request, proposal: longReason,
      approval: { ...f.approval, proposalHash: configuratorValueHash(longReason) } });
    assert.equal(longPlan.promotion.proposal.reason, longReason.reason, 'retain the whole approved reason instead of truncating it to fit preparation provenance');
  } finally { f.close(); }
});
