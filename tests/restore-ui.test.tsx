import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackupRestorePanel, RestoreDiff } from '../src/web/BackupRestorePanel.tsx';
import { ForkRestorePreviewSchema } from '../src/web/backup-client.ts';
const id = '11111111-1111-4111-8111-111111111111';
test('restore entry is functional and does not claim offline recovery or an automatic publication', () => {
 const html = renderToStaticMarkup(<BackupRestorePanel />);
 assert.match(html, /Crear backup de todas las representaciones/); assert.match(html, /Consultar backup guardado/); assert.match(html, /ejecutor offline y sigue pendiente/); assert.doesNotMatch(html, /Confirmar restauración|Bifurcación preparada y publicada/);
});
test('restore diff presents saved evidence and explicit blockers without inventing a completed operation', () => {
 const preview = ForkRestorePreviewSchema.parse({ backupId: id, operationId: id, sourceRunId: id, name: 'Ensayo', reason: 'Otra perspectiva', mode: 'fork', previewToken: id, expiresAt: 100, manifestHash: 'a'.repeat(64), diffHash: 'b'.repeat(64), differences: ['Memoria aislada desde commit 4'], blockers: ['RESTORE_SOURCE_NOT_AVAILABLE'] });
 const html = renderToStaticMarkup(<RestoreDiff preview={preview} />); assert.match(html, /Memoria aislada desde commit 4/); assert.match(html, /RESTORE_SOURCE_NOT_AVAILABLE/); assert.match(html, /No inicia actores ni genera audio/); assert.doesNotMatch(html, /publicada/);
});
