import { z } from 'zod';
import { JobIdSchema } from './values.ts';

/** Shared contract for host persistence and browser views of the representation. */
export const WorldLifecycleSchema = z.enum(['draft', 'ready', 'running', 'paused', 'stopped', 'closed']);
export type WorldLifecycle = z.infer<typeof WorldLifecycleSchema>;

/** Commands exposed by the operator control surface. They describe intent, not authority. */
export const RunControlCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start') }),
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume') }),
  z.strictObject({ kind: z.literal('step') }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('close') }),
]);
export type RunControlCommand = z.infer<typeof RunControlCommandSchema>;

/** HTTP controls are stricter than the pure transition command: start/resume
 * must name the exact durable preflight they consume. */
export const RunLifecycleControlRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), preflightJobId: JobIdSchema }),
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume'), preflightJobId: JobIdSchema }),
  z.strictObject({ kind: z.literal('step') }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('close') }),
]);
export type RunLifecycleControlRequest = z.infer<typeof RunLifecycleControlRequestSchema>;

export const RunLifecycleViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('draft'), revision: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('ready'), revision: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('running'), revision: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('paused'), revision: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('stopped'), revision: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('closed'), revision: z.number().int().nonnegative(), closedAt: z.string().datetime({ offset: true }) }),
]);
export type RunLifecycleView = z.infer<typeof RunLifecycleViewSchema>;

export type RunControlTransition =
  | { kind: 'transition'; from: WorldLifecycle; to: WorldLifecycle }
  | { kind: 'singlePulse'; lifecycle: 'paused' }
  | { kind: 'invalid'; code: 'INVALID_LIFECYCLE'; lifecycle: WorldLifecycle; command: RunControlCommand['kind'] };

/** Pure lifecycle policy. The host still checks durable revisions, gates and idempotency. */
export function resolveRunControlTransition(lifecycle: WorldLifecycle, command: RunControlCommand): RunControlTransition {
  if (command.kind === 'step') {
    return lifecycle === 'paused'
      ? { kind: 'singlePulse', lifecycle: 'paused' }
      : { kind: 'invalid', code: 'INVALID_LIFECYCLE', lifecycle, command: command.kind };
  }

  let target: WorldLifecycle | undefined;
  switch (command.kind) {
    case 'start': if (lifecycle === 'ready') target = 'running'; break;
    case 'pause': if (lifecycle === 'running') target = 'paused'; break;
    case 'resume': if (lifecycle === 'paused' || lifecycle === 'stopped') target = 'running'; break;
    case 'stop': if (lifecycle === 'running' || lifecycle === 'paused') target = 'stopped'; break;
    case 'close': if (lifecycle === 'running' || lifecycle === 'paused' || lifecycle === 'stopped') target = 'closed'; break;
  }
  return target === undefined
    ? { kind: 'invalid', code: 'INVALID_LIFECYCLE', lifecycle, command: command.kind }
    : { kind: 'transition', from: lifecycle, to: target };
}
