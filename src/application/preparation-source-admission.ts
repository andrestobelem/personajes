import { isDeepStrictEqual } from 'node:util';
import type { Dossier } from '../domain/catalog.ts';
import { DossierAdaptationReadSchema } from '../domain/dossier-exchange.ts';
import { DossierSourceReferenceSchema } from '../domain/dossier-source.ts';
import { verifyIcmWorkspaceSnapshot, type IcmWorkspaceSnapshot } from '../domain/icm-workspace.ts';
import type { RunConfigurationDraftSchema } from '../domain/production.ts';
import type { z } from 'zod';
import type { openDossierExchange } from './dossier-exchange.ts';
import { freezeCatalogDossierSource, validateFrozenDossierSource } from './dossier-source-repository.ts';

type Draft = z.infer<typeof RunConfigurationDraftSchema>;
export type PreparationSourceAdmission = (input: { principalId: string; previous: Draft; candidate: Draft }) => void;

/** Called synchronously inside the journal transaction, after replay and CAS.
 * A checksum proves integrity; only a host-owned source proves provenance. */
export function createPreparationSourceAdmission(input: {
  readCatalogDossier(characterId: string): Dossier;
  adaptations: Pick<ReturnType<typeof openDossierExchange>, 'readSavedAdaptation'>;
  /** Host-owned resolver; never accepts a checksum as evidence of origin. */
  admitIcmWorkspace?: (snapshot: IcmWorkspaceSnapshot) => void;
}): PreparationSourceAdmission {
  return ({ principalId, previous, candidate }) => {
    const priorWorkspace = previous.icmWorkspace;
    const workspace = candidate.icmWorkspace;
    if (workspace?.kind === 'configured') verifyIcmWorkspaceSnapshot(workspace.value);
    if (priorWorkspace?.kind === 'configured') verifyIcmWorkspaceSnapshot(priorWorkspace.value);
    if (priorWorkspace?.kind === 'configured' && workspace?.kind !== 'configured') {
      throw new Error('ICM_WORKSPACE_REMOVAL_FORBIDDEN');
    }
    if (workspace?.kind === 'configured'
      && (priorWorkspace?.kind !== 'configured' || !isDeepStrictEqual(priorWorkspace.value, workspace.value))) {
      if (input.admitIcmWorkspace === undefined) throw new Error('ICM_WORKSPACE_ADMISSION_UNAVAILABLE');
      input.admitIcmWorkspace(workspace.value);
    }
    const oldRoster = previous.roster.kind !== 'empty' ? [...previous.roster.value.preparedCharacters, ...(previous.roster.value.preparationDrafts ?? [])] : [];
    const actors = candidate.roster.kind !== 'empty' ? [...candidate.roster.value.preparedCharacters, ...(candidate.roster.value.preparationDrafts ?? [])] : [];
    for (const actor of actors) {
      const prior = oldRoster.find(entry => entry.characterId === actor.characterId);
      const source = actor.dossierSource;
      if (source === undefined) {
        if (prior?.dossierSource !== undefined) throw new Error('DOSSIER_SOURCE_REMOVAL_FORBIDDEN');
        continue;
      }
      validateFrozenDossierSource(source);
      // Already admitted sources, including foreign fork provenance, remain
      // self-contained. Never read another host's private import IDs here.
      if (prior?.dossierSource !== undefined && isDeepStrictEqual(source, prior.dossierSource)) continue;
      const common = { kind: source.kind, characterId: source.characterId, revision: source.revision,
        contentHash: source.contentHash, fullArchiveHash: source.fullArchiveHash };
      const reference = DossierSourceReferenceSchema.parse(source.kind === 'catalog-original' ? common
        : { ...common, importId: source.importId, adaptationId: source.adaptationId });
      const resolved = reference.kind === 'catalog-original'
        ? freezeCatalogDossierSource(input.readCatalogDossier(reference.characterId))
        : (() => {
          const saved = DossierAdaptationReadSchema.parse(input.adaptations.readSavedAdaptation({ principalId, importId: reference.importId }));
          return validateFrozenDossierSource({ kind: 'saved-adaptation', characterId: saved.characterId,
            revision: saved.revision, contentHash: saved.contentHash, fullArchiveHash: saved.archiveHash,
            importId: saved.importId, adaptationId: saved.adaptationId, importedArchiveHash: saved.importedArchiveHash,
            frozenDossier: saved.adaptation.importedDossier });
        })();
      if (!isDeepStrictEqual(source, resolved)) throw new Error('DOSSIER_SOURCE_SELECTION_CHANGED');
    }
  };
}
