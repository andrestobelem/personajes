import {
  RunStageViewSchema,
  ConversationViewSchema,
} from "../../src/domain/run-observation.ts";
export function stageFixture() {
  return RunStageViewSchema.parse({
    kind: "run-stage",
    runId: "11111111-1111-4111-8111-111111111111",
    configRevision: 2,
    worldRevision: 4,
    worldSeq: 8,
    commitIndex: 9,
    fictionalAt: 0,
    clock: {
      instant: 0,
      convention: {
        kind: "fixedOffset",
        offsetMinutes: -180,
        label: "UTC−03:00",
      },
    },
    lifecycle: "paused",
    lifecycleAsOf: "current",
    activeSceneId: "22222222-2222-4222-8222-222222222222",
    scenes: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "Escena de prueba",
        lifecycle: "open",
        participantIds: ["maxwell-smart"],
        placeIds: ["sala"],
      },
    ],
    places: [
      { id: "sala", name: "Sala", width: 12, height: 8, lighting: "normal" },
    ],
    entities: [
      {
        kind: "character",
        entityId: "33333333-3333-4333-8333-333333333333",
        label: "Identidad visible",
        placeId: "sala",
        position: { x: 2, y: 3 },
        availability: "available",
        species: "human",
      },
      {
        kind: "object",
        entityId: "44444444-4444-4444-8444-444444444444",
        label: "Objeto llevado",
        placeId: null,
        position: null,
        holderEntityId: "33333333-3333-4333-8333-333333333333",
        quantity: 1,
        condition: "usable",
      },
    ],
    doors: [],
    connections: [],
    channels: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        kind: "speech",
        label: "Conversación",
        enabled: true,
        placeIds: ["sala"],
      },
    ],
    humanParticipants: [],
  });
}
export function conversationFixture() {
  const stage = stageFixture();
  return ConversationViewSchema.parse({
    kind: "published-communication",
    eventId: "66666666-6666-4666-8666-666666666666",
    runId: stage.runId,
    worldSeq: stage.worldSeq,
    commitIndex: stage.commitIndex,
    fictionalAt: stage.fictionalAt,
    sceneId: stage.activeSceneId,
    speaker: {
      kind: "character",
      entityId: "33333333-3333-4333-8333-333333333333",
      label: "Identidad visible",
    },
    channel: {
      id: "55555555-5555-4555-8555-555555555555",
      label: "Conversación",
    },
    content: { kind: "speech", text: "<script>dato, no código</script>" },
    emission: "emitted",
    requestedRecipients: [
      {
        entityId: "77777777-7777-4777-8777-777777777777",
        label: "Destinatario",
      },
    ],
    effectiveAudience: [],
    requestedRecipientCount: 1,
    effectiveAudienceCount: 0,
    deliveries: [],
  });
}
