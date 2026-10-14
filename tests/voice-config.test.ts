import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireHostOwnership } from "../src/adapters/host-ownership.ts";
import { openVoiceConfigStore } from "../src/application/voice-config-store.ts";
import { openVoiceCredentialStore } from "../src/application/voice-credentials.ts";
import { VoiceConfigSchema } from "../src/domain/voice.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "personajes-voice-config-"));
  const ownership = acquireHostOwnership({ privateDataRoot: root });
  let baseRevision = 3;
  let baseHash = "a".repeat(64);
  const initial = VoiceConfigSchema.parse({
    revision: 3,
    spanishVariety: {
      kind: "proposed",
      source: "editorial-proposal",
      label: "español rioplatense",
    },
    audioMode: { kind: "disabled" },
    speakerSlots: { max: { kind: "disabled" } },
    narratorSlot: { kind: "absent" },
    soundEffectSlots: { fang: { kind: "disabled" } },
  });
  const options = {
    privateDataRoot: root,
    ownerToken: ownership.ownerToken,
    readBaseConfiguration: () => ({
      configurationRevision: baseRevision,
      configurationHash: baseHash,
      voiceConfig: initial,
      speakableIds: ["max"],
    }),
    readSpeechBinding: () => {
      throw new Error("not found");
    },
    readSoundBinding: () => {
      throw new Error("not found");
    },
    initialQuotaLimits: { voiceDesignCalls: 2, ttsCalls: 4, sfxCalls: 2 },
  };
  let store = openVoiceConfigStore(options);
  return {
    get store() {
      return store;
    },
    root,
    changeBase() {
      baseRevision++;
      baseHash = "b".repeat(64);
    },
    reopen() {
      store.close();
      store = openVoiceConfigStore(options);
    },
    command: (revision = store.read("run").config.revision) => ({
      runId: "run",
      principal: "authenticated-operator",
      operationId: randomUUID(),
      expectedRevision: revision,
    }),
    cleanup() {
      store.close();
      ownership.release();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("initial imported presentation config is durable, disabled and not claimed as human confirmation", () => {
  const f = setup();
  try {
    const first = f.store.read("run");
    assert.equal(first.config.revision, 0);
    assert.equal(first.config.audioMode.kind, "disabled");
    assert.equal(first.config.spanishVariety.kind, "proposed");
    assert.equal(first.baseRunConfigurationRevision, 3);
    f.reopen();
    assert.deepEqual(f.store.read("run"), first);
    assert.deepEqual(f.store.readHistorical("run", 0), first);
  } finally {
    f.cleanup();
  }
});
test("human confirmation stamped by host, idempotent receipt precedes stale CAS", () => {
  const f = setup();
  try {
    const command = {
      ...f.command(),
      label: "español rioplatense",
      kind: "confirm" as const,
    };
    const confirmed = f.store.setVariety(command);
    assert.equal(confirmed.config.revision, 1);
    assert.equal(confirmed.config.spanishVariety.kind, "confirmed");
    if (confirmed.config.spanishVariety.kind === "confirmed")
      assert.equal(
        confirmed.config.spanishVariety.confirmedBy,
        "authenticated-operator",
      );
    assert.deepEqual(f.store.setVariety(command), confirmed);
    assert.throws(
      () => f.store.setVariety({ ...command, label: "español de España" }),
      /IDEMPOTENCY/,
    );
    assert.throws(
      () =>
        f.store.setVariety({
          ...f.command(0),
          label: "español de España",
          kind: "confirm",
        }),
      /STALE/,
    );
    assert.equal(
      f.store.readHistorical("run", 0).config.spanishVariety.kind,
      "proposed",
    );
  } finally {
    f.cleanup();
  }
});
test("core configuration changed requires explicit reconciliation, retains voice and core historical revisions", () => {
  const f = setup();
  try {
    f.store.read("run");
    f.store.setVariety({
      ...f.command(),
      kind: "confirm",
      label: "español rioplatense",
    });
    f.changeBase();
    assert.throws(() => f.store.read("run"), /BASE_CONFIGURATION_STALE/);
    const snapshot = f.store.reconcile({ ...f.command(1) });
    assert.equal(snapshot.config.revision, 2);
    assert.equal(snapshot.baseRunConfigurationRevision, 4);
    assert.equal(snapshot.config.spanishVariety.kind, "confirmed");
    assert.equal(
      f.store.readHistorical("run", 0).baseRunConfigurationRevision,
      3,
    );
  } finally {
    f.cleanup();
  }
});
test("settings CAS and independent quota revision; forging evidence or Fang speech forbidden", () => {
  const f = setup();
  try {
    const current = f.store.read("run");
    const settings = {
      audioMode: current.config.audioMode,
      speakerSlots: current.config.speakerSlots,
      narratorSlot: current.config.narratorSlot,
      soundEffectSlots: current.config.soundEffectSlots,
      quotaLimits: { voiceDesignCalls: 7, ttsCalls: 12, sfxCalls: 1 },
    };
    const updated = f.store.update({ ...f.command(), settings });
    assert.equal(updated.config.revision, 1);
    assert.deepEqual(updated.quotaLimits, settings.quotaLimits);
    assert.throws(
      () =>
        f.store.update({
          ...f.command(),
          settings: {
            ...settings,
            speakerSlots: { fang: { kind: "enabled-unbound" } },
          },
        }),
      /OWNER_NOT_SPEAKABLE/,
    );
    assert.throws(() =>
      f.store.update({
        ...f.command(),
        settings: { ...settings, confirmedBy: "forged" },
      }),
    );
  } finally {
    f.cleanup();
  }
});
test("credential idempotency stores no key fingerprints and never reapplies a repeated secret command", () => {
  const root = mkdtempSync(join(tmpdir(), "personajes-voice-credential-"));
  try {
    const store = openVoiceCredentialStore({ privateAuthRoot: root });
    const operationId = randomUUID();
    store.replaceOnce({ operationId, raw: { apiKey: "first-private-key" } });
    store.replaceOnce({ operationId, raw: { apiKey: "another-key" } });
    assert.equal(store.getApiKey(), "first-private-key");
    assert.throws(() => store.removeOnce({ operationId }), /IDEMPOTENCY/);
    store.removeOnce({ operationId: randomUUID() });
    assert.equal(store.status().credentialConfigured, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
