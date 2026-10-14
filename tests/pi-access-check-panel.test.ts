import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PiAccessJobViewSchema } from '../src/domain/http.ts';
import { DEFAULT_INFERENCE_PROFILE, CLAUDE_INFERENCE_PROFILE } from '../src/domain/inference-profile.ts';
import { PiAccessCheckPanel, PiAccessCheckResult } from '../src/web/PiAccessCheckPanel.tsx';
import { accessFailureIsConfirmed, accessJobEtag, executeAccessIntent, type PiAccessIntent } from '../src/web/pi-access-check-client.ts';

const job = PiAccessJobViewSchema.parse({ kind: 'pi-access-job', jobId: '99999999-1111-4111-8111-111111111111', provider: 'openai-codex', profile: DEFAULT_INFERENCE_PROFILE,
  state: 'queued', revision: 0, createdAt: '2026-10-14T20:00:00Z', updatedAt: '2026-10-14T20:00:00Z', resultKind: null, safeCode: null, passedResult: null });
test('lost access-check response retries the same operation and rejects mismatched receipts', async () => {
  const intent: PiAccessIntent = { kind: 'start', key: '99999999-2222-4222-8222-222222222222', profile: DEFAULT_INFERENCE_PROFILE };
  const requests: RequestInit[] = []; let lost = true;
  const request: typeof fetch = async (_url, init) => {
    assert.ok(init); requests.push(init);
    if (lost) { lost = false; throw new Error('Synthetic response lost after commit'); }
    return Response.json({ kind: 'pi-access-job-receipt', job }, { status: 202, headers: { ETag: accessJobEtag(job) } });
  };
  await assert.rejects(executeAccessIntent({ intent, csrfToken: 'test-csrf', request }));
  const result = await executeAccessIntent({ intent, csrfToken: 'test-csrf', request });
  assert.deepEqual(requests[0], requests[1]); assert.equal(result.job.jobId, job.jobId);
  assert.equal(new Headers(requests[1]?.headers).get('Idempotency-Key'), intent.key);
  await assert.rejects(executeAccessIntent({ intent, csrfToken: 'test-csrf', request: async () => Response.json({ kind: 'pi-access-job-receipt', job }, { headers: { ETag: '"wrong"' } }) }));
  await assert.rejects(executeAccessIntent({ intent: { ...intent, profile: CLAUDE_INFERENCE_PROFILE }, csrfToken: 'test-csrf', request }));
  assert.ok(accessFailureIsConfirmed(Object.assign(new Error('rejected'), { status: 412 })));
  assert.ok(!accessFailureIsConfirmed(Object.assign(new Error('uncertain'), { status: 503 })));
});
test('panel makes the probe explicit and does not render an ambiguous result as access passed', () => {
  const initial = renderToStaticMarkup(React.createElement(PiAccessCheckPanel));
  assert.match(initial, /puede consumir cuota o generar un cargo/);
  assert.match(initial, /Comprobar acceso · puede consumir cuota/);
  assert.match(initial, /Consultar historial local/);
  const uncertain = PiAccessJobViewSchema.parse({ ...job, state: 'failed', revision: 2, resultKind: 'ambiguous', safeCode: 'timeout' });
  const html = renderToStaticMarkup(React.createElement(PiAccessCheckResult, { job: uncertain }));
  assert.match(html, /Resultado incierto · no acredita acceso/);
  assert.doesNotMatch(html, /Acceso comprobado|Perfil confirmado/);
  const approved = { ...job, state: 'succeeded', resultKind: 'passed', passedResult: {
    effectiveProfile: { provider: 'openai-codex', api: 'openai-codex-responses', model: 'gpt-6.1-sol', providerThinkingLevel: 'low', reasoningEvidence: 'sdk-payload-and-response' },
    measuredUsage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
  } };
  assert.ok(PiAccessJobViewSchema.safeParse(approved).success);
  assert.ok(!PiAccessJobViewSchema.safeParse({ ...approved, passedResult: { ...approved.passedResult, effectiveProfile: { ...approved.passedResult.effectiveProfile, model: 'claude-opus-5-5' } } }).success);
  assert.ok(!PiAccessJobViewSchema.safeParse({ ...approved, passedResult: { ...approved.passedResult, effectiveProfile: { ...approved.passedResult.effectiveProfile, providerThinkingLevel: 'high' } } }).success);
  assert.ok(!PiAccessJobViewSchema.safeParse({ ...approved, passedResult: { ...approved.passedResult, measuredUsage: { ...approved.passedResult.measuredUsage, input: 0.5 } } }).success);
  assert.ok(!PiAccessJobViewSchema.safeParse({ ...approved, passedResult: { ...approved.passedResult, measuredUsage: { ...approved.passedResult.measuredUsage, totalTokens: Number.MAX_SAFE_INTEGER + 1 } } }).success);
});
