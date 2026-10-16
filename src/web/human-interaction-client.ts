import { HumanReceptionPageSchema } from "../domain/run-observation.ts";
import { z } from "zod";
import {
  ApiProblemSchema,
  SessionModeSchema,
  SessionViewSchema,
  HumanInterventionAcceptedSchema,
  type SessionMode,
  type SessionView,
} from "../domain/http.ts";
import {
  HumanInteractionContextSchema,
  HumanInterventionRequestSchema,
  type HumanInteractionContext,
  type HumanInterventionRequest,
} from "../domain/interaction-schema.ts";
import { bootstrapSession } from "./client.ts";
import { WorldSeqSchema, HumanParticipantIdSchema } from "../domain/values.ts";

export type SessionDocument = { view: SessionView; etag: string };
export type ContextDocument = { view: HumanInteractionContext; etag: string };
export type HumanIntent =
  | { kind: "mode"; mode: SessionMode; etag: string; key: string }
  | {
      kind: "speech";
      runId: string;
      participantId: string;
      request: HumanInterventionRequest;
      etag: string;
      key: string;
    };
export class HumanRejection extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function captureHumanIntent(intent: HumanIntent): HumanIntent {
  const key = z.string().uuid().parse(intent.key);
  if (intent.kind === "mode")
    return { ...intent, key, mode: SessionModeSchema.parse(intent.mode) };
  return {
    ...intent,
    key,
    runId: z.string().uuid().parse(intent.runId),
    participantId: HumanParticipantIdSchema.parse(intent.participantId),
    request: HumanInterventionRequestSchema.parse(intent.request),
  };
}
export function buildHumanRequest(intent: HumanIntent, csrfToken: string) {
  const saved = captureHumanIntent(intent);
  return {
    path:
      saved.kind === "mode"
        ? "/api/v1/session/mode"
        : `/api/v1/runs/${saved.runId}/interventions`,
    init: {
      method: saved.kind === "mode" ? "PUT" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "If-Match": saved.etag,
        "Idempotency-Key": saved.key,
      },
      body: JSON.stringify(saved.kind === "mode" ? saved.mode : saved.request),
    } satisfies RequestInit,
  };
}
async function body(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(value);
    if (
      problem.success &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408
    )
      throw new HumanRejection(response.status, problem.data.error.message);
    throw new Error(
      "Resultado incierto: conservá la operación y reintentá la misma clave.",
    );
  }
  return value;
}
function sessionDocument(value: unknown, response: Response): SessionDocument {
  const view = SessionViewSchema.parse(value);
  const etag = `"session:r${view.sessionRevision}"`;
  if (response.headers.get("etag") !== etag)
    throw new Error("Revisión de sesión inconsistente");
  return { view, etag };
}
export function createHumanInteractionClient(
  request: typeof fetch = fetch,
  bootstrap = bootstrapSession,
) {
  return {
    async session() {
      await bootstrap();
      const response = await request("/api/v1/session", {
        credentials: "same-origin",
      });
      return sessionDocument(await body(response), response);
    },
    async context(runId: string): Promise<ContextDocument> {
      const response = await request(
        `/api/v1/runs/${z.string().uuid().parse(runId)}/intervention-context`,
        { credentials: "same-origin" },
      );
      const view = HumanInteractionContextSchema.parse(await body(response));
      const etag = `"world:${runId}:r${view.worldRevision}"`;
      if (view.runId !== runId || response.headers.get("etag") !== etag)
        throw new Error("Contexto de otra representación o revisión");
      return { view, etag };
    },
    async receptions(runId: string, participantId: string, fromWorldSeq=0) {
      const checkedRun=z.string().uuid().parse(runId);
      const checkedParticipant=HumanParticipantIdSchema.parse(participantId);
      const from=WorldSeqSchema.parse(fromWorldSeq);
      const items=[];
      let throughWorldSeq=from;
      let cursor:string|null=null;
      do {
        const query=new URLSearchParams({limit:'100'});
        if(from>0)query.set('fromWorldSeq',String(from));
        if(cursor!==null)query.set('pageCursor',cursor);
        const response=await request(`/api/v1/runs/${checkedRun}/human-receptions?${query}`,{credentials:'same-origin'});
        const page=HumanReceptionPageSchema.parse(await body(response));
        if(page.runId!==checkedRun||page.participantId!==checkedParticipant)throw new Error('La recepción pertenece a otra identidad o representación');
        items.push(...page.items);throughWorldSeq=page.toWorldSeq;cursor=page.nextCursor;
      } while(cursor!==null);
      return {items,throughWorldSeq};
    },
    async mutate(intent: HumanIntent) {
      const session = await bootstrap();
      const built = buildHumanRequest(intent, session.csrfToken);
      const response = await request(built.path, built.init);
      const value = await body(response);
      if (intent.kind === "mode") {
        if (response.status !== 200) throw new Error("Modo no confirmado");
        return {
          kind: "mode" as const,
          document: sessionDocument(value, response),
        };
      }
      if (response.status !== 202)
        throw new Error("Intervención no confirmada");
      const receipt = HumanInterventionAcceptedSchema.parse(value);
      if (
        response.headers.get("etag") !==
        `"world:${intent.runId}:r${receipt.worldRevision}"`
      )
        throw new Error("Revisión del recibo inconsistente");
      return { kind: "speech" as const, receipt };
    },
  };
}
export type HumanInteractionClient = ReturnType<
  typeof createHumanInteractionClient
>;
