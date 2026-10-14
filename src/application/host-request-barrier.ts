/** Process-local admission barrier under the single host owner. Every HTTP request
 * enters before reading a body or running host services, including lazy GET writers.
 * Backup creation owns the barrier and is excluded from its own drain. */
export function createHostRequestBarrier(){
 let held=false;let active=0;const waiters=new Set<()=>void>();
 function metadata(method:string,path:readonly string[]){return method==='GET'&&path.length===4&&path[0]==='api'&&path[1]==='v1'&&path[2]==='backups';}
 function backupCreate(method:string,path:readonly string[]){return method==='PUT'&&path.length===4&&path[0]==='api'&&path[1]==='v1'&&path[2]==='backups';}
 return Object.freeze({
  get isHeld(){return held;},get activeRequests(){return active;},
  enter(input:{method:string;path:readonly string[]}):()=>void{
   if(held&&!metadata(input.method,input.path))throw new Error('HOST_BACKUP_IN_PROGRESS');
   if(metadata(input.method,input.path)||backupCreate(input.method,input.path))return ()=>{};
   active++;let released=false;
   return ()=>{if(released)return;released=true;active--;if(active===0){for(const resolve of waiters)resolve();waiters.clear();}};
  },
  async acquire():Promise<()=>void>{
   if(held)throw new Error('BACKUP_BARRIER_BUSY');held=true;
   if(active>0)await new Promise<void>(resolve=>waiters.add(resolve));
   let released=false;return ()=>{if(released)return;released=true;held=false;};
  },
 });
}
