import { createRunObservationApplication } from '../application/run-observation.ts';
import { createNarrationObservation } from '../application/narration-observation.ts';
import { createNarrationRoutes } from './narration-routes.ts';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { loadCatalog } from '../adapters/catalog.ts';
import { createLocalHttpServer, StaticAssetMimeSchema } from './http.ts';
import type { LocalStaticAsset } from './http.ts';
import type { LocalHttpServer } from './http.ts';
import { openLocalHost } from '../application/local-host.ts';
import { resolveConfiguredSessionMode } from '../application/production-preflight.ts';
import { projectHumanInteractionContext } from '../domain/interaction.ts';
import { HumanParticipantProfilesSchema } from '../domain/production.ts';
import { isHostOwnershipFailure } from '../adapters/host-ownership.ts';
import { createWorldDeliverySupervisor } from '../application/world-delivery-supervisor.ts';
import { createRepresentationRuntime } from '../application/representation-runtime.ts';
import { createRunLifecycleApplication } from '../application/run-lifecycle.ts';
import { PiRuntime } from '../adapters/pi.ts';
import { createPiOAuthPort } from '../application/pi-oauth.ts';
import { createPiOAuthJobs } from '../application/pi-oauth-jobs.ts';
import { createPiAccessJobs } from '../application/pi-access-jobs.ts';
import { createPiAuthFingerprint } from '../application/pi-auth-fingerprint.ts';
import { createRunPreflightJobs } from '../application/run-preflight-jobs.ts';
import { createProductionPreflightHost } from '../application/production-preflight-host.ts';
import { createVoiceRuntime } from '../application/voice-runtime.ts';
import { createExchangeRuntime } from '../application/exchange-runtime.ts';
import { createRunInspectorApplication } from '../application/run-inspector.ts';
import { createHostRequestBarrier } from '../application/host-request-barrier.ts';
import { createHostBackupQuiesce } from '../application/host-backup-quiesce.ts';

async function start() {
const repositoryRoot = resolve(import.meta.dirname, '../..');
const distribution = join(repositoryRoot, 'dist');
const shellHtml = await readFile(join(distribution, 'index.html'), 'utf8');
const staticAssets = new Map<string, LocalStaticAsset>();
const mimeByExtension: Readonly<Record<string, string>> = {
  '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
for (const entry of await readdir(join(distribution, 'assets'), { withFileTypes: true })) {
  if (!entry.isFile()) throw new Error('Build contiene un asset no soportado');
  const mimeType = StaticAssetMimeSchema.parse(mimeByExtension[extname(entry.name)]);
  staticAssets.set(`/assets/${entry.name}`, { bytes: await readFile(join(distribution, 'assets', entry.name)), mimeType });
}
const catalog = await loadCatalog({ repositoryRoot });
const port = z.coerce.number().int().min(0).max(65_535).parse(process.env.PERSONAJES_PORT ?? 4173);
const defaultPrivateData = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'Personajes')
  : process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local', 'Personajes')
    : join(homedir(), '.local', 'share', 'personajes');
const host = openLocalHost({ privateDataRoot: process.env.PERSONAJES_PRIVATE_DATA_ROOT ?? defaultPrivateData });
let representation: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
let piRuntime: PiRuntime;
let oauthJobs: Awaited<ReturnType<typeof createPiOAuthJobs>> | undefined;
let accessJobs: Awaited<ReturnType<typeof createPiAccessJobs>> | undefined;
let preflightJobs: Awaited<ReturnType<typeof createRunPreflightJobs>> | undefined;
const oauthController = new AbortController();
let voices: ReturnType<typeof createVoiceRuntime> | undefined;
let exchange: Awaited<ReturnType<typeof createExchangeRuntime>> | undefined;
try {
  voices=createVoiceRuntime({host,...(process.env.PERSONAJES_PRIVATE_AUTH_ROOT===undefined?{}:{privateAuthRoot:process.env.PERSONAJES_PRIVATE_AUTH_ROOT}),onDiagnostic:diagnostic=>process.stderr.write(JSON.stringify(diagnostic)+'\n')});
  exchange=await createExchangeRuntime({host,catalog});
  piRuntime = await PiRuntime.create({ privateDataRoot: host.privateDataRoot });
  oauthJobs = await createPiOAuthJobs({
    journal: host.journal, ownerToken: host.ownerToken,
    oauth: createPiOAuthPort({ modelRuntime: piRuntime.modelRuntime, signal: oauthController.signal, loginOptions: { agentName: 'Personajes' } }),
    onDiagnostic: (diagnostic) => process.stderr.write(JSON.stringify({ kind: 'piOAuthDiagnostic', diagnostic }) + '\n'),
  });
  const authentication = createPiAuthFingerprint({ privateDataRoot: host.privateDataRoot });
  accessJobs = await createPiAccessJobs({ journal: host.journal, modelRuntime: piRuntime.modelRuntime,
    readCredentialFingerprint: authentication.readCredentialFingerprint, ownerToken: host.ownerToken, signal: oauthController.signal });
  preflightJobs = await createRunPreflightJobs({
    journal: host.journal, ownerToken: host.ownerToken, signal: oauthController.signal,
    readCredentialFingerprint: authentication.readCredentialFingerprint,
    createHost: () => createProductionPreflightHost({ journal: host.journal, catalog, piRuntime, authentication,
      roleReadiness:()=>representation?.roleReadiness??{actor:false,continuista:false,director:false,narrator:false},
      ...(process.env.PERSONAJES_ICM_BINARY === undefined ? {} : { icmBinaryPath: process.env.PERSONAJES_ICM_BINARY }) }),
  });
  if (process.env.PERSONAJES_ICM_BINARY !== undefined) {
    representation = await createRepresentationRuntime({
      host, piRuntime, icmBinaryPath: process.env.PERSONAJES_ICM_BINARY,
      onDiagnostic: (diagnostic) => process.stderr.write(JSON.stringify({ kind: 'representationDiagnostic', diagnostic }) + '\n'),
      onWorldCommitted: event => voices?.onWorldCommitted({runId:event.runId,eventIds:event.eventIds}),
      onNarrationPublished: event => voices?.onNarrationPublished(event),
    });
  }
} catch (error) {
  oauthController.abort();
  await voices?.close();
  exchange?.close();
  try { await preflightJobs?.close(); }
  finally { try { await accessJobs?.close(); }
    finally { try { await oauthJobs?.close(); } finally { host.close(); } } }
  throw error;
}
const worldDeliveries = representation === undefined ? createWorldDeliverySupervisor({
  journal: host.journal,
  onOutcome(target, result) {
    if (result.kind === 'failed') {
      process.stderr.write(JSON.stringify({
        kind: 'worldDeliveryFailed', runId: target.runId, actorId: target.actorId, reason: result.reason,
      }) + '\n');
    }
  },
}) : undefined;
const admissionBarrier=createHostRequestBarrier();
if(exchange!==undefined&&voices!==undefined&&oauthJobs!==undefined&&accessJobs!==undefined&&preflightJobs!==undefined) {
  exchange.setBackupQuiesce(createHostBackupQuiesce({host,admission:admissionBarrier,oauth:oauthJobs,access:accessJobs,preflight:preflightJobs,
    ...(representation===undefined?{}:{representation}),...(worldDeliveries===undefined?{}:{deliveries:worldDeliveries}),voice:voices.service}));
}
  const runLifecycle = createRunLifecycleApplication({
    journal: host.journal,
    ...(preflightJobs === undefined ? {} : { preflights: preflightJobs }),
    ...(representation === undefined ? {} : { runtime: representation }),
    ...(voices===undefined?{}:{readVoiceBudget:(runId:string)=>voices!.service.budget(runId)}),
  });
async function closeWorkersAndHost() {
  oauthController.abort();
  await voices?.close();
  exchange?.close();
  try { await preflightJobs?.close(); }
  finally {
    try { await accessJobs?.close(); }
    finally {
      try { await oauthJobs?.close(); }
      finally {
        if (representation !== undefined) await representation.close();
        else { try { await worldDeliveries?.close(); } finally { host.close(); } }
      }
    }
  }
}
let server: LocalHttpServer;
let address: Awaited<ReturnType<typeof server.listen>>;
try {
  server = createLocalHttpServer({
    catalog,
    shellHtml,
    staticAssets,
    admissionBarrier,
    runtimeComposition:()=>({kind:representation!==undefined&&!representation.isClosed?'composed':'unavailable'}),
    operatorExtensions:[createNarrationRoutes(createNarrationObservation({journal:host.journal})),...(voices===undefined?[]:[voices.routes]),...(exchange===undefined?[]:[exchange.routes])],
    runConfigurationDrafts: host.journal,
    readRunModelTimeBudget: (request) => host.journal.readRunModelTimeBudget(request),
    ...(oauthJobs === undefined ? {} : { piOAuthJobs: oauthJobs }),
    ...(accessJobs === undefined ? {} : { piAccessJobs: accessJobs }),
    ...(preflightJobs === undefined ? {} : { runPreflightJobs: preflightJobs }),
    runLifecycle,
    runObservation:createRunObservationApplication({journal:host.journal}),
    runInspector:createRunInspectorApplication({journal:host.journal}),
    authorizeObserverView:(runId)=>host.journal.readWorldLifecycle({runId})!==undefined,
    onInspectorRead:metadata=>process.stderr.write(JSON.stringify({kind:'inspectorRead',...metadata})+'\n'),
    resolveSessionMode: (candidate) => resolveConfiguredSessionMode({
      candidate,
      readWorldConfiguration: (request) => host.journal.readWorldConfiguration(request),
    }),
    readHumanInteractionContext: ({ runId, participantId }) => {
      const configurationValue = host.journal.readWorldConfiguration({ runId });
      if (configurationValue === undefined) return null;
      const configuration = z.record(z.string(), z.unknown()).parse(configurationValue);
      const profiles = HumanParticipantProfilesSchema.parse(configuration.humanParticipants);
      const profile = profiles.find((item) => item.identity.participantId === participantId);
      if (profile === undefined) return null;
      const snapshot = host.journal.loadWorld({ runId });
      return snapshot === undefined ? null : projectHumanInteractionContext({ snapshot, profile }) ?? null;
    },
    commitHumanIntervention: (request) => {
      const result = host.journal.commitHumanIntervention(request);
      if ((result.kind === 'stored' || result.kind === 'existing') && result.resolution.kind === 'applied') {
        const actorIds = [...new Set(result.resolution.perceptions.map((perception) => perception.recipientCharacterId))];
        if (actorIds.length > 0) {
          const target = { runId: result.resolution.newSnapshot.runId, actorIds };
          if (representation !== undefined) representation.scheduleDelivery(target);
          else worldDeliveries?.schedule(target);
        }
      }
      return result;
    },
  });
  address = await server.listen(port);
}
catch (error) { await closeWorkersAndHost(); throw error; }
process.stdout.write(JSON.stringify({ kind: 'serverReady', origin: address.origin,
  representation: representation === undefined ? 'icm-not-configured' : 'composed',
}) + '\n');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await server.close(); }
  finally {
    await closeWorkersAndHost();
  }
}
const onSignal = () => void stop().catch(() => {
  process.stderr.write(JSON.stringify({ kind: 'hostCloseFailed', code: 'HOST_CLOSE_FAILED' }) + '\n');
  process.exitCode = 1;
});
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
// Recovery can await memory processes or Pi. Shutdown handlers must exist first.
try {
  if (representation !== undefined) await representation.recover();
  else worldDeliveries?.recover();
}
catch {
  process.stderr.write(JSON.stringify({ kind: 'representationRecoveryFailed', code: 'REPRESENTATION_RECOVERY_FAILED' }) + '\n');
}
}

await start().catch((error: unknown) => {
  process.stderr.write(JSON.stringify({ kind: 'serverStartFailed', code: isHostOwnershipFailure(error) ? error.code : 'SERVER_START_FAILED' }) + '\n');
  process.exitCode = 1;
});
