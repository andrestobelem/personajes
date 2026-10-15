/** Process-local admission under the single host owner. Backup excludes its own
 * create request and permits metadata reads. Recovery drains every database user,
 * including those exceptions, while preserving only the in-memory HTTP shell. */
export function createHostRequestBarrier(){
 let mode:'open'|'backup'|'recovery'|'maintenance'='open';
 let active=0;let recoveryActive=0;
 const waiters=new Set<()=>void>();const recoveryWaiters=new Set<()=>void>();
 function metadata(method:string,path:readonly string[]){return method==='GET'&&path.length===4&&path[0]==='api'&&path[1]==='v1'&&path[2]==='backups';}
 function backupCreate(method:string,path:readonly string[]){return method==='PUT'&&path.length===4&&path[0]==='api'&&path[1]==='v1'&&path[2]==='backups';}
 function runtimeConfigurationRead(method:string,path:readonly string[]){return method==='GET'&&path[0]==='api'&&path[1]==='v1'&&path[2]==='host'&&path[3]==='icm-runtime-configuration'&&(path.length===4||(path[4]==='jobs'&&(path.length===5||path.length===6)));}
 function maintenanceRead(method:string,path:readonly string[]){return runtimeConfigurationRead(method,path)||(method==='GET'&&(path.length===5||path.length===6)&&path[0]==='api'&&path[1]==='v1'&&path[2]==='runs'&&path[4]==='memory-preparations');}
 function memoryOnly(method:string,path:readonly string[]){
  if((method==='GET'||method==='HEAD')&&(path.length===0||(path.length===2&&path[0]==='assets')))return true;
  if(path[0]!=='api'||path[1]!=='v1')return false;
  if(path.length===3&&path[2]==='session'&&['POST','GET','DELETE'].includes(method))return true;
  if(runtimeConfigurationRead(method,path))return true;
  return path[2]==='host-recoveries'&&(
   method==='GET'&&(path.length===4||(path.length===5&&path[4]==='ownership'))||
   method==='POST'&&path.length===5&&path[4]==='resume');
 }
 return Object.freeze({
  get isHeld(){return mode!=='open';},get isRecovering(){return mode==='recovery';},get isMaintaining(){return mode==='maintenance';},get activeRequests(){return active;},
  enter(input:{method:string;path:readonly string[]}):()=>void{
   if(mode==='recovery'&&!memoryOnly(input.method,input.path))throw new Error('HOST_RECOVERY_IN_PROGRESS');
   if(mode==='backup'&&!metadata(input.method,input.path))throw new Error('HOST_BACKUP_IN_PROGRESS');
   if(mode==='maintenance'&&!memoryOnly(input.method,input.path)&&!maintenanceRead(input.method,input.path))throw new Error('HOST_MAINTENANCE_IN_PROGRESS');
   const backupCounted=!metadata(input.method,input.path)&&!backupCreate(input.method,input.path);
   const recoveryCounted=!memoryOnly(input.method,input.path);
   if(backupCounted)active++;
   if(recoveryCounted)recoveryActive++;
   let released=false;
   return ()=>{
    if(released)return;released=true;
    if(backupCounted)active--;
    if(recoveryCounted)recoveryActive--;
    if(active===0){for(const resolve of waiters)resolve();waiters.clear();}
    if(recoveryActive===0){for(const resolve of recoveryWaiters)resolve();recoveryWaiters.clear();}
   };
  },
  async acquire():Promise<()=>void>{
   if(mode!=='open')throw new Error('BACKUP_BARRIER_BUSY');mode='backup';
   if(active>0)await new Promise<void>(resolve=>waiters.add(resolve));
   let released=false;return ()=>{if(released)return;released=true;mode='open';};
  },
  async acquireRecovery():Promise<()=>void>{
   if(mode!=='open')throw new Error('HOST_RECOVERY_BUSY');mode='recovery';
   if(recoveryActive>0)await new Promise<void>(resolve=>recoveryWaiters.add(resolve));
   let released=false;return ()=>{if(released)return;released=true;mode='open';};
  },
  async acquireMaintenance():Promise<()=>void>{
   if(mode!=='open')throw new Error('HOST_MAINTENANCE_BUSY');mode='maintenance';
   if(recoveryActive>0)await new Promise<void>(resolve=>recoveryWaiters.add(resolve));
   let released=false;return ()=>{if(released)return;released=true;mode='open';};
  },
 });
}
