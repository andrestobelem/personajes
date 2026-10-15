import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { configuratorValueHash } from '../application/configurator-context.ts';
import { canonicalDirectorValue } from '../application/director-context.ts';
const RowSchema = z.strictObject({ principal_id: z.string(), idempotency_key: z.uuid(), kind: z.string(),
  request_json: z.string(), request_hash: z.string(), result_json: z.string().nullable(),
  result_hash: z.string().nullable(), record_hash: z.string() });

/** Private operator receipts outlive resource changes. A failed asynchronous
 * dispatch keeps its sealed intent; a reused key cannot select another effect.
 */
export function openConfiguratorHttpOperations(input: { journalPath: string }) {
  const db = new DatabaseSync(input.journalPath);
  const pending = new Map<string, Promise<unknown>>();
  function read(principal: string, key: string) {
    const raw = db.prepare('SELECT * FROM configurator_http_operations WHERE principal_id=? AND idempotency_key=?').get(principal, key);
    if (raw === undefined) return undefined;
    const row = RowSchema.parse(raw); const { record_hash, ...record } = row;
    if (configuratorValueHash(record) !== record_hash || configuratorValueHash(JSON.parse(row.request_json)) !== row.request_hash
      || (row.result_json === null) !== (row.result_hash === null)
      || (row.result_json !== null && configuratorValueHash(JSON.parse(row.result_json)) !== row.result_hash))
      throw new Error('CONFIGURATOR_HTTP_RECEIPT_CORRUPT');
    return row;
  }
  return Object.freeze({
    get activeCount() { return pending.size; },
    async execute(input: { principalId: string; idempotencyKey: string; kind: string; request: unknown }, effect: () => Promise<unknown>) {
      const principal = z.string().trim().min(1).max(200).parse(input.principalId); const key = z.uuid().parse(input.idempotencyKey);
      const requestJson = canonicalDirectorValue(input.request); const requestHash = configuratorValueHash(input.request);
      const previous = read(principal, key);
      if (previous !== undefined) {
        if (previous.kind !== input.kind || previous.request_hash !== requestHash || previous.request_json !== requestJson)
          throw new Error('CONFIGURATOR_IDEMPOTENCY_REUSE');
        if (previous.result_json !== null) return JSON.parse(previous.result_json);
      } else {
        const record = { principal_id: principal, idempotency_key: key, kind: input.kind, request_json: requestJson,
          request_hash: requestHash, result_json: null, result_hash: null };
        db.prepare('INSERT INTO configurator_http_operations VALUES(?,?,?,?,?,?,?,?)')
          .run(principal, key, input.kind, requestJson, requestHash, null, null, configuratorValueHash(record));
      }
      const identity = canonicalDirectorValue([principal, key]); const active = pending.get(identity);
      if (active !== undefined) return await active;
      const work = Promise.resolve().then(async () => {
        const result = await effect(); const resultJson = canonicalDirectorValue(result); const resultHash = configuratorValueHash(result);
        db.exec('BEGIN IMMEDIATE');
        try {
          const old = read(principal, key); if (old === undefined) throw new Error('CONFIGURATOR_HTTP_RECEIPT_MISSING');
          const record = { principal_id: principal, idempotency_key: key, kind: input.kind,
            request_json: requestJson, request_hash: requestHash, result_json: resultJson, result_hash: resultHash };
          db.prepare('UPDATE configurator_http_operations SET result_json=?,result_hash=?,record_hash=? WHERE principal_id=? AND idempotency_key=?')
            .run(resultJson, resultHash, configuratorValueHash(record), principal, key);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return result;
      });
      pending.set(identity, work);
      try { return await work; } finally { if (pending.get(identity) === work) pending.delete(identity); }
    },
    close() { if (pending.size > 0) throw new Error('CONFIGURATOR_HTTP_OPERATIONS_ACTIVE'); db.close(); },
  });
}
