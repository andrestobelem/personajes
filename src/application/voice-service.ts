import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  fstatSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { voiceHash } from "./voice-hash.ts";
import { validateVoiceMedia, voicePcmToWav } from "./voice-media.ts";
import { ElevenLabsError } from "../adapters/elevenlabs.ts";
import type {
  ElevenLabsAudio,
  ElevenLabsClient,
} from "../adapters/elevenlabs.ts";
import {
  assertVoiceOwner,
  buildVoiceSubtitles,
  requireConfirmedVariety,
  voiceOwnerKey,
  VoiceConfigSchema,
  VoiceOwnerSchema,
  VoiceSourceSchema,
  VoiceDesignRequestSchema,
  VoiceTestRequestSchema,
  SoundEffectRequestSchema,
  SpeechBindingDraftSchema,
  SpeechBindingSchema,
  VoiceArtifactSchema,
  VoiceOperationSchema,
  SoundBindingSchema,
  VoiceSnapshotSchema,
  SavedVoiceSchema,
  VoicePreviewSchema,
  VoicePreviewIdSchema,
  SavedVoiceIdSchema,
} from "../domain/voice.ts";
import type {
  VoiceArtifact,
  VoiceConfig,
  VoiceOperation,
} from "../domain/voice.ts";

const publicationSchema = z
  .object({
    publicationId: z.string().min(1),
    runId: z.string().min(1),
    text: z.string().min(1).max(65536),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    textRevision: z.number().int().nonnegative(),
    configRevision: z.number().int().nonnegative(),
    owner: VoiceOwnerSchema,
    committedAt: z.iso.datetime(),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export type VoicePublication = z.infer<typeof publicationSchema>;
const savedSchema = SavedVoiceSchema;
const previewSchema = VoicePreviewSchema;
const clickSchema = z
  .object({
    operationId: z.uuid(),
    principal: z.string().min(1).max(120),
    runId: z.string().min(1).max(120),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const workSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("design-preview"),
      config: VoiceConfigSchema,
      request: VoiceDesignRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("save-voice"),
      preview: previewSchema,
      voiceName: z.string().min(1).max(120),
      voiceDescription: z.string().min(20).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("binding-test"),
      config: VoiceConfigSchema,
      draft: SpeechBindingDraftSchema,
      request: VoiceTestRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tts"),
      config: VoiceConfigSchema,
      binding: SpeechBindingSchema,
      publication: publicationSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("sfx"), request: SoundEffectRequestSchema })
    .strict(),
]);
type Work = z.infer<typeof workSchema>;
const reservationKinds = ["voiceDesignCalls", "ttsCalls", "sfxCalls"] as const;
type QuotaKind = (typeof reservationKinds)[number];
function quotaKind(kind: VoiceOperation["kind"]): QuotaKind | null {
  return kind === "design-preview"
    ? "voiceDesignCalls"
    : kind === "tts" || kind === "binding-test"
      ? "ttsCalls"
      : kind === "sfx"
        ? "sfxCalls"
        : null;
}

/** Host-only service. The caller must acquire local-host ownership first and close this before its host. */
export function openVoiceService(input: {
  privateDataRoot: string;
  ownerToken: string;
  client: ElevenLabsClient;
  hasCredential: () => boolean;
  readConfig: (runId: string) => VoiceConfig;
  readPublication: (
    runId: string,
    publicationId: string,
  ) => VoicePublication | null;
  speakableIds: (runId: string) => readonly string[];
  quotaLimits: (runId: string) => {
    voiceDesignCalls: number;
    ttsCalls: number;
    sfxCalls: number;
  };
  concurrency?: number;
}) {
  if (!isAbsolute(input.privateDataRoot))
    throw new Error("VOICE_PRIVATE_ROOT_REQUIRED");
  const concurrency = z
    .number()
    .int()
    .min(1)
    .max(16)
    .parse(input.concurrency ?? 2);
  const mediaRoot = join(input.privateDataRoot, "media");
  const canonicalRoot = realpathSync(input.privateDataRoot);
  mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(mediaRoot).isSymbolicLink())
    throw new Error("VOICE_MEDIA_ROOT_INVALID");
  chmodSync(mediaRoot, 0o700);
  function assertMediaRoot() {
    const stat = lstatSync(mediaRoot);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      realpathSync(mediaRoot) !== join(canonicalRoot, "media")
    )
      throw new Error("VOICE_MEDIA_ROOT_INVALID");
  }
  function privateBytes(path: string) {
    assertMediaRoot();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > 16 * 1024 * 1024
      )
        throw new Error("VOICE_MEDIA_INVALID");
      return readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  function assertOwnership() {
    const lock = z
      .object({ nonce: z.uuid(), pid: z.number().int() })
      .passthrough()
      .parse(
        JSON.parse(
          readFileSync(
            join(input.privateDataRoot, "host-ownership.json"),
            "utf8",
          ),
        ),
      );
    if (lock.nonce !== input.ownerToken || lock.pid !== process.pid)
      throw new Error("VOICE_HOST_OWNERSHIP_LOST");
  }
  assertOwnership();
  const db = new DatabaseSync(join(input.privateDataRoot, "world.sqlite"));
  db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  db.exec(`CREATE TABLE IF NOT EXISTS voice_schema_version(version INTEGER NOT NULL); INSERT INTO voice_schema_version SELECT 2 WHERE NOT EXISTS(SELECT 1 FROM voice_schema_version);
 CREATE TABLE IF NOT EXISTS voice_entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,data_hash TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS voice_operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,principal TEXT NOT NULL,run_id TEXT NOT NULL,request_hash TEXT NOT NULL,dedupe TEXT UNIQUE,data TEXT NOT NULL,work TEXT NOT NULL,data_hash TEXT NOT NULL,work_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS voice_reservations(operation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,reservation_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS voice_staged_media(operation_id TEXT NOT NULL,artifact_id TEXT PRIMARY KEY,metadata TEXT NOT NULL,bytes BLOB NOT NULL,metadata_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS voice_receipts(scope TEXT NOT NULL,id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(scope,id));`);
  if (
    z
      .object({ version: z.literal(2) })
      .safeParse(db.prepare("SELECT version FROM voice_schema_version").get())
      .success !== true
  )
    throw new Error("VOICE_SCHEMA_VERSION_UNSUPPORTED");
  let active = 0;
  let closed = false;
  let stopping = false;
  let admissionsSuspended = 0;
  let shutdownTask: Promise<void> | null = null;
  const pending = new Set<Promise<VoiceOperation>>();
  const executing = new Set<string>();
  const aborts = new Map<string, AbortController>();
  function transaction<T>(work: () => T): T {
    assertOwnership();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function entity<T>(kind: string, id: string, schema: z.ZodType<T>): T {
    const row = z
      .object({ data: z.string(), data_hash: z.string() })
      .parse(
        db
          .prepare(
            "SELECT data,data_hash FROM voice_entities WHERE kind=? AND id=?",
          )
          .get(kind, id),
      );
    if (
      row.data_hash !== voiceHash(JSON.stringify({ kind, id, data: row.data }))
    )
      throw new Error("VOICE_ENTITY_INTEGRITY_FAILED");
    const value: unknown = JSON.parse(row.data);
    const parsed = schema.parse(value);
    const keyFields: Record<string, string> = {
      binding: "speechBindingId",
      draft: "bindingDraftId",
      preview: "previewId",
      saved: "savedVoiceId",
      "orphaned-saved": "savedVoiceId",
      artifact: "artifactId",
      "sound-binding": "soundBindingId",
    };
    const field = keyFields[kind];
    if (field) {
      const key = z.object({ [field]: z.string() }).parse(value)[field];
      if (key !== id) throw new Error("VOICE_ENTITY_SCOPE_INVALID");
    }
    if (kind === "listen") {
      const key = z
        .object({ artifactId: z.string(), principal: z.string() })
        .parse(value);
      if (`${key.artifactId}:${key.principal}` !== id)
        throw new Error("VOICE_ENTITY_SCOPE_INVALID");
    }
    return parsed;
  }
  function put(kind: string, id: string, value: unknown) {
    const data = JSON.stringify(value);
    const hash = voiceHash(JSON.stringify({ kind, id, data }));
    db.prepare(
      "INSERT INTO voice_entities(kind,id,data,data_hash) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,data_hash=excluded.data_hash",
    ).run(kind, id, data, hash);
  }
  function operation(id: string): VoiceOperation {
    const row = z
      .object({
        id: z.string(),
        principal: z.string(),
        run_id: z.string(),
        data: z.string(),
        data_hash: z.string(),
      })
      .parse(
        db
          .prepare(
            "SELECT id,principal,run_id,data,data_hash FROM voice_operations WHERE id=?",
          )
          .get(id),
      );
    if (
      row.data_hash !==
      voiceHash(
        JSON.stringify({
          id: row.id,
          principal: row.principal,
          runId: row.run_id,
          data: row.data,
        }),
      )
    )
      throw new Error("VOICE_OPERATION_INTEGRITY_FAILED");
    const op = VoiceOperationSchema.parse(JSON.parse(row.data));
    if (
      op.operationId !== row.id ||
      op.principal !== row.principal ||
      op.runId !== row.run_id
    )
      throw new Error("VOICE_OPERATION_SCOPE_INVALID");
    return op;
  }
  function frozenWork(id: string): Work {
    const op = operation(id);
    const row = z
      .object({ work: z.string(), work_hash: z.string() })
      .parse(
        db
          .prepare("SELECT work,work_hash FROM voice_operations WHERE id=?")
          .get(id),
      );
    if (
      row.work_hash !==
      voiceHash(
        JSON.stringify({
          id: op.operationId,
          principal: op.principal,
          runId: op.runId,
          work: row.work,
        }),
      )
    )
      throw new Error("VOICE_WORK_INTEGRITY_FAILED");
    const work = workSchema.parse(JSON.parse(row.work));
    if (work.kind !== op.kind) throw new Error("VOICE_WORK_SCOPE_INVALID");
    if (
      work.kind === "tts" ||
      work.kind === "binding-test" ||
      work.kind === "design-preview"
    ) {
      if (work.config.revision !== op.configRevision)
        throw new Error("VOICE_WORK_SCOPE_INVALID");
      requireConfirmedVariety(work.config);
    }
    if (
      work.kind === "tts" &&
      (work.publication.runId !== op.runId ||
        work.publication.textHash !== voiceHash(work.publication.text) ||
        voiceOwnerKey(work.publication.owner) !==
          voiceOwnerKey(work.binding.owner) ||
        work.binding.ttsModelId !== op.modelId)
    )
      throw new Error("VOICE_PUBLICATION_INTEGRITY_FAILED");
    return work;
  }
  function update(
    op: VoiceOperation,
    patch: Partial<VoiceOperation>,
  ): VoiceOperation {
    const next = VoiceOperationSchema.parse({
      ...op,
      ...patch,
      revision: op.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    const data = JSON.stringify(next);
    db.prepare("UPDATE voice_operations SET data=?,data_hash=? WHERE id=?").run(
      data,
      voiceHash(
        JSON.stringify({
          id: next.operationId,
          principal: next.principal,
          runId: next.runId,
          data,
        }),
      ),
      op.operationId,
    );
    return next;
  }
  function getConfig(click: z.infer<typeof clickSchema>) {
    const config = VoiceConfigSchema.parse(input.readConfig(click.runId));
    if (config.revision !== click.expectedRevision)
      throw new Error("VOICE_CONFIG_STALE");
    return config;
  }
  function replay(
    click: z.infer<typeof clickSchema>,
    kind: VoiceOperation["kind"],
    request: unknown,
  ): VoiceOperation | null {
    const row = db
      .prepare("SELECT request_hash,data FROM voice_operations WHERE id=?")
      .get(click.operationId);
    if (!row) return null;
    const parsed = z
      .object({ request_hash: z.string(), data: z.string() })
      .parse(row);
    if (
      parsed.request_hash !==
      voiceHash(
        JSON.stringify({
          principal: click.principal,
          runId: click.runId,
          kind,
          request,
        }),
      )
    )
      throw new Error("VOICE_IDEMPOTENCY_KEY_REUSE");
    return operation(click.operationId);
  }
  function reservationRows(runId: string, kind: QuotaKind) {
    return db
      .prepare(
        "SELECT operation_id,run_id,kind,state,reservation_hash FROM voice_reservations WHERE run_id=? AND kind=? LIMIT 10001",
      )
      .all(runId, kind)
      .map((value) => {
        const row = z
          .object({
            operation_id: z.string(),
            run_id: z.string(),
            kind: z.enum(reservationKinds),
            state: z.enum(["reserved", "consumed", "released"]),
            reservation_hash: z.string(),
          })
          .parse(value);
        const fields = {
          operationId: row.operation_id,
          runId: row.run_id,
          kind: row.kind,
          state: row.state,
        };
        if (row.reservation_hash !== voiceHash(JSON.stringify(fields)))
          throw new Error("VOICE_RESERVATION_INTEGRITY_FAILED");
        const op = operation(row.operation_id);
        if (op.runId !== runId || quotaKind(op.kind) !== kind)
          throw new Error("VOICE_RESERVATION_SCOPE_INVALID");
        return fields;
      });
  }
  function setReservation(
    id: string,
    state: "reserved" | "consumed" | "released",
  ) {
    const row = db
      .prepare(
        "SELECT operation_id,run_id,kind,state,reservation_hash FROM voice_reservations WHERE operation_id=?",
      )
      .get(id);
    if (!row) return;
    const prior = z
      .object({
        operation_id: z.string(),
        run_id: z.string(),
        kind: z.enum(reservationKinds),
        state: z.string(),
        reservation_hash: z.string(),
      })
      .parse(row);
    if (
      prior.reservation_hash !==
      voiceHash(
        JSON.stringify({
          operationId: prior.operation_id,
          runId: prior.run_id,
          kind: prior.kind,
          state: prior.state,
        }),
      )
    )
      throw new Error("VOICE_RESERVATION_INTEGRITY_FAILED");
    db.prepare(
      "UPDATE voice_reservations SET state=?,reservation_hash=? WHERE operation_id=?",
    ).run(
      state,
      voiceHash(
        JSON.stringify({
          operationId: id,
          runId: prior.run_id,
          kind: prior.kind,
          state,
        }),
      ),
      id,
    );
  }
  function schedule(
    click: z.infer<typeof clickSchema>,
    work: Work,
    modelId: string,
    dedupe: string | null = null,
    command: unknown = work,
  ): VoiceOperation {
    if (stopping || closed || admissionsSuspended > 0)
      throw new Error("VOICE_SERVICE_STOPPING");
    return transaction(() => {
      const old = replay(click, work.kind, command);
      if (old) return old;
      if (dedupe) {
        const row = db
          .prepare("SELECT id FROM voice_operations WHERE dedupe=?")
          .get(dedupe);
        if (row) {
          const existing = operation(
            z.object({ id: z.string() }).parse(row).id,
          );
          if (existing.principal !== click.principal)
            throw new Error("VOICE_OPERATION_FORBIDDEN");
          return existing;
        }
      }
      if (
        work.kind !== "sfx" &&
        work.kind !== "save-voice" &&
        work.kind !== "tts"
      )
        getConfig(click);
      if (!input.hasCredential())
        throw new Error("ELEVENLABS_CREDENTIAL_MISSING");
      const quota = quotaKind(work.kind);
      if (quota) {
        const limit = z
          .number()
          .int()
          .nonnegative()
          .safe()
          .parse(input.quotaLimits(click.runId)[quota]);
        const count = reservationRows(click.runId, quota).filter(
          (row) => row.state !== "released",
        ).length;
        if (count >= limit) throw new Error("VOICE_QUOTA_EXHAUSTED");
        db.prepare(
          "INSERT INTO voice_reservations(operation_id,run_id,kind,state,reservation_hash) VALUES(?,?,?,?,?)",
        ).run(
          click.operationId,
          click.runId,
          quota,
          "reserved",
          voiceHash(
            JSON.stringify({
              operationId: click.operationId,
              runId: click.runId,
              kind: quota,
              state: "reserved",
            }),
          ),
        );
      }
      const now = new Date().toISOString();
      const op = VoiceOperationSchema.parse({
        operationId: click.operationId,
        principal: click.principal,
        runId: click.runId,
        kind: work.kind,
        configRevision: click.expectedRevision,
        modelId,
        state: "queued",
        revision: 0,
        createdAt: now,
        updatedAt: now,
        artifactIds: [],
        previewIds: [],
        selectedPreviewId: null,
        savedVoiceId: null,
        safeCode: null,
        cost: { kind: "unknown" },
      });
      db.prepare(
        "INSERT INTO voice_operations(id,principal,run_id,request_hash,dedupe,data,work,data_hash,work_hash) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        click.operationId,
        click.principal,
        click.runId,
        voiceHash(
          JSON.stringify({
            principal: click.principal,
            runId: click.runId,
            kind: work.kind,
            request: command,
          }),
        ),
        dedupe,
        JSON.stringify(op),
        JSON.stringify(work),
        voiceHash(
          JSON.stringify({
            id: op.operationId,
            principal: op.principal,
            runId: op.runId,
            data: JSON.stringify(op),
          }),
        ),
        voiceHash(
          JSON.stringify({
            id: op.operationId,
            principal: op.principal,
            runId: op.runId,
            work: JSON.stringify(work),
          }),
        ),
      );
      return op;
    });
  }
  function assertOwner(runId: string, owner: z.infer<typeof VoiceOwnerSchema>) {
    assertVoiceOwner(owner, input.speakableIds(runId));
  }
  async function assertCompatible(voiceId: string, modelId: string) {
    const models = await input.client.listModels();
    const model = models.find((model) => model.modelId === modelId);
    if (!model?.canDoTextToSpeech || !model.languages.includes("es"))
      throw new Error("VOICE_MODEL_INCOMPATIBLE");
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let count = 0; count < 100; count++) {
      const page = await input.client.listVoices({
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const voice = page.voices.find((voice) => voice.voiceId === voiceId);
      if (voice) return voice;
      if (!page.hasMore) return Promise.reject(new Error("VOICE_UNAVAILABLE"));
      if (!page.nextCursor || seen.has(page.nextCursor))
        throw new Error("VOICE_CATALOG_PAGINATION_INVALID");
      cursor = page.nextCursor;
      seen.add(cursor);
    }
    throw new Error("VOICE_CATALOG_LIMIT");
  }
  function makeArtifact(
    op: VoiceOperation,
    audio: ElevenLabsAudio,
    source: {
      kind: VoiceArtifact["kind"];
      sourceId: string;
      text: string;
      textRevision: number;
      bindingId: string | null;
      durationSeconds: number | null;
    },
  ) {
    return VoiceArtifactSchema.parse({
      artifactId: randomUUID(),
      operationId: op.operationId,
      ...source,
      state: op.state === "cancelled" ? "orphaned" : "available",
      textHash: voiceHash(source.text),
      configRevision: op.configRevision,
      modelId: op.modelId,
      mediaType:
        audio.mediaType === "audio/mp3" ? "audio/mpeg" : audio.mediaType,
      byteLength: audio.audio.length,
      hash: voiceHash(audio.audio),
      providerAudioHash: voiceHash(audio.audio),
      providerOutputFormat: (() => {
        const work = frozenWork(op.operationId);
        return work.kind === "tts" || work.kind === "binding-test"
          ? work.config.audioMode.kind === "enabled"
            ? work.config.audioMode.outputFormat
            : "mp3_44100_128"
          : null;
      })(),
      subtitles: buildVoiceSubtitles(source.text, audio.alignment),
    });
  }
  function stage(
    op: VoiceOperation,
    artifacts: { metadata: VoiceArtifact; audio: Uint8Array }[],
    extra: () => void = () => {},
  ) {
    artifacts = artifacts.map((a) => {
      if (a.metadata.mediaType !== "audio/pcm") return a;
      const format = a.metadata.providerOutputFormat;
      if (!format) throw new Error("VOICE_MEDIA_FORMAT_INVALID");
      const audio = voicePcmToWav(a.audio, format);
      return {
        audio,
        metadata: VoiceArtifactSchema.parse({
          ...a.metadata,
          mediaType: "audio/wav",
          hash: voiceHash(audio),
          byteLength: audio.byteLength,
        }),
      };
    });
    if (artifacts.reduce((n, a) => n + a.audio.length, 0) > 64 * 1024 * 1024)
      throw new Error("VOICE_OPERATION_MEDIA_LIMIT");
    transaction(() => {
      for (const a of artifacts)
        db.prepare(
          "INSERT INTO voice_staged_media(operation_id,artifact_id,metadata,bytes,metadata_hash) VALUES(?,?,?,?,?)",
        ).run(
          op.operationId,
          a.metadata.artifactId,
          JSON.stringify(a.metadata),
          a.audio,
          voiceHash(
            JSON.stringify({
              operationId: op.operationId,
              artifactId: a.metadata.artifactId,
              metadata: JSON.stringify(a.metadata),
            }),
          ),
        );
      extra();
      update(operation(op.operationId), {
        state:
          operation(op.operationId).state === "cancelled"
            ? "orphaned"
            : "response-received",
      });
    });
  }
  async function persistStaged(id: string): Promise<VoiceOperation> {
    const current = operation(id);
    if (
      current.state !== "response-received" &&
      current.state !== "artifact-persisting" &&
      current.state !== "orphaned"
    )
      throw new Error("VOICE_NO_RESPONSE_TO_RECONCILE");
    const rows = db
      .prepare(
        "SELECT operation_id,artifact_id,metadata,metadata_hash,bytes FROM voice_staged_media WHERE operation_id=?",
      )
      .all(id);
    const artifacts = rows.map((row) => {
      const p = z
        .object({
          operation_id: z.string(),
          artifact_id: z.string(),
          metadata: z.string(),
          metadata_hash: z.string(),
          bytes: z.instanceof(Uint8Array),
        })
        .parse(row);
      if (
        p.metadata_hash !==
        voiceHash(
          JSON.stringify({
            operationId: p.operation_id,
            artifactId: p.artifact_id,
            metadata: p.metadata,
          }),
        )
      )
        throw new Error("VOICE_STAGING_INTEGRITY_FAILED");
      const metadata = VoiceArtifactSchema.parse(JSON.parse(p.metadata));
      if (
        metadata.operationId !== id ||
        metadata.artifactId !== p.artifact_id ||
        voiceHash(p.bytes) !== metadata.hash ||
        p.bytes.byteLength !== metadata.byteLength
      )
        throw new Error("VOICE_STAGING_SCOPE_INVALID");
      return { metadata, bytes: p.bytes };
    });
    for (const a of artifacts) {
      assertOwnership();
      assertMediaRoot();
      const path = join(mediaRoot, `${a.metadata.artifactId}.bin`);
      if (existsSync(path)) {
        if (voiceHash(privateBytes(path)) !== a.metadata.hash)
          throw new Error("VOICE_MEDIA_HASH_MISMATCH");
      } else {
        const fd = openSync(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFileSync(fd, a.bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      const work = frozenWork(id);
      const outputFormat =
        work.kind === "tts" || work.kind === "binding-test"
          ? work.config.audioMode.kind === "enabled"
            ? work.config.audioMode.outputFormat
            : "mp3_44100_128"
          : null;
      a.metadata.durationSeconds = await validateVoiceMedia({
        path,
        mediaType: a.metadata.mediaType,
        outputFormat,
        byteLength: a.metadata.byteLength,
      });
      assertOwnership();
      assertMediaRoot();
      if (voiceHash(privateBytes(path)) !== a.metadata.hash)
        throw new Error("VOICE_MEDIA_HASH_MISMATCH");
      if (
        a.metadata.subtitles.kind === "verified" &&
        a.metadata.subtitles.cues.some(
          (cue) => cue.endSeconds > (a.metadata.durationSeconds ?? 0) + 0.05,
        )
      )
        a.metadata.subtitles = { kind: "unverified", text: a.metadata.text };
    }
    return transaction(() => {
      let op = operation(id);
      const orphan = op.state === "cancelled" || op.state === "orphaned";
      for (const a of artifacts)
        put("artifact", a.metadata.artifactId, {
          ...a.metadata,
          state: orphan ? "orphaned" : a.metadata.state,
        });
      db.prepare("DELETE FROM voice_staged_media WHERE operation_id=?").run(id);
      op = update(op, {
        state: orphan ? "orphaned" : "ready",
        artifactIds: artifacts.map((a) => a.metadata.artifactId),
      });
      return op;
    });
  }
  async function executeInternal(id: string): Promise<VoiceOperation> {
    assertOwnership();
    const before = operation(id);
    if (stopping || closed || admissionsSuspended > 0) return before;
    if (before.state !== "queued" || executing.has(id) || active >= concurrency)
      return before;
    executing.add(id);
    active++;
    const controller = new AbortController();
    aborts.set(id, controller);
    try {
      const work = frozenWork(id);
      transaction(() => update(operation(id), { state: "validating" }));
      if (!input.hasCredential())
        throw new Error("ELEVENLABS_CREDENTIAL_MISSING");
      if (work.kind === "tts" || work.kind === "binding-test")
        await assertCompatible(
          work.kind === "tts"
            ? work.binding.voiceId
            : work.draft.providerVoiceId,
          opModel(work),
        );
      if (operation(id).state === "cancelled") return operation(id);
      transaction(() => {
        update(operation(id), { state: "submitted" });
        setReservation(id, "consumed");
      });
      if (work.kind === "save-voice") {
        const result = await input.client.saveVoice(
          {
            generatedVoiceId: work.preview.generatedVoiceId,
            voiceName: work.voiceName,
            voiceDescription: work.voiceDescription,
          },
          { signal: controller.signal },
        );
        return transaction(() => {
          const op = operation(id);
          const saved = savedSchema.parse({
            savedVoiceId: randomUUID(),
            providerVoiceId: result.voiceId,
            voiceName: work.voiceName,
            voiceDescription: work.voiceDescription,
            designModelId: work.preview.modelId,
            previewId: work.preview.previewId,
          });
          put(
            op.state === "cancelled" ? "orphaned-saved" : "saved",
            saved.savedVoiceId,
            saved,
          );
          return update(op, {
            state: op.state === "cancelled" ? "orphaned" : "ready",
            savedVoiceId: SavedVoiceIdSchema.parse(saved.savedVoiceId),
          });
        });
      }
      if (work.kind === "design-preview") {
        const previews = await input.client.design(
          {
            text: work.request.sampleText,
            voiceDescription: work.request.voiceDescription,
            modelId: work.request.modelId,
          },
          { signal: controller.signal },
        );
        const op = operation(id);
        const artifacts = previews.map((p) => ({
          metadata: makeArtifact(op, p, {
            kind: "preview",
            sourceId: op.operationId,
            text: work.request.sampleText,
            textRevision: 0,
            bindingId: null,
            durationSeconds: p.durationSeconds,
          }),
          audio: p.audio,
        }));
        stage(op, artifacts, () => {
          const ids = previews.map((p, index) => {
            const artifact = artifacts[index];
            if (!artifact) throw new Error("VOICE_PREVIEW_INVALID");
            const preview = previewSchema.parse({
              previewId: randomUUID(),
              operationId: id,
              generatedVoiceId: p.generatedVoiceId,
              artifactId: artifact.metadata.artifactId,
              description: work.request.voiceDescription,
              sampleText: work.request.sampleText,
              modelId: work.request.modelId,
              varietyLabel: requireConfirmedVariety(work.config).label,
            });
            put("preview", preview.previewId, preview);
            return VoicePreviewIdSchema.parse(preview.previewId);
          });
          update(operation(id), { previewIds: ids });
        });
        return await persistStaged(id);
      }
      const audio =
        work.kind === "sfx"
          ? await input.client.soundEffect(
              {
                text: work.request.text,
                modelId: work.request.modelId,
                ...(work.request.durationSeconds === undefined
                  ? {}
                  : { durationSeconds: work.request.durationSeconds }),
                ...(work.request.promptInfluence === undefined
                  ? {}
                  : { promptInfluence: work.request.promptInfluence }),
              },
              { signal: controller.signal },
            )
          : await input.client.tts(
              {
                text:
                  work.kind === "tts"
                    ? work.publication.text
                    : work.request.sampleText,
                voiceId:
                  work.kind === "tts"
                    ? work.binding.voiceId
                    : work.draft.providerVoiceId,
                modelId: opModel(work),
                outputFormat:
                  work.config.audioMode.kind === "enabled"
                    ? work.config.audioMode.outputFormat
                    : "mp3_44100_128",
              },
              { signal: controller.signal },
            );
      const op = operation(id);
      const source =
        work.kind === "sfx"
          ? {
              kind: "sound-effect" as const,
              sourceId: id,
              text: work.request.text,
              textRevision: 0,
              bindingId: null,
              durationSeconds: work.request.durationSeconds ?? null,
            }
          : work.kind === "tts"
            ? {
                kind: "publication" as const,
                sourceId: work.publication.publicationId,
                text: work.publication.text,
                textRevision: work.publication.textRevision,
                bindingId: work.binding.speechBindingId,
                durationSeconds: null,
              }
            : {
                kind: "binding-test" as const,
                sourceId: work.draft.bindingDraftId,
                text: work.request.sampleText,
                textRevision: 0,
                bindingId: null,
                durationSeconds: null,
              };
      stage(op, [
        { metadata: makeArtifact(op, audio, source), audio: audio.audio },
      ]);
      return await persistStaged(id);
    } catch (error) {
      return transaction(() => {
        const op = operation(id);
        if (op.state === "cancelled" || op.state === "orphaned") return op;
        const ambiguous =
          op.state === "submitted" &&
          error instanceof ElevenLabsError &&
          error.code === "uncertain";
        const staging = z
          .object({ n: z.number() })
          .parse(
            db
              .prepare(
                "SELECT count(*) n FROM voice_staged_media WHERE operation_id=?",
              )
              .get(id),
          ).n;
        const state = ambiguous
          ? "uncertain"
          : staging
            ? "response-received"
            : op.state === "validating"
              ? "blocked"
              : "failed";
        if (op.state === "validating" || op.state === "queued")
          setReservation(id, "released");
        return update(op, {
          state,
          safeCode:
            error instanceof ElevenLabsError
              ? `ELEVENLABS_${error.code.replaceAll("-", "_").toUpperCase()}`
              : "VOICE_OPERATION_FAILED",
        });
      });
    } finally {
      executing.delete(id);
      aborts.delete(id);
      active--;
    }
  }
  function execute(id: string): Promise<VoiceOperation> {
    const promise = executeInternal(id);
    pending.add(promise);
    void promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }
  function opModel(work: Extract<Work, { kind: "tts" | "binding-test" }>) {
    return work.kind === "tts"
      ? work.binding.ttsModelId
      : work.draft.ttsModelId;
  }
  function findReceipt<T>(
    scope: string,
    id: string,
    request: unknown,
    schema: z.ZodType<T>,
  ): T | null {
    const old = db
      .prepare(
        "SELECT request_hash,result,result_hash FROM voice_receipts WHERE scope=? AND id=?",
      )
      .get(scope, id);
    if (!old) return null;
    const row = z
      .object({
        request_hash: z.string(),
        result: z.string(),
        result_hash: z.string(),
      })
      .parse(old);
    if (
      row.result_hash !==
      voiceHash(
        JSON.stringify({
          scope,
          id,
          requestHash: row.request_hash,
          result: row.result,
        }),
      )
    )
      throw new Error("VOICE_RECEIPT_INTEGRITY_FAILED");
    if (row.request_hash !== voiceHash(JSON.stringify(request)))
      throw new Error("VOICE_IDEMPOTENCY_KEY_REUSE");
    return schema.parse(JSON.parse(row.result));
  }
  function receipt<T>(
    scope: string,
    id: string,
    request: unknown,
    work: () => T,
    schema: z.ZodType<T>,
  ): T {
    return transaction(() => {
      const hash = voiceHash(JSON.stringify(request));
      const old = db
        .prepare(
          "SELECT request_hash,result,result_hash FROM voice_receipts WHERE scope=? AND id=?",
        )
        .get(scope, id);
      if (old) {
        const row = z
          .object({
            request_hash: z.string(),
            result: z.string(),
            result_hash: z.string(),
          })
          .parse(old);
        if (
          row.result_hash !==
          voiceHash(
            JSON.stringify({
              scope,
              id,
              requestHash: row.request_hash,
              result: row.result,
            }),
          )
        )
          throw new Error("VOICE_RECEIPT_INTEGRITY_FAILED");
        if (row.request_hash !== hash)
          throw new Error("VOICE_IDEMPOTENCY_KEY_REUSE");
        return schema.parse(JSON.parse(row.result));
      }
      const result = work();
      db.prepare(
        "INSERT INTO voice_receipts(scope,id,request_hash,result,result_hash) VALUES(?,?,?,?,?)",
      ).run(
        scope,
        id,
        hash,
        JSON.stringify(result),
        voiceHash(
          JSON.stringify({
            scope,
            id,
            requestHash: hash,
            result: JSON.stringify(result),
          }),
        ),
      );
      return result;
    });
  }
  function authorizeOperation(id: string, principal: string) {
    const op = operation(id);
    if (op.principal !== principal)
      throw new Error("VOICE_OPERATION_FORBIDDEN");
    return op;
  }
  function media(artifactId: string, principal: string) {
    const artifact = entity("artifact", artifactId, VoiceArtifactSchema);
    authorizeOperation(artifact.operationId, principal);
    if (artifact.state !== "available")
      throw new Error("VOICE_ARTIFACT_UNAVAILABLE");
    const path = join(mediaRoot, `${artifact.artifactId}.bin`);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== artifact.byteLength
    )
      throw new Error("VOICE_MEDIA_INVALID");
    const bytes = privateBytes(path);
    if (voiceHash(bytes) !== artifact.hash)
      throw new Error("VOICE_MEDIA_HASH_MISMATCH");
    return { artifact, bytes };
  }
  function recover() {
    transaction(() => {
      for (;;) {
        const rows = db
          .prepare(
            "SELECT id FROM voice_operations WHERE json_extract(data,'$.state') IN ('queued','validating','submitted') LIMIT 1000",
          )
          .all();
        if (!rows.length) break;
        for (const row of rows) {
          const op = operation(z.object({ id: z.string() }).parse(row).id);
          if (op.state === "submitted")
            update(op, {
              state: "uncertain",
              safeCode: "VOICE_INTERRUPTED_AFTER_DISPATCH",
            });
          if (op.state === "validating" || op.state === "queued") {
            update(op, {
              state: "blocked",
              safeCode: "VOICE_INTERRUPTED_BEFORE_DISPATCH",
            });
            setReservation(op.operationId, "released");
          }
        }
      }
    });
  }
  recover();
  return Object.freeze({
    execute,
    async drain(options: { limit?: number } = {}) {
      if (stopping || closed || admissionsSuspended > 0) return 0;
      const limit = z
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(options.limit ?? 100);
      const rows = db
        .prepare(
          "SELECT id FROM voice_operations WHERE json_extract(data,'$.state')='queued' ORDER BY seq LIMIT ?",
        )
        .all(limit);
      const ids = rows
        .map((row) => z.object({ id: z.string() }).parse(row).id)
        .filter((id) => operation(id).state === "queued");
      for (let index = 0; index < ids.length; index += concurrency)
        await Promise.all(ids.slice(index, index + concurrency).map(execute));
      return ids.length;
    },
    getOperation(id: string, principal: string) {
      return authorizeOperation(id, principal);
    },
    listOperations(
      runId: string,
      principal: string,
      options: { afterSequence?: number; limit?: number } = {},
    ) {
      const limit = z
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(options.limit ?? 100);
      const after = z
        .number()
        .int()
        .nonnegative()
        .parse(options.afterSequence ?? 0);
      return db
        .prepare(
          "SELECT id FROM voice_operations WHERE run_id=? AND principal=? AND seq>? ORDER BY seq LIMIT ?",
        )
        .all(runId, principal, after, limit)
        .map((row) => operation(z.object({ id: z.string() }).parse(row).id));
    },
    async requestDesign(clickInput: unknown, requestInput: unknown) {
      const click = clickSchema.parse(clickInput);
      const request = VoiceDesignRequestSchema.parse(requestInput);
      const previous = replay(click, "design-preview", request);
      if (previous) return previous;
      const config = getConfig(click);
      requireConfirmedVariety(config);
      assertOwner(click.runId, request.owner);
      if (
        !request.voiceDescription
          .toLocaleLowerCase("es")
          .includes(
            requireConfirmedVariety(config).label.toLocaleLowerCase("es"),
          )
      )
        throw new Error("VOICE_DESCRIPTION_VARIETY_MISMATCH");
      return schedule(
        click,
        { kind: "design-preview", config, request },
        request.modelId,
        null,
        request,
      );
    },
    getPreview(id: string, principal: string) {
      const preview = entity("preview", id, previewSchema);
      authorizeOperation(preview.operationId, principal);
      return preview;
    },
    selectPreview(request: {
      operationId: string;
      principal: string;
      expectedOperationRevision: number;
      previewId: string;
      idempotencyKey: string;
    }) {
      return receipt(
        "selection",
        z.uuid().parse(request.idempotencyKey),
        request,
        () => {
          const op = authorizeOperation(request.operationId, request.principal);
          if (op.revision !== request.expectedOperationRevision)
            throw new Error("VOICE_OPERATION_STALE");
          if (
            op.state !== "ready" ||
            !op.previewIds.some((id) => id === request.previewId)
          )
            throw new Error("VOICE_PREVIEW_NOT_AVAILABLE");
          const preview = entity("preview", request.previewId, previewSchema);
          entity(
            "listen",
            `${preview.artifactId}:${request.principal}`,
            z
              .object({
                artifactId: z.uuid(),
                principal: z.string(),
                listenedAt: z.iso.datetime(),
              })
              .strict(),
          );
          return update(op, {
            selectedPreviewId: VoicePreviewIdSchema.parse(request.previewId),
          });
        },
        VoiceOperationSchema,
      );
    },
    savePreview(
      clickInput: unknown,
      requestInput: unknown,
      expectedSourceRevision?: number,
    ) {
      const click = clickSchema.parse(clickInput);
      const req = z
        .object({
          previewId: z.uuid(),
          voiceName: z.string().min(1).max(120),
          voiceDescription: z.string().min(20).max(1000),
        })
        .strict()
        .parse(requestInput);
      const previous = replay(click, "save-voice", req);
      if (previous) return previous;
      const preview = entity("preview", req.previewId, previewSchema);
      const op = authorizeOperation(preview.operationId, click.principal);
      if (
        expectedSourceRevision !== undefined &&
        expectedSourceRevision !== op.revision
      )
        throw new Error("VOICE_OPERATION_STALE");
      if (op.state !== "ready" || op.selectedPreviewId !== req.previewId)
        throw new Error("VOICE_PREVIEW_NOT_SELECTED");
      return schedule(
        click,
        {
          kind: "save-voice",
          preview,
          voiceName: req.voiceName,
          voiceDescription: req.voiceDescription,
        },
        preview.modelId,
        null,
        req,
      );
    },
    listSavedVoices(options: { afterId?: string; limit?: number } = {}) {
      const limit = z
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(options.limit ?? 100);
      return db
        .prepare(
          "SELECT id FROM voice_entities WHERE kind='saved' AND id>? ORDER BY id LIMIT ?",
        )
        .all(options.afterId ?? "", limit)
        .map((row) =>
          entity(
            "saved",
            z.object({ id: z.string() }).parse(row).id,
            savedSchema,
          ),
        );
    },
    listBindingDrafts(runId: string, principal: string) {
      return db
        .prepare(
          "SELECT id FROM voice_entities WHERE kind='draft-scope' AND json_extract(data,'$.runId')=? AND json_extract(data,'$.principal')=? ORDER BY id LIMIT 100",
        )
        .all(runId, principal)
        .map((row) => {
          const id = z.object({ id: z.string() }).parse(row).id;
          const scope = entity(
            "draft-scope",
            id,
            z.object({ runId: z.string(), principal: z.string() }).strict(),
          );
          if (scope.runId !== runId || scope.principal !== principal)
            throw new Error("VOICE_DRAFT_FORBIDDEN");
          return entity("draft", id, SpeechBindingDraftSchema);
        });
    },
    async createBindingDraft(clickInput: unknown, requestInput: unknown) {
      const click = clickSchema.parse(clickInput);
      const req = z
        .object({
          owner: VoiceOwnerSchema,
          source: VoiceSourceSchema,
          ttsModelId: z.string().min(1),
        })
        .strict()
        .parse(requestInput);
      const previous = findReceipt(
        "draft",
        click.operationId,
        { click, req },
        SpeechBindingDraftSchema,
      );
      if (previous) return previous;
      const config = getConfig(click);
      const variety = requireConfirmedVariety(config);
      assertOwner(click.runId, req.owner);
      const saved =
        req.source.kind === "savedVoice"
          ? entity("saved", req.source.savedVoiceId, savedSchema)
          : null;
      const providerVoiceId =
        saved?.providerVoiceId ??
        (req.source.kind === "providerVoice" ? req.source.providerVoiceId : "");
      const voice = await assertCompatible(providerVoiceId, req.ttsModelId);
      return receipt(
        "draft",
        click.operationId,
        { click, req },
        () => {
          getConfig(click);
          const draft = SpeechBindingDraftSchema.parse({
            kind: "unvalidated",
            bindingDraftId: randomUUID(),
            owner: req.owner,
            providerVoiceId,
            ttsModelId: req.ttsModelId,
            varietyLabel: variety.label,
            configRevision: config.revision,
            source: req.source,
            provenance: saved
              ? {
                  kind: "created-by-this-app",
                  savedVoiceId: saved.savedVoiceId,
                  designModelId: saved.designModelId,
                }
              : {
                  kind: "existing-provider-voice-selected",
                  providerCatalogRef: voiceHash(JSON.stringify(voice)),
                },
            voiceSnapshot: VoiceSnapshotSchema.parse({
              providerVoiceId,
              name: voice.name,
              description: voice.description ?? "",
              language: "es",
              catalogHash: voiceHash(JSON.stringify(voice)),
            }),
          });
          put("draft", draft.bindingDraftId, { ...draft });
          put("draft-scope", draft.bindingDraftId, {
            runId: click.runId,
            principal: click.principal,
          });
          return draft;
        },
        SpeechBindingDraftSchema,
      );
    },
    requestBindingTest(
      clickInput: unknown,
      draftId: string,
      requestInput: unknown,
    ) {
      const click = clickSchema.parse(clickInput);
      const request = VoiceTestRequestSchema.parse(requestInput);
      const command = { draftId, request };
      const previous = replay(click, "binding-test", command);
      if (previous) return previous;
      const config = getConfig(click);
      const draft = entity("draft", draftId, SpeechBindingDraftSchema);
      const scope = entity(
        "draft-scope",
        draftId,
        z.object({ runId: z.string(), principal: z.string() }).strict(),
      );
      if (scope.runId !== click.runId || scope.principal !== click.principal)
        throw new Error("VOICE_DRAFT_FORBIDDEN");
      if (draft.varietyLabel !== requireConfirmedVariety(config).label)
        throw new Error("VOICE_BINDING_VARIETY_STALE");
      return schedule(
        click,
        { kind: "binding-test", config, draft, request },
        draft.ttsModelId,
        null,
        command,
      );
    },
    recordListened(request: {
      artifactId: string;
      principal: string;
      idempotencyKey: string;
    }) {
      return receipt(
        "listen",
        z.uuid().parse(request.idempotencyKey),
        request,
        () => {
          const artifact = media(
            request.artifactId,
            request.principal,
          ).artifact;
          const result = {
            artifactId: artifact.artifactId,
            principal: request.principal,
            listenedAt: new Date().toISOString(),
          };
          put("listen", `${artifact.artifactId}:${request.principal}`, result);
          return result;
        },
        z
          .object({
            artifactId: z.uuid(),
            principal: z.string(),
            listenedAt: z.iso.datetime(),
          })
          .strict(),
      );
    },
    acceptBinding(clickInput: unknown, requestInput: unknown) {
      const click = clickSchema.parse(clickInput);
      const req = z
        .object({
          bindingDraftId: z.uuid(),
          artifactId: z.uuid(),
          kind: z.enum(["accept", "reject"]),
        })
        .strict()
        .parse(requestInput);
      return receipt(
        "accept-binding",
        click.operationId,
        { click, req },
        () => {
          const config = getConfig(click);
          const draft = entity(
            "draft",
            req.bindingDraftId,
            SpeechBindingDraftSchema,
          );
          const artifact = media(req.artifactId, click.principal).artifact;
          const scope = entity(
            "draft-scope",
            draft.bindingDraftId,
            z.object({ runId: z.string(), principal: z.string() }).strict(),
          );
          if (
            scope.runId !== click.runId ||
            scope.principal !== click.principal ||
            artifact.kind !== "binding-test" ||
            artifact.sourceId !== draft.bindingDraftId ||
            artifact.modelId !== draft.ttsModelId ||
            artifact.configRevision !== config.revision ||
            draft.varietyLabel !== requireConfirmedVariety(config).label
          )
            throw new Error("VOICE_TEST_NOT_MATCHING");
          entity(
            "listen",
            `${artifact.artifactId}:${click.principal}`,
            z
              .object({
                artifactId: z.uuid(),
                principal: z.string(),
                listenedAt: z.iso.datetime(),
              })
              .strict(),
          );
          if (req.kind === "reject")
            return {
              kind: "rejected",
              bindingDraftId: draft.bindingDraftId,
            } as const;
          const binding = SpeechBindingSchema.parse({
            kind: "speech",
            speechBindingId: randomUUID(),
            owner: draft.owner,
            provider: "elevenlabs",
            voiceId: draft.providerVoiceId,
            voiceName: draft.voiceSnapshot.name,
            voiceDescription: draft.voiceSnapshot.description,
            language: "es",
            ttsModelId: draft.ttsModelId,
            varietyLabel: draft.varietyLabel,
            configRevision: config.revision,
            validationEvidenceId: randomUUID(),
            provenance: draft.provenance,
          });
          put("binding", binding.speechBindingId, binding);
          put("validation-evidence", binding.validationEvidenceId, {
            speechBindingId: binding.speechBindingId, bindingDraftId: draft.bindingDraftId,
            artifactId: artifact.artifactId, runId: click.runId, principal: click.principal,
            receiptId: click.operationId,
          });
          return { kind: "accepted" as const, binding };
        },
        z.discriminatedUnion("kind", [
          z
            .object({ kind: z.literal("rejected"), bindingDraftId: z.uuid() })
            .strict(),
          z
            .object({
              kind: z.literal("accepted"),
              binding: SpeechBindingSchema,
            })
            .strict(),
        ]),
      );
    },
    requestPublicationAudio(
      clickInput: unknown,
      publicationId: string,
      trigger: "operator" | "after-commit",
      frozenConfig?: VoiceConfig,
    ) {
      const click = clickSchema.parse(clickInput);
      const command = { publicationId, trigger };
      const previous = replay(click, "tts", command);
      if (previous) return previous;
      if (frozenConfig !== undefined && trigger !== "after-commit")
        throw new Error("VOICE_FROZEN_CONFIG_FORBIDDEN");
      const config =
        frozenConfig === undefined
          ? getConfig(click)
          : VoiceConfigSchema.parse(frozenConfig);
      if (config.revision !== click.expectedRevision)
        throw new Error("VOICE_CONFIG_STALE");
      if (config.audioMode.kind !== "enabled")
        throw new Error("VOICE_AUDIO_DISABLED");
      const variety = requireConfirmedVariety(config);
      if (
        (trigger === "operator" &&
          config.audioMode.ttsMode !== "manual-per-publication") ||
        (trigger === "after-commit" &&
          config.audioMode.ttsMode !== "automatic-after-publication")
      )
        throw new Error("VOICE_TTS_MODE_MISMATCH");
      const publication = publicationSchema.parse(
        input.readPublication(click.runId, publicationId),
      );
      if (
        publication.runId !== click.runId ||
        publication.publicationId !== publicationId ||
        publication.textHash !== voiceHash(publication.text)
      )
        throw new Error("VOICE_PUBLICATION_INVALID");
      if (
        trigger === "after-commit" &&
        publication.configRevision !== config.revision
      )
        throw new Error("VOICE_AUTOMATIC_BACKFILL_FORBIDDEN");
      assertOwner(click.runId, publication.owner);
      const slot =
        publication.owner.kind === "narrator"
          ? config.narratorSlot
          : config.speakerSlots[publication.owner.id];
      if (slot?.kind !== "enabled-bound")
        throw new Error("VOICE_BINDING_MISSING");
      const binding = entity(
        "binding",
        slot.speechBindingId,
        SpeechBindingSchema,
      );
      if (
        voiceOwnerKey(binding.owner) !== voiceOwnerKey(publication.owner) ||
        binding.varietyLabel !== variety.label ||
        binding.ttsModelId !== config.audioMode.ttsModelId
      )
        throw new Error("VOICE_BINDING_INCOMPATIBLE");
      return schedule(
        click,
        { kind: "tts", config, binding, publication },
        binding.ttsModelId,
        voiceHash(
          `${click.runId}:${publication.publicationId}:${publication.textHash}:${binding.speechBindingId}:${config.audioMode.outputFormat}`,
        ),
        command,
      );
    },
    requestSoundEffect(clickInput: unknown, requestInput: unknown) {
      const click = clickSchema.parse(clickInput);
      const request = SoundEffectRequestSchema.parse(requestInput);
      return schedule(
        click,
        { kind: "sfx", request },
        request.modelId,
        null,
        request,
      );
    },
    saveSoundEffect(clickInput: unknown, artifactId: string, sourceId: string) {
      const click = clickSchema.parse(clickInput);
      return receipt(
        "save-sound",
        click.operationId,
        { click, artifactId, sourceId },
        () => {
          const artifact = media(artifactId, click.principal).artifact;
          if (artifact.kind !== "sound-effect")
            throw new Error("VOICE_NOT_SOUND_EFFECT");
          entity(
            "listen",
            `${artifact.artifactId}:${click.principal}`,
            z
              .object({
                artifactId: z.uuid(),
                principal: z.string(),
                listenedAt: z.iso.datetime(),
              })
              .strict(),
          );
          const binding = SoundBindingSchema.parse({
            kind: "nonverbal-effect",
            soundBindingId: randomUUID(),
            sourceId,
            artifactId,
            configRevision: click.expectedRevision,
            provenance: {
              kind: "operator-reviewed-nonverbal",
              acceptedBy: click.principal,
              acceptedAt: new Date().toISOString(),
            },
          });
          put("sound-binding", binding.soundBindingId, binding);
          return binding;
        },
        SoundBindingSchema,
      );
    },
    associateSoundEffect(
      request: {
        operationId: string;
        principal: string;
        runId: string;
        eventId: string;
        soundBindingId: string;
      },
      readEvent: (
        runId: string,
        eventId: string,
      ) => {
        confirmed: boolean;
        nonverbal: boolean;
        soundCategory: string | null;
        audible: boolean;
      } | null,
    ) {
      return receipt(
        "associate-sound",
        z.uuid().parse(request.operationId),
        request,
        () => {
          const binding = entity(
            "sound-binding",
            request.soundBindingId,
            SoundBindingSchema,
          );
          const event = readEvent(request.runId, request.eventId);
          if (
            !event?.confirmed ||
            !event.nonverbal ||
            !event.soundCategory ||
            !event.audible
          )
            throw new Error("VOICE_SOUND_EVENT_NOT_AUTHORIZED");
          media(binding.artifactId, request.principal);
          return {
            runId: request.runId,
            eventId: request.eventId,
            soundBindingId: binding.soundBindingId,
            artifactId: binding.artifactId,
          };
        },
        z
          .object({
            runId: z.string(),
            eventId: z.string(),
            soundBindingId: z.uuid(),
            artifactId: z.uuid(),
          })
          .strict(),
      );
    },
    cancel(request: {
      operationId: string;
      principal: string;
      expectedOperationRevision: number;
      idempotencyKey: string;
    }) {
      return receipt(
        "cancel",
        z.uuid().parse(request.idempotencyKey),
        request,
        () => {
          const op = authorizeOperation(request.operationId, request.principal);
          if (op.revision !== request.expectedOperationRevision)
            throw new Error("VOICE_OPERATION_STALE");
          if (
            op.state === "ready" ||
            op.state === "failed" ||
            op.state === "orphaned" ||
            op.state === "uncertain"
          )
            return op;
          if (op.state === "queued" || op.state === "validating")
            setReservation(op.operationId, "released");
          aborts.get(op.operationId)?.abort();
          return update(op, { state: "cancelled" });
        },
        VoiceOperationSchema,
      );
    },
    async reconcileLocal(id: string, principal: string) {
      authorizeOperation(id, principal);
      return await persistStaged(id);
    },
    readMedia: media,
    getBinding(id: string) {
      return entity("binding", id, SpeechBindingSchema);
    },
    getSoundBinding(id: string) {
      return entity("sound-binding", id, SoundBindingSchema);
    },
    /** Host-only proof inspection; no synthesis, repair, receipt or provider call. */
    readBindingProof(request: {runId: string; kind: "speech" | "sound-effect"; bindingId: string}) {
      if (request.kind === "sound-effect") {
        const binding = entity("sound-binding", request.bindingId, SoundBindingSchema);
        const receiptRow = z.object({id:z.string(),request_hash:z.string(),result:z.string(),result_hash:z.string()}).parse(db.prepare("SELECT id,request_hash,result,result_hash FROM voice_receipts WHERE scope='save-sound' AND json_extract(result,'$.soundBindingId')=? LIMIT 1").get(binding.soundBindingId));
        if (receiptRow.result_hash !== voiceHash(JSON.stringify({scope:"save-sound",id:receiptRow.id,requestHash:receiptRow.request_hash,result:receiptRow.result})) || JSON.stringify(SoundBindingSchema.parse(JSON.parse(receiptRow.result))) !== JSON.stringify(binding)) throw new Error("VOICE_BINDING_PROOF_INVALID");
        const artifact = media(binding.artifactId, binding.provenance.acceptedBy).artifact;
        const op = operation(artifact.operationId);
        if (op.runId !== request.runId || op.state !== "ready" || artifact.kind !== "sound-effect") throw new Error("VOICE_BINDING_PROOF_INVALID");
        entity("listen", `${artifact.artifactId}:${binding.provenance.acceptedBy}`, z.object({artifactId:z.uuid(),principal:z.string(),listenedAt:z.iso.datetime()}).strict());
        return binding;
      }
      const binding = entity("binding", request.bindingId, SpeechBindingSchema);
      const evidence = entity("validation-evidence", binding.validationEvidenceId, z.strictObject({speechBindingId:z.uuid(),bindingDraftId:z.uuid(),artifactId:z.uuid(),runId:z.string(),principal:z.string(),receiptId:z.uuid()}));
      if (evidence.speechBindingId !== binding.speechBindingId || evidence.runId !== request.runId) throw new Error("VOICE_BINDING_PROOF_INVALID");
      const receiptRow = z.object({request_hash:z.string(),result:z.string(),result_hash:z.string()}).parse(db.prepare("SELECT request_hash,result,result_hash FROM voice_receipts WHERE scope='accept-binding' AND id=?").get(evidence.receiptId));
      if (receiptRow.result_hash !== voiceHash(JSON.stringify({scope:"accept-binding",id:evidence.receiptId,requestHash:receiptRow.request_hash,result:receiptRow.result}))) throw new Error("VOICE_RECEIPT_INTEGRITY_FAILED");
      const receiptResult = z.strictObject({kind:z.literal("accepted"),binding:SpeechBindingSchema}).parse(JSON.parse(receiptRow.result));
      if (JSON.stringify(receiptResult.binding) !== JSON.stringify(binding)) throw new Error("VOICE_BINDING_PROOF_INVALID");
      const artifact = media(evidence.artifactId,evidence.principal).artifact;
      const op = operation(artifact.operationId);
      const work = frozenWork(op.operationId);
      if (op.runId !== request.runId || op.state !== "ready" || work.kind !== "binding-test" || artifact.kind !== "binding-test" || artifact.sourceId !== evidence.bindingDraftId || artifact.modelId !== binding.ttsModelId || artifact.configRevision !== binding.configRevision || work.draft.bindingDraftId !== evidence.bindingDraftId || voiceOwnerKey(work.draft.owner) !== voiceOwnerKey(binding.owner) || work.draft.providerVoiceId !== binding.voiceId || work.draft.varietyLabel !== binding.varietyLabel || JSON.stringify(work.draft.provenance) !== JSON.stringify(binding.provenance)) throw new Error("VOICE_BINDING_PROOF_INVALID");
      entity("listen", `${artifact.artifactId}:${evidence.principal}`, z.object({artifactId:z.uuid(),principal:z.string(),listenedAt:z.iso.datetime()}).strict());
      if (binding.provenance.kind === "created-by-this-app") {
        const saved = entity("saved", binding.provenance.savedVoiceId, savedSchema);
        if (saved.providerVoiceId !== binding.voiceId || saved.designModelId !== binding.provenance.designModelId || work.draft.source.kind !== "savedVoice" || work.draft.source.savedVoiceId !== saved.savedVoiceId) throw new Error("VOICE_BINDING_PROVENANCE_INVALID");
      } else if (work.draft.source.kind !== "providerVoice" || work.draft.source.providerVoiceId !== binding.voiceId || binding.provenance.providerCatalogRef !== work.draft.voiceSnapshot.catalogHash) throw new Error("VOICE_BINDING_PROVENANCE_INVALID");
      return binding;
    },
    readArtifact(id: string, principal: string) {
      const artifact = entity("artifact", id, VoiceArtifactSchema);
      authorizeOperation(artifact.operationId, principal);
      return artifact;
    },
    expireArtifact(request: { artifactId: string; principal: string }) {
      return transaction(() => {
        const artifact = entity(
          "artifact",
          request.artifactId,
          VoiceArtifactSchema,
        );
        authorizeOperation(artifact.operationId, request.principal);
        const path = join(mediaRoot, `${artifact.artifactId}.bin`);
        if (existsSync(path)) unlinkSync(path);
        const expired = VoiceArtifactSchema.parse({
          ...artifact,
          state: "artifact-unavailable",
        });
        put("artifact", artifact.artifactId, expired);
        return expired;
      });
    },
    budget(runId: string) {
      return Object.fromEntries(
        reservationKinds.map((kind) => {
          const limit = input.quotaLimits(runId)[kind];
          const rows = reservationRows(runId, kind);
          const used = rows.filter((row) => row.state === "consumed").length;
          const reserved = rows.filter(
            (row) => row.state === "reserved",
          ).length;
          return [
            kind,
            {
              limit,
              used,
              reserved,
              remaining: Math.max(0, limit - used - reserved),
            },
          ];
        }),
      );
    },
    backupArtifacts() {
      if (admissionsSuspended < 1 || active > 0)
        throw new Error("VOICE_BACKUP_BARRIER_REQUIRED");
      const result: { path: string; kind: "media" }[] = [];
      let after = "";
      for (;;) {
        const rows = db
          .prepare(
            "SELECT id FROM voice_entities WHERE kind='artifact' AND id>? ORDER BY id LIMIT 100",
          )
          .all(after);
        if (!rows.length) break;
        for (const row of rows) {
          const id = z.object({ id: z.string() }).parse(row).id;
          after = id;
          const artifact = entity("artifact", id, VoiceArtifactSchema);
          if (artifact.state === "artifact-unavailable") continue;
          const bytes = privateBytes(
            join(mediaRoot, `${artifact.artifactId}.bin`),
          );
          if (
            bytes.byteLength !== artifact.byteLength ||
            voiceHash(bytes) !== artifact.hash
          )
            throw new Error("VOICE_MEDIA_HASH_MISMATCH");
          result.push({
            path: `media/${artifact.artifactId}.bin`,
            kind: "media",
          });
          if (result.length > 100000)
            throw new Error("VOICE_BACKUP_MEDIA_LIMIT");
        }
      }
      return result;
    },
    async suspendAdmissions() {
      if (closed || stopping) throw new Error("VOICE_SERVICE_STOPPING");
      admissionsSuspended++;
      await Promise.allSettled([...pending]);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        admissionsSuspended--;
      };
    },
    shutdown() {
      if (shutdownTask) return shutdownTask;
      if (closed) return Promise.resolve();
      shutdownTask = (async () => {
        stopping = true;
        transaction(() => {
          const rows = db
            .prepare(
              "SELECT id FROM voice_operations WHERE json_extract(data,'$.state') IN ('queued','validating','submitted') LIMIT 10000",
            )
            .all();
          for (const row of rows) {
            const op = operation(z.object({ id: z.string() }).parse(row).id);
            if (op.state === "queued" || op.state === "validating") {
              setReservation(op.operationId, "released");
              update(op, {
                state: "cancelled",
                safeCode: "VOICE_HOST_SHUTDOWN",
              });
            } else if (op.state === "submitted")
              update(op, {
                state: "cancelled",
                safeCode: "VOICE_HOST_SHUTDOWN",
              });
          }
        });
        for (const controller of aborts.values()) controller.abort();
        await Promise.allSettled([...pending]);
        db.close();
        closed = true;
      })();
      return shutdownTask;
    },
    close() {
      if (closed) return;
      if (active || stopping) throw new Error("VOICE_WORKERS_ACTIVE");
      db.close();
      closed = true;
    },
  });
}
export type VoiceService = ReturnType<typeof openVoiceService>;
