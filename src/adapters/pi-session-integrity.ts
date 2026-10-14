import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { CharacterIdSchema, RunIdSchema } from '../domain/values.ts';

const RequestSchema = z.strictObject({
  privateDataRoot: z.string().min(1), runId: RunIdSchema, actorId: CharacterIdSchema,
  sessionId: z.string().min(1).max(200), sessionPath: z.string().min(1).max(2_000),
  baseLeafId: z.string().min(1).max(200).nullable(), inputLeafId: z.string().min(1).max(200), terminalLeafId: z.string().min(1).max(200),
});
const HeaderSchema = z.strictObject({ type: z.literal('session'), version: z.literal(CURRENT_SESSION_VERSION),
  id: z.string().min(1), timestamp: z.string().datetime({ offset: true }), cwd: z.string().min(1), parentSession: z.string().min(1).optional() });
const EntryBase = { id: z.string().min(1).max(200), parentId: z.string().min(1).max(200).nullable(), timestamp: z.string().datetime({ offset: true }) };
const ContentSchema = z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]);
const MessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: ContentSchema, timestamp: z.number().finite() }).passthrough(),
  z.object({ role: z.literal('assistant'), content: z.array(z.record(z.string(), z.unknown())), timestamp: z.number().finite(),
    api: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), usage: z.record(z.string(), z.unknown()),
    stopReason: z.enum(['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred']) }).passthrough(),
  z.object({ role: z.literal('toolResult'), content: z.array(z.record(z.string(), z.unknown())), timestamp: z.number().finite(),
    toolCallId: z.string().min(1), toolName: z.string().min(1), isError: z.boolean() }).passthrough(),
  z.object({ role: z.literal('system'), content: ContentSchema, timestamp: z.number().finite() }).passthrough(),
  z.object({ role: z.literal('custom'), content: ContentSchema, customType: z.string().min(1), display: z.boolean(), timestamp: z.number().finite() }).passthrough(),
  z.object({ role: z.literal('bashExecution'), command: z.string(), output: z.string(), cancelled: z.boolean(), truncated: z.boolean(), timestamp: z.number().finite() }).passthrough(),
  z.object({ role: z.literal('branchSummary'), summary: z.string(), fromId: z.string().nullable(), timestamp: z.number().finite() }).passthrough(),
  z.object({ role: z.literal('compactionSummary'), summary: z.string(), tokensBefore: z.number().finite(), timestamp: z.number().finite() }).passthrough(),
]);
const EntrySchema = z.discriminatedUnion('type', [
  z.strictObject({ ...EntryBase, type: z.literal('message'), message: MessageSchema }),
  z.strictObject({ ...EntryBase, type: z.literal('thinking_level_change'), thinkingLevel: z.string() }),
  z.strictObject({ ...EntryBase, type: z.literal('model_change'), provider: z.string(), modelId: z.string() }),
  z.strictObject({ ...EntryBase, type: z.literal('usage'), kind: z.string(), provider: z.string(), model: z.string(), usage: z.record(z.string(), z.unknown()), note: z.string().optional() }),
  z.strictObject({ ...EntryBase, type: z.literal('custom'), customType: z.string(), data: z.unknown().optional() }),
  z.strictObject({ ...EntryBase, type: z.literal('label'), targetId: z.string(), label: z.string().optional() }),
  z.strictObject({ ...EntryBase, type: z.literal('session_info'), name: z.string().optional() }),
  z.strictObject({ ...EntryBase, type: z.literal('custom_message'), customType: z.string(), content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]), details: z.unknown().optional(), display: z.boolean() }),
  z.strictObject({ ...EntryBase, type: z.literal('context_edit'), targetId: z.string(), replacement: z.strictObject({ content: z.unknown() }).nullable() }),
  z.strictObject({ ...EntryBase, type: z.literal('compaction'), summary: z.string(), firstKeptEntryId: z.string(), tokensBefore: z.number().finite(), details: z.unknown().optional(), usage: z.unknown().optional(), fromHook: z.boolean().optional(), systemMessage: z.unknown().optional() }),
  z.strictObject({ ...EntryBase, type: z.literal('branch_summary'), fromId: z.string(), summary: z.string(), details: z.unknown().optional(), usage: z.unknown().optional(), fromHook: z.boolean().optional() }),
]);

export type PiSessionIntegrityResult =
  | { kind: 'verified'; sessionPath: string; sessionId: string; terminalLeafId: string }
  | { kind: 'invalid'; code: 'session-path' | 'session-unavailable' | 'session-encoding' | 'session-jsonl' | 'session-header' | 'session-chain' };

/**
 * Read-only structural proof before recovering a turn. Never calls SessionManager.open,
 * OAuth or a model. Existing IDs/ancestry are checked; content tampering with valid IDs
 * is not detected without independently frozen byte hashes.
 */
export function verifyPiActorSessionIntegrity(rawInput: unknown): PiSessionIntegrityResult {
  const input = RequestSchema.parse(rawInput);
  if (!isAbsolute(input.privateDataRoot) || !isAbsolute(input.sessionPath)) return { kind: 'invalid', code: 'session-path' };
  let sessionPath: string;
  let expectedCwd: string;
  let bytes: Buffer;
  try {
    const root = realpathSync(input.privateDataRoot);
    const identityDir = join(root, 'runs', input.runId, 'actors', input.actorId);
    const sessionsDir = join(identityDir, 'sessions');
    expectedCwd = join(identityDir, 'cwd');
    if (realpathSync(sessionsDir) !== resolve(sessionsDir) || realpathSync(expectedCwd) !== resolve(expectedCwd)) return { kind: 'invalid', code: 'session-path' };
    sessionPath = realpathSync(input.sessionPath);
    if (!isInside(sessionsDir, sessionPath) || !statSync(sessionPath).isFile()) return { kind: 'invalid', code: 'session-path' };
    bytes = readFileSync(sessionPath);
  } catch { return { kind: 'invalid', code: 'session-unavailable' }; }
  if (bytes.length === 0) return { kind: 'invalid', code: 'session-jsonl' };
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return { kind: 'invalid', code: 'session-encoding' }; }
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < 2 || lines.some((line) => line.trim() === '')) return { kind: 'invalid', code: 'session-jsonl' };
  const rawEntries: unknown[] = [];
  try { for (const line of lines) rawEntries.push(JSON.parse(line)); }
  catch { return { kind: 'invalid', code: 'session-jsonl' }; }
  const header = HeaderSchema.safeParse(rawEntries[0]);
  if (!header.success || header.data.id !== input.sessionId || header.data.cwd !== expectedCwd) return { kind: 'invalid', code: 'session-header' };
  const entries = z.array(EntrySchema).safeParse(rawEntries.slice(1));
  if (!entries.success) return { kind: 'invalid', code: 'session-jsonl' };
  const byId = new Map<string, z.infer<typeof EntrySchema>>();
  for (const entry of entries.data) {
    if (byId.has(entry.id) || entry.id === header.data.id) return { kind: 'invalid', code: 'session-chain' };
    byId.set(entry.id, entry);
  }
  // Validate all branches, including unaccepted tails, without silently discarding broken lines.
  const verifiedEntries = new Set<string>();
  for (const entry of entries.data) {
    const seen = new Set<string>();
    let cursor: string | null = entry.id;
    while (cursor !== null && !verifiedEntries.has(cursor)) {
      if (seen.has(cursor)) return { kind: 'invalid', code: 'session-chain' };
      seen.add(cursor);
      const node = byId.get(cursor);
      if (node === undefined) return { kind: 'invalid', code: 'session-chain' };
      cursor = node.parentId;
    }
    for (const id of seen) verifiedEntries.add(id);
  }
  const inputEntry = byId.get(input.inputLeafId);
  const terminalEntry = byId.get(input.terminalLeafId);
  if (inputEntry === undefined || terminalEntry === undefined || inputEntry.type !== 'message'
    || terminalEntry.type !== 'message' || terminalEntry.message.role !== 'assistant'
    || !['stop', 'length'].includes(terminalEntry.message.stopReason)
    || (input.baseLeafId !== null && !byId.has(input.baseLeafId))) return { kind: 'invalid', code: 'session-chain' };
  const terminalAncestors = ancestry(input.terminalLeafId, byId);
  const inputAncestors = ancestry(input.inputLeafId, byId);
  if (input.terminalLeafId === input.inputLeafId || !terminalAncestors.has(input.inputLeafId)
    || (input.baseLeafId !== null && (input.baseLeafId === input.inputLeafId || !inputAncestors.has(input.baseLeafId)))) return { kind: 'invalid', code: 'session-chain' };
  return { kind: 'verified', sessionPath, sessionId: input.sessionId, terminalLeafId: input.terminalLeafId };
}

function ancestry(leaf: string, entries: ReadonlyMap<string, z.infer<typeof EntrySchema>>): Set<string> {
  const result = new Set<string>();
  let cursor: string | null = leaf;
  while (cursor !== null) { result.add(cursor); cursor = entries.get(cursor)?.parentId ?? null; }
  return result;
}
function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
