import { join } from 'node:path';
import { readDossier, type loadCatalog } from '../adapters/catalog.ts';
import { z } from 'zod';
import { CharacterIdSchema } from '../domain/values.ts';
import type { openLocalHost } from './local-host.ts';
import { openDossierExchange } from './dossier-exchange.ts';
import { openBackupService,type BackupQuiescePort } from './backup-service.ts';
import { createExchangeRoutes } from '../server/exchange-routes.ts';

/** Trusted host composition; loading the registered catalog never starts inference.
 * The unresolved global writer barrier makes backup fail explicitly, not a best-effort copy. */
export async function createExchangeRuntime(input:{host:ReturnType<typeof openLocalHost>;catalog:Awaited<ReturnType<typeof loadCatalog>>}){
  z.string().min(1).parse(input.host.ownerToken);
  const entries=input.catalog.manifest.characters;
  const loaded=await Promise.all(entries.map(entry=>readDossier({catalog:input.catalog,characterId:entry.characterId})));
  const dossiersById=new Map(loaded.map(dossier=>[dossier.characterId,dossier]));
  const journalPath=join(input.host.privateDataRoot,'world.sqlite');
  const dossiers=openDossierExchange({journalPath,getDossier(characterId){
    const dossier=dossiersById.get(CharacterIdSchema.parse(characterId));
    if(dossier===undefined)throw new Error('DOSSIER_NOT_FOUND');return dossier;
  }});
  let backups:ReturnType<typeof openBackupService>;
  let quiesce:BackupQuiescePort|undefined;
  try{backups=openBackupService({privateDataRoot:input.host.privateDataRoot,quiesce:{async acquire(){if(!quiesce)throw new Error('BACKUP_QUIESCE_UNAVAILABLE');return await quiesce.acquire();}}});}
  catch(error){dossiers.close();throw error;}
  let routes:ReturnType<typeof createExchangeRoutes>;
  try{routes=createExchangeRoutes({journalPath,dossiers,backups});}catch(error){backups.close();dossiers.close();throw error;}
  let closed=false;
  return Object.freeze({routes,dossiers,backups,setBackupQuiesce(port:BackupQuiescePort){if(closed||quiesce)throw new Error('BACKUP_QUIESCE_ALREADY_CONFIGURED');quiesce=port;},close(){if(closed)return;closed=true;routes.close();backups.close();dossiers.close();}});
}
