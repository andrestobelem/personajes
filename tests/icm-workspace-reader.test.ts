import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  createIcmWorkspaceReader, ICM_WORKSPACE_ACTOR_SLUGS, ICM_WORKSPACE_CATALOG,
} from '../src/adapters/icm-workspace.ts';

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

function temporaryWorkspace() {
  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), 'personajes-icm-reader-')));
  const reader = createIcmWorkspaceReader({ workspaceRoot: temporaryRoot });
  return {
    root: temporaryRoot,
    reader,
    write(relativePath: string, content: string | Uint8Array) {
      const path = join(temporaryRoot, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    cleanup() {
      rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function writeRequiredSources(workspace: ReturnType<typeof temporaryWorkspace>) {
  const files: Record<string, string> = {
    'obra/stages/02-actuacion/CONTEXT.md': '## Process\nActúa desde la propuesta.\n\n## Cierre\nNo declares la propuesta como hecho.\n',
    'obra/personajes/maxwell-smart/CONTEXT.md': '## Process\nInterpreta a Maxwell desde su propia historia.\n\n## Cierre\nConserva su punto de vista.\n',
    'obra/stages/03-moderacion/CONTEXT.md': '## Process\nRevisa la propuesta.\n\n## Cierre\nNo inventes hechos.\n',
    'obra/continuista/CONTEXT.md': '## Process\nComprueba continuidad.\n\n## Cierre\nRegistra el resultado.\n',
    'obra/stages/07-direccion/CONTEXT.md': '## Process\nObserva el desarrollo.\n\n## Cierre\nRegistra el cierre.\n',
    'obra/direccion/CONTEXT.md': '## Process\nDirige sin decidir por el actor.\n',
    'obra/setup/CONTEXT.md': '## Process\nPrepara la representación.\n\n## Cierre\nValida los datos.\n',
    'obra/narrador/CONTEXT.md': '## Process\nNarra hechos autorizados.\n\n## Cierre\nNo cambies los hechos.\n',
    'obra/revisor-narracion/CONTEXT.md': '## Process\nRevisa la narración.\n\n## Cierre\nNo la publiques por sí sola.\n',
  };
  for (const [path, content] of Object.entries(files)) workspace.write(path, content);
}

function allRolesPreviewInput() {
  return {
    groups: [
      { audience: { role: 'configurator' }, sourceIds: ['role.configurator'], sectionIdsBySource: { 'role.configurator': ['cierre', 'process'] } },
      { audience: { role: 'director' }, sourceIds: ['role.director', 'stage.direction'], sectionIdsBySource: {
        'role.director': ['process'], 'stage.direction': ['cierre', 'process'],
      } },
      { audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['actor.maxwell-smart.context', 'stage.actuation'], sectionIdsBySource: {
        'actor.maxwell-smart.context': ['cierre', 'process'], 'stage.actuation': ['cierre', 'process'],
      } },
      { audience: { role: 'continuista' }, sourceIds: ['role.continuista', 'stage.moderation'], sectionIdsBySource: {
        'role.continuista': ['cierre', 'process'], 'stage.moderation': ['cierre', 'process'],
      } },
      { audience: { role: 'narration-reviewer' }, sourceIds: ['role.narration-reviewer'], sectionIdsBySource: {
        'role.narration-reviewer': ['cierre', 'process'],
      } },
      { audience: { role: 'narrator' }, sourceIds: ['role.narrator'], sectionIdsBySource: {
        'role.narrator': ['cierre', 'process'],
      } },
    ],
  };
}

test('el catálogo es explícito, no revela paths y limita cada actor a su contexto propio', () => {
  const workspace = temporaryWorkspace();
  try {
    assert.equal(ICM_WORKSPACE_ACTOR_SLUGS.length, 27);
    assert.ok(ICM_WORKSPACE_CATALOG.every((entry) => !Object.hasOwn(entry, 'relativePath')));
    const listed = workspace.reader.listSources({ role: 'actor', actorId: 'maxwell-smart' });
    assert.deepEqual(listed.map((entry) => entry.sourceId), ['stage.actuation', 'actor.maxwell-smart.context']);
    assert.deepEqual(workspace.reader.listSources({ role: 'actor', actorId: 'unlisted-actor' }), []);
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' },
      sourceIds: ['actor.hymie.context'],
      sectionIdsBySource: { 'actor.hymie.context': ['process'] },
    }), /ICM_WORKSPACE_SOURCE_NOT_ALLOWED_FOR_AUDIENCE/);
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' },
      sourceIds: ['/etc/passwd'],
      sectionIdsBySource: { '/etc/passwd': ['process'] },
    }), /ICM_WORKSPACE_SOURCE_NOT_ALLOWED_FOR_AUDIENCE/);
  } finally {
    workspace.cleanup();
  }
});

test('preview conserva headings exactos, CRLF, orden del manifiesto y límites Markdown incluso dentro de fences', () => {
  const workspace = temporaryWorkspace();
  try {
    const stage = '# Introducción\r\n## Process\r\nPermitido\r\n````md\r\n## Cierre\r\nDentro del bloque\r\n````texto\r\nTodavía dentro del bloque\r\n````\r\n# Límite\r\nNO_SELECCIONAR\r\n## Cierre\r\nCierre exacto\r\n';
    workspace.write('obra/stages/02-actuacion/CONTEXT.md', stage);
    workspace.write('obra/personajes/maxwell-smart/CONTEXT.md', '## Process\nContexto propio\n\n## Cierre\nConserva continuidad.\n');
    const result = workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' },
      sourceIds: ['actor.maxwell-smart.context', 'stage.actuation'],
      sectionIdsBySource: {
        'actor.maxwell-smart.context': ['cierre', 'process'],
        'stage.actuation': ['cierre', 'process'],
      },
    });

    assert.deepEqual(result.snapshot.sources.map((source) => source.sourceId), ['stage.actuation', 'actor.maxwell-smart.context']);
    const stageSource = result.snapshot.sources[0];
    assert.ok(stageSource);
    assert.deepEqual(stageSource.sections.map((section) => section.sectionId), ['process', 'cierre']);
    assert.equal(stageSource.sections[0]?.markdown,
      '## Process\r\nPermitido\r\n````md\r\n## Cierre\r\nDentro del bloque\r\n````texto\r\nTodavía dentro del bloque\r\n````\r\n');
    assert.equal(stageSource.sections[1]?.markdown, '## Cierre\r\nCierre exacto\r\n');
    assert.equal(result.snapshot.sources[1]?.sections[0]?.markdown, '## Process\nContexto propio\n\n');
    assert.equal(result.selections[0]?.sourceHash, stageSource.sourceHash);
    assert.match(result.workspaceRevision, /^[0-9a-f]{64}$/);
  } finally {
    workspace.cleanup();
  }
});

test('el contrato del Director no admite Cierre inexistente ni fallback a otra sección', () => {
  const workspace = temporaryWorkspace();
  try {
    workspace.write('obra/direccion/CONTEXT.md', '## Inputs\nNo autorizado.\n## Process\nContrato.\n## Outputs\nNo autorizado.\n');
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'director' }, sourceIds: ['role.director'],
      sectionIdsBySource: { 'role.director': ['cierre'] },
    }), /ICM_WORKSPACE_SECTION_NOT_ALLOWED/);
    const preview = workspace.reader.preview({
      audience: { role: 'director' }, sourceIds: ['role.director'],
      sectionIdsBySource: { 'role.director': ['process'] },
    });
    assert.deepEqual(preview.snapshot.sources[0]?.sections.map((section) => section.markdown), ['## Process\nContrato.\n']);
  } finally {
    workspace.cleanup();
  }
});

test('previewMany crea snapshot multiaudiencia estable y admisión vuelve a comprobar todos los contratos requeridos', () => {
  const workspace = temporaryWorkspace();
  try {
    writeRequiredSources(workspace);
    const preview = workspace.reader.previewMany(allRolesPreviewInput());
    assert.deepEqual(preview.snapshot.sources.map((source) => source.sourceId), [
      'stage.actuation', 'stage.moderation', 'stage.direction', 'role.continuista', 'role.director',
      'role.configurator', 'role.narrator', 'role.narration-reviewer', 'actor.maxwell-smart.context',
    ]);
    assert.deepEqual(preview.snapshot.sources.map((source) => source.audience.role), [
      'actor', 'continuista', 'director', 'continuista', 'director', 'configurator', 'narrator',
      'narration-reviewer', 'actor',
    ]);
    const admitted = workspace.reader.admitFrozenSnapshot(preview.snapshot, {
      expectedSnapshotHash: preview.snapshot.snapshotHash,
      expectedWorkspaceRevision: preview.workspaceRevision,
    });
    assert.deepEqual(admitted, preview.snapshot);
    assert.throws(() => workspace.reader.previewMany({ groups: [
      ...allRolesPreviewInput().groups,
      { audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'], sectionIdsBySource: { 'stage.actuation': ['process'] } },
    ] }), /ICM_WORKSPACE_DUPLICATE_AUDIENCE_SOURCE/);

    const incompleteActor = workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    });
    assert.throws(() => workspace.reader.admitFrozenSnapshot(incompleteActor.snapshot), /ICM_WORKSPACE_REQUIRED_SOURCE_MISSING/);
  } finally {
    workspace.cleanup();
  }
});

test('admisión rechaza drift de fuentes y conflicto de revisión entre preview y CAS', () => {
  const workspace = temporaryWorkspace();
  try {
    workspace.write('obra/stages/02-actuacion/CONTEXT.md', '## Process\nPaso original.\n');
    workspace.write('obra/personajes/maxwell-smart/CONTEXT.md', '## Process\nHistoria propia.\n');
    const preview = workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' },
      sourceIds: ['stage.actuation', 'actor.maxwell-smart.context'],
      sectionIdsBySource: { 'stage.actuation': ['process'], 'actor.maxwell-smart.context': ['process'] },
    });
    workspace.write('obra/stages/02-actuacion/CONTEXT.md', '## Process\nPaso modificado después del preview.\n');
    assert.throws(() => workspace.reader.admitFrozenSnapshot(preview.snapshot, {
      expectedWorkspaceRevision: preview.workspaceRevision,
    }), /ICM_WORKSPACE_WORKSPACE_REVISION_CONFLICT/);
    assert.throws(() => workspace.reader.admitFrozenSnapshot(preview.snapshot), /ICM_WORKSPACE_SOURCE_DRIFT/);
  } finally {
    workspace.cleanup();
  }
});

test('el root, sus componentes, directorios y archivos de fuente rechazan symlinks', () => {
  const workspace = temporaryWorkspace();
  const outside = mkdtempSync(join(tmpdir(), 'personajes-icm-outside-'));
  const alias = `${workspace.root}-alias`;
  try {
    const outsideSource = join(outside, 'CONTEXT.md');
    writeFileSync(outsideSource, '## Process\nNo seguir enlaces.\n');
    const stageDirectory = join(workspace.root, 'obra/stages/02-actuacion');
    mkdirSync(dirname(stageDirectory), { recursive: true });
    symlinkSync(outside, stageDirectory, 'dir');
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    }), /ICM_WORKSPACE_SYMLINK_FORBIDDEN/);

    rmSync(stageDirectory, { recursive: true, force: true });
    mkdirSync(stageDirectory, { recursive: true });
    symlinkSync(outsideSource, join(stageDirectory, 'CONTEXT.md'));
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    }), /ICM_WORKSPACE_SYMLINK_FORBIDDEN/);

    symlinkSync(workspace.root, alias, 'dir');
    assert.throws(() => createIcmWorkspaceReader({ workspaceRoot: alias }), /ICM_WORKSPACE_SYMLINK_FORBIDDEN|ROOT_SYMLINK_FORBIDDEN/);
  } finally {
    rmSync(alias, { force: true });
    workspace.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test('las fuentes deben ser UTF-8 válidas y respetar límites de bytes', () => {
  const workspace = temporaryWorkspace();
  try {
    const path = 'obra/stages/02-actuacion/CONTEXT.md';
    workspace.write(path, Uint8Array.from([0x23, 0x23, 0x20, 0x50, 0x72, 0x6f, 0x63, 0x65, 0x73, 0x73, 0x0a, 0xff]));
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    }), /ICM_WORKSPACE_INVALID_UTF8/);

    workspace.write(path, `## Process\n${'a'.repeat(1_000_001)}`);
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    }), /ICM_WORKSPACE_SOURCE_TOO_LARGE/);
  } finally {
    workspace.cleanup();
  }
});

test('previewMany impone el límite global de fuentes sumando todos los roles', () => {
  const workspace = temporaryWorkspace();
  try {
    const largeSource = `${'x'.repeat(600_000)}\n## Process\ncontenido corto\n`;
    workspace.write('obra/stages/02-actuacion/CONTEXT.md', largeSource);
    workspace.write('obra/personajes/maxwell-smart/CONTEXT.md', largeSource);
    workspace.write('obra/stages/03-moderacion/CONTEXT.md', largeSource);
    workspace.write('obra/continuista/CONTEXT.md', largeSource);
    assert.throws(() => workspace.reader.previewMany({ groups: [
      { audience: { role: 'actor', actorId: 'maxwell-smart' },
        sourceIds: ['stage.actuation', 'actor.maxwell-smart.context'],
        sectionIdsBySource: { 'stage.actuation': ['process'], 'actor.maxwell-smart.context': ['process'] } },
      { audience: { role: 'continuista' },
        sourceIds: ['stage.moderation', 'role.continuista'],
        sectionIdsBySource: { 'stage.moderation': ['process'], 'role.continuista': ['process'] } },
    ] }), /ICM_WORKSPACE_TOTAL_SOURCE_BYTES_EXCEEDED/);
  } finally {
    workspace.cleanup();
  }
});

test('un encabezado duplicado permitido es ambiguo y bloquea el preview', () => {
  const workspace = temporaryWorkspace();
  try {
    workspace.write('obra/stages/02-actuacion/CONTEXT.md', '## Process\nPrimero.\n## Process\nSegundo.\n');
    assert.throws(() => workspace.reader.preview({
      audience: { role: 'actor', actorId: 'maxwell-smart' }, sourceIds: ['stage.actuation'],
      sectionIdsBySource: { 'stage.actuation': ['process'] },
    }), /ICM_WORKSPACE_DUPLICATE_SECTION/);
  } finally {
    workspace.cleanup();
  }
});

test('lectura real del repo extrae etapa y contexto de Maxwell sin descubrir contexto de otros actores', () => {
  const reader = createIcmWorkspaceReader({ workspaceRoot: repositoryRoot });
  const visibleSources = reader.listSources({ role: 'actor', actorId: 'maxwell-smart' });
  assert.deepEqual(visibleSources.map((source) => source.sourceId), ['stage.actuation', 'actor.maxwell-smart.context']);
  const preview = reader.preview({
    audience: { role: 'actor', actorId: 'maxwell-smart' },
    sourceIds: ['stage.actuation', 'actor.maxwell-smart.context'],
    sectionIdsBySource: { 'stage.actuation': ['process', 'cierre'], 'actor.maxwell-smart.context': ['process', 'cierre'] },
  });
  assert.deepEqual(preview.snapshot.sources.map((source) => source.sourceId), ['stage.actuation', 'actor.maxwell-smart.context']);
  assert.ok(preview.snapshot.sources.every((source) => source.audience.role === 'actor'
    && source.audience.actorId === 'maxwell-smart'));
  assert.ok(preview.snapshot.sources[1]?.sections.some((section) => section.markdown.includes('contexto propio')));
  assert.ok(!preview.snapshot.sources.some((source) => source.sourceId.includes('hymie')));
});
