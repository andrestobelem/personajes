import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  AudioModeSchema,
  SpeakerSlotSchema,
  NarratorSlotSchema,
  SoundEffectSlotSchema,
  VoiceConfigSchema,
  SpeechBindingSchema,
  SoundBindingSchema,
  assertVoiceOwner,
  voiceOwnerKey,
  VoiceQuotaLimitsSchema,
  VoiceConfigSnapshotSchema,
} from "../domain/voice.ts";
import type { VoiceConfig } from "../domain/voice.ts";
import { voiceHash } from "./voice-hash.ts";

export { VoiceQuotaLimitsSchema, VoiceConfigSnapshotSchema };
export const VoiceSettingsRequestSchema = z
  .object({
    audioMode: AudioModeSchema,
    speakerSlots: z.record(z.string(), SpeakerSlotSchema),
    narratorSlot: NarratorSlotSchema,
    soundEffectSlots: z.record(z.string(), SoundEffectSlotSchema),
    quotaLimits: VoiceQuotaLimitsSchema,
  })
  .strict();
const baseSchema = z
  .object({
    configurationRevision: z.number().int().nonnegative(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    voiceConfig: VoiceConfigSchema,
    speakableIds: z.array(z.string()),
    createdAt: z.iso.datetime().nullable().optional(),
    effectOwnerIds: z.array(z.string()).optional(),
  })
  .strict();
const snapshotSchema = VoiceConfigSnapshotSchema;
export type VoiceConfigSnapshot = z.infer<typeof snapshotSchema>;
export function voiceConfigEtag(runId: string, revision: number) {
  return `"voice-config:${runId}:r${revision}"`;
}

/** Independent presentation revisions preserve historical Pi/continuity fences. Core edits require explicit reconciliation. */
export function openVoiceConfigStore(input: {
  privateDataRoot: string;
  ownerToken: string;
  readBaseConfiguration: (runId: string) => z.infer<typeof baseSchema>;
  readSpeechBinding: (id: string) => unknown;
  readSoundBinding: (id: string) => unknown;
  initialQuotaLimits: z.infer<typeof VoiceQuotaLimitsSchema>;
}) {
  function owned() {
    const lock = z
      .object({ nonce: z.uuid(), pid: z.number() })
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
  owned();
  const db = new DatabaseSync(join(input.privateDataRoot, "world.sqlite"));
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(`CREATE TABLE IF NOT EXISTS voice_config_versions(run_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,data_hash TEXT NOT NULL,PRIMARY KEY(run_id,revision));
 CREATE TABLE IF NOT EXISTS voice_config_receipts(operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL,result_hash TEXT NOT NULL);`);
  function transact<T>(fn: () => T) {
    owned();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function verifiedSnapshot(value: unknown, runId: string) {
    const row = z
      .object({
        run_id: z.string(),
        revision: z.number().int().nonnegative(),
        data: z.string(),
        data_hash: z.string(),
      })
      .parse(value);
    if (
      row.run_id !== runId ||
      row.data_hash !==
        voiceHash(
          JSON.stringify({
            runId: row.run_id,
            revision: row.revision,
            data: row.data,
          }),
        )
    )
      throw new Error("VOICE_CONFIG_INTEGRITY_FAILED");
    const snapshot = snapshotSchema.parse(JSON.parse(row.data));
    if (snapshot.config.revision !== row.revision)
      throw new Error("VOICE_CONFIG_SCOPE_INVALID");
    return snapshot;
  }
  function base(runId: string) {
    return baseSchema.parse(input.readBaseConfiguration(runId));
  }
  function readRaw(runId: string) {
    const row = db
      .prepare(
        "SELECT run_id,revision,data,data_hash FROM voice_config_versions WHERE run_id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(runId);
    if (row) return verifiedSnapshot(row, runId);
    const original = base(runId);
    const snapshot = snapshotSchema.parse({
      config: { ...original.voiceConfig, revision: 0 },
      baseRunConfigurationRevision: original.configurationRevision,
      baseRunConfigurationHash: original.configurationHash,
      quotaLimits: input.initialQuotaLimits,
      updatedBy: "host-imported-existing-configuration",
      updatedAt: original.createdAt ?? new Date().toISOString(),
    });
    owned();
    db.prepare(
      "INSERT INTO voice_config_versions(run_id,revision,data,data_hash) VALUES(?,?,?,?)",
    ).run(
      runId,
      0,
      JSON.stringify(snapshot),
      voiceHash(
        JSON.stringify({ runId, revision: 0, data: JSON.stringify(snapshot) }),
      ),
    );
    return snapshot;
  }
  function read(runId: string) {
    const stored = readRaw(runId);
    const current = base(runId);
    if (
      stored.baseRunConfigurationRevision !== current.configurationRevision ||
      stored.baseRunConfigurationHash !== current.configurationHash
    )
      throw new Error("VOICE_BASE_CONFIGURATION_STALE");
    return stored;
  }
  function validateSlots(runId: string, config: VoiceConfig) {
    const current = base(runId);
    for (const [id, slot] of Object.entries(config.speakerSlots)) {
      assertVoiceOwner({ kind: "character", id }, current.speakableIds);
      if (slot.kind === "enabled-bound") {
        const binding = SpeechBindingSchema.parse(
          input.readSpeechBinding(slot.speechBindingId),
        );
        if (
          voiceOwnerKey(binding.owner) !== id ||
          binding.varietyLabel !== config.spanishVariety.label ||
          config.spanishVariety.kind !== "confirmed"
        )
          throw new Error("VOICE_BINDING_INCOMPATIBLE");
        if (
          config.audioMode.kind === "enabled" &&
          binding.ttsModelId !== config.audioMode.ttsModelId
        )
          throw new Error("VOICE_BINDING_MODEL_MISMATCH");
      }
    }
    if (config.narratorSlot.kind === "enabled-bound") {
      const binding = SpeechBindingSchema.parse(
        input.readSpeechBinding(config.narratorSlot.speechBindingId),
      );
      if (
        binding.owner.kind !== "narrator" ||
        binding.varietyLabel !== config.spanishVariety.label ||
        config.spanishVariety.kind !== "confirmed"
      )
        throw new Error("VOICE_BINDING_INCOMPATIBLE");
      if (
        config.audioMode.kind === "enabled" &&
        binding.ttsModelId !== config.audioMode.ttsModelId
      )
        throw new Error("VOICE_BINDING_MODEL_MISMATCH");
    }
    const allowedEffects = current.effectOwnerIds ?? ["fang", "familia-smart"];
    for (const ownerId of Object.keys(config.soundEffectSlots))
      if (!allowedEffects.includes(ownerId))
        throw new Error("VOICE_EFFECT_OWNER_INVALID");
    for (const slot of Object.values(config.soundEffectSlots))
      if (slot.kind === "enabled-bound")
        SoundBindingSchema.parse(input.readSoundBinding(slot.soundBindingId));
  }
  function mutate(
    request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
      command: unknown;
    },
    fn: (prior: VoiceConfigSnapshot) => VoiceConfigSnapshot,
    reconcile = false,
  ) {
    return transact(() => {
      const operationId = z.uuid().parse(request.operationId);
      const hash = voiceHash(
        JSON.stringify({
          runId: request.runId,
          principal: request.principal,
          command: request.command,
        }),
      );
      const old = db
        .prepare(
          "SELECT request_hash,result,result_hash FROM voice_config_receipts WHERE operation_id=?",
        )
        .get(operationId);
      if (old) {
        const result = z
          .object({
            request_hash: z.string(),
            result: z.string(),
            result_hash: z.string(),
          })
          .parse(old);
        if (
          result.result_hash !==
          voiceHash(
            JSON.stringify({
              operationId,
              requestHash: result.request_hash,
              result: result.result,
            }),
          )
        )
          throw new Error("VOICE_CONFIG_RECEIPT_INTEGRITY_FAILED");
        if (result.request_hash !== hash)
          throw new Error("VOICE_IDEMPOTENCY_KEY_REUSE");
        return snapshotSchema.parse(JSON.parse(result.result));
      }
      const prior = reconcile ? readRaw(request.runId) : read(request.runId);
      if (prior.config.revision !== request.expectedRevision)
        throw new Error("VOICE_CONFIG_STALE");
      const next = snapshotSchema.parse(fn(prior));
      validateSlots(request.runId, next.config);
      db.prepare(
        "INSERT INTO voice_config_versions(run_id,revision,data,data_hash) VALUES(?,?,?,?)",
      ).run(
        request.runId,
        next.config.revision,
        JSON.stringify(next),
        voiceHash(
          JSON.stringify({
            runId: request.runId,
            revision: next.config.revision,
            data: JSON.stringify(next),
          }),
        ),
      );
      db.prepare(
        "INSERT INTO voice_config_receipts(operation_id,request_hash,result,result_hash) VALUES(?,?,?,?)",
      ).run(
        operationId,
        hash,
        JSON.stringify(next),
        voiceHash(
          JSON.stringify({
            operationId,
            requestHash: hash,
            result: JSON.stringify(next),
          }),
        ),
      );
      return next;
    });
  }
  function revised(
    prior: VoiceConfigSnapshot,
    principal: string,
    config: VoiceConfig,
    quotaLimits = prior.quotaLimits,
  ) {
    return {
      ...prior,
      config: { ...config, revision: prior.config.revision + 1 },
      quotaLimits,
      updatedBy: principal,
      updatedAt: new Date().toISOString(),
    };
  }
  return Object.freeze({
    read,
    readHistorical(runId: string, revision: number) {
      const row = db
        .prepare(
          "SELECT run_id,revision,data,data_hash FROM voice_config_versions WHERE run_id=? AND revision=?",
        )
        .get(runId, revision);
      if (!row) throw new Error("VOICE_CONFIG_VERSION_NOT_FOUND");
      return verifiedSnapshot(row, runId);
    },
    readAt(runId: string, at: string | number) {
      readRaw(runId);
      const time = z.iso
        .datetime()
        .parse(typeof at === "number" ? new Date(at).toISOString() : at);
      const rows = db
        .prepare(
          "SELECT run_id,revision,data,data_hash FROM voice_config_versions WHERE run_id=? AND json_extract(data,'$.updatedAt')<=? ORDER BY revision DESC LIMIT 1",
        )
        .all(runId, time);
      return rows[0] ? verifiedSnapshot(rows[0], runId) : null;
    },
    readUnreconciled: readRaw,
    update(request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
      settings: unknown;
    }) {
      const settings = VoiceSettingsRequestSchema.parse(request.settings);
      const { quotaLimits, ...voiceSettings } = settings;
      return mutate(
        { ...request, command: { kind: "settings", settings } },
        (prior) =>
          revised(
            prior,
            request.principal,
            { ...prior.config, ...voiceSettings },
            quotaLimits,
          ),
      );
    },
    setVariety(request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
      label: string;
      kind: "propose" | "confirm";
    }) {
      const label = z.string().min(1).max(300).parse(request.label);
      return mutate(
        { ...request, command: { kind: request.kind, label } },
        (prior) =>
          revised(prior, request.principal, {
            ...prior.config,
            spanishVariety:
              request.kind === "propose"
                ? { kind: "proposed", source: "editorial-proposal", label }
                : {
                    kind: "confirmed",
                    source: "operator",
                    label,
                    confirmedBy: request.principal,
                    confirmedAt: new Date().toISOString(),
                  },
            speakerSlots: Object.fromEntries(
              Object.entries(prior.config.speakerSlots).map(([id, slot]) => [
                id,
                slot.kind === "disabled" ? slot : { kind: "enabled-unbound" },
              ]),
            ),
            narratorSlot:
              prior.config.narratorSlot.kind === "absent"
                ? { kind: "absent" }
                : { kind: "enabled-unbound" },
          }),
      );
    },
    bindSpeech(request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
      speechBindingId: string;
    }) {
      return mutate(
        {
          ...request,
          command: {
            kind: "bind-speech",
            speechBindingId: request.speechBindingId,
          },
        },
        (prior) => {
          const binding = SpeechBindingSchema.parse(
            input.readSpeechBinding(request.speechBindingId),
          );
          const config =
            binding.owner.kind === "narrator"
              ? {
                  ...prior.config,
                  narratorSlot: {
                    kind: "enabled-bound" as const,
                    speechBindingId: binding.speechBindingId,
                  },
                }
              : {
                  ...prior.config,
                  speakerSlots: {
                    ...prior.config.speakerSlots,
                    [binding.owner.id]: {
                      kind: "enabled-bound" as const,
                      speechBindingId: binding.speechBindingId,
                    },
                  },
                };
          return revised(prior, request.principal, config);
        },
      );
    },
    bindSound(request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
      ownerId: string;
      soundBindingId: string;
    }) {
      return mutate(
        {
          ...request,
          command: {
            kind: "bind-sound",
            ownerId: request.ownerId,
            soundBindingId: request.soundBindingId,
          },
        },
        (prior) => {
          const binding = SoundBindingSchema.parse(
            input.readSoundBinding(request.soundBindingId),
          );
          return revised(prior, request.principal, {
            ...prior.config,
            soundEffectSlots: {
              ...prior.config.soundEffectSlots,
              [request.ownerId]: {
                kind: "enabled-bound",
                soundBindingId: binding.soundBindingId,
              },
            },
          });
        },
      );
    },
    reconcile(request: {
      runId: string;
      principal: string;
      operationId: string;
      expectedRevision: number;
    }) {
      return mutate(
        { ...request, command: { kind: "reconcile-base" } },
        (prior) => {
          const current = base(request.runId);
          const speakerSlots = Object.fromEntries(
            Object.entries(prior.config.speakerSlots).filter(([id]) =>
              current.speakableIds.includes(id),
            ),
          );
          return {
            ...revised(prior, request.principal, {
              ...prior.config,
              speakerSlots,
              soundEffectSlots: Object.fromEntries(
                Object.entries(prior.config.soundEffectSlots).filter(([id]) =>
                  (
                    current.effectOwnerIds ?? ["fang", "familia-smart"]
                  ).includes(id),
                ),
              ),
            }),
            baseRunConfigurationRevision: current.configurationRevision,
            baseRunConfigurationHash: current.configurationHash,
          };
        },
        true,
      );
    },
    close() {
      db.close();
    },
  });
}
export type VoiceConfigStore = ReturnType<typeof openVoiceConfigStore>;
