import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openJournal} from '../src/adapters/journal.ts';
import {draftFixture} from './fixtures/continuista.ts';

test('el host conserva catálogo sin cambios y estampa autor, fecha y versión ante cambios reales',()=>{
 const directory=mkdtempSync(join(tmpdir(),'personajes-catalog-authority-'));const journal=openJournal({path:join(directory,'world.sqlite')});
 try{
  const {kind,schemaVersion,runId,revision,...patch}=draftFixture();
  if(patch.worldSnapshot.kind!=='configured')assert.fail('No World');
  const catalog={revision:900,provenance:{authoredBy:'forged-principal',recordedAt:'1900-01-01T00:00:00Z',sourceRefs:['declaración sintética']},
    environmentConditions:[{id:'ruido',label:'Ruido de prueba',states:[{id:'suave',description:'Se oye un ruido tenue.',modality:'auditory'}]}],objectTemplates:[]};
  const created=journal.createRunConfigurationDraft({principalId:'local-operator',idempotencyKey:randomUUID(),patch:{...patch,
    worldSnapshot:{...patch.worldSnapshot,value:{...patch.worldSnapshot.value,circumstanceCatalog:catalog}}}});
  if(created.kind!=='created'||created.draft.worldSnapshot.kind!=='configured')assert.fail('No draft');
  const first=created.draft.worldSnapshot.value.circumstanceCatalog;assert.ok(first);
  assert.equal(first.revision,1);assert.equal(first.provenance.authoredBy,'local-operator');assert.notEqual(first.provenance.recordedAt,catalog.provenance.recordedAt);
  const next=journal.updateRunConfigurationDraft({principalId:'second-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:0,
    patch:{worldSnapshot:{...created.draft.worldSnapshot,value:{...created.draft.worldSnapshot.value,
      circumstanceCatalog:{...first,revision:800,provenance:{...first.provenance,authoredBy:'spoof'}}}}}});
  if(next.kind!=='stored'||next.draft.worldSnapshot.kind!=='configured')assert.fail('No update');
  assert.deepEqual(next.draft.worldSnapshot.value.circumstanceCatalog,first,'spoof de metadatos no crea otra versión');
  const changed=journal.updateRunConfigurationDraft({principalId:'second-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:1,
    patch:{worldSnapshot:{...next.draft.worldSnapshot,value:{...next.draft.worldSnapshot.value,circumstanceCatalog:{...first,
      environmentConditions:[{...first.environmentConditions[0],id:'ruido',label:'Ruido corregido',states:first.environmentConditions[0]?.states??[]}]}}}}});
  if(changed.kind!=='stored'||changed.draft.worldSnapshot.kind!=='configured')assert.fail('No update');
  const final=changed.draft.worldSnapshot.value.circumstanceCatalog;assert.ok(final);
  assert.equal(final.revision,3);assert.equal(final.provenance.authoredBy,'second-operator');
  const promotion=journal.validateRunConfigurationDraft({principalId:'second-operator',idempotencyKey:randomUUID(),runId:created.draft.runId,expectedRevision:2});
  assert.equal(promotion.kind,'ready');
  assert.deepEqual(journal.loadWorld({runId:created.draft.runId})?.circumstanceCatalog,final);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
