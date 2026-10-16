import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setup, actorId } from './fixtures/continuista.ts';
import { createIcmWorkspaceSnapshot, hashIcmMarkdown } from '../src/domain/icm-workspace.ts';
import { hashContinuistaValue } from '../src/domain/continuista-review.ts';
import { ReadyRunConfigurationSchema } from '../src/application/production-preflight.ts';
import { prepareForkState } from '../src/application/prepare-fork-state.ts';
import { prepareForkConfiguration } from '../src/application/fork-configuration.ts';

test('fork derives new identity fences while preserving frozen ICM bytes and explicit legacy absence', async () => {
  const base = await setup();
  try {
    const snapshot = createIcmWorkspaceSnapshot({ sources: [
      { sourceId: 'synthetic.actor', audience: { role: 'actor', actorId } },
      { sourceId: 'synthetic.continuista', audience: { role: 'continuista' } },
      { sourceId: 'synthetic.director', audience: { role: 'director' } },
      { sourceId: 'synthetic.configurator', audience: { role: 'configurator' } },
    ].map(source => ({ ...source, revision: 0, sourceHash: hashIcmMarkdown('Fuente sintética congelada.'),
      sections: [{ sectionId: 'process', markdown: 'Contrato congelado sin filesystem.\r\n' }] })) });
    for (const icmWorkspace of [undefined, snapshot]) {
      const sourceConfiguration = ReadyRunConfigurationSchema.parse({ ...base.configuration,
        ...(icmWorkspace === undefined ? {} : { icmWorkspace }) });
      const world = sourceConfiguration.worldSnapshot;
      const cuts = world.entities.flatMap(entity => {
        if (entity.kind !== 'character') return [];
        const read = base.journal.readActorStateCut({ runId: world.runId, actorId: entity.characterId,
          commitIndex: 0, worldRevision: world.revision, worldSeq: world.seq });
        if (read.kind !== 'found') assert.fail('Missing source checkpoint');
        return [{ ...read.cut, source: { ...read.cut.source, configurationHash: hashContinuistaValue(sourceConfiguration) } }];
      });
      const state = prepareForkState({ snapshot: world, configuration: sourceConfiguration, cuts, targetRunId: randomUUID() });
      const fork = prepareForkConfiguration({ sourceConfiguration, state, name: 'Fork ICM sintético',
        principalId: 'test-operator', recordedAt: '2026-10-15T12:00:00Z', operationId: randomUUID() });
      assert.notEqual(fork.configuration.runId, sourceConfiguration.runId);
      assert.deepEqual(fork.configuration.icmWorkspace, sourceConfiguration.icmWorkspace);
      assert.equal(JSON.stringify(fork.configuration.icmWorkspace), JSON.stringify(icmWorkspace));
      assert.equal(Object.hasOwn(fork.configuration, 'icmWorkspace'), icmWorkspace !== undefined);
      const oldPrepared = sourceConfiguration.roster.preparedCharacters.find(actor => actor.characterId === actorId);
      const newPrepared = fork.configuration.roster.preparedCharacters.find(actor => actor.characterId === actorId);
      assert.ok(oldPrepared); assert.ok(newPrepared);
      assert.notEqual(hashContinuistaValue(oldPrepared), hashContinuistaValue(newPrepared));
    }
  } finally { base.close(); }
});
