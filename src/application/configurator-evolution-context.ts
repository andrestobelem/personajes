import { z } from 'zod';
import { DossierSchema } from '../domain/catalog.ts';
import { CharacterIdSchema } from '../domain/values.ts';
import { ConfiguratorEvolutionRunScopeSchema } from '../domain/configurator.ts';
import { ConfiguratorEvidenceSchema } from '../domain/configurator.ts';
import { ForkSourceReadResultSchema } from './fork-source.ts';
import { exportDossier } from '../adapters/catalog.ts';
import { configuratorEvidencePayload,configuratorExperienceStatus,configuratorValueHash,validateConfiguratorContext } from './configurator-context.ts';
import { createHash } from 'node:crypto';

const FoundSourceSchema=ForkSourceReadResultSchema.options[0];
const RequestSchema=z.strictObject({source:FoundSourceSchema,originalDossier:DossierSchema,scope:ConfiguratorEvolutionRunScopeSchema,characterId:CharacterIdSchema});
/** Deterministic UUID v4-shaped identity for a derived evidence row; never a fabricated event. */
function stateEvidenceId(value:unknown){const hash=configuratorValueHash(value);return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;}
const archiveHash=(dossier:z.infer<typeof DossierSchema>)=>createHash('sha256').update(exportDossier(dossier)).digest('hex');

/** Host-only compiler. Its input is a verified journal source, not submitted GUI evidence.
 * Only the selected actor's admitted archive and exact committed mind enter the result.
 * A recorded belief or testimony remains subjective; no world event is invented from it. */
export function compileConfiguratorEvolutionContext(raw:unknown){
  const request=RequestSchema.parse(raw);const {source,scope,characterId,originalDossier}=request;
  const cut=source.cuts.find(item=>item.actorId===characterId);const snapshot=source.snapshot;const configuration=source.configuration;
  const prepared=configuration.roster.preparedCharacters.find(item=>item.characterId===characterId);
  const actor=snapshot.entities.find(item=>item.kind==='character'&&item.characterId===characterId);
  if(cut===undefined||prepared===undefined||actor?.kind!=='character'||actor.preparation.kind!=='prepared'||originalDossier.characterId!==characterId)throw new Error('Evolution requires the exact prepared actor and original dossier');
  if(originalDossier.revision!==prepared.dossierRevision||originalDossier.contentHash!==prepared.dossierHash)throw new Error('Original dossier does not match prepared source revision and hash');
  const anchor=cut.source;
  if(anchor.runId!==scope.runId||anchor.configurationRevision!==scope.configurationRevision||anchor.worldRevision!==scope.worldRevision||anchor.worldSeq!==scope.throughWorldSeq||snapshot.runId!==anchor.runId||snapshot.revision!==anchor.worldRevision||snapshot.seq!==anchor.worldSeq||snapshot.clock.instant!==scope.fictitiousAt||configuratorValueHash(snapshot)!==anchor.snapshotHash||configuration.runId!==anchor.runId||configuration.configRevision!==anchor.configurationRevision||configuratorValueHash(configuration)!==anchor.configurationHash||configuratorValueHash(configuration.inferenceProfile)!==configuratorValueHash(scope.profile))throw new Error('Evolution source, profile or exact boundary mismatch');
  const actors=snapshot.entities.filter(item=>item.kind==='character');
  if(source.cuts.length!==actors.length||new Set(source.cuts.map(item=>item.actorId)).size!==actors.length||actors.some(actor=>!source.cuts.some(item=>item.actorId===actor.characterId))||source.cuts.some(item=>configuratorValueHash(item.source)!==configuratorValueHash(anchor)))throw new Error('Incomplete or mixed evolution checkpoint batch');
  if(source.structure.runId!==anchor.runId||source.structure.activeSceneId!==snapshot.activeSceneId||source.structure.structureRevision>anchor.commitIndex)throw new Error('Evolution structure outside source');
  const fence=configuration.preparedActorFences.find(item=>item.characterId===characterId);
  if(fence===undefined||fence.identityVersion!==prepared.identityVersion||fence.dossierRevision!==prepared.dossierRevision||fence.dossierHash!==prepared.dossierHash||fence.continuity.continuityId!==prepared.continuity.continuityId||fence.continuity.revision!==prepared.continuity.revision||fence.continuity.contentHash!==prepared.continuity.contentHash||actor.preparation.identityVersion!==prepared.identityVersion||actor.preparation.continuityId!==prepared.continuity.continuityId||configuratorValueHash(prepared.continuity)!==configuratorValueHash(configuration.continuity))throw new Error('Prepared actor or configuration fence mismatch');
  const initial=prepared.initialExperience.value;const references=new Set([...cut.experiences.map(item=>item.envelope.experienceId),...(initial.kind==='run-cut'?initial.experiences.map(item=>item.experienceId):[])]);
  if(actor.mind.relationships.some(item=>item.history.some(id=>!references.has(id)))||actor.mind.goals.some(item=>item.history.some(id=>!references.has(id)))||actor.mind.beliefs.some(item=>!references.has(item.experienceId)||item.basedOn.some(id=>!references.has(id))))throw new Error('Actor state has no admitted private evidence');
  const statePayload={characterId,source:anchor,worldRevision:snapshot.revision,commitIndex:anchor.commitIndex,worldSeq:snapshot.seq,mind:actor.mind};
  const stateEvidence=ConfiguratorEvidenceSchema.parse({kind:'committed-character-state',evidenceId:stateEvidenceId({kind:'committed-character-state',...statePayload}),...statePayload,fullHash:configuratorValueHash(statePayload)});
  const experienceEvidence=cut.experiences.map(experience=>{
    const payload={characterId,source:anchor,experience,epistemicStatus:configuratorExperienceStatus(experience.envelope)};
    return ConfiguratorEvidenceSchema.parse({kind:'admitted-experience',evidenceId:experience.envelope.experienceId,...payload,fullHash:configuratorValueHash(payload)});
  });
  const evolutionEvidence=[stateEvidence,...experienceEvidence].sort((left,right)=>left.evidenceId<right.evidenceId?-1:left.evidenceId>right.evidenceId?1:0);
  // Keep the serializer/checksum contract shared with imported dossiers and proposals.
  const fullHash=archiveHash(originalDossier);
  const context=validateConfiguratorContext({kind:'configurator-context',schemaVersion:1,role:'configurator',scope:{kind:'evolution',scope,anchor:{source:anchor,preparedContextHash:configuratorValueHash(prepared)},actorStateCut:cut},source:originalDossier,target:originalDossier,sourceFullHash:fullHash,targetFullHash:fullHash,preparedCharacter:prepared,documents:[],evolutionEvidence});
  if(context.evolutionEvidence.some(item=>item.fullHash!==configuratorValueHash(configuratorEvidencePayload(item))))throw new Error('Compiled evidence integrity mismatch');
  return context;
}
