import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyRunConfigurationDraft, RunConfigurationDraftSchema } from '../src/domain/production.ts';
import { createProductionPreflightPort, ReadyRunConfigurationSchema, validateRunConfiguration } from '../src/application/production-preflight.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { actorId, draftFixture } from './fixtures/continuista.ts';
import {
  createIcmWorkspaceSnapshot, hashIcmMarkdown, type IcmWorkspaceAudience,
} from '../src/domain/icm-workspace.ts';
import { CharacterIdSchema, RevisionSchema, SourceRefIdSchema } from '../src/domain/values.ts';

test('legacy Draft/Ready conserva ausencia de ICM y hash, sin defaults ni backfill', () => {
  const draft = draftFixture();
  const originalDraftHash = hashContinuistaValue(draft);
  const parsedDraft = RunConfigurationDraftSchema.parse(draft);
  assert.equal(Object.hasOwn(parsedDraft, 'icmWorkspace'), false);
  assert.equal(hashContinuistaValue(parsedDraft), originalDraftHash);
  const result = validateRunConfiguration({ draft });
  if (result.kind !== 'ready') assert.fail('Fixture legacy debe quedar Ready');
  const original = result.configuration;
  assert.equal(Object.hasOwn(original, 'icmWorkspace'), false);
  const parsedReady = ReadyRunConfigurationSchema.parse(original);
  assert.deepEqual(parsedReady, original);
  assert.equal(hashContinuistaValue(parsedReady), hashContinuistaValue(original));
  const empty = createEmptyRunConfigurationDraft({runId: draft.runId, revision: 0});
  assert.equal(Object.hasOwn(empty, 'icmWorkspace'), false, 'el constructor no admite un workspace implícito');
});

test('una selección ICM presente pero vacía deja la puesta incompleta', () => {
  const result = validateRunConfiguration({ draft: { ...draftFixture(), icmWorkspace: {kind: 'empty'} } });
  if (result.kind !== 'incomplete') assert.fail('La selección vacía no puede promover');
  assert.ok(result.issues.some(issue => issue.field === 'icmWorkspace' && issue.code === 'draft-field-empty'));
});

// Synthetic source IDs are only configuration fixtures, not admitted manifest sources.
function snapshotFixture(audiences: IcmWorkspaceAudience[] = [
  {role: 'actor', actorId}, {role: 'continuista'}, {role: 'director'}, {role: 'configurator'},
]) {
  return createIcmWorkspaceSnapshot({sources: audiences.map(audience => ({
    sourceId: SourceRefIdSchema.parse(`synthetic.${audience.role}`), audience,
    revision: RevisionSchema.parse(0), sourceHash: hashIcmMarkdown('Contrato sintético explícito.\n'),
    sections: [{sectionId: 'process', markdown: 'Contrato sintético explícito.\n'}],
  }))});
}

function configuredWorkspace(snapshot = snapshotFixture()) {
  return RunConfigurationDraftSchema.shape.icmWorkspace.unwrap().parse({
    kind: 'configured', value: snapshot,
    evidence: {kind: 'operator-choice', operatorId: 'fixture-operator', recordedAt: '2026-10-15T12:00:00Z'},
  });
}

test('preflight cannot silently ignore selected Markdown before worker delivery is connected', async () => {
  const validated = validateRunConfiguration({ draft: { ...draftFixture(), icmWorkspace: configuredWorkspace() } });
  if (validated.kind !== 'ready') assert.fail('Expected configured fixture');
  let hostReads = 0;
  const fail = async () => { hostReads += 1; throw new Error('No host read required for unavailable integration'); };
  const preflight = createProductionPreflightPort({ host: {
    readCurrentConfigurationRevision: fail, loadCurrentWorldSnapshot: fail, loadPreparedActorContexts: fail,
    readCatalogEligibility: fail, readPiSdkStatus: fail, readPiModelProfile: fail,
    readInferenceAuthenticationStatus: fail, readInferenceAccessCheckReceipt: fail,
    readPiRuntimeReadiness: fail, readIcmMemoryReadiness: fail, readRunBudgetReadiness: fail, readVoiceReadiness: fail,
  } });
  const report = await preflight.preflight({ configuration: validated.configuration, observedAt: '2026-10-15T12:00:00Z' });
  assert.equal(report.kind, 'blocked');
  assert.ok(report.checks.some(check => check.kind === 'unavailable' && check.code === 'icm-context-runtime-not-connected'));
  assert.equal(hostReads, 0);
});

test('Ready conserva snapshot configurado exacto con fuentes, orden, bytes y hashes', () => {
  const snapshot = snapshotFixture();
  const result = validateRunConfiguration({draft: {...draftFixture(), icmWorkspace: configuredWorkspace(snapshot)}});
  if (result.kind !== 'ready') assert.fail(JSON.stringify(result));
  assert.deepEqual(result.configuration.icmWorkspace, snapshot);
  assert.equal(hashContinuistaValue(result.configuration.icmWorkspace), hashContinuistaValue(snapshot));
});

test('la propuesta ICM requiere confirmación antes de Ready', () => {
  const result = validateRunConfiguration({draft: {...draftFixture(), icmWorkspace: {
    kind: 'proposed', proposalId: '00000000-0000-4000-8000-000000000160', value: snapshotFixture(), source: 'editorial',
  }}});
  if (result.kind !== 'incomplete') assert.fail(JSON.stringify(result));
  assert.ok(result.issues.some(issue => issue.field === 'icmWorkspace' && issue.code === 'proposal-not-confirmed'));
});

test('Ready rechaza contrato de actor ajeno y audiencias requeridas ausentes', () => {
  const base = validateRunConfiguration({draft: draftFixture()});
  if (base.kind !== 'ready') assert.fail('Fixture legacy debe quedar Ready');
  const foreign = snapshotFixture([
    {role: 'actor', actorId}, {role: 'actor', actorId: CharacterIdSchema.parse('otro-personaje')},
    {role: 'continuista'}, {role: 'director'}, {role: 'configurator'},
  ]);
  const foreignResult = ReadyRunConfigurationSchema.safeParse({...base.configuration, icmWorkspace: foreign});
  assert.equal(foreignResult.success, false);
  if (!foreignResult.success) assert.ok(foreignResult.error.issues.some(issue => issue.message.includes('ajeno')));
  for (const excluded of ['actor', 'continuista', 'director', 'configurator']) {
    const snapshot = snapshotFixture(snapshotFixture().sources.map(source => source.audience).filter(audience => audience.role !== excluded));
    const result = validateRunConfiguration({draft: {...draftFixture(), icmWorkspace: configuredWorkspace(snapshot)}});
    if (result.kind !== 'invalid') assert.fail(`Debe faltar ${excluded}: ${JSON.stringify(result)}`);
    assert.ok(result.issues.some(issue => issue.field.startsWith('icmWorkspace') && issue.detail.includes('audiencia requerida')));
  }
});

test('Narrador habilitado requiere contratos de narrador y revisor aunque audio esté desactivado', () => {
  const draft = draftFixture();
  const narrationMode = {...draft.narrationMode, value: {kind: 'enabled'}};
  const missing = validateRunConfiguration({draft: {...draft, narrationMode, icmWorkspace: configuredWorkspace()}});
  if (missing.kind !== 'invalid') assert.fail(JSON.stringify(missing));
  assert.ok(missing.issues.some(issue => issue.detail.includes('narrator')));
  assert.ok(missing.issues.some(issue => issue.detail.includes('narration-reviewer')));
  const snapshot = snapshotFixture([
    {role: 'actor', actorId}, {role: 'continuista'}, {role: 'director'}, {role: 'configurator'},
    {role: 'narrator'}, {role: 'narration-reviewer'},
  ]);
  assert.equal(validateRunConfiguration({draft: {...draft, narrationMode, icmWorkspace: configuredWorkspace(snapshot)}}).kind, 'ready');
});
