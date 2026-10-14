import { z } from "zod";
import {
  ApiProblemSchema,
  RunControlReceiptSchema,
  RunViewSchema,
  type RunView,
} from "../domain/http.ts";
import {
  RunLifecycleControlRequestSchema,
  type RunLifecycleControlRequest,
} from "../domain/run-lifecycle.ts";
import { RunStepJobViewSchema } from "../domain/run-lifecycle.ts";
import { bootstrapSession } from "./client.ts";

export type RunDocument = { view: RunView; etag: string };
export type RunControlIntent = {
  document: RunDocument;
  command: RunLifecycleControlRequest;
  key: string;
};
export function runEtag(view: RunView) {
  return `"run:${view.runId}:c${view.configRevision}:w${view.worldRevision}:l${view.lifecycleRevision}"`;
}
export function captureRunControl(input: RunControlIntent): RunControlIntent {
  const view = RunViewSchema.parse(input.document.view);
  if (input.document.etag !== runEtag(view))
    throw new Error("La revisión de la representación no coincide.");
  return {
    document: { view, etag: input.document.etag },
    command: RunLifecycleControlRequestSchema.parse(input.command),
    key: z.string().uuid().parse(input.key),
  };
}
export function buildRunControlRequest(input: {
  intent: RunControlIntent;
  csrfToken: string;
}) {
  const intent = captureRunControl(input.intent);
  return {
    path: `/api/v1/runs/${intent.document.view.runId}/${intent.command.kind}`,
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": input.csrfToken,
        "Idempotency-Key": intent.key,
        "If-Match": intent.document.etag,
      },
      body: JSON.stringify(intent.command),
    } satisfies RequestInit,
  };
}
const Rejection = z.strictObject({
  kind: z.literal("run-control-rejected"),
  status: z.number().int(),
  message: z.string(),
  requestId: z.string().uuid(),
});
export function runControlRejection(error: unknown) {
  return Rejection.safeParse(error).data;
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
      throw Rejection.parse({
        kind: "run-control-rejected",
        status: response.status,
        message: problem.data.error.message,
        requestId: problem.data.requestId,
      });
    throw new Error("No se confirmó el control.");
  }
  return value;
}
function document(
  view: RunView,
  response: Response,
  runId: string,
): RunDocument {
  if (view.runId !== runId || response.headers.get("etag") !== runEtag(view))
    throw new Error("La respuesta pertenece a otra representación o revisión.");
  return { view, etag: runEtag(view) };
}
export function createRunControlsClient(
  request: typeof fetch = (url, options) => fetch(url, options),
) {
  return {
    async stepJob(runId: string, jobId: string, signal: AbortSignal) {
      const response = await request(
        `/api/v1/runs/${z.string().uuid().parse(runId)}/steps/${z.string().uuid().parse(jobId)}`,
        { credentials: "same-origin", signal },
      );
      const job = RunStepJobViewSchema.parse(await body(response));
      if (
        job.runId !== runId ||
        job.jobId !== jobId ||
        response.headers.get("etag") !==
          `"run-step:${job.jobId}:r${job.revision}"`
      )
        throw new Error("El trabajo pertenece a otro ámbito o revisión.");
      return job;
    },
    async read(runId: string, signal: AbortSignal) {
      await bootstrapSession();
      const response = await request(
        `/api/v1/runs/${z.string().uuid().parse(runId)}`,
        { credentials: "same-origin", signal },
      );
      return document(
        RunViewSchema.parse(await body(response)),
        response,
        runId,
      );
    },
    async mutate(intent: RunControlIntent, signal: AbortSignal) {
      const session = await bootstrapSession();
      const built = buildRunControlRequest({
        intent,
        csrfToken: session.csrfToken,
      });
      const response = await request(built.path, { ...built.init, signal });
      const value = await body(response);
      if (response.status === 202) {
        const receipt = RunControlReceiptSchema.parse(value);
        return {
          document: document(receipt.run, response, intent.document.view.runId),
          job: receipt.job,
        };
      }
      if (response.status !== 200)
        throw new Error("El control no tiene un recibo reconocido.");
      return {
        document: document(
          RunViewSchema.parse(value),
          response,
          intent.document.view.runId,
        ),
        job: null,
      };
    },
  };
}
export type RunControlsClient = ReturnType<typeof createRunControlsClient>;
