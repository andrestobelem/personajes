import type { openJournal } from '../adapters/journal.ts';
import { renderIcmContextPacket } from './icm-context-compiler.ts';

type Journal = Pick<ReturnType<typeof openJournal>,
  'readIcmContextBinding' | 'readIcmContextPacket' | 'ensureIcmContextPacket'>;

/** Private host composition only. The journal derives identity, cut and workspace
 * from the execution lease; none of these strings grants model capabilities. */
export function resolveIcmSessionContext(input: {
  journal: Journal;
  binding: unknown;
  hostPolicyMarkdown: string;
  diegeticContextMarkdown: string;
  legacySystemPrompt: string;
  legacyPromptText: string;
  icmPromptText: string;
  expectedPreparedContextHash?: string;
}) {
  const authority = input.journal.readIcmContextBinding(input.binding);
  if (authority.kind === 'legacy-without-icm') {
    return { kind: 'legacy-without-icm' as const, systemPrompt: input.legacySystemPrompt, promptText: input.legacyPromptText };
  }
  if (input.expectedPreparedContextHash !== undefined && authority.preparedContextHash !== input.expectedPreparedContextHash) {
    throw new Error('ICM_CONTEXT_PREPARATION_MISMATCH');
  }
  // Reclaim/replay uses the existing packet before considering newly compiled
  // context. It cannot pick up a changed compiler, contract or live source file.
  const receipt = input.journal.readIcmContextPacket(input.binding)
    ?? input.journal.ensureIcmContextPacket({ binding: input.binding,
      hostPolicyMarkdown: input.hostPolicyMarkdown, diegeticContextMarkdown: input.diegeticContextMarkdown });
  const systemPrompt = renderIcmContextPacket({ packet: receipt.packet, expectedPacketHash: receipt.packetHash,
    scope: authority.scope, workspace: authority.workspace,
    ...(authority.preparedContextHash === undefined ? {} : { expectedPreparedContextHash: authority.preparedContextHash }),
  });
  return { kind: 'icm-context' as const, systemPrompt, promptText: input.icmPromptText, packetHash: receipt.packetHash };
}
