import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunViewSchema } from "../src/domain/http.ts";
import {
  RunStatusView,
  RunCloseWarning,
  RunControlsPanel,
} from "../src/web/RunControlsPanel.tsx";
import {
  buildRunControlRequest,
  captureRunControl,
  runEtag,
} from "../src/web/run-controls-client.ts";
import { JobIdSchema } from "../src/domain/values.ts";
import { runViewFixture } from "./fixtures/run-view.ts";

test("run controls capture exact lifecycle CAS, CSRF and immutable idempotency for retries", () => {
  const view = runViewFixture();
  const key = randomUUID();
  const preflightJobId = JobIdSchema.parse(randomUUID());
  const intent = captureRunControl({
    document: { view, etag: runEtag(view) },
    key,
    command: { kind: "start", preflightJobId },
  });
  const built = buildRunControlRequest({ intent, csrfToken: "session-csrf" });
  assert.equal(built.path, `/api/v1/runs/${view.runId}/start`);
  assert.equal(built.init.headers["If-Match"], runEtag(view));
  assert.equal(built.init.headers["Idempotency-Key"], key);
  assert.equal(built.init.headers["X-CSRF-Token"], "session-csrf");
  assert.deepEqual(JSON.parse(built.init.body), {
    kind: "start",
    preflightJobId,
  });
  assert.deepEqual(
    buildRunControlRequest({ intent, csrfToken: "session-csrf" }),
    built,
  );
  assert.throws(() =>
    captureRunControl({ ...intent, document: { view, etag: '"wrong"' } }),
  );
  assert.throws(() => captureRunControl({ ...intent, key: "invalid" }));
});

test("representation SSR distinguishes confirmed state and unknown budget, no inferred dialogue", () => {
  const view = runViewFixture();
  const html = renderToStaticMarkup(
    React.createElement(RunStatusView, { view }),
  );
  assert.match(html, /Lista para iniciar/);
  assert.match(html, /Tiempo de transporte del modelo/);
  assert.match(html, /reservadas/);
  const unknown = RunViewSchema.parse({
    ...view,
    budget: {
      ...view.budget,
      status: "unknown" satisfies typeof view.budget.status,
      modelWallTimeMs: {
        ...view.budget.modelWallTimeMs,
        measured: null,
        remaining: null,
      },
    },
  });
  assert.match(
    renderToStaticMarkup(React.createElement(RunStatusView, { view: unknown })),
    /Historial desconocido/,
  );
  const initial = renderToStaticMarkup(
    React.createElement(RunControlsPanel, { runId: view.runId }),
  );
  assert.match(initial, /Consultar|Consultando/);
  assert.match(initial, /disabled=""/);
  assert.match(initial, /Avanzar un pulso/);
});

test("destructive close warning identifies the exact representation", () => {
  const view = runViewFixture();
  const html = renderToStaticMarkup(
    React.createElement(RunCloseWarning, { view }),
  );
  assert.ok(html.includes(view.config.name));
  assert.ok(html.includes(view.runId));
  assert.match(html, /Cerrar definitivamente/);
  assert.match(html, /conservar su historia/);
});
