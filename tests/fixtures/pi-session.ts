import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { PiRuntime } from '../../src/adapters/pi.ts';

/** Synthetic SDK-written session frames for boundary tests; never a claimed model inference. */
export function createSyntheticActorSession(input: { runtime: PiRuntime; runId: string; actorId: string }) {
  const root = join(input.runtime.privateDataRoot, 'runs', input.runId, 'actors', input.actorId);
  const cwd = join(root, 'cwd');
  const sessionDir = join(root, 'sessions');
  mkdirSync(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, sessionDir);
  const sessionPath = manager.getSessionFile();
  if (sessionPath === undefined) throw new Error('Fixture SDK sin archivo de sesión');
  return {
    snapshot: { sessionId: manager.getSessionId(), sessionPath, candidateLeafId: null },
    appendInput(text: string) { return manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() }); },
    appendTerminal() { return manager.appendMessage({ role: 'assistant', content: [], api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6-luna',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now() }); },
  };
}
