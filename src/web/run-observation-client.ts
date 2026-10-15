import { z } from "zod";
import { ApiProblemSchema } from "../domain/http.ts";
import {
  RunStageViewSchema,
  ConversationPageSchema,
  ConfirmedEventPageSchema,
  TechnicalJobPageSchema,
  DirectorObservationListSchema,
} from "../domain/run-observation.ts";
import { bootstrapSession } from "./client.ts";
const Id = z.string().uuid();
const Seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
async function parse<T>(response: Response, schema: z.ZodType<T>) {
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(value);
    throw new Error(
      problem.success
        ? `${problem.data.error.message} Referencia: ${problem.data.requestId}.`
        : "La lectura del Escenario no pudo completarse.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "La lectura del host no tiene el formato público esperado.",
    );
  return parsed.data;
}
export function createRunObservationClient(
  request: typeof fetch = (url, init) => fetch(url, init),
  bootstrap = bootstrapSession,
) {
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ) {
    await bootstrap();
    return parse(
      await request(path, { credentials: "same-origin", signal }),
      schema,
    );
  }
  function query(input: {
    fromWorldSeq: number;
    toWorldSeq: number;
    cursor?: string;
  }) {
    return new URLSearchParams({
      fromWorldSeq: String(Seq.parse(input.fromWorldSeq)),
      toWorldSeq: String(Seq.parse(input.toWorldSeq)),
      limit: "100",
      ...(input.cursor === undefined ? {} : { pageCursor: input.cursor }),
    });
  }
  return {
    async stage(runId: string, signal: AbortSignal, cut?: number | { commitIndex: number }) {
      const query = cut === undefined ? '' : typeof cut === 'number'
        ? `?atWorldSeq=${Seq.parse(cut)}` : `?atCommitIndex=${Seq.parse(cut.commitIndex)}`;
      const path = `/api/v1/runs/${Id.parse(runId)}/stage${query}`;
      const value = await read(path, RunStageViewSchema, signal);
      if (
        value.runId !== runId ||
        (typeof cut === 'number' && value.worldSeq !== cut) ||
        (typeof cut === 'object' && value.commitIndex !== cut.commitIndex)
      )
        throw new Error("El Escenario recibido corresponde a otro corte.");
      return value;
    },
    async directorObservations(runId: string, signal: AbortSignal, atCommitIndex?: number) {
      const query = atCommitIndex === undefined ? '' : `?atCommitIndex=${Seq.parse(atCommitIndex)}`;
      const value = await read(`/api/v1/runs/${Id.parse(runId)}/director-observations${query}`, DirectorObservationListSchema, signal);
      if (value.runId !== runId || (atCommitIndex !== undefined && value.throughCommitIndex !== atCommitIndex))
        throw new Error("Las observaciones del Director corresponden a otra representación o corte.");
      return value;
    },
    async conversations(input: {
      runId: string;
      fromWorldSeq: number;
      toWorldSeq: number;
      cursor?: string;
      signal: AbortSignal;
    }) {
      const page = await read(
        `/api/v1/runs/${Id.parse(input.runId)}/conversations?${query(input)}`,
        ConversationPageSchema,
        input.signal,
      );
      if (
        page.runId !== input.runId ||
        page.fromWorldSeq !== input.fromWorldSeq ||
        page.toWorldSeq !== input.toWorldSeq ||
        page.items.some(
          (item) =>
            item.runId !== input.runId ||
            item.worldSeq < input.fromWorldSeq ||
            item.worldSeq > input.toWorldSeq,
        )
      )
        throw new Error(
          "La conversación recibida no corresponde al corte solicitado.",
        );
      return page;
    },
    async events(input: {
      runId: string;
      fromWorldSeq: number;
      toWorldSeq: number;
      cursor?: string;
      signal: AbortSignal;
    }) {
      const page = await read(
        `/api/v1/runs/${Id.parse(input.runId)}/events?${query(input)}`,
        ConfirmedEventPageSchema,
        input.signal,
      );
      if (
        page.runId !== input.runId ||
        page.fromWorldSeq !== input.fromWorldSeq ||
        page.toWorldSeq !== input.toWorldSeq ||
        page.items.some(
          (item) =>
            item.runId !== input.runId ||
            item.worldSeq < input.fromWorldSeq ||
            item.worldSeq > input.toWorldSeq,
        )
      )
        throw new Error(
          "Los eventos recibidos no corresponden al corte solicitado.",
        );
      return page;
    },
    async jobs(runId: string, signal: AbortSignal, cursor?: string) {
      const page = await read(
        `/api/v1/runs/${Id.parse(runId)}/jobs?${new URLSearchParams({ limit: "100", ...(cursor === undefined ? {} : { cursor }) })}`,
        TechnicalJobPageSchema,
        signal,
      );
      if (
        page.runId !== runId ||
        page.items.some((item) => item.runId !== runId)
      )
        throw new Error("Los trabajos pertenecen a otra representación.");
      return page;
    },
  };
}
export type RunObservationClient = ReturnType<
  typeof createRunObservationClient
>;
