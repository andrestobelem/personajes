import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openPreparationConfiguratorJobLedger } from '../adapters/preparation-configurator-job-ledger.ts';
import type { openLocalHost } from './local-host.ts';
import type { loadCatalog } from '../adapters/catalog.ts';
import type { openDossierExchange } from './dossier-exchange.ts';
import type { PiRuntime, CreatePiSessionInput, PiSessionHandle } from '../adapters/pi.ts';
import type { PreparationConfiguratorAdmissionHost } from './preparation-configurator-admission.ts';
import { createPreparationConfiguratorPiWorker } from './preparation-configurator-pi-worker.ts';
import { createPreparationConfiguratorManager } from './preparation-configurator-manager.ts';
import { loadPreparationConfiguratorSources } from './preparation-configurator-sources.ts';
import { applyPreparationConfiguratorSelection } from './preparation-configurator-application.ts';
import { PreparationConfiguratorCreateBodySchema, PreparationConfiguratorApplyBodySchema, projectPreparationConfiguratorJob } from '../domain/preparation-configurator-http.ts';
import { RunIdSchema, JobIdSchema } from '../domain/values.ts';
import { RunConfigurationDraftSchema } from '../domain/production.ts';
import { sha256CanonicalJson } from '../domain/canonical-json.ts';
import { DossierSourceReferenceSchema } from '../domain/dossier-source.ts';
import type { DossierSourceReference } from '../domain/dossier-source.ts';
import type { PreparationConfiguratorApplicationPort, PreparationConfiguratorAuthority } from '../server/preparation-configurator-routes.ts';

type Host = ReturnType<typeof openLocalHost>;
type Catalog = Awaited<ReturnType<typeof loadCatalog>>;
type DossierExchange = ReturnType<typeof openDossierExchange>;

function requireRunOperator(authority: PreparationConfiguratorAuthority, runId: string) {
  if (authority.mode.kind === 'observer') return;
  if (authority.mode.kind !== 'director' || authority.mode.runId !== runId || authority.mode.scope.kind !== 'run') {
    throw new Error('PREPARATION_CONFIGURATOR_OPERATOR_REQUIRED');
  }
}
function requireRunReader(authority: PreparationConfiguratorAuthority, runId: string) {
  if (authority.mode.kind === 'observer') return;
  if (authority.mode.kind !== 'director' || authority.mode.runId !== runId || authority.mode.scope.kind !== 'run') {
    throw new Error('PREPARATION_CONFIGURATOR_OPERATOR_REQUIRED');
  }
}
function sameSavedAdaptation(left: DossierSourceReference, right: DossierSourceReference) {
  return left.kind === 'saved-adaptation' && right.kind === 'saved-adaptation'
    && left.characterId === right.characterId && left.importId === right.importId && left.adaptationId === right.adaptationId;
}

/**
 * Host-owned composition for the preparation configurator. Construction loads
 * frozen source choices and installs resolvers, but does not start a worker,
 * create a Pi session, check credentials or contact a model provider.
 */
export async function createPreparationConfiguratorRuntime(input: {
  host: Host;
  catalog: Catalog;
  adaptations: Pick<DossierExchange, 'readSavedAdaptation'>;
  runtime: PiRuntime;
  admission: PreparationConfiguratorAdmissionHost;
  sessionFactory?: (input: CreatePiSessionInput) => Promise<PiSessionHandle>;
  onFailure?: (input: { jobId: string; code: 'PREPARATION_CONFIGURATOR_WORKER_FAILED' }) => void;
}) {
  const journal = input.host.journal;
  const sources = await loadPreparationConfiguratorSources({ catalog: input.catalog, adaptations: input.adaptations });
  journal.setPreparationConfiguratorSourceResolver(sources.resolve);
  journal.setPreparationConfiguratorApplicationResolver(({ principalId, context, candidate, selection, currentDraft, recordedAt }) => {
    const result = applyPreparationConfiguratorSelection({
      context,
      proposal: candidate.proposal,
      proposalId: candidate.candidateId,
      currentDraft,
      selection,
      host: { principalId, recordedAt, uuid: () => randomUUID() },
    });
    return result.patch;
  });

  const ledger = openPreparationConfiguratorJobLedger({
    journal,
    journalPath: join(input.host.privateDataRoot, 'world.sqlite'),
    privateDataRoot: input.host.privateDataRoot,
    ownerToken: input.host.ownerToken,
  });
  const worker = createPreparationConfiguratorPiWorker({
    ledger: {
      claim: value => journal.claimPreparationConfiguratorJob(value),
      assertActive: value => { journal.assertPreparationConfiguratorActive(value); },
      assertDispatch: value => { ledger.assertDispatch(value); },
      recordSession: value => ledger.recordSession(value),
      recordCheckpoint: value => ledger.recordCheckpoint(value),
      recordCandidate: value => ledger.recordCandidate(value),
      finish: value => ledger.finish(value),
    },
    budget: journal,
    runtime: input.runtime,
    ownerToken: input.host.ownerToken,
    admission: input.admission,
    ...(input.sessionFactory === undefined ? {} : { sessionFactory: input.sessionFactory }),
  });
  const manager = createPreparationConfiguratorManager({ worker, ...(input.onFailure === undefined ? {} : { onFailure: input.onFailure }) });

  const application: PreparationConfiguratorApplicationPort = {
    choices({ runId, authority }) {
      RunIdSchema.parse(runId);
      requireRunReader(authority, runId);
      const draft = RunConfigurationDraftSchema.parse(journal.readRunConfigurationDraft({ runId }));
      const available = sources.choices();
      const activeIds = new Set(draft.roster.kind === 'configured' ? draft.roster.value.activeCharacterIds : []);
      const catalogActors = available.actors.filter(actor => activeIds.has(actor.reference.characterId));
      const actorSources = [...catalogActors];
      if (draft.roster.kind === 'configured') {
        const prepared = [...draft.roster.value.preparedCharacters, ...(draft.roster.value.preparationDrafts ?? [])];
        for (const actor of prepared) {
          const dossierSource = actor.dossierSource;
          if (!activeIds.has(actor.characterId) || dossierSource?.kind !== 'saved-adaptation') continue;
          const reference = DossierSourceReferenceSchema.parse({
            kind: 'saved-adaptation', characterId: dossierSource.characterId, revision: dossierSource.revision,
            contentHash: dossierSource.contentHash, fullArchiveHash: dossierSource.fullArchiveHash,
            importId: dossierSource.importId, adaptationId: dossierSource.adaptationId,
          });
          if (actorSources.some(item => sameSavedAdaptation(item.reference, reference))) continue;
          const catalogName = available.actors.find(item => item.reference.characterId === actor.characterId)?.label;
          actorSources.push({ label: catalogName ?? actor.characterId, reference });
        }
      }
      return {
        kind: 'preparation-configurator-choices',
        runId: draft.runId,
        draftRevision: draft.revision,
        draftHash: sha256CanonicalJson(draft),
        actorSources,
        documents: available.documents.map(document => ({ sourceId: document.sourceId, label: document.title, fullHash: document.fullHash })),
      };
    },
    list({ runId, authority, limit, offset }) {
      RunIdSchema.parse(runId);
      requireRunReader(authority, runId);
      const page = journal.listPreparationConfiguratorJobs({ principalId: authority.principalId, runId, limit, offset });
      return { kind: 'preparation-configurator-jobs', runId, items: page.items.map(projectPreparationConfiguratorJob), hasMore: page.hasMore };
    },
    create({ runId, jobId, body, authority, idempotencyKey }) {
      requireRunOperator(authority, runId);
      const parsed = PreparationConfiguratorCreateBodySchema.parse(body);
      return journal.createPreparationConfiguratorJob({
        principalId: authority.principalId,
        idempotencyKey,
        request: {
          kind: 'preparation-configurator-request',
          schemaVersion: 1,
          runId: RunIdSchema.parse(runId),
          draftRevision: parsed.draftRevision,
          draftHash: parsed.draftHash,
          jobId: JobIdSchema.parse(jobId),
          generation: 0,
          instructions: parsed.instructions,
          actorSources: parsed.actorSources,
          documentIds: parsed.documentIds,
        },
      });
    },
    readJob({ jobId, authority }) {
      try {
        const stored = ledger.readStored({ principalId: authority.principalId, jobId });
        requireRunReader(authority, stored.job.scope.runId);
        return stored.job;
      }
      catch (error) { if (error instanceof Error && error.message === 'PREPARATION_CONFIGURATOR_JOB_MISSING') return undefined; throw error; }
    },
    readReview({ jobId, authority }) {
      const stored = ledger.readStored({ principalId: authority.principalId, jobId });
      requireRunReader(authority, stored.job.scope.runId);
      if (stored.job.state !== 'accepted') return { kind: 'preparation-configurator-review', job: projectPreparationConfiguratorJob(stored.job), candidateId: null, proposalHash: null, proposal: null };
      const candidate = ledger.readAccepted({ principalId: authority.principalId, jobId });
      return { kind: 'preparation-configurator-review', job: projectPreparationConfiguratorJob(stored.job), candidateId: candidate.candidateId,
        proposalHash: sha256CanonicalJson(candidate.proposal), proposal: candidate.proposal };
    },
    start({ jobId, authority, expectedRevision, idempotencyKey }) {
      requireRunOperator(authority, ledger.readStored({ principalId: authority.principalId, jobId }).job.scope.runId);
      const result = ledger.start({ principalId: authority.principalId, jobId, expectedRevision, idempotencyKey });
      if (result.kind === 'started') manager.start(result.job);
      return result.job;
    },
    async cancel({ jobId, authority, expectedRevision, idempotencyKey }) {
      requireRunOperator(authority, ledger.readStored({ principalId: authority.principalId, jobId }).job.scope.runId);
      const job = ledger.cancel({ principalId: authority.principalId, jobId, expectedRevision, idempotencyKey });
      await manager.cancel({ jobId });
      return job;
    },
    apply({ jobId, authority, expectedRevision, idempotencyKey, body }) {
      const stored = ledger.readStored({ principalId: authority.principalId, jobId });
      requireRunOperator(authority, stored.job.scope.runId);
      const parsed = PreparationConfiguratorApplyBodySchema.parse(body);
      const request = {
        principalId: authority.principalId,
        jobId,
        expectedRevision,
        idempotencyKey,
        candidateId: parsed.candidateId,
        proposalHash: parsed.proposalHash,
        expectedDraftRevision: parsed.draftRevision,
        expectedDraftHash: parsed.draftHash,
        selection: parsed.selection,
      };
      const replay = ledger.readApplyReceipt(request);
      if (replay !== undefined) return replay;
      // Verify the accepted Pi checkpoint chain before asking the journal to
      // consume its proof and atomically apply the operator's selected fields.
      const accepted = ledger.readAccepted({ principalId: authority.principalId, jobId });
      if (stored.job.revision !== expectedRevision || accepted.candidateId !== parsed.candidateId
        || sha256CanonicalJson(accepted.proposal) !== parsed.proposalHash) {
        throw new Error('PREPARATION_CONFIGURATOR_ACCEPTED_PROOF_REQUIRED');
      }
      return ledger.apply(request);
    },
  };

  let closed = false;
  return Object.freeze({
    application,
    manager,
    ledger,
    suspendAdmissions: () => manager.suspendAdmissions(),
    recover() {
      if (closed) throw new Error('PREPARATION_CONFIGURATOR_RUNTIME_CLOSED');
      return ledger.recoverInterrupted({ ownerToken: input.host.ownerToken });
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await manager.close(); }
      finally { ledger.close(); }
    },
  });
}
