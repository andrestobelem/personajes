import {PreparationConfiguratorJobSchema} from '../domain/preparation-configurator-jobs.ts';
import type {createPreparationConfiguratorPiWorker} from './preparation-configurator-pi-worker.ts';

/** Scheduling is inert until start is explicitly invoked by an authorized host
 * command. Recovery belongs to the durable ledger and never requeues work. */
export function createPreparationConfiguratorManager(input:{worker:ReturnType<typeof createPreparationConfiguratorPiWorker>;onFailure?:(input:{jobId:string;code:'PREPARATION_CONFIGURATOR_WORKER_FAILED'})=>void}){
  const active=new Map<string,{controller:AbortController;promise:Promise<void>}>();let closed=false;let suspensions=0;
  return Object.freeze({
    start(raw:unknown){const job=PreparationConfiguratorJobSchema.parse(raw);if(closed)throw new Error('PREPARATION_CONFIGURATOR_MANAGER_CLOSED');if(suspensions>0)throw new Error('PREPARATION_CONFIGURATOR_MANAGER_SUSPENDED');if(job.state!=='queued')throw new Error('PREPARATION_CONFIGURATOR_NOT_QUEUED');if(active.has(job.scope.jobId))return {kind:'already-active'} as const;
      const controller=new AbortController();const promise=Promise.resolve().then(async()=>{try{await input.worker.run(job,{signal:controller.signal});}catch{try{input.onFailure?.({jobId:job.scope.jobId,code:'PREPARATION_CONFIGURATOR_WORKER_FAILED'});}catch{/* Diagnostics do not authorize retries. */}}});
      active.set(job.scope.jobId,{controller,promise});void promise.finally(()=>{if(active.get(job.scope.jobId)?.promise===promise)active.delete(job.scope.jobId);});return {kind:'started'} as const;
    },
    hasActive(input:{runId?:string;jobId:string}){return active.has(input.jobId);},
    async cancel(input:{jobId:string}){const running=active.get(input.jobId);if(running!==undefined){running.controller.abort();await running.promise;}},
    async waitForIdle(){while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));},
    async suspendAdmissions(){
      if(closed)throw new Error('PREPARATION_CONFIGURATOR_MANAGER_CLOSED');
      ++suspensions;
      try {
        for(const running of active.values())running.controller.abort();
        while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));
      } catch(error) { --suspensions;throw error; }
      let released=false;
      return ()=>{if(!released){released=true;--suspensions;}};
    },
    async close(){closed=true;for(const running of active.values())running.controller.abort();while(active.size>0)await Promise.allSettled([...active.values()].map(item=>item.promise));},
  });
}
