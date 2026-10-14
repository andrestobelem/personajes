import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DossierSchema, parseDossierMarkdown } from '../src/domain/catalog.ts';
import { ExperienceSchema } from '../src/domain/experience.ts';
import {
  ContinuityContextSchema, ContinuityReferenceSchema, PreparationDraftSchema,
  PreparationProvenanceSchema, SpanishVarietyForActingSchema, UnknownPolicySchema,
} from '../src/domain/preparation.ts';
import type { ContinuityContext, PreparationProvenance, PreparedCharacter } from '../src/domain/preparation.ts';
import type { ActorWorldProjectionRequest } from '../src/domain/preparation.ts';
import { ActorWorldProjectionSchema } from '../src/application/actor-world-projection.ts';
import type { ActorFacingWorldView } from '../src/application/actor-world-projection.ts';
import { GoalIdSchema as WorldGoalIdSchema, PlaceHandleSchema } from '../src/domain/world.ts';
import {
  compilePrivateActorPrompt, createEmptyPreparationDraft, prepareCharacter,
} from '../src/application/prepare-character.ts';
import {
  CharacterIdSchema, ExperienceIdSchema, FictionalInstantSchema, HashSchema,
  RevisionSchema, RunIdSchema, WorldSeqSchema,
} from '../src/domain/values.ts';

// Synthetic fixtures only: these examples exercise boundaries and are not canon evidence.
const profileSource = {
  id: 'fixture-profile', kind: 'canon', reference: 'fixture://profile',
  scope: 'Synthetic unit-test fixture', uncertainty: 'No canon claim',
};
const familySource = {
  id: 'fixture-family', kind: 'canon', reference: 'fixture://family',
  scope: 'Synthetic unit-test fixture', uncertainty: 'No canon claim',
};

function dossierFor(input: { characterId: string; displayName: string; markdown?: string }) {
  const markdown = input.markdown ?? `# ${input.displayName}\n\n## Identidad\nFicha de fixture.`;
  return DossierSchema.parse({
    schemaVersion: 1,
    characterId: CharacterIdSchema.parse(input.characterId),
    displayName: input.displayName,
    aliases: [],
    performers: ['FIXTURE_PERFORMER_METADATA_DO_NOT_PROMPT'],
    markdown,
    sections: [],
    sourceRefs: [profileSource, familySource],
    unknowns: [],
    contradictions: [],
    adaptations: [],
    avatarRef: { kind: 'unbound' },
    voiceRecipe: { kind: 'unreviewed' },
    revision: 2,
    contentHash: HashSchema.parse('a'.repeat(64)),
    curationStatus: 'unreviewed',
    unknownSections: [],
  });
}

function continuityFor(input: {
  continuityId?: string;
  revision?: number;
  hash?: string;
  label?: string;
  marriage?: 'reached' | 'notReached' | 'undetermined';
  children?: 'reached' | 'notReached' | 'undetermined';
}) {
  const milestones = [];
  if (input.marriage !== undefined) {
    milestones.push({
      milestoneId: 'marriage-to-99', label: 'Matrimonio de Max y 99',
      status: input.marriage, sourceRefs: ['fixture-family'],
    });
  }
  if (input.children !== undefined) {
    milestones.push({
      milestoneId: 'children', label: 'Hijos de Max y 99',
      status: input.children, sourceRefs: ['fixture-family'],
    });
  }
  return ContinuityContextSchema.parse({
    continuityId: input.continuityId ?? 'get-smart-original',
    revision: input.revision ?? 3,
    contentHash: input.hash ?? 'b'.repeat(64),
    kind: 'original',
    label: input.label ?? 'Corte ficticio de fixture',
    milestones,
    inclusions: [],
  });
}

function dossierBasis(dossier: ReturnType<typeof dossierFor>, continuity: ContinuityContext, sourceRefs = ['fixture-profile']): PreparationProvenance {
  return PreparationProvenanceSchema.parse({
    kind: 'dossier-evidence',
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity: ContinuityReferenceSchema.parse({
      continuityId: continuity.continuityId,
      revision: continuity.revision,
      contentHash: continuity.contentHash,
    }),
    curatedBy: 'fixture-curator',
    curatedAt: '2026-10-14T12:00:00.000Z',
    sourceRefs,
  });
}

function declarationBasis(dossier: ReturnType<typeof dossierFor>, continuity: ContinuityContext, reason: string): PreparationProvenance {
  return PreparationProvenanceSchema.parse({
    kind: 'curator-declaration',
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity: ContinuityReferenceSchema.parse({
      continuityId: continuity.continuityId,
      revision: continuity.revision,
      contentHash: continuity.contentHash,
    }),
    reason,
    authoredBy: 'fixture-curator',
    createdAt: '2026-10-14T12:00:00.000Z',
    sourceRefs: [],
  });
}

function adaptationBasis(dossier: ReturnType<typeof dossierFor>, continuity: ContinuityContext): PreparationProvenance {
  return PreparationProvenanceSchema.parse({
    kind: 'explicit-adaptation',
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity: ContinuityReferenceSchema.parse({
      continuityId: continuity.continuityId,
      revision: continuity.revision,
      contentHash: continuity.contentHash,
    }),
    adaptationId: '00000000-0000-4000-8000-000000000100',
    reason: 'Adaptación explícita sintética del fixture',
    authoredBy: 'fixture-curator',
    createdAt: '2026-10-14T12:00:00.000Z',
    sourceRefs: ['fixture-profile'],
  });
}

function experience(input: {
  experienceId?: string;
  characterId?: string;
  runId?: string;
  worldSeq?: number;
  fictitiousAt?: number;
  receivedAt?: number;
  content?: string;
}) {
  return ExperienceSchema.parse({
    schemaVersion: 1,
    experienceId: ExperienceIdSchema.parse(input.experienceId ?? '00000000-0000-4000-8000-000000000201'),
    runId: RunIdSchema.parse(input.runId ?? '00000000-0000-4000-8000-000000000301'),
    actorId: CharacterIdSchema.parse(input.characterId ?? 'maxwell-smart'),
    kind: 'recollection',
    content: input.content ?? 'Escuché una alarma en la oficina.',
    sourceRefs: [],
    fictitiousAt: FictionalInstantSchema.parse(input.fictitiousAt ?? 40),
    receivedAt: FictionalInstantSchema.parse(input.receivedAt ?? 40),
    worldSeq: WorldSeqSchema.parse(input.worldSeq ?? 4),
    confidence: 0.8,
    revision: RevisionSchema.parse(0),
    predecessor: { kind: 'initial' },
    basedOn: [],
  });
}

function createDraft(input: {
  dossier: ReturnType<typeof dossierFor>;
  continuity: ContinuityContext;
  selfReference?: string;
  selfConcept?: string;
  spoken?: boolean;
  antecedents?: Array<{ antecedentId: string; kind: 'biography' | 'milestone' | 'recollection' | 'testimony'; statement: string; applicability?: unknown; provenance?: PreparationProvenance }>;
  goal?: string;
  relationships?: Array<{ ownerCharacterId: string; otherCharacterId: string; otherReference: string; descriptionFromOwnerPerspective: string; confidence: number }>;
  capabilities?: Array<{ capabilityId: string; kind: 'speech' | 'gesture' | 'movement' | 'nonverbal-sound' | 'operate-device' | 'other'; description: string; deviceId?: string }>;
  initialExperience?: unknown;
  initialExperienceProvenance?: PreparationProvenance;
  unknownFields?: unknown;
}) {
  const { dossier, continuity } = input;
  const base = createEmptyPreparationDraft({
    characterId: dossier.characterId,
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity,
    identityVersion: RevisionSchema.parse(1),
  });
  const evidence = dossierBasis(dossier, continuity);
  const declaration = declarationBasis(dossier, continuity, 'Declaración explícita de fixture.');
  const antecedents = input.antecedents ?? [];
  const initialExperience = input.initialExperience ?? { kind: 'none' };
  const initialExperienceProvenance = input.initialExperienceProvenance ?? declaration;
  const voice = input.spoken === false
    ? { kind: 'nonverbal', description: 'Sonidos y gestos no verbales del personaje.' }
    : { kind: 'spoken', recipe: 'Habla en español con ritmo y elección de palabras curados para el personaje.' };
  const goals = [{
    goalId: 'goal-main', kind: 'durable', ownerCharacterId: dossier.characterId,
    desiredOutcome: input.goal ?? 'Resolver la situación sin perder autoridad.', priority: 0.8,
    reviewConditions: [], status: 'active', evidenceRefs: ['fixture-profile'],
  }];
  const capabilities = input.capabilities ?? [
    { capabilityId: 'speak', kind: 'speech', description: 'Puede hablar.' },
    { capabilityId: 'move', kind: 'movement', description: 'Puede desplazarse.' },
  ];
  const unknownPolicy = UnknownPolicySchema.parse({
    defaultTreatment: 'do-not-infer-or-assert', fields: input.unknownFields ?? [],
  });
  const draft = PreparationDraftSchema.parse({
    ...base,
    identity: {
      kind: 'declared',
      value: {
        value: {
          selfReference: input.selfReference ?? dossier.displayName,
          selfConcept: input.selfConcept ?? 'Una identidad estable, contradictoria y situada.',
          values: ['Lealtad a su equipo'],
          dispositions: ['Improvisa ante obstáculos'],
          contradictions: [],
        },
        provenance: evidence,
      },
    },
    voice: { kind: 'declared', value: { value: voice, provenance: evidence } },
    antecedents: {
      kind: 'declared',
      value: {
        value: antecedents.map((antecedent) => ({
          antecedentId: antecedent.antecedentId,
          kind: antecedent.kind,
          statement: antecedent.statement,
          applicability: antecedent.applicability ?? { kind: 'unconditional' },
          provenance: antecedent.provenance ?? evidence,
        })),
        provenance: declaration,
      },
    },
    goals: { kind: 'declared', value: { value: goals, provenance: evidence } },
    relationships: {
      kind: 'declared',
      value: { value: input.relationships ?? [], provenance: input.relationships?.length ? evidence : declaration },
    },
    capabilities: { kind: 'declared', value: { value: capabilities, provenance: evidence } },
    inventory: { kind: 'declared', value: { value: [], provenance: declaration } },
    initialExperience: {
      kind: 'declared',
      value: { value: initialExperience, provenance: initialExperienceProvenance },
    },
    unknownPolicy: {
      kind: 'declared',
      value: {
        value: unknownPolicy,
        provenance: unknownPolicy.fields.some((field) => field.kind === 'character-knowledge-adaptation')
          ? adaptationBasis(dossier, continuity)
          : declaration,
      },
    },
  });
  return draft;
}

function preparedFrom(): PreparedCharacter {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const continuity = continuityFor({ marriage: 'notReached', children: 'notReached' });
  const draft = createDraft({ dossier, continuity });
  const result = prepareCharacter({ draft, dossier });
  if (result.kind !== 'prepared') throw new Error(`Fixture inválido: ${result.kind}`);
  return result.character;
}

function actorWorldProjectionPort(input: {
  content?: string;
  wrongActorId?: string;
  relationships?: Array<{
    targetHandle: string;
    stance: 'unknown' | 'wary' | 'neutral' | 'warm' | 'trusting';
    confidence: number;
    revision: number;
  }>;
  capabilities?: Array<'move' | 'observe' | 'speak' | 'gesture' | 'animalSound' | 'take' | 'offer' | 'useDevice' | 'wait' | 'rest'>;
  goals?: ActorFacingWorldView['self']['goals'];
  placeCount?: number;
  oversizedPlaceDescriptions?: boolean;
} = {}) {
  return {
    async projectForActor(request: ActorWorldProjectionRequest): Promise<unknown> {
      const places: ActorFacingWorldView['places'] = Array.from({ length: input.placeCount ?? 1 }, (_, index) => ({
        handle: PlaceHandleSchema.parse(`place-${index}`), name: `Sala ${index}`,
        description: input.oversizedPlaceDescriptions === true ? 'x'.repeat(2_000) : 'Una sala de prueba.',
        lighting: 'normal',
      }));
      const currentPlace = places[0];
      if (currentPlace === undefined) throw new Error('El fixture requiere un lugar actual');
      return ActorWorldProjectionSchema.parse({
        kind: 'actor-world-projection',
        actorId: input.wrongActorId === undefined ? request.actorId : CharacterIdSchema.parse(input.wrongActorId),
        runId: request.runId,
        continuity: request.continuity,
        worldRevision: request.expectedWorldRevision,
        atWorldSeq: request.atWorldSeq,
        fictionalAt: request.fictionalAt,
        inputPerceptionIds: [],
        world: {
          kind: 'actor-world-view',
          revision: request.expectedWorldRevision,
          now: { instant: request.fictionalAt, convention: { kind: 'fixedOffset', offsetMinutes: -180, label: 'Buenos Aires' } },
          sceneLabel: 'Escena de prueba',
          currentPlace,
          places,
          self: {
            displayName: 'Personaje de prueba', position: { x: 1, y: 1 }, capabilities: input.capabilities ?? ['observe', 'speak'],
            goals: input.goals ?? [], relationships: input.relationships ?? [],
          },
          entities: [], channels: [{ handle: 'channel-speech', kind: 'speech', label: 'Voz cercana' }],
          offers: [],
          inbox: input.content === undefined ? [] : [{
            kind: 'communication', speakerHandle: 'entity-speaker', channelLabel: 'Voz cercana',
            content: { kind: 'speech', text: input.content }, targetHandle: null, fictitiousAt: request.fictionalAt,
          }],
        },
      });
    },
  };
}

test('un dossier Markdown produce un draft vacío, no una biografía inferida', () => {
  const markdown = '# Maxwell Smart\n\n## Biografía\nMax se casa con 99 y tiene hijos.';
  const dossier = parseDossierMarkdown({
    characterId: 'maxwell-smart', displayName: 'Maxwell Smart',
    performers: ['METADATA_DE_INTÉRPRETE'], markdown, contentHash: 'a'.repeat(64),
  });
  const draft = createEmptyPreparationDraft({
    characterId: dossier.characterId,
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity: continuityFor({ marriage: 'notReached', children: 'notReached' }),
    identityVersion: RevisionSchema.parse(0),
  });
  assert.equal(draft.identity.kind, 'empty');
  assert.equal(draft.antecedents.kind, 'empty');
  assert.equal(draft.goals.kind, 'empty');
  const result = prepareCharacter({ draft, dossier });
  assert.equal(result.kind, 'incomplete');
  if (result.kind === 'incomplete') assert.ok(result.missing.includes('identity'));
  assert.throws(() => createEmptyPreparationDraft({
    characterId: dossier.characterId,
    dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash,
    continuity: continuityFor({ marriage: 'notReached', children: 'notReached' }),
    identityVersion: RevisionSchema.parse(0),
    markdown: dossier.markdown,
  }));
});

test('Max antes y después del matrimonio usa condiciones ficticias, no fecha de emisión', async () => {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const futureMarriageFact: NonNullable<Parameters<typeof createDraft>[0]['antecedents']>[number] = {
    antecedentId: 'marriage-to-99',
    kind: 'milestone',
    statement: 'Está casado con 99.',
    applicability: { kind: 'milestone-state', milestoneId: 'marriage-to-99', requires: 'reached' },
  };
  const futureChildrenFact: NonNullable<Parameters<typeof createDraft>[0]['antecedents']>[number] = {
    antecedentId: 'children-with-99',
    kind: 'milestone',
    statement: 'Max tiene hijos con 99.',
    applicability: { kind: 'milestone-state', milestoneId: 'children', requires: 'reached' },
  };
  const preContinuity = continuityFor({ marriage: 'notReached', children: 'notReached', label: 'Antes del matrimonio; fixture' });
  const preDraft = createDraft({ dossier, continuity: preContinuity });
  const pre = prepareCharacter({ draft: preDraft, dossier });
  assert.equal(pre.kind, 'prepared');
  if (pre.kind !== 'prepared') return;
  const compilePre = await compilePrivateActorPrompt({
    prepared: pre.character, runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000301'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(4), fictionalAt: FictionalInstantSchema.parse(40),
    spanishVariety: SpanishVarietyForActingSchema.parse({ kind: 'proposed', label: 'español rioplatense', source: 'editorial-proposal' }),
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
  });
  assert.doesNotMatch(compilePre.text, /Está casado con 99/);
  assert.doesNotMatch(compilePre.text, /METADATA_DE_INTÉRPRETE|FIXTURE_PERFORMER_METADATA|fixture-profile|Antes del matrimonio/);
  assert.match(compilePre.text, /propuesta editorial \(no confirmada como preferencia humana\)/);

  const postContinuity = continuityFor({ marriage: 'reached', children: 'reached', label: 'Después del matrimonio; fixture' });
  const postDraft = createDraft({ dossier, continuity: postContinuity, antecedents: [futureMarriageFact, futureChildrenFact] });
  const post = prepareCharacter({ draft: postDraft, dossier });
  assert.equal(post.kind, 'prepared');
  if (post.kind !== 'prepared') return;
  const compilePost = await compilePrivateActorPrompt({
    prepared: post.character, runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000301'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(4), fictionalAt: FictionalInstantSchema.parse(40),
    spanishVariety: SpanishVarietyForActingSchema.parse({
      kind: 'confirmed', label: 'español declarado en fixture', source: 'operator',
      confirmedBy: 'fixture-operator', confirmedAt: '2026-10-14T12:00:00.000Z',
    }),
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
  });
  assert.match(compilePost.text, /Está casado con 99/);
  assert.match(compilePost.text, /Max tiene hijos con 99/);
  assert.match(compilePost.text, /Variedad de español confirmada para esta puesta/);
  assert.throws(() => ContinuityContextSchema.parse({
    ...postContinuity,
    episodeAiredAt: '1968-01-01',
  }));
  const invalidPreDraft = createDraft({ dossier, continuity: preContinuity, antecedents: [futureMarriageFact] });
  const invalidPre = prepareCharacter({ draft: invalidPreDraft, dossier });
  assert.equal(invalidPre.kind, 'invalid');
});

test('hitos y apariciones necesitan estado de continuidad o inclusión explícita', () => {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const continuity = ContinuityContextSchema.parse({
    ...continuityFor({}),
    inclusions: [{
      inclusionId: '00000000-0000-4000-8000-000000000401',
      label: 'Adaptación explícita de un encuentro para este corte de fixture',
      sourceRefs: ['fixture-profile'],
      confirmedBy: 'fixture-operator',
      confirmedAt: '2026-10-14T12:00:00.000Z',
    }],
  });
  const includedFact: NonNullable<Parameters<typeof createDraft>[0]['antecedents']>[number] = {
    antecedentId: 'included-encounter',
    kind: 'milestone',
    statement: 'Recuerda el encuentro identificado por la inclusión de esta puesta.',
    applicability: { kind: 'explicit-inclusion', inclusionId: '00000000-0000-4000-8000-000000000401' },
  };
  const valid = prepareCharacter({ draft: createDraft({ dossier, continuity, antecedents: [includedFact] }), dossier });
  assert.equal(valid.kind, 'prepared');
  const unconditionalFact = { ...includedFact, applicability: { kind: 'unconditional' } };
  assert.throws(() => createDraft({
    dossier, continuity,
    antecedents: [unconditionalFact],
  }));
});

test('la preparación rechaza curaciones ligadas a otra revisión o hash', () => {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const continuity = continuityFor({ marriage: 'notReached' });
  const draft = createDraft({ dossier, continuity });
  const changedDossier = DossierSchema.parse({ ...dossier, revision: 3 });
  const staleSnapshot = prepareCharacter({ draft, dossier: changedDossier });
  assert.equal(staleSnapshot.kind, 'invalid');

  if (draft.identity.kind !== 'declared') throw new Error('Fixture de identidad incompleto');
  const staleProvenance = PreparationProvenanceSchema.parse({
    ...draft.identity.value.provenance,
    dossierHash: 'c'.repeat(64),
  });
  const staleDraft = PreparationDraftSchema.parse({
    ...draft,
    identity: {
      kind: 'declared',
      value: { ...draft.identity.value, provenance: staleProvenance },
    },
  });
  const staleCuration = prepareCharacter({ draft: staleDraft, dossier });
  assert.equal(staleCuration.kind, 'invalid');
});

test('un dato civil desconocido en la ficha no se convierte en amnesia del personaje', async () => {
  const dossier = dossierFor({ characterId: 'agente-99', displayName: 'Agente 99' });
  const continuity = continuityFor({ continuityId: 'get-smart-original', marriage: 'notReached' });
  const draft = createDraft({
    dossier, continuity, selfReference: 'Agente 99',
    unknownFields: [{ kind: 'source-not-established', topic: 'Nombre civil de Agente 99' }],
  });
  const result = prepareCharacter({ draft, dossier });
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') return;
  const compilation = await compilePrivateActorPrompt({
    prepared: result.character, runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000302'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(0), fictionalAt: FictionalInstantSchema.parse(0),
    spanishVariety: { kind: 'proposed', label: 'español de la puesta', source: 'editorial-proposal' },
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
  });
  assert.match(compilation.text, /La ausencia de un dato en el contexto no prueba que lo hayas olvidado ni que no lo sepas/);
  assert.doesNotMatch(compilation.text, /Nombre civil de Agente 99/);
  assert.doesNotMatch(compilation.text, /no conoces tu nombre civil|has olvidado tu nombre/);
});

test('una excepción de conocimiento requiere y compila su antecedente de la misma adaptación', async () => {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const continuity = continuityFor({ marriage: 'notReached' });
  const adaptationId = '00000000-0000-4000-8000-000000000100';
  const adaptedFact = '99 le contó a Max que el archivador contiene una llave de repuesto.';
  const validDraft = createDraft({
    dossier, continuity,
    antecedents: [{
      antecedentId: 'key-location-told-by-99',
      kind: 'testimony', statement: adaptedFact,
      applicability: { kind: 'unconditional' },
      provenance: adaptationBasis(dossier, continuity),
    }],
    unknownFields: [{
      kind: 'character-knowledge-adaptation', topic: 'Ubicación de la llave', adaptationId,
      reason: 'La puesta incluye este testimonio antes del inicio.', antecedentIds: ['key-location-told-by-99'],
    }],
  });
  const prepared = prepareCharacter({ draft: validDraft, dossier });
  assert.equal(prepared.kind, 'prepared');
  if (prepared.kind !== 'prepared') return;
  const compilation = await compilePrivateActorPrompt({
    prepared: prepared.character,
    runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000407'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(0), fictionalAt: FictionalInstantSchema.parse(0),
    spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
  });
  assert.match(compilation.text, new RegExp(adaptedFact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(compilation.text, /La puesta incluye este testimonio/);

  const unlinkedDraft = createDraft({
    dossier, continuity,
    unknownFields: [{
      kind: 'character-knowledge-adaptation', topic: 'Ubicación de la llave', adaptationId,
      reason: 'La puesta incluye este testimonio antes del inicio.', antecedentIds: ['missing-antecedent'],
    }],
  });
  assert.equal(prepareCharacter({ draft: unlinkedDraft, dossier }).kind, 'invalid');

  const wrongAdaptationDraft = createDraft({
    dossier, continuity,
    antecedents: [{
      antecedentId: 'key-location-told-by-99',
      kind: 'testimony', statement: adaptedFact,
      applicability: { kind: 'unconditional' },
      provenance: adaptationBasis(dossier, continuity),
    }],
    unknownFields: [{
      kind: 'character-knowledge-adaptation', topic: 'Ubicación de la llave',
      adaptationId: '00000000-0000-4000-8000-000000000101',
      reason: 'Una identidad de adaptación distinta no autoriza este conocimiento.',
      antecedentIds: ['key-location-told-by-99'],
    }],
  });
  assert.equal(prepareCharacter({ draft: wrongAdaptationDraft, dossier }).kind, 'invalid');
});

test('Fang conserva voz y capacidades no verbales sin habilitar habla', async () => {
  const dossier = dossierFor({ characterId: 'fang', displayName: 'Fang' });
  const continuity = continuityFor({ continuityId: 'get-smart-original' });
  const draft = createDraft({
    dossier, continuity, selfReference: 'Fang', spoken: false,
    capabilities: [
      { capabilityId: 'move', kind: 'movement', description: 'Puede desplazarse.' },
      { capabilityId: 'sound', kind: 'nonverbal-sound', description: 'Puede emitir sonidos no léxicos.' },
      { capabilityId: 'gesture', kind: 'gesture', description: 'Puede hacer gestos observables.' },
    ],
  });
  const result = prepareCharacter({ draft, dossier });
  assert.equal(result.kind, 'prepared');
  if (result.kind !== 'prepared') return;
  const compilation = await compilePrivateActorPrompt({
    prepared: result.character, runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000303'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(0), fictionalAt: FictionalInstantSchema.parse(0),
    spanishVariety: { kind: 'proposed', label: 'español de la puesta', source: 'editorial-proposal' },
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort({ capabilities: ['observe', 'gesture', 'animalSound'] }),
  });
  assert.match(compilation.text, /Tu perfil vocal es no verbal/);
  assert.match(compilation.text, /nonverbal-sound/);
  const incompatibleFang = createDraft({
    dossier, continuity, selfReference: 'Fang', spoken: false,
    capabilities: [{ capabilityId: 'speak', kind: 'speech', description: 'Habla.' }],
  });
  assert.equal(prepareCharacter({ draft: incompatibleFang, dossier }).kind, 'invalid');
});

test('experiencia inicial exige dueño, corrida y cortes exactos, incluido el momento actual', async () => {
  const dossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const continuity = continuityFor({ marriage: 'notReached' });
  const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000304');
  const continuityRef = ContinuityReferenceSchema.parse({
    continuityId: continuity.continuityId,
    revision: continuity.revision,
    contentHash: continuity.contentHash,
  });
  const sourceExperience = experience({ runId, worldSeq: 4, fictitiousAt: 40, receivedAt: 40 });
  const runCut = {
    kind: 'run-cut', runId, throughWorldSeq: WorldSeqSchema.parse(4),
    throughFictionalAt: FictionalInstantSchema.parse(40), continuity: continuityRef,
    experiences: [sourceExperience],
  };
  const provenance = PreparationProvenanceSchema.parse({
    kind: 'experience-cut', dossierRevision: RevisionSchema.parse(dossier.revision),
    dossierHash: dossier.contentHash, continuity: continuityRef, runId,
    throughWorldSeq: WorldSeqSchema.parse(4), throughFictionalAt: FictionalInstantSchema.parse(40),
    admittedBy: 'fixture-curator', admittedAt: '2026-10-14T12:00:00.000Z',
    experienceIds: [sourceExperience.experienceId],
  });
  const accepted = prepareCharacter({
    draft: createDraft({ dossier, continuity, initialExperience: runCut, initialExperienceProvenance: provenance }),
    dossier,
  });
  assert.equal(accepted.kind, 'prepared');
  if (accepted.kind === 'prepared') {
    await assert.rejects(compilePrivateActorPrompt({
      prepared: accepted.character,
      runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000405'),
      worldRevision: RevisionSchema.parse(4),
      throughWorldSeq: WorldSeqSchema.parse(1),
      fictionalAt: FictionalInstantSchema.parse(30),
      spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
      experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
    }), /corte posterior a la situación actual/);
  }

  const sameInstantFuture = experience({
    experienceId: '00000000-0000-4000-8000-000000000204', runId,
    worldSeq: 5, fictitiousAt: 40, receivedAt: 40,
  });
  const sameInstantCut = {
    ...runCut, throughWorldSeq: WorldSeqSchema.parse(5), experiences: [sameInstantFuture],
  };
  const sameInstantProvenance = PreparationProvenanceSchema.parse({
    ...provenance, throughWorldSeq: WorldSeqSchema.parse(5), experienceIds: [sameInstantFuture.experienceId],
  });
  const sameInstantPrepared = prepareCharacter({
    draft: createDraft({ dossier, continuity, initialExperience: sameInstantCut, initialExperienceProvenance: sameInstantProvenance }),
    dossier,
  });
  assert.equal(sameInstantPrepared.kind, 'prepared');
  if (sameInstantPrepared.kind === 'prepared') {
    await assert.rejects(compilePrivateActorPrompt({
      prepared: sameInstantPrepared.character, runId,
      worldRevision: RevisionSchema.parse(4),
      throughWorldSeq: WorldSeqSchema.parse(4), fictionalAt: FictionalInstantSchema.parse(40),
      spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
      experiences: [], actorWorldProjectionPort: actorWorldProjectionPort(),
    }), /corte posterior a la situación actual/);
  }

  const wrongOwner = experience({
    experienceId: '00000000-0000-4000-8000-000000000202',
    characterId: 'agente-99', runId, worldSeq: 4, fictitiousAt: 40, receivedAt: 40,
  });
  const rejectedOwner = prepareCharacter({
    draft: createDraft({
      dossier, continuity,
      initialExperience: { ...runCut, experiences: [wrongOwner] },
      initialExperienceProvenance: PreparationProvenanceSchema.parse({ ...provenance, experienceIds: [wrongOwner.experienceId] }),
    }), dossier,
  });
  assert.equal(rejectedOwner.kind, 'invalid');

  const afterCut = experience({
    experienceId: '00000000-0000-4000-8000-000000000203',
    runId, worldSeq: 5, fictitiousAt: 50, receivedAt: 50,
  });
  const rejectedCut = prepareCharacter({
    draft: createDraft({
      dossier, continuity,
      initialExperience: { ...runCut, experiences: [afterCut] },
      initialExperienceProvenance: PreparationProvenanceSchema.parse({ ...provenance, experienceIds: [afterCut.experienceId] }),
    }), dossier,
  });
  assert.equal(rejectedCut.kind, 'invalid');
});

test('la vista incorpora sólo las relaciones actuales y experiencias del propio actor', async () => {
  const maxDossier = dossierFor({ characterId: 'maxwell-smart', displayName: 'Maxwell Smart' });
  const agentDossier = dossierFor({ characterId: 'agente-99', displayName: 'Agente 99' });
  const continuity = continuityFor({ marriage: 'notReached' });
  const maxDraft = createDraft({
    dossier: maxDossier, continuity,
    relationships: [{
      ownerCharacterId: 'maxwell-smart', otherCharacterId: 'agente-99',
      otherReference: '99',
      descriptionFromOwnerPerspective: 'Max confía en la competencia de 99.', confidence: 0.9,
    }],
  });
  const agentDraft = createDraft({
    dossier: agentDossier, continuity,
    relationships: [{
      ownerCharacterId: 'agente-99', otherCharacterId: 'maxwell-smart',
      otherReference: 'Max',
      descriptionFromOwnerPerspective: '99 desconfía de la fanfarronería de Max.', confidence: 0.7,
    }],
  });
  const maxResult = prepareCharacter({ draft: maxDraft, dossier: maxDossier });
  const agentResult = prepareCharacter({ draft: agentDraft, dossier: agentDossier });
  assert.equal(maxResult.kind, 'prepared');
  assert.equal(agentResult.kind, 'prepared');
  if (maxResult.kind !== 'prepared' || agentResult.kind !== 'prepared') return;
  const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000305');
  const maxMemory = experience({ runId, content: 'Max oyó una alarma.' });
  const maxPrompt = await compilePrivateActorPrompt({
    prepared: maxResult.character, runId, throughWorldSeq: WorldSeqSchema.parse(5),
    worldRevision: RevisionSchema.parse(4),
    fictionalAt: FictionalInstantSchema.parse(50),
    spanishVariety: { kind: 'proposed', label: 'español de la puesta', source: 'editorial-proposal' },
    experiences: [maxMemory], actorWorldProjectionPort: actorWorldProjectionPort({
      content: '99 dice: «La puerta está abierta».',
      relationships: [{ targetHandle: 'entity-opaque-99', stance: 'trusting', confidence: 0.9, revision: 2 }],
    }),
  });
  const agentPrompt = await compilePrivateActorPrompt({
    prepared: agentResult.character, runId, throughWorldSeq: WorldSeqSchema.parse(5),
    worldRevision: RevisionSchema.parse(4),
    fictionalAt: FictionalInstantSchema.parse(50),
    spanishVariety: { kind: 'proposed', label: 'español de la puesta', source: 'editorial-proposal' },
    experiences: [], actorWorldProjectionPort: actorWorldProjectionPort({
      relationships: [{ targetHandle: 'entity-opaque-max', stance: 'wary', confidence: 0.7, revision: 1 }],
    }),
  });
  assert.match(maxPrompt.text, /entity-opaque-99/);
  assert.doesNotMatch(maxPrompt.text, /entity-opaque-max/);
  assert.match(agentPrompt.text, /entity-opaque-max/);
  assert.doesNotMatch(agentPrompt.text, /entity-opaque-99/);
  assert.doesNotMatch(maxPrompt.text, /Max confía en la competencia de 99|99 desconfía de la fanfarronería/);
  assert.doesNotMatch(agentPrompt.text, /99 desconfía de la fanfarronería|Max confía en la competencia de 99/);
  assert.match(maxPrompt.text, /Max oyó una alarma/);
  assert.match(maxPrompt.text, /La puerta está abierta/);
  assert.doesNotMatch(maxPrompt.text, /HISTORIA_PRIVADA_DE_99/);
});

test('el compilador rechaza experiencias o proyecciones de otra identidad y cualquier dato posterior', async () => {
  const prepared = preparedFrom();
  const runId = RunIdSchema.parse('00000000-0000-4000-8000-000000000306');
  const base = {
    prepared,
    runId,
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(5),
    fictionalAt: FictionalInstantSchema.parse(50),
    spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
  };
  await assert.rejects(compilePrivateActorPrompt({
    ...base,
    experiences: [experience({ characterId: 'agente-99', runId, worldSeq: 4, fictitiousAt: 40, receivedAt: 40 })],
    actorWorldProjectionPort: actorWorldProjectionPort(),
  }), /experiencia de otro personaje/);
  await assert.rejects(compilePrivateActorPrompt({
    ...base,
    experiences: [experience({ runId, worldSeq: 6, fictitiousAt: 60, receivedAt: 60 })],
    actorWorldProjectionPort: actorWorldProjectionPort(),
  }), /posterior al corte/);
  await assert.rejects(compilePrivateActorPrompt({
    ...base, experiences: [], actorWorldProjectionPort: actorWorldProjectionPort({ wrongActorId: 'agente-99' }),
  }), /proyección de otro actor/);
});

test('el prompt largo se rechaza completo y nunca se trunca silenciosamente', async () => {
  const prepared = preparedFrom();
  await assert.rejects(compilePrivateActorPrompt({
    prepared,
    runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000307'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(0),
    fictionalAt: FictionalInstantSchema.parse(0),
    spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
    experiences: [],
    actorWorldProjectionPort: actorWorldProjectionPort({ placeCount: 100, oversizedPlaceDescriptions: true }),
  }), /supera el límite de 160000 caracteres/);
});

test('el contexto actual usa las metas runtime propias sin duplicar metas preparadas', async () => {
  const prepared = preparedFrom();
  const compilation = await compilePrivateActorPrompt({
    prepared,
    runId: RunIdSchema.parse('00000000-0000-4000-8000-000000000308'),
    worldRevision: RevisionSchema.parse(4),
    throughWorldSeq: WorldSeqSchema.parse(0),
    fictionalAt: FictionalInstantSchema.parse(0),
    spanishVariety: { kind: 'proposed', label: 'fixture', source: 'editorial-proposal' },
    experiences: [],
    actorWorldProjectionPort: actorWorldProjectionPort({
      goals: [{
        id: WorldGoalIdSchema.parse('00000000-0000-4000-8000-000000000901'),
        kind: 'durable', description: 'Meta runtime vigente de la agencia.', priority: 0.7, state: 'active', revision: RevisionSchema.parse(2),
      }],
    }),
  });
  assert.match(compilation.text, /Meta runtime vigente de la agencia/);
  assert.doesNotMatch(compilation.text, /Resolver la situación sin perder autoridad/);
  assert.match(compilation.text, /00000000-0000-4000-8000-000000000901/);
});

