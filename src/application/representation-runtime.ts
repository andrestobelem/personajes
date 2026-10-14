import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { isIcmAdapterFailure, createIcmMemoryAdapter } from '../adapters/icm.ts';
import type { IcmActorMemoryReader, IcmMemoryAdapter } from '../adapters/icm.ts';
import { PiRuntime } from '../adapters/pi.ts';
import type { CreatePiSessionInput, PiSessionHandle } from '../adapters/pi.ts';
import { CharacterIdSchema, RunIdSchema } from '../domain/values.ts';
import type { WorldIdSource } from '../domain/world.ts';
import { createActorTurnWorker } from './actor-turn-worker.ts';
import { createDirectorPiWorker } from './director-pi-worker.ts';
import { createContinuistaPiWorker } from './continuista-pi-worker.ts';
import { createCoordinatorPulseSupervisor } from './coordinator-pulse-supervisor.ts';
import { openLocalHost } from './local-host.ts';
import { createPiOAuthPort } from './pi-oauth.ts';
import { createProjectMemoryWorker } from './project-memory.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { createWorldDeliverySupervisor } from './world-delivery-supervisor.ts';

const InputSchema = z.strictObject({
  icmBinaryPath: z.string().trim().min(1).refine(isAbsolute, 'La ruta ICM fijada por el host debe ser absoluta.'),
});
const TargetSchema = z.strictObject({ runId: RunIdSchema, actorId: CharacterIdSchema });
const ScheduleDeliverySchema = z.strictObject({ runId: RunIdSchema, actorIds: z.array(CharacterIdSchema).min(1).max(1_000) })
  .superRefine((input, context) => {
    if (new Set(input.actorIds).size !== input.actorIds.length) {
      context.addIssue({ code: 'custom', path: ['actorIds'], message: 'El schedule repite un personaje.' });
    }
  });
const ScheduleRunSchema = z.strictObject({ runId: RunIdSchema });
const ProjectionResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('completed'), projected: z.number().int().nonnegative(), limitReached: z.boolean() }),
  z.strictObject({ kind: z.literal('busy'), projected: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('failed'), projected: z.number().int().nonnegative(), reason: z.enum(['store_failed', 'journal_failed']) }),
  z.strictObject({ kind: z.literal('cancelled'), projected: z.number().int().nonnegative() }),
]);

type Host = ReturnType<typeof openLocalHost>;
type RunId = z.infer<typeof RunIdSchema>;
type ActorId = z.infer<typeof CharacterIdSchema>;
type PiSessionFactory = (input: CreatePiSessionInput) => Promise<PiSessionHandle>;
type MemoryResources = { adapter: IcmMemoryAdapter; worker: ReturnType<typeof createProjectMemoryWorker> };
const PiSessionFactorySchema = z.custom<PiSessionFactory>((value) => typeof value === 'function');
const TestTransportSchema = z.strictObject({
  kind: z.literal('controlled-test-transport'),
  name: z.string().trim().min(1).max(120),
  actorSessionFactory: PiSessionFactorySchema,
  continuistaSessionFactory: PiSessionFactorySchema,
  directorSessionFactory: PiSessionFactorySchema,
});

/**
 * An explicit test seam for a named, controlled Pi transport. Omitting it always
 * uses the production Pi SDK session factory for both actor and Continuista.
 */
export interface ControlledPiTestTransport {
  kind: 'controlled-test-transport';
  name: string;
  actorSessionFactory: PiSessionFactory;
  continuistaSessionFactory: PiSessionFactory;
  directorSessionFactory: PiSessionFactory;
}

export type RepresentationRuntimeDiagnostic =
  | { kind: 'memory-projection'; runId: RunId; actorId: ActorId; outcome: 'failed'; reason: 'busy' | 'store_failed' | 'journal_failed' | 'adapter_failed'; adapterCode?: string }
  | { kind: 'delivery'; runId: RunId; actorId: ActorId; outcome: 'failed'; reason: 'delivery_failed' | 'journal_failed' }
  | { kind: 'coordinator'; runId: RunId; failureKind: 'worker' | 'journal' | 'supervisor' };

/**
 * Composes workers around a host that already owns its private root and journal.
 * Creation does not configure a run, contact OpenAI, or start any worker.
 */
export async function createRepresentationRuntime(input: {
  host: Host;
  icmBinaryPath: string;
  /** Host-owned shared authentication runtime, never supplied by HTTP or an actor. */
  piRuntime?: PiRuntime;
  testTransport?: ControlledPiTestTransport;
  onDiagnostic?: (diagnostic: RepresentationRuntimeDiagnostic) => void;
  onWorldCommitted?: (event: {runId: string; eventIds: string[]}) => void;
}) {
  const parsed = InputSchema.parse({ icmBinaryPath: input.icmBinaryPath });
  const testTransport = input.testTransport === undefined ? undefined : TestTransportSchema.parse(input.testTransport);
  if (activeHosts.has(input.host)) throw new Error('Este host ya tiene un runtime de representación activo.');
  activeHosts.add(input.host);

  let runtime: PiRuntime;
  try {
    runtime = input.piRuntime ?? await PiRuntime.create({ privateDataRoot: input.host.privateDataRoot });
    if (runtime.privateDataRoot !== input.host.privateDataRoot) {
      throw new Error('El runtime Pi pertenece a otro directorio privado.');
    }
  } catch (error) {
    activeHosts.delete(input.host);
    throw error;
  }

  let closed = false;
  let admissionSuspended=false;
  let closing: Promise<void> | undefined;
  const projectionController = new AbortController();
  const oauthPort = createPiOAuthPort({ modelRuntime: runtime.modelRuntime, signal: projectionController.signal, loginOptions: { agentName: 'Personajes' } });
  const adapters = new Map<string, Promise<MemoryResources>>();
  const projectionUnavailable = new Set<string>();
  const inFlightOperations = new Set<Promise<void>>();
  // Recovery may complete mechanical deliveries, but it must not infer until a
  // fresh preflight has explicitly authorized this run in the current process.
  const enabledRuns = new Set<RunId>();
  let workEpoch = 0;
  const ownerToken = input.host.ownerToken;

  function report(diagnostic: RepresentationRuntimeDiagnostic): void {
    try { input.onDiagnostic?.(diagnostic); } catch { /* Host diagnostics cannot change durable state. */ }
  }

  function keyFor(target: { runId: RunId; actorId: ActorId }): string {
    return JSON.stringify([target.runId, target.actorId]);
  }

  function adapterFor(target: { runId: RunId; actorId: ActorId }): Promise<MemoryResources> {
    if (closed) return Promise.reject(new Error('El runtime de representación está cerrado.'));
    const key = keyFor(target);
    const existing = adapters.get(key);
    if (existing !== undefined) return existing;
    const created = (async (): Promise<MemoryResources> => {
      const adapter = await createIcmMemoryAdapter({
        privateDataRoot: input.host.privateDataRoot,
        runId: target.runId,
        actorId: target.actorId,
        binaryPath: parsed.icmBinaryPath,
        ledger: { findReceipt: (request) => input.host.journal.findReceipt(request) },
      });
      if (closed) throw new Error('El runtime de representación se cerró mientras preparaba ICM.');
      const worker = createProjectMemoryWorker({ journal: input.host.journal, projector: adapter.projector, ...target });
      return { adapter, worker };
    })();
    adapters.set(key, created);
    void created.catch(() => { if (adapters.get(key) === created) adapters.delete(key); });
    return created;
  }

  async function drainMemory(target: { runId: RunId; actorId: ActorId }): Promise<z.infer<typeof ProjectionResultSchema>> {
    const key = keyFor(target);
    if (closed || projectionController.signal.aborted) return { kind: 'cancelled', projected: 0 };
    try {
      const resources = await adapterFor(target);
      await resources.adapter.checkHealth({ signal: projectionController.signal });
      if (closed || projectionController.signal.aborted) return { kind: 'cancelled', projected: 0 };
      let total = 0;
      while (!closed && !projectionController.signal.aborted) {
        const result = ProjectionResultSchema.parse(await resources.worker.drain({ maxItems: 100, signal: projectionController.signal }));
        total += result.projected;
        if (result.kind !== 'completed' || !result.limitReached) {
          const totalResult = { ...result, projected: total };
          if (result.kind === 'completed') projectionUnavailable.delete(key);
          else projectionUnavailable.add(key);
          if (result.kind === 'busy') report({ kind: 'memory-projection', ...target, outcome: 'failed', reason: 'busy' });
          if (result.kind === 'failed') report({ kind: 'memory-projection', ...target, outcome: 'failed', reason: result.reason });
          return ProjectionResultSchema.parse(totalResult);
        }
        await yieldToHost();
      }
      return { kind: 'cancelled', projected: total };
    } catch (error) {
      if (closed || projectionController.signal.aborted) return { kind: 'cancelled', projected: 0 };
      projectionUnavailable.add(key);
      report({ kind: 'memory-projection', ...target, outcome: 'failed', reason: 'adapter_failed',
        ...(isIcmAdapterFailure(error) ? { adapterCode: error.code } : {}) });
      return { kind: 'failed', projected: 0, reason: 'store_failed' };
    }
  }

  const memoryForActor = (target: { runId: RunId; actorId: ActorId }): IcmActorMemoryReader => ({
    async recall(request, options) {
      const key = keyFor(target);
      if (closed || options?.signal?.aborted) throw new Error('La consulta de memoria fue cancelada.');
      if (projectionUnavailable.has(key)) throw new Error('La memoria del personaje tiene proyecciones pendientes; no se puede afirmar que la búsqueda esté vacía.');
      const resources = await adapterFor(target);
      if (closed || options?.signal?.aborted) throw new Error('La consulta de memoria fue cancelada.');
      if (projectionUnavailable.has(key)) throw new Error('La memoria del personaje tiene proyecciones pendientes; no se puede afirmar que la búsqueda esté vacía.');
      return resources.adapter.actor.recall(request, options);
    },
  });

  const continuista = createContinuistaPiWorker({
    journal: input.host.journal,
    runtime,
    ids: createWorldIdSource(),
    ownerToken,
    ...(testTransport === undefined ? {} : { sessionFactory: testTransport.continuistaSessionFactory }),
  });
  const actorWorker = createActorTurnWorker({
    journal: input.host.journal,
    runtime,
    ids: createWorldIdSource(),
    memoryForActor,
    continuista,
    ...(testTransport === undefined ? {} : { sessionFactory: testTransport.actorSessionFactory }),
    onCommitted({ scope, commit }) {
      if (closed || admissionSuspended || commit.resolution.kind !== 'applied') return;
      try { input.onWorldCommitted?.({runId:scope.runId,eventIds:commit.resolution.events.map(event=>event.id)}); }
      catch { /* Presentation failure cannot undo a confirmed world commit. */ }
      const recipients = [...new Set(commit.resolution.perceptions.map((perception) => perception.recipientCharacterId))];
      if (recipients.length > 0) {
        workEpoch += 1;
        delivery.schedule({ runId: scope.runId, actorIds: recipients });
      }
    },
  });

  const director=createDirectorPiWorker({journal:input.host.journal,runtime,ownerToken,
    ...(testTransport===undefined?{}:{sessionFactory:testTransport.directorSessionFactory})});

  const coordinator = createCoordinatorPulseSupervisor({
    journal: input.host.journal,
    ownerToken,
    actorWorker,
    async beforeClosePulse({runId,pulseId},signal) {
      await delivery.waitForRunIdle({runId});
      if(closed||signal.aborted)return false;
      const result=await director.run({runId,pulseId},{signal});
      return result.kind==='accepted'||result.kind==='existing'||result.kind==='blocked';
    },
    async onPulseClosed({runId,pulseId}) {
      const step = input.host.journal.readActiveRunStepJob({runId});
      if (step?.pulseId !== pulseId) return;
      await delivery.waitForRunIdle({runId});
      const configuration = ReadyRunConfigurationSchema.parse(input.host.journal.readWorldConfiguration({runId}));
      let failed = false;
      for (const actorId of configuration.roster.activeCharacterIds) {
        let result = await drainMemory({runId,actorId});
        while (result.kind === 'busy' && !closed) { await yieldToHost(); result = await drainMemory({runId,actorId}); }
        if (result.kind !== 'completed') failed = true;
      }
      input.host.journal.completeRunStepJob({runId,jobId:step.jobId,failed});
    },
    onFailure(failure) {
      report({ kind: 'coordinator', runId: failure.runId, failureKind: failure.kind });
    },
  });

  function trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    workEpoch += 1;
    const result = Promise.resolve().then(operation);
    let settled: Promise<void>;
    settled = result.then(() => undefined, () => undefined).finally(() => {
      inFlightOperations.delete(settled);
      workEpoch += 1;
    });
    inFlightOperations.add(settled);
    return result;
  }

  function trackBackground(input: { runId: RunId; operation: () => Promise<void> }): void {
    if (closed||admissionSuspended) return;
    void trackOperation(async () => {
      try { await input.operation(); }
      catch { report({ kind: 'coordinator', runId: input.runId, failureKind: 'journal' }); }
    });
  }

  async function prepareRun(rawInput: unknown): Promise<boolean> {
    if (closed||admissionSuspended) return false;
    const { runId } = ScheduleRunSchema.parse(rawInput);
    if (!enabledRuns.has(runId)) return false;
    const begin = input.host.journal.beginCoordinatorPulse({ runId });
    if (begin.kind === 'inactive') return false;
    // An authorized run can wait for its first stimulus. Accepting its schedule
    // must not depend on a fictional event or an already delivered perception.
    if (begin.kind === 'idle') return true;
    if (begin.pulse.state !== 'running') {
      if (input.host.journal.readActiveRunStepJob({runId}) === undefined) return false;
      workEpoch += 1;
      coordinator.schedule({runId});
      return true;
    }
    for (const job of begin.jobs) {
      if (closed||admissionSuspended) return false;
      // Accepted jobs only need their durable commit receipt; blocked/running jobs
      // are handled or suspended by the coordinator without a new actor call.
      if (job.state !== 'queued') continue;
      const projected = await drainMemory({ runId: job.runId, actorId: job.actorId });
      if (projected.kind !== 'completed'||admissionSuspended) return false;
    }
    if (closed||admissionSuspended) return false;
    workEpoch += 1;
    coordinator.schedule({ runId });
    return true;
  }

  const delivery = createWorldDeliverySupervisor({
    journal: input.host.journal,
    onOutcome(target, result) {
      if (closed) return;
      if (result.kind === 'failed') {
        report({ kind: 'delivery', ...target, outcome: 'failed', reason: result.reason });
        return;
      }
      if (result.kind !== 'completed') return;
      trackBackground({ runId: target.runId, operation: async () => {
        const projection = await drainMemory(target);
        if (projection.kind !== 'completed' || closed) return;
        await prepareRun({ runId: target.runId });
      } });
    },
  });

  function scheduleDelivery(rawInput: unknown): void {
    if (closed||admissionSuspended) return;
    workEpoch += 1;
    delivery.schedule(ScheduleDeliverySchema.parse(rawInput));
  }

  function scheduleRun(rawInput: unknown): Promise<boolean> {
    if (closed||admissionSuspended) return Promise.resolve(false);
    const { runId } = ScheduleRunSchema.parse(rawInput);
    enabledRuns.add(runId);
    return trackOperation(() => prepareRun({ runId }));
  }

  function cancelRun(rawInput: unknown): Promise<boolean> {
    if (closed) return Promise.resolve(false);
    const { runId } = ScheduleRunSchema.parse(rawInput);
    enabledRuns.delete(runId);
    return trackOperation(() => coordinator.cancelRun({ runId }));
  }

  function retryMemoryProjection(rawInput: unknown): Promise<z.infer<typeof ProjectionResultSchema>> {
    if (closed||admissionSuspended) return Promise.resolve({ kind: 'cancelled', projected: 0 });
    return trackOperation(async () => {
      const target = TargetSchema.parse(rawInput);
      const configuration = input.host.journal.readWorldConfiguration({ runId: target.runId });
      if (configuration === undefined) throw new Error('No existe una configuración durable para este Escenario.');
      const prepared = ReadyRunConfigurationSchema.parse(configuration);
      if (!prepared.roster.preparedCharacters.some((actor) => actor.characterId === target.actorId)) {
        throw new Error('El personaje no está preparado para esta corrida.');
      }
      const result = await drainMemory(target);
      if (result.kind === 'completed' && !closed) await prepareRun({ runId: target.runId });
      return result;
    });
  }

  function recover(): Promise<{ deliveryTargets: number; coordinatorTargets: number; scheduledRuns: number }> {
    if (closed||admissionSuspended) return Promise.resolve({ deliveryTargets: 0, coordinatorTargets: 0, scheduledRuns: 0 });
    return trackOperation(async () => {
      const deliveryTargets = delivery.recover();
      const targets = input.host.journal.listCoordinatorPulseTargets({ limit: 1_000 });
      const scheduledRuns = 0;
      for (const target of targets) {
        if (enabledRuns.has(target.runId) || input.host.journal.readActiveRunStepJob(target) === undefined) continue;
        // A restart cannot reuse expiring preflight authorization for new calls.
        // Preserve the step/pulse and reservations; an explicit freshly gated
        // step resumes that job instead of inventing another pulse.
        input.host.journal.interruptRunStepJob(target);
      }
      return { deliveryTargets, coordinatorTargets: targets.length, scheduledRuns };
    });
  }

  async function waitForIdle(): Promise<void> {
    while (!closed) {
      const observedEpoch = workEpoch;
      await Promise.all([delivery.waitForIdle(), coordinator.waitForIdle()]);
      const tasks = [...inFlightOperations];
      await Promise.all(tasks);
      await Promise.all([delivery.waitForIdle(), coordinator.waitForIdle()]);
      if (closed) return;
      if (observedEpoch === workEpoch && inFlightOperations.size === 0) return;
    }
  }
  async function suspendAdmissions(rawRunIds:unknown):Promise<()=>void>{
    if(closed||admissionSuspended)throw new Error('BACKUP_REPRESENTATION_BUSY');
    const runIds=z.array(RunIdSchema).max(100000).parse(rawRunIds);
    admissionSuspended=true;
    enabledRuns.clear();
    try{
      await Promise.all(runIds.map(runId=>coordinator.cancelRun({runId})));
      await waitForIdle();
    }catch(error){admissionSuspended=false;throw error;}
    let released=false;
    return ()=>{if(released)return;released=true;admissionSuspended=false;};
  }

  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true;
    projectionController.abort();
    closing = (async () => {
      await Promise.all([delivery.close(), coordinator.close()]);
      while (inFlightOperations.size > 0) await Promise.all([...inFlightOperations]);
      try { input.host.close(); }
      finally { activeHosts.delete(input.host); }
    })();
    return closing;
  }

  return Object.freeze({
    oauth: Object.freeze({
      status: () => trackOperation(() => oauthPort.status()),
      login: (interaction: Parameters<typeof oauthPort.login>[0]) => trackOperation(() => oauthPort.login(interaction)),
      logout: (options?: Parameters<typeof oauthPort.logout>[0]) => trackOperation(() => oauthPort.logout(options)),
    }),
    scheduleDelivery,
    scheduleRun,
    cancelRun,
    retryMemoryProjection,
    recover,
    waitForIdle,
    suspendAdmissions,
    close,
    get isClosed() { return closed; },
    get roleReadiness() { return {actor:!closed,continuista:!closed,director:!closed,narrator:false}; },
  });
}

const activeHosts = new WeakSet<object>();

function createWorldIdSource(): WorldIdSource {
  return {
    eventId: randomUUID,
    perceptionId: randomUUID,
    experienceId: randomUUID,
    offerId: randomUUID,
    entityHandle: randomUUID,
    placeHandle: randomUUID,
    channelHandle: randomUUID,
    offerHandle: randomUUID,
  };
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
