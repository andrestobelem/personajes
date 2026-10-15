import { readFile, readdir, mkdir, realpath } from 'node:fs/promises';
import { resolve, join, extname, dirname, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { loadCatalog } from '../adapters/catalog.ts';
import { isHostOwnershipFailure, type HostDirectoryOperation } from '../adapters/host-ownership.ts';
import { openLocalHost } from '../application/local-host.ts';
import { createHostRequestBarrier } from '../application/host-request-barrier.ts';
import { createLocalHttpServer, StaticAssetMimeSchema, type LocalStaticAsset, type LocalHttpServer } from './http.ts';
import { createProductionHost } from './production-host.ts';
import { createHostRecoveryRuntime,releaseInterruptedHostOwnership } from '../application/host-recovery-runtime.ts';
import { openIcmRuntimeConfiguration } from '../application/icm-runtime-configuration.ts';
import { createIcmRuntimeConfigurationRoutes } from './icm-runtime-configuration-routes.ts';

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
const selectedRoot=process.env.PERSONAJES_PRIVATE_DATA_ROOT??defaultPrivateData;
if(!isAbsolute(selectedRoot))throw new Error('HOST_ROOT_INVALID');
// Preparing ancestors does not recreate a missing root during an interrupted exchange.
const normalizedRoot=resolve(selectedRoot);
await mkdir(dirname(normalizedRoot),{recursive:true,mode:0o700});
const privateDataRoot=join(await realpath(dirname(normalizedRoot)),basename(normalizedRoot));
const admissionBarrier=createHostRequestBarrier();
let production:Awaited<ReturnType<typeof createProductionHost>>|undefined;
let server:LocalHttpServer|undefined;
let runtimeConfiguration:ReturnType<typeof openIcmRuntimeConfiguration>|undefined;
const recovery=createHostRecoveryRuntime({privateDataRoot,admissionBarrier,
 async resetSessions(){if(server===undefined)throw new Error('HOST_RECOVERY_HTTP_UNAVAILABLE');await server.resetSessions();},
 async closeProduction(options){
  const current=production;
  if(current===undefined){releaseInterruptedHostOwnership({privateDataRoot,...options});return;}
  try{await current.close(options);}finally{production=undefined;}
 },
 async reopenProduction({directoryOperation}){production=await compose(openLocalHost({privateDataRoot,directoryOperation}),directoryOperation);},
 onDiagnostic:diagnostic=>process.stderr.write(JSON.stringify(diagnostic)+'\n'),
});
async function compose(owned:ReturnType<typeof openLocalHost>,directoryOperation?:HostDirectoryOperation,selection?:{binaryPath:string|null}){
 const savedSelection=runtimeConfiguration?.readConfiguration();
 const binaryPath=selection!==undefined?selection.binaryPath:savedSelection===undefined?process.env.PERSONAJES_ICM_BINARY:savedSelection.configuredBinaryPath;
 return await createProductionHost({host:owned,catalog,admissionBarrier,
 ...(binaryPath===undefined||binaryPath===null?{}:{icmBinaryPath:binaryPath}),
 ...(process.env.PERSONAJES_PRIVATE_AUTH_ROOT===undefined?{}:{privateAuthRoot:process.env.PERSONAJES_PRIVATE_AUTH_ROOT}),
 ...(directoryOperation===undefined?{}:{directoryOperation}),
 configureRestorePort:recovery.wrap,
 onDiagnostic:diagnostic=>process.stderr.write(JSON.stringify(diagnostic)+'\n'),
 });
}
runtimeConfiguration=openIcmRuntimeConfiguration({privateDataRoot,
 ...(process.env.PERSONAJES_ICM_BINARY===undefined?{}:{environmentBinaryPath:process.env.PERSONAJES_ICM_BINARY}),
 acquireMaintenance:()=>admissionBarrier.acquireMaintenance(),
 async apply({binaryPath}){
  if(recovery.pendingOperations().length>0)throw new Error('HOST_RECOVERY_PENDING');
  const previous=production;
  if(previous===undefined)throw new Error('PRODUCTION_RUNTIME_CONFIGURATION_BUSY');
  previous.assertRuntimeConfigurationIdle();
  const previousPath=runtimeConfiguration?.readConfiguration().configuredBinaryPath??null;
  production=undefined;
  try{
   await previous.close();
   production=await compose(openLocalHost({privateDataRoot}),undefined,{binaryPath});
  }
  catch(error){
   try{production=await compose(openLocalHost({privateDataRoot}),undefined,{binaryPath:previousPath});}
   catch{process.stderr.write(JSON.stringify({kind:'runtimeConfigurationRollbackFailed',code:'RUNTIME_CONFIGURATION_ROLLBACK_FAILED'})+'\n');}
   throw error;
  }
 },
});
const runtimeConfigurationRoutes=createIcmRuntimeConfigurationRoutes({application:runtimeConfiguration});
let controlOnly=recovery.pendingOperations().length>0;
if(controlOnly){await recovery.enterOffline();}
else{
 try{production=await compose(openLocalHost({privateDataRoot}));}
 catch(error){
  if(recovery.pendingOperations().length===0){await recovery.close();await runtimeConfiguration.close();throw error;}
  controlOnly=true;await recovery.enterOffline();
 }
}
let address:Awaited<ReturnType<LocalHttpServer['listen']>>;
try{
 const initialOptions={catalog,shellHtml,staticAssets,admissionBarrier};
 // Resolve application ports per request, so no route retains a closed journal
 // after the offline exchange. Static assets and the control plane remain live.
 server=createLocalHttpServer(new Proxy(initialOptions,{get(target,key,receiver){
  if(key==='operatorExtensions')return [recovery.routes,runtimeConfigurationRoutes,...(production?.httpOptions.operatorExtensions??[])];
  if(key==='runtimeComposition'&&production===undefined)return ()=>({kind:'unavailable'});
  if(production!==undefined&&Reflect.has(production.httpOptions,key))return Reflect.get(production.httpOptions,key);
  return Reflect.get(target,key,receiver);
 }}));
 address=await server.listen(port);
}catch(error){await runtimeConfiguration.close();await recovery.close();await production?.close();throw error;}
process.stdout.write(JSON.stringify({kind:'serverReady',origin:address.origin,
 representation:production===undefined?'host-recovery-pending':production.httpOptions.runtimeComposition().kind==='composed'?'composed':'icm-not-configured',
})+'\n');
let stopping=false;
async function stop(){
 if(stopping)return;
 stopping=true;
 try{await runtimeConfiguration?.close();await recovery.close();await server?.close();}finally{await production?.close();}
}
const onSignal=()=>void stop().catch(()=>{
 process.stderr.write(JSON.stringify({kind:'hostCloseFailed',code:'HOST_CLOSE_FAILED'})+'\n');
 process.exitCode=1;
});
process.on('SIGINT',onSignal);
process.on('SIGTERM',onSignal);
// Recovery can await memory processes or Pi. Shutdown handlers must exist first.
try{if(!controlOnly)await production?.recover();}
catch{process.stderr.write(JSON.stringify({kind:'representationRecoveryFailed',code:'REPRESENTATION_RECOVERY_FAILED'})+'\n');}
}

await start().catch((error:unknown)=>{
 process.stderr.write(JSON.stringify({kind:'serverStartFailed',code:isHostOwnershipFailure(error)?error.code:'SERVER_START_FAILED'})+'\n');
 process.exitCode=1;
});
