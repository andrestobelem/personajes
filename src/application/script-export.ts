import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { openJournal } from '../adapters/journal.ts';
import { canonicalJson, sha256CanonicalJson, sha256Utf8 } from '../domain/canonical-json.ts';
import { HashSchema, RunIdSchema } from '../domain/values.ts';
import { ScriptExportFilenameSchema, ScriptExportReceiptSchema, ScriptExportRequestSchema } from '../domain/script-export.ts';
import { ConfirmedEventViewSchema, ConversationViewSchema } from '../domain/run-observation.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { createRunObservationApplication } from './run-observation.ts';
import { createNarrationObservation } from './narration-observation.ts';
import { fountainCommunication, fountainDialogue, fountainLine } from './render-fountain.ts';

type Journal = Pick<ReturnType<typeof openJournal>, 'readRunConfigurationAtCommit' | 'readInspectorWorldCut' | 'readWorldLifecycle' | 'readWorldConfiguration' | 'loadWorld' | 'readObservationEvents' | 'readObservationDeliveries' | 'readObservationJobs' | 'readDirectorObservationHistory' | 'readDramaticStructureEvents' | 'readNarrationPublicationPage'>;
const IntentSchema = z.strictObject({ requestHash: HashSchema, capturedAt: z.number().int().nonnegative().safe() });
const StoredReceiptSchema = z.strictObject({ requestHash: HashSchema, receipt: ScriptExportReceiptSchema });
function code(error: unknown, value: string) { return error instanceof Error && 'code' in error && error.code === value; }
function root(path: string) { const resolved = resolve(path); if (realpathSync(resolved) !== resolved || !lstatSync(resolved).isDirectory() || lstatSync(resolved).isSymbolicLink()) throw new Error('SCRIPT_EXPORT_UNSAFE_DIRECTORY'); return resolved; }
function directory(parent: string, name: string, mode: number) {
  root(parent); const path = join(parent, name);
  try { mkdirSync(path, { mode }); } catch (error) { if (!code(error, 'EEXIST')) throw error; }
  return root(path);
}
function regular(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const before = fstatSync(fd); if (!before.isFile() || before.nlink !== 1) throw new Error('SCRIPT_EXPORT_UNSAFE_FILE');
    const bytes = readFileSync(fd); const after = fstatSync(fd);
    if (before.size !== bytes.byteLength || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('SCRIPT_EXPORT_FILE_CHANGED');
    return bytes;
  } finally { closeSync(fd); }
}
function optional(path: string): Buffer | undefined { try { return regular(path); } catch (error) { if (code(error, 'ENOENT')) return undefined; throw error; } }
function writeOnce(path: string, bytes: Buffer, mode: number) {
  const parent = root(resolve(path, '..')); const temp = join(parent, `.script-${randomUUID()}.tmp`);
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try { try { linkSync(temp, path); } catch (error) {
    if (!code(error, 'EEXIST') || !regular(path).equals(bytes)) throw new Error('SCRIPT_EXPORT_OUTPUT_CONFLICT');
  } } finally { unlinkSync(temp); }
}
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

/** Fixed-cut public transcript. All calls are synchronous journal reads, so no
 * runtime callback can interleave; retries also retain their narration cutoff. */
export function collectScript(input: { journal: Journal; runId: string; commitIndex: number; capturedAt: number }) {
  const runId = RunIdSchema.parse(input.runId);
  const cut = input.journal.readInspectorWorldCut({ runId, atCommitIndex: input.commitIndex });
  const configurationRead = input.journal.readRunConfigurationAtCommit({ runId, commitIndex: input.commitIndex });
  const state = input.journal.readWorldLifecycle({ runId });
  if (cut === undefined || configurationRead.kind !== 'found' || state === undefined) throw new Error('SCRIPT_EXPORT_CUT_UNAVAILABLE');
  const configuration = ReadyRunConfigurationSchema.parse(configurationRead.configuration);
  const observation = createRunObservationApplication({ journal: { ...input.journal, readWorldConfiguration: () => configuration,
    readWorldLifecycle: () => ({ ...state, worldRevision: cut.snapshot.revision, lastWorldSeq: cut.snapshot.seq }) } });
  const frames = new Map<number, ReturnType<typeof observation.readStage>>();
  const frame = (commitIndex: number) => { const prior = frames.get(commitIndex); if (prior !== undefined) return prior;
    const value = observation.readStage({ runId, atCommitIndex: commitIndex }); frames.set(commitIndex, value); return value; };
  const readAll = (surface: 'events' | 'conversations') => {
    const values = []; let cursor: string | undefined; const seen = new Set<string>();
    do {
      const request = { runId, fromWorldSeq: 0, toWorldSeq: cut.snapshot.seq, limit: 100, ...(cursor === undefined ? {} : { pageCursor: cursor }) };
      const page = surface === 'events' ? observation.readEvents(request) : observation.readConversations(request);
      if (page.kind !== 'found') throw new Error('SCRIPT_EXPORT_HISTORY_UNAVAILABLE');
      values.push(...page.value.items.filter(item => item.commitIndex <= input.commitIndex));
      const next = page.value.nextCursor; if (next !== null && seen.has(next)) throw new Error('SCRIPT_EXPORT_CURSOR_INVALID');
      if (next !== null) seen.add(next); cursor = next ?? undefined;
    } while (cursor !== undefined);
    return values;
  };
  const events = z.array(ConfirmedEventViewSchema).parse(readAll('events')); const conversations = z.array(ConversationViewSchema).parse(readAll('conversations'));
  const communication = new Map(conversations.map(item => [item.eventId, item]));
  type Line = { commitIndex: number; sequence: number; rank: number; sceneId: string | null; text: string };
  const lines: Line[] = [];
  const opening=frame(0);if(opening.kind==='found'&&opening.value.activeSceneId!==null)lines.push({commitIndex:0,sequence:opening.value.worldSeq,rank:0,sceneId:opening.value.activeSceneId,text:''});
  for (const event of events) {
    const published = communication.get(event.eventId);
    if ((event.eventType === 'communicated' || event.eventType === 'humanIntervention') && published === undefined) throw new Error('SCRIPT_EXPORT_COMMUNICATION_MISSING');
    const text = published !== undefined && published.kind === 'published-communication' ? fountainCommunication(published) : `!${fountainLine(event.summary)}\n`;
    lines.push({ commitIndex: event.commitIndex, sequence: event.worldSeq, rank: 1, sceneId: event.sceneId, text });
  }
  let after: number | null = null;
  do {
    const page = input.journal.readDramaticStructureEvents({ runId, afterStructureRevision: after, throughCommitIndex: input.commitIndex, limit: 1000 });
    if (page === undefined) throw new Error('SCRIPT_EXPORT_STRUCTURE_UNAVAILABLE');
    for (const event of page.events) {
      if (event.kind === 'episodeOpened' || event.kind === 'episodeClosed' || event.kind === 'sceneOpened' || event.kind === 'sceneClosed') lines.push({ commitIndex: event.commitIndex, sequence: event.worldSeq, rank: 0,
        sceneId:event.kind==='sceneOpened'?z.object({scene:z.object({id:z.string().uuid()})}).parse(event.payload).scene.id:null,
        text: `[[${({episodeOpened:'Apertura de episodio',episodeClosed:'Cierre de episodio',sceneOpened:'Apertura de escena',sceneClosed:'Cierre de escena'})[event.kind]}; commit ${event.commitIndex}; revisión estructural ${event.structureRevision}]]\n` });
    }
    if (!page.hasMore) break;
    const last = page.events.at(-1); if (last === undefined || after !== null && last.structureRevision <= after) throw new Error('SCRIPT_EXPORT_CURSOR_INVALID'); after = last.structureRevision;
  } while (true);
  const narration = createNarrationObservation({ journal: { readInspectorWorldCut: () => cut, readNarrationPublicationPage: input.journal.readNarrationPublicationPage } });
  let cursor: string | undefined; let narrationCount = 0; const seenNarration = new Set<string>();
  do {
    const page = narration.read({ runId, atWorldSeq: cut.snapshot.seq, worldRevision: cut.snapshot.revision, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (page.kind !== 'found') throw new Error('SCRIPT_EXPORT_NARRATION_UNAVAILABLE');
    for (const item of page.page.items) if (item.publishedAt <= input.capturedAt) {
      const source = input.journal.readInspectorWorldCut({ runId, atWorldSeq: item.sourceWorldSeq, worldRevision: item.sourceWorldRevision });
      if (source === undefined || source.commitIndex > input.commitIndex) throw new Error('SCRIPT_EXPORT_NARRATION_CUT_INVALID');
      lines.push({ commitIndex: source.commitIndex, sequence: item.sourceWorldSeq, rank: 2, sceneId: item.sceneId,
        text: fountainDialogue('NARRADOR (V.O.)', item.text) }); narrationCount++;
    }
    const next = page.page.nextCursor; if (next !== null && seenNarration.has(next)) throw new Error('SCRIPT_EXPORT_CURSOR_INVALID'); if (next !== null) seenNarration.add(next); cursor = next ?? undefined;
  } while (cursor !== undefined);
  lines.sort((a,b) => a.commitIndex - b.commitIndex || a.sequence - b.sequence || a.rank - b.rank);
  const chunks = [`Title: ${fountainLine(configuration.name)}\nSource: Registro público confirmado de Personajes\nDraft date: ${new Date(cut.snapshot.clock.instant).toISOString()}\n\n`,
    `[[Representación ${runId}; configuración ${configuration.configRevision}; configuración SHA-256 ${configurationRead.configurationHash}; commit ${input.commitIndex}; revisión ${cut.snapshot.revision}; secuencia ${cut.snapshot.seq}]]\n\n`,
    '[[Sólo acontecimientos y emisiones públicas confirmadas. Las palabras de un personaje no prueban sus afirmaciones ni acciones. Los vacíos no se completan. La fecha de portada es ficticia UTC. Las voces en off se agrupan por el corte de su fuente; su publicación puede ser posterior y no atribuye percepciones al elenco.]]\n\n'];
  let sceneKey: string | null = null;
  for (const line of lines) {
    if (line.sceneId !== null && line.sceneId !== sceneKey) {
      const stage = frame(line.commitIndex); if (stage.kind !== 'found') throw new Error('SCRIPT_EXPORT_STAGE_UNAVAILABLE');
      const scene = stage.value.scenes.find(item => item.id === line.sceneId);
      const label = scene?.label ?? 'ESCENA SIN ETIQUETA PÚBLICA EN ESTE CORTE';
      const places = stage.value.places.filter(place => scene?.placeIds.includes(place.id)).map(place => fountainLine(place.name)).join(' / ');
      chunks.push(`.${fountainLine(label).toLocaleUpperCase('es')}${places === '' ? '' : ` - ${places.toLocaleUpperCase('es')}`}\n\n`); sceneKey = line.sceneId;
    }
    chunks.push(line.text, '\n');
  }
  if (events.length === 0 && narrationCount === 0) chunks.push('[[No hay emisiones ni acciones públicas confirmadas en este corte.]]\n');
  return { text: chunks.join(''), configuration, cut, eventCount: events.length, communicationCount: conversations.length, narrationCount };
}

export function createScriptExportService(input: { journal: Journal; repositoryRoot: string; privateDataRoot: string }) {
  function paths() { const output = directory(directory(root(input.repositoryRoot), 'docs', 0o755), 'output', 0o755);
    const ledger = directory(root(input.privateDataRoot), 'script-exports', 0o700); return { output, intents: directory(ledger, 'operations', 0o700), artifacts: directory(ledger, 'artifacts', 0o700) }; }
  function verifiedArtifact(receipt: z.infer<typeof ScriptExportReceiptSchema>) { const { output } = paths(); const bytes = regular(join(output, receipt.filename)); if (bytes.byteLength !== receipt.bytes || digest(bytes) !== receipt.sha256) throw new Error('SCRIPT_EXPORT_OUTPUT_CHANGED'); return bytes; }
  return {
    export(raw: unknown, principalId: string) {
      const request = ScriptExportRequestSchema.parse(raw); const requestHash = sha256CanonicalJson({ request, principalId }); const { output, intents, artifacts } = paths();
      const operation = `${sha256Utf8(principalId)}-${request.idempotencyKey}`; const receiptPath = join(intents, `${operation}.receipt.json`);
      const priorBytes = optional(receiptPath);
      if (priorBytes !== undefined) { const prior = StoredReceiptSchema.parse(JSON.parse(priorBytes.toString('utf8'))); if (prior.requestHash !== requestHash) throw new Error('SCRIPT_EXPORT_IDEMPOTENCY_CONFLICT'); verifiedArtifact(prior.receipt); return prior.receipt; }
      const intentPath = join(intents, `${operation}.json`); const intentBytes = optional(intentPath);
      const intent = intentBytes === undefined ? { requestHash, capturedAt: Date.now() } : IntentSchema.parse(JSON.parse(intentBytes.toString('utf8')));
      if (intent.requestHash !== requestHash) throw new Error('SCRIPT_EXPORT_IDEMPOTENCY_CONFLICT');
      if (intentBytes === undefined) writeOnce(intentPath, Buffer.from(canonicalJson(intent)), 0o600);
      const script = collectScript({ journal: input.journal, runId: request.runId, commitIndex: request.commitIndex, capturedAt: intent.capturedAt });
      const bytes = Buffer.from(script.text, 'utf8'), sha256 = digest(bytes);
      const slug = script.configuration.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'representacion';
      const filename = ScriptExportFilenameSchema.parse(`${slug}-${request.runId}-c${request.commitIndex}-${sha256.slice(0,16)}.fountain`);
      const receipt = ScriptExportReceiptSchema.parse({ kind: 'script-export', runId: request.runId, commitIndex: request.commitIndex, worldRevision: script.cut.snapshot.revision, worldSeq: script.cut.snapshot.seq,
        configurationRevision: script.configuration.configRevision, format: 'fountain', filename, relativePath: `docs/output/${filename}`, sha256, bytes: bytes.byteLength,
        eventCount: script.eventCount, communicationCount: script.communicationCount, narrationCount: script.narrationCount });
      writeOnce(join(output, filename), bytes, 0o644); writeOnce(join(artifacts, `${filename}.json`), Buffer.from(canonicalJson(receipt)), 0o600);
      writeOnce(receiptPath, Buffer.from(canonicalJson({ requestHash, receipt })), 0o600); return receipt;
    },
    download(raw: unknown) {
      const request = z.strictObject({ runId: RunIdSchema, filename: ScriptExportFilenameSchema }).parse(raw); const { artifacts } = paths();
      const bytes = optional(join(artifacts, `${request.filename}.json`)); if (bytes === undefined) return undefined;
      const receipt = ScriptExportReceiptSchema.parse(JSON.parse(bytes.toString('utf8'))); if (receipt.runId !== request.runId || receipt.filename !== request.filename) return undefined;
      return { receipt, stream: Readable.from([verifiedArtifact(receipt)]) };
    },
  };
}
