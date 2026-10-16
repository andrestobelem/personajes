import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  IcmContextPacketInputSchema, IcmContextPacketScopeSchema, IcmContextPacketSchema,
  IcmWorkspaceAudienceSchema, IcmWorkspaceSnapshotSchema, IcmWorkspaceSourceSelectionSchema,
  createIcmContextPacket, createIcmWorkspaceSnapshot, hashIcmMarkdown,
  verifyIcmContextPacket, verifyIcmContextPacketAgainstSnapshot, verifyIcmWorkspaceSnapshot,
} from '../src/domain/icm-workspace.ts';
import { IcmWorkspaceSnapshotStructureSchema } from '../src/domain/icm-workspace-schema.ts';
import { canonicalJson, sha256CanonicalJson } from '../src/domain/canonical-json.ts';

function actorScope(actorId = 'maxwell-smart') {
  return IcmContextPacketScopeSchema.parse({
    runId: randomUUID(), configurationRevision: 4, jobId: randomUUID(), generation: 1,
    audience: { role: 'actor', actorId },
    cut: { kind: 'world-cut', commitIndex: 5, worldRevision: 3, worldSeq: 9 },
  });
}

function actorWorkspace(scope = actorScope()) {
  return createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'stage.actuation', audience: scope.audience, revision: 0, sourceHash: hashIcmMarkdown('complete stage source'),
      sections: [{ sectionId: 'process', markdown: 'Conservá exactamente este texto.\r\n' }, { sectionId: 'cierre', markdown: 'No inventes resultados.\n' }] },
    { sourceId: 'actor.maxwell-smart.context', audience: scope.audience, revision: 0, sourceHash: hashIcmMarkdown('complete actor source'),
      sections: [{ sectionId: 'process', markdown: 'Actuá desde tu punto de vista.\n' }] },
    { sourceId: 'actor.hymie.context', audience: { role: 'actor', actorId: 'hymie' }, revision: 0,
      sourceHash: hashIcmMarkdown('other actor source'), sections: [{ sectionId: 'process', markdown: 'PRIVATE_HYMIE_FACT' }] },
    { sourceId: 'role.director', audience: { role: 'director' }, revision: 0,
      sourceHash: hashIcmMarkdown('director source'), sections: [{ sectionId: 'process', markdown: 'PRIVATE_DIRECTOR_FACT' }] },
  ] });
}

function actorPacketInput(scope = actorScope(), workspace = actorWorkspace(scope)) {
  if (scope.audience.role !== 'actor') throw new Error('Fixture requires actor scope');
  const actorId = scope.audience.actorId;
  const sources = workspace.sources.filter((source) => source.audience.role === 'actor'
    && source.audience.actorId === actorId);
  return {
    scope,
    workspaceSnapshotHash: workspace.snapshotHash,
    compilerVersion: 'icm-markdown-test-v1',
    sourceRefs: sources.map((source) => ({ sourceId: source.sourceId, audience: source.audience,
      revision: source.revision, sourceHash: source.sourceHash,
      sections: source.sections.map(({ sectionId, sectionHash }) => ({ sectionId, sectionHash })) })),
    hostPolicyMarkdown: 'El host controla las herramientas y la autoridad.',
    roleContractMarkdown: sources.flatMap((source) => source.sections.map((section) => section.markdown)).join('\n'),
    diegeticContextMarkdown: 'La escena comienza en el pasillo.',
    preparedContextHash: hashIcmMarkdown('prepared max'),
  };
}

test('canonical JSON is stable across object insertion order and Markdown hashes preserve exact UTF-8 text', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, b: null } }), canonicalJson({ a: { b: null, y: true }, z: 1 }));
  assert.equal(sha256CanonicalJson({ z: 1, a: 2 }), sha256CanonicalJson({ a: 2, z: 1 }));
  assert.notEqual(hashIcmMarkdown('línea\n'), hashIcmMarkdown('línea\r\n'));
  assert.throws(() => canonicalJson(undefined), /serializable/i);
});

test('workspace snapshots preserve exact selected Markdown and verify section and aggregate hashes', () => {
  const snapshot = actorWorkspace();
  const verified = verifyIcmWorkspaceSnapshot(snapshot);
  assert.deepEqual(verified, snapshot);
  assert.equal(verified.sources[0]?.sections[0]?.markdown, 'Conservá exactamente este texto.\r\n');
  assert.equal(verified.sources[0]?.sections[0]?.sectionHash, hashIcmMarkdown('Conservá exactamente este texto.\r\n'));
  assert.throws(() => IcmWorkspaceSnapshotSchema.parse({
    ...snapshot,
    sources: snapshot.sources.map((source, index) => index === 0 ? {
      ...source, sections: source.sections.map((section, sectionIndex) => sectionIndex === 0
        ? { ...section, markdown: 'Texto cambiado' } : section),
    } : source),
  }));
  assert.throws(() => IcmWorkspaceSnapshotSchema.parse({ ...snapshot, snapshotHash: hashIcmMarkdown('wrong aggregate') }));
});

test('browser-safe snapshot parsing is structural; host verification rejects forged nested hashes', () => {
  const snapshot = actorWorkspace();
  const changed = {
    ...snapshot,
    sources: snapshot.sources.map((source, sourceIndex) => sourceIndex === 0 ? {
      ...source,
      sections: source.sections.map((section, sectionIndex) => sectionIndex === 0
        ? { ...section, sectionHash: hashIcmMarkdown('forged section bytes') } : section),
    } : source),
  };
  const { snapshotHash: _snapshotHash, ...body } = changed;
  void _snapshotHash;
  const selfConsistentOuterHash = { ...changed, snapshotHash: sha256CanonicalJson(body) };
  assert.equal(IcmWorkspaceSnapshotStructureSchema.safeParse(selfConsistentOuterHash).success, true);
  assert.throws(() => verifyIcmWorkspaceSnapshot(selfConsistentOuterHash));
});

test('source selections and frozen snapshots reject paths, duplicate sections and duplicate source audiences', () => {
  const actor = actorScope().audience;
  const sourceHash = hashIcmMarkdown('source');
  const valid = { sourceId: 'stage.actuation', audience: actor, revision: 0, sourceHash, sectionIds: ['process', 'cierre'] };
  assert.deepEqual(IcmWorkspaceSourceSelectionSchema.parse(valid).sectionIds, ['process', 'cierre']);
  assert.equal(IcmWorkspaceSourceSelectionSchema.safeParse({ ...valid, path: 'obra/stages/02-actuacion/CONTEXT.md' }).success, false);
  assert.equal(IcmWorkspaceSourceSelectionSchema.safeParse({ ...valid, sectionIds: ['process', 'process'] }).success, false);
  assert.equal(IcmWorkspaceAudienceSchema.safeParse({ role: 'actor' }).success, false);
  assert.equal(IcmWorkspaceAudienceSchema.safeParse({ role: 'director', actorId: 'maxwell-smart' }).success, false);

  assert.throws(() => createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'stage.actuation', audience: actor, revision: 0, sourceHash, sections: [{ sectionId: 'process', markdown: 'Uno' }] },
    { sourceId: 'stage.actuation', audience: actor, revision: 0, sourceHash, sections: [{ sectionId: 'cierre', markdown: 'Dos' }] },
  ] }));
  assert.throws(() => createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'stage.actuation', audience: actor, revision: 0, sourceHash, sections: [
      { sectionId: 'process', markdown: 'Uno' }, { sectionId: 'process', markdown: 'Dos' },
    ] },
  ] }));
  const sameSourceOtherActor = createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'stage.actuation', audience: actor, revision: 0, sourceHash, sections: [{ sectionId: 'process', markdown: 'Max' }] },
    { sourceId: 'stage.actuation', audience: { role: 'actor', actorId: 'hymie' }, revision: 0,
      sourceHash, sections: [{ sectionId: 'process', markdown: 'Hymie' }] },
  ] });
  assert.equal(sameSourceOtherActor.sources.length, 2);
});

test('context packets require exact role audience, cut kind, actor identity fence and valid hashes', () => {
  const scope = actorScope();
  const workspace = actorWorkspace(scope);
  const input = actorPacketInput(scope, workspace);
  assert.equal(IcmContextPacketInputSchema.safeParse(input).success, true);
  const packet = createIcmContextPacket(input);
  assert.deepEqual(verifyIcmContextPacket(packet), packet);
  assert.equal(IcmContextPacketSchema.safeParse({ ...packet, roleContractMarkdown: 'altered' }).success, false);
  assert.equal(verifyIcmContextPacketAgainstSnapshot(packet, workspace).packetHash, packet.packetHash);

  assert.throws(() => createIcmContextPacket({ ...input,
    sourceRefs: input.sourceRefs.map((source) => ({ ...source, audience: { role: 'actor', actorId: 'hymie' } })),
  }));
  assert.throws(() => createIcmContextPacket({ ...input, preparedContextHash: undefined }));
  assert.throws(() => IcmContextPacketScopeSchema.parse({ ...scope, actorId: 'maxwell-smart' }));
  assert.throws(() => verifyIcmContextPacketAgainstSnapshot(packet, actorWorkspace(actorScope('hymie'))));

  const adminScope = IcmContextPacketScopeSchema.parse({
    runId: randomUUID(), configurationRevision: 0, jobId: randomUUID(), generation: 0,
    audience: { role: 'configurator' }, cut: { kind: 'preparation-cut', draftRevision: 2, draftHash: hashIcmMarkdown('draft') },
  });
  const adminInput = {
    scope: adminScope, workspaceSnapshotHash: hashIcmMarkdown('snapshot'), compilerVersion: 'test-v1',
    sourceRefs: [{ sourceId: 'role.configurator', audience: adminScope.audience, revision: 0,
      sourceHash: hashIcmMarkdown('configurator'), sections: [{ sectionId: 'process', sectionHash: hashIcmMarkdown('Do setup') }] }],
    hostPolicyMarkdown: 'Host policy.', roleContractMarkdown: 'Setup contract.', diegeticContextMarkdown: '',
  };
  const adminPacket = createIcmContextPacket(adminInput);
  assert.equal(adminPacket.scope.audience.role, 'configurator');
  assert.equal('preparedContextHash' in adminPacket, false);
  assert.throws(() => createIcmContextPacket({ ...adminInput, preparedContextHash: hashIcmMarkdown('actor') }));
  assert.throws(() => IcmContextPacketSchema.parse({ ...adminPacket, packetHash: hashIcmMarkdown('forged') }));
});
