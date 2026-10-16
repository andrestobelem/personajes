import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIcmContextPacket, createIcmWorkspaceSnapshot, IcmContextPacketScopeSchema, type IcmContextPacket } from '../src/domain/icm-workspace.ts';
import { compileIcmContextPacket, renderIcmContextPacket } from '../src/application/icm-context-compiler.ts';

function packetInput(packet: IcmContextPacket) {
  const { kind, schemaVersion, packetHash, ...body } = packet;
  void kind; void schemaVersion; void packetHash;
  return body;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const scope = IcmContextPacketScopeSchema.parse({
    runId: randomUUID(), configurationRevision: 2, jobId: randomUUID(), generation: 0,
    audience: { role: 'actor', actorId: 'maxwell-smart' },
    cut: { kind: 'world-cut', commitIndex: 3, worldRevision: 2, worldSeq: 1 },
  });
  const workspace = createIcmWorkspaceSnapshot({ sources: [
    { sourceId: 'stage.actuation', audience: scope.audience, revision: 0, sourceHash: hash('source stage'),
      sections: [{ sectionId: 'process', markdown: 'Elegir una táctica propia.\n' }] },
    { sourceId: 'actor.maxwell-smart.context', audience: scope.audience, revision: 0, sourceHash: hash('source max'),
      sections: [{ sectionId: 'cierre', markdown: 'No inventar resultados.\r\n' }] },
    { sourceId: 'actor.hymie.context', audience: { role: 'actor', actorId: 'hymie' }, revision: 0, sourceHash: hash('source hymie'),
      sections: [{ sectionId: 'process', markdown: 'SECRETO_OTRO_ACTOR' }] },
    { sourceId: 'role.director', audience: { role: 'director' }, revision: 0, sourceHash: hash('source director'),
      sections: [{ sectionId: 'process', markdown: 'PLAN_PRIVADO_DIRECTOR' }] },
  ] });
  const packet = compileIcmContextPacket({ workspace, scope, hostPolicyMarkdown: 'Usar sólo tools admitidas.',
    diegeticContextMarkdown: '{"selfReference":"Max","observations":[]}', preparedContextHash: hash('prepared max') });
  return { scope, workspace, packet, expectedPacketHash: packet.packetHash, expectedPreparedContextHash: hash('prepared max') };
}

test('compiler delivers selected Markdown with exact sections and isolates actor and role', () => {
  const f = fixture();
  assert.ok(f.packet.roleContractMarkdown.includes('Elegir una táctica propia.\n'));
  assert.ok(f.packet.roleContractMarkdown.includes('No inventar resultados.\r\n'));
  assert.equal(f.packet.sourceRefs.length, 2);
  const rendered = renderIcmContextPacket(f);
  assert.ok(rendered.indexOf('Política del host') < rendered.indexOf('Contrato procedural'));
  assert.ok(rendered.includes(JSON.stringify(f.packet.roleContractMarkdown)));
  assert.equal(rendered.includes('SECRETO_OTRO_ACTOR'), false);
  assert.equal(rendered.includes('PLAN_PRIVADO_DIRECTOR'), false);
  assert.equal('tools' in f.packet, false);
  assert.equal(renderIcmContextPacket(f), rendered);
});

test('recovery rejects a self-consistent packet rebound to another job, actor, generation, cut or snapshot', () => {
  const f = fixture();
  for (const scope of [
    { ...f.scope, jobId: randomUUID() },
    { ...f.scope, generation: 1 },
    { ...f.scope, configurationRevision: 3 },
    { ...f.scope, cut: { kind: 'world-cut', commitIndex: 4, worldRevision: 3, worldSeq: 2 } },
    { ...f.scope, audience: { role: 'actor', actorId: 'hymie' } },
  ]) assert.throws(() => renderIcmContextPacket({ ...f, scope: IcmContextPacketScopeSchema.parse(scope) }));
  const foreign = createIcmContextPacket({ ...packetInput(f.packet), roleContractMarkdown: 'Contrato adulterado pero rehasheado' });
  assert.throws(() => renderIcmContextPacket({ ...f, packet: foreign }), /RECEIPT|BINDING/);
  assert.throws(() => renderIcmContextPacket({ ...f, packet: { ...f.packet, diegeticContextMarkdown: 'Cambio sin rehash' } }));
  for (const changed of [{ hostPolicyMarkdown: 'Host falso.' }, { diegeticContextMarkdown: 'Observación inventada.' }, { preparedContextHash: hash('foreign preparation') }]) {
    const rebound = createIcmContextPacket({ ...packetInput(f.packet), ...changed });
    assert.throws(() => renderIcmContextPacket({ ...f, packet: rebound }), /RECEIPT/);
  }
  assert.throws(() => renderIcmContextPacket({ ...f, expectedPreparedContextHash: hash('foreign preparation') }), /PREPARATION/);
  const unsupported = createIcmContextPacket({ ...packetInput(f.packet), compilerVersion: 'compiler-futuro' });
  assert.throws(() => renderIcmContextPacket({ ...f, packet: unsupported, expectedPacketHash: unsupported.packetHash }), /UNSUPPORTED/);
});

test('all administrative roles use only their own contract and forbid an actor identity fence', () => {
  for (const role of ['continuista', 'director', 'configurator', 'narrator', 'narration-reviewer']) {
    const audience = { role };
    const workspace = createIcmWorkspaceSnapshot({ sources: [{
      sourceId: `role.${role}`, audience, revision: 0, sourceHash: hash(role),
      sections: [{ sectionId: 'process', markdown: `Contrato ${role}` }],
    }] });
    const scope = IcmContextPacketScopeSchema.parse({ runId: randomUUID(), configurationRevision: 0,
      jobId: randomUUID(), generation: 0, audience,
      cut: { kind: 'preparation-cut', draftRevision: 0, draftHash: hash('draft') } });
    const packet = compileIcmContextPacket({ workspace, scope, hostPolicyMarkdown: 'Política fija.', diegeticContextMarkdown: 'Datos curados.' });
    assert.ok(renderIcmContextPacket({ packet, scope, workspace, expectedPacketHash: packet.packetHash }).includes(`Contrato ${role}`));
    assert.throws(() => compileIcmContextPacket({ workspace, scope, hostPolicyMarkdown: 'Política fija.',
      diegeticContextMarkdown: 'Datos curados.', preparedContextHash: hash('foreign actor') }));
  }
});
