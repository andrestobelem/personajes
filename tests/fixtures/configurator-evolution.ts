import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openJournal } from '../../src/adapters/journal.ts';
import { createDeliverWorldWorker } from '../../src/application/deliver-world.ts';
import { ReadyRunConfigurationSchema } from '../../src/application/production-preflight.ts';
import { PreparedCharacterSchema } from '../../src/domain/preparation.ts';
import { loadCatalog,readDossier } from '../../src/adapters/catalog.ts';
import { DossierSchema } from '../../src/domain/catalog.ts';
import { ConfiguratorEvolutionRunScopeSchema } from '../../src/domain/configurator.ts';
import { ConfiguratorProposalSchema,ConfiguratorApprovalSchema } from '../../src/domain/configurator.ts';
import { configuratorValueHash } from '../../src/application/configurator-context.ts';
import { compileConfiguratorEvolutionContext } from '../../src/application/configurator-evolution-context.ts';
import { freezeExperience } from '../../src/application/experience-envelope.ts';
import { setup,actorId } from './continuista.ts';

/** Synthetic test identities anchored to an actual SQLite commit and delivered experience archive. */
export async function configuratorEvolutionFixture(){
  const originalBase=await setup();
  const original=await readDossier({catalog:await loadCatalog({repositoryRoot:process.cwd()}),characterId:'maxwell-smart'});
  const originalDossier=DossierSchema.parse({...original,characterId:actorId,displayName:'Expediente sintético para pruebas del Configurador',unknowns:[...original.unknowns,'Vacío sintético conservado'],contradictions:[...original.contradictions,'Discrepancia documental sintética conservada']});
  const preparedCharacters=originalBase.configuration.roster.preparedCharacters.map(actor=>{
    if(actor.characterId!==actorId)return actor;
    const section=<T extends {provenance:{dossierRevision:number;dossierHash:string}}>(value:T)=>({...value,provenance:{...value.provenance,dossierRevision:originalDossier.revision,dossierHash:originalDossier.contentHash}});
    return PreparedCharacterSchema.parse({...actor,dossierRevision:originalDossier.revision,dossierHash:originalDossier.contentHash,identity:section(actor.identity),voice:section(actor.voice),antecedents:{...section(actor.antecedents),value:actor.antecedents.value.map(section)},goals:section(actor.goals),relationships:section(actor.relationships),capabilities:section(actor.capabilities),inventory:section(actor.inventory),initialExperience:section(actor.initialExperience),unknownPolicy:section(actor.unknownPolicy)});
  });
  const configuration=ReadyRunConfigurationSchema.parse({...originalBase.configuration,roster:{...originalBase.configuration.roster,preparedCharacters},preparedActorFences:preparedCharacters.map(actor=>({characterId:actor.characterId,identityVersion:actor.identityVersion,dossierRevision:actor.dossierRevision,dossierHash:actor.dossierHash,continuity:{continuityId:actor.continuity.continuityId,revision:actor.continuity.revision,contentHash:actor.continuity.contentHash}}))});
  const journalPath=join(originalBase.directory,'configurator.sqlite');const journal=openJournal({path:journalPath});
  const base={...originalBase,configuration,journal,close(){journal.close();originalBase.close();}};
  try{
    const world0=configuration.worldSnapshot;
    journal.registerWorldRun({initialSnapshot:world0,configurationRevision:configuration.configRevision,configuration,continuityFence:{kind:'prepared-contexts',atWorldSeq:world0.seq,contexts:preparedCharacters.filter(actor=>world0.scenes.find(scene=>scene.id===world0.activeSceneId)?.participantIds.includes(actor.characterId)).map(actor=>({actorId:actor.characterId,continuityId:actor.continuity.continuityId,continuityRevision:actor.continuity.revision,continuityContentHash:actor.continuity.contentHash,identityVersion:actor.identityVersion,preparedContextHash:configuratorValueHash(actor)}))},lifecycle:'running'});
    const initialHuman=configuration.humanParticipants[0];assert.ok(initialHuman);
    const first=journal.commitHumanIntervention({runId:world0.runId,participantId:initialHuman.identity.participantId,expectedRevision:world0.revision,idempotencyKey:randomUUID(),request:{kind:'speech',recipientCharacterIds:[actorId],channelId:initialHuman.presence.channelId,content:{kind:'speech',text:'Mensaje sintético entregado antes del corte.'}}});if(first.kind==='idempotencyConflict'||first.kind==='invalidLifecycle'||first.resolution.kind!=='applied')assert.fail('Fixture speech rejected');
    assert.equal((await createDeliverWorldWorker({journal,runId:world0.runId,actorId}).drain()).kind,'completed');
    const world=base.journal.loadWorld({runId:base.configuration.runId});assert.ok(world);
    const belief=freezeExperience({schemaVersion:1,kind:'belief',experienceId:randomUUID(),runId:world.runId,actorId,content:'Creo que debo escuchar antes de actuar; esto es una interpretación propia.',sourceRefs:[],worldSeq:world.seq,fictitiousAt:world.clock.instant,receivedAt:world.clock.instant,confidence:0.6,revision:0,predecessor:{kind:'initial'},basedOn:[]});base.journal.recordExperience(belief);
    const human=base.configuration.humanParticipants[0];assert.ok(human);
    const applied=base.journal.commitHumanIntervention({runId:world.runId,participantId:human.identity.participantId,expectedRevision:world.revision,idempotencyKey:randomUUID(),request:{kind:'speech',recipientCharacterIds:[actorId],channelId:human.presence.channelId,content:{kind:'speech',text:'Segundo mensaje sintético para conservar un corte posterior a la entrega.'}}});
    if(applied.kind==='idempotencyConflict'||applied.kind==='invalidLifecycle'||applied.resolution.kind!=='applied')assert.fail('Fixture not committed');
    const snapshot=applied.resolution.newSnapshot;const committed=base.journal.readInspectorWorldCut({runId:snapshot.runId,worldRevision:snapshot.revision,atWorldSeq:snapshot.seq});assert.ok(committed);
    const source=base.journal.readForkSource({runId:snapshot.runId,commitIndex:committed.commitIndex,worldRevision:snapshot.revision,worldSeq:snapshot.seq});assert.equal(source.kind,'found');if(source.kind!=='found')assert.fail('Source unavailable');
    const lifecycle=base.journal.readWorldLifecycle({runId:snapshot.runId});assert.ok(lifecycle);
    const scope=ConfiguratorEvolutionRunScopeSchema.parse({runId:snapshot.runId,jobId:randomUUID(),generation:0,lifecycleRevision:lifecycle.lifecycleRevision,configurationRevision:source.configuration.configRevision,worldRevision:snapshot.revision,throughWorldSeq:snapshot.seq,fictitiousAt:snapshot.clock.instant,profile:source.configuration.inferenceProfile});
    const context=compileConfiguratorEvolutionContext({source,originalDossier,scope,characterId:actorId});
    const lived=context.evolutionEvidence.find(item=>item.kind==='admitted-experience'&&item.experience.envelope.experienceId===belief.envelope.experienceId);assert.ok(lived);
    const prepared=context.preparedCharacter;assert.ok(prepared);
    const proposal=ConfiguratorProposalSchema.parse({kind:'identity-promotion-proposal',sourceRevision:context.source.revision,targetRevision:context.target.revision,sourceHash:context.source.contentHash,targetHash:context.target.contentHash,sourceFullHash:context.sourceFullHash,targetFullHash:context.targetFullHash,reason:'La experiencia sintética justifica proponer más escucha; pendiente del operador.',evidenceIds:[lived.evidenceId],sourceIds:[],expectedIdentityVersion:prepared.identityVersion,identity:{...prepared.identity.value,selfConcept:prepared.identity.value.selfConcept+' Procuro escuchar con mayor paciencia.'},effectiveBoundary:'future-coherent-boundary',unknowns:context.target.unknowns});
    const approval=ConfiguratorApprovalSchema.parse({kind:'operator-consent',proposalHash:configuratorValueHash(proposal),contextHash:configuratorValueHash(context),targetFullHash:context.targetFullHash,operatorId:'synthetic-operator',operationId:randomUUID(),confirmedAt:'2026-10-15T23:00:00Z'});
    return {base,journalPath,source,context,proposal,approval,originalDossier,scope,characterId:actorId,close:()=>base.close()};
  }catch(error){base.close();throw error;}
}
