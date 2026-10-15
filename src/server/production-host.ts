import { createBackupForkRestorePort } from '../application/backup-fork-restore.ts';
import { createForkRuntime } from '../application/fork-runtime.ts';
import { createForkApplication } from '../application/fork-application.ts';
import {createCircumstanceApplication} from '../application/direction-circumstances.ts';
import { createRunObservationApplication } from '../application/run-observation.ts';
import { createDramaticStructureApplication } from '../application/dramatic-structure.ts';
import { createDirectionApplication } from '../application/direction-indications.ts';
import { createNarrationObservation } from '../application/narration-observation.ts';
import { createNarrationRoutes } from './narration-routes.ts';
import { z } from 'zod';
import type { loadCatalog } from '../adapters/catalog.ts';
import type { openLocalHost } from '../application/local-host.ts';
import { resolveConfiguredSessionMode } from '../application/production-preflight.ts';
import { projectHumanInteractionContext } from '../domain/interaction.ts';
import { HumanParticipantProfilesSchema } from '../domain/production.ts';
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
import type { createHostRequestBarrier } from '../application/host-request-barrier.ts';
import { createHostBackupQuiesce } from '../application/host-backup-quiesce.ts';

import type { HostDirectoryOperation } from '../adapters/host-ownership.ts';
import type { LocalHttpOptions } from './http.ts';
import type { BackupRestorePort } from '../application/backup-service.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openBackupTransferService } from '../application/backup-transfer-service.ts';
import { ApprovedJournalSchemaSchema } from '../application/external-backup-validation.ts';
import { createBackupTransferRoutes } from './backup-transfer-routes.ts';
import { createExternalBackupRestoreRoutes } from './external-backup-restore-routes.ts';

/** Reusable composition of one owned private directory. Creation does not recover,
 * begin a representation, login, probe a provider, or synthesize audio. */
export async function createProductionHost(input:{
 host:ReturnType<typeof openLocalHost>;
 catalog:Awaited<ReturnType<typeof loadCatalog>>;
 admissionBarrier:ReturnType<typeof createHostRequestBarrier>;
 icmBinaryPath?:string;
 privateAuthRoot?:string;
 directoryOperation?:HostDirectoryOperation;
 onDiagnostic?:(diagnostic:unknown)=>void;
 configureRestorePort?:(forkPort:BackupRestorePort)=>BackupRestorePort;
}){
 const catalog=input.catalog;
 const diagnosticSink=(diagnostic:unknown)=>{try{input.onDiagnostic?.(diagnostic);}catch{/* Observers do not control workers. */}};
 let closeOptions=input.directoryOperation===undefined?undefined:{directoryOperation:input.directoryOperation};
 // RepresentationRuntime closes its host. Delegate through the active operation
 // capability without changing the frozen original host or replacing properties.
 const host=Object.freeze({...input.host,close(options?:{directoryOperation:HostDirectoryOperation}){input.host.close(options??closeOptions);}});
 let worldDeliveries:ReturnType<typeof createWorldDeliverySupervisor>|undefined;
 let closePromise:Promise<void>|undefined;
 let closing=false;
 async function close(options?:{directoryOperation:HostDirectoryOperation}):Promise<void>{
  if(closePromise!==undefined)return closePromise;
  if(options!==undefined)closeOptions=options;
  closing=true;
  closePromise=(async()=>{
   const errors:unknown[]=[];
   async function settle(work:()=>unknown|Promise<unknown>){try{await work();}catch(error){errors.push(error);}}
   oauthController.abort();
   await restoreRecovery?.catch(()=>undefined);
   await settle(()=>exchange?.backups.waitForRestores());
   await settle(()=>forks?.close());
   await settle(()=>voices?.close());
   await settle(()=>transfers?.close());
   await settle(()=>externalRestoreRoutes?.close());
   await settle(()=>exchange?.close());
   await settle(()=>preflightJobs?.close());
   await settle(()=>accessJobs?.close());
   await settle(()=>oauthJobs?.close());
   if(representation!==undefined)await settle(()=>representation?.close());
   else await settle(()=>worldDeliveries?.close());
   await settle(()=>host.close());
   if(errors.length>0)throw new AggregateError(errors,'Production host cleanup failed');
  })();
  return closePromise;
 }
let representation: Awaited<ReturnType<typeof createRepresentationRuntime>> | undefined;
let piRuntime: PiRuntime;
let oauthJobs: Awaited<ReturnType<typeof createPiOAuthJobs>> | undefined;
let accessJobs: Awaited<ReturnType<typeof createPiAccessJobs>> | undefined;
let preflightJobs: Awaited<ReturnType<typeof createRunPreflightJobs>> | undefined;
const oauthController = new AbortController();
let voices: ReturnType<typeof createVoiceRuntime> | undefined;
let exchange: Awaited<ReturnType<typeof createExchangeRuntime>> | undefined;
let forks: ReturnType<typeof createForkRuntime> | undefined;
let restoreRecovery: Promise<unknown> | undefined;
let transfers:ReturnType<typeof openBackupTransferService>|undefined;
let externalRestoreRoutes:ReturnType<typeof createExternalBackupRestoreRoutes>|undefined;
try {
  voices=createVoiceRuntime({host,...(input.privateAuthRoot===undefined?{}:{privateAuthRoot:input.privateAuthRoot}),onDiagnostic:diagnostic=>diagnosticSink(diagnostic)});
  const configuredExchange=await createExchangeRuntime({host,catalog});
  exchange=configuredExchange;
  const configuredTransfers=openBackupTransferService({privateDataRoot:host.privateDataRoot,ownerToken:host.ownerToken,
    ...(input.directoryOperation===undefined?{}:{directoryOperation:input.directoryOperation}),
    readLocalBackup:id=>configuredExchange.backups.verify(id),
    readApprovedJournalSchema(){
      const reader=new DatabaseSync(join(host.privateDataRoot,'world.sqlite'),{readOnly:true});
      try{return ApprovedJournalSchemaSchema.parse(reader.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());}
      finally{reader.close();}
    },
  });
  transfers=configuredTransfers;
  configuredExchange.backups.setExternalBackupPort({resolve:request=>configuredTransfers.resolveRegistration(request)});
  externalRestoreRoutes=createExternalBackupRestoreRoutes({transfers:configuredTransfers,backups:configuredExchange.backups,journalPath:join(host.privateDataRoot,'world.sqlite')});
  piRuntime = await PiRuntime.create({ privateDataRoot: host.privateDataRoot });
  oauthJobs = await createPiOAuthJobs({
    journal: host.journal, ownerToken: host.ownerToken,
    oauth: createPiOAuthPort({ modelRuntime: piRuntime.modelRuntime, signal: oauthController.signal, loginOptions: { agentName: 'Personajes' } }),
    onDiagnostic: (diagnostic) => diagnosticSink({ kind: 'piOAuthDiagnostic', diagnostic }),
  });
  const authentication = createPiAuthFingerprint({ privateDataRoot: host.privateDataRoot });
  accessJobs = await createPiAccessJobs({ journal: host.journal, modelRuntime: piRuntime.modelRuntime,
    readCredentialFingerprint: authentication.readCredentialFingerprint, ownerToken: host.ownerToken, signal: oauthController.signal });
  preflightJobs = await createRunPreflightJobs({
    journal: host.journal, ownerToken: host.ownerToken, signal: oauthController.signal,
    readCredentialFingerprint: authentication.readCredentialFingerprint,
    createHost: () => createProductionPreflightHost({ journal: host.journal, catalog, piRuntime, authentication,
      readVoiceReadiness: async request => voices?.readPreflightReadiness(request) ?? Promise.resolve({kind:'unavailable',code:'voice-runtime-unavailable'}),
      roleReadiness:()=>representation?.roleReadiness??{actor:false,continuista:false,director:false,narrator:false},
      ...(input.icmBinaryPath === undefined ? {} : { icmBinaryPath: input.icmBinaryPath }) }),
  });
  if (input.icmBinaryPath !== undefined) {
    forks = createForkRuntime({host, binaryPath: input.icmBinaryPath});
    representation = await createRepresentationRuntime({
      host, piRuntime, icmBinaryPath: input.icmBinaryPath,
      onDiagnostic: (diagnostic) => diagnosticSink({ kind: 'representationDiagnostic', diagnostic }),
      onWorldCommitted: event => voices?.onWorldCommitted({runId:event.runId,eventIds:event.eventIds}),
      onNarrationPublished: event => voices?.onNarrationPublished(event),
    });
  }
  const forkRestore=createBackupForkRestorePort({host,...(forks===undefined?{}:{runtime:forks}),
    readExternalSource:request=>configuredTransfers.readRegisteredSource(request)});
  exchange.backups.setRestorePort(input.configureRestorePort?.(forkRestore)??forkRestore);
worldDeliveries = representation === undefined ? createWorldDeliverySupervisor({
  journal: host.journal,
  onOutcome(target, result) {
    if (result.kind === 'failed') {
      diagnosticSink({ kind: 'worldDeliveryFailed', runId: target.runId, actorId: target.actorId, reason: result.reason });
    }
  },
}) : undefined;
if(exchange!==undefined&&voices!==undefined&&oauthJobs!==undefined&&accessJobs!==undefined&&preflightJobs!==undefined) {
  exchange.setBackupQuiesce(createHostBackupQuiesce({host,admission:input.admissionBarrier,oauth:oauthJobs,access:accessJobs,preflight:preflightJobs,
    ...(forks===undefined?{}:{forks}),
    ...(representation===undefined?{}:{representation}),...(worldDeliveries===undefined?{}:{deliveries:worldDeliveries}),voice:voices.service}));
}
  const configuredVoices=voices;
  const runLifecycle = createRunLifecycleApplication({
    journal: host.journal,
    ...(preflightJobs === undefined ? {} : { preflights: preflightJobs }),
    ...(representation === undefined ? {} : { runtime: representation }),
    ...(configuredVoices===undefined?{}:{readVoiceBudget:(runId:string)=>configuredVoices.service.budget(runId),readVoiceReadiness:(request:{runId:string;configRevision:number})=>configuredVoices.readPreflightReadiness(request)}),
  });
  const httpOptions={
    admissionBarrier:input.admissionBarrier,
    runtimeComposition:()=>({kind:representation!==undefined&&!representation.isClosed?'composed':'unavailable'}),
    operatorExtensions:[createNarrationRoutes(createNarrationObservation({journal:host.journal})),...(voices===undefined?[]:[voices.routes]),
      createBackupTransferRoutes({service:()=>configuredTransfers}),externalRestoreRoutes,...(exchange===undefined?[]:[exchange.routes])],
    runConfigurationDrafts: host.journal,
    forks: createForkApplication({journal:host.journal,...(forks===undefined?{}:{runtime:forks})}),
    readRunModelTimeBudget: (request) => host.journal.readRunModelTimeBudget(request),
    ...(oauthJobs === undefined ? {} : { piOAuthJobs: oauthJobs }),
    ...(accessJobs === undefined ? {} : { piAccessJobs: accessJobs }),
    ...(preflightJobs === undefined ? {} : { runPreflightJobs: preflightJobs }),
    runLifecycle,
    runObservation:createRunObservationApplication({journal:host.journal}),
    runDramaticStructure:createDramaticStructureApplication({journal:host.journal}),
    runDirections:createDirectionApplication({journal:host.journal}),
    runCircumstances:createCircumstanceApplication({journal:host.journal,onCommitted(event){
      try{voices?.onWorldCommitted({runId:event.runId,eventIds:event.eventIds});}
      finally{
        const target={runId:event.runId,actorIds:event.actorIds};
        if(representation!==undefined)representation.scheduleDelivery(target);
        else worldDeliveries?.schedule(target);
      }
    }}),
    runInspector:createRunInspectorApplication({journal:host.journal}),
    authorizeObserverView:(runId)=>host.journal.readWorldLifecycle({runId})!==undefined,
    onInspectorRead:metadata=>diagnosticSink({kind:'inspectorRead',...metadata}),
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

  } satisfies Omit<LocalHttpOptions,'catalog'|'shellHtml'|'staticAssets'>;
 async function recover(){
  if(closing)throw new Error('PRODUCTION_HOST_CLOSED');
  restoreRecovery=configuredExchange.backups.recoverRestores();
  await restoreRecovery;
  if(closing)return;
  forks?.recover();
  if(representation!==undefined)await representation.recover();
  else worldDeliveries?.recover();
 }
 // The creation capability only authorizes failure cleanup inside its gate.
 // A successfully reopened host may outlive that operation; later close receives
 // a fresh capability explicitly or acquires the ordinary ownership gate.
 closeOptions=undefined;
 return Object.freeze({host,exchange:configuredExchange,transfers:configuredTransfers,httpOptions,recover,close});
} catch (error) {
  try { await close(); } catch (closeError) { throw new AggregateError([error,closeError], 'Production setup and cleanup failed'); }
  throw error;
}
}
export type ProductionHost=Awaited<ReturnType<typeof createProductionHost>>;
