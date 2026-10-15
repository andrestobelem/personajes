import { z } from 'zod';
import { PreparedForkStateSchema } from './prepare-fork-state.ts';
import { ReadyRunConfigurationSchema } from './production-preflight.ts';
import { WorldContinuityFenceSchema } from '../domain/world-journal.ts';
import { ForkDramaticSeedSchema } from './fork-dramatic-seed.ts';
import { hashContinuistaValue } from '../domain/continuista-review.ts';

export const ForkPublicationPackageSchema=z.strictObject({
 kind:z.literal('fork-publication-package'),state:PreparedForkStateSchema,
 configuration:ReadyRunConfigurationSchema,continuityFence:WorldContinuityFenceSchema,dramaticSeed:ForkDramaticSeedSchema,
}).superRefine((packet,context)=>{
 const source=packet.state.source;const origin=packet.configuration.forkOrigin;
 if(packet.configuration.runId!==packet.state.targetRunId||packet.configuration.configRevision!==0
  ||hashContinuistaValue(packet.configuration.worldSnapshot)!==hashContinuistaValue(packet.state.snapshot)
  ||origin===undefined||hashContinuistaValue(origin.source)!==hashContinuistaValue(source)
  ||hashContinuistaValue(packet.dramaticSeed.source)!==hashContinuistaValue(source)
  ||packet.dramaticSeed.structure.runId!==packet.state.targetRunId||packet.dramaticSeed.structure.activeSceneId!==packet.state.snapshot.activeSceneId
  ||packet.continuityFence.atWorldSeq!==packet.state.snapshot.seq)
  context.addIssue({code:'custom',message:'Paquete de publicación de otra fuente o destino'});
});
export type ForkPublicationPackage=z.infer<typeof ForkPublicationPackageSchema>;
