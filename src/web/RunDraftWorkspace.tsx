import React from 'react';
import { RunConfigurationDraftSummarySchema, type CatalogPage, type RunConfigurationDraftPage } from '../domain/http.ts';
import { createEmptyRunConfigurationDraft, type RunConfigurationDraft } from '../domain/production.ts';
import { DRAFT_SECTIONS, changedDraftSections, describeDraftSection, reconcileDraft, type DraftSection } from './draft-form.ts';
import { RunDraftEditor } from './RunDraftEditor.tsx';
import { RunPreflightPanel } from './RunPreflightPanel.tsx';
import { createDraftSaveIntent, listRunDrafts, readRunDraft, saveRunDraft, validateRunDraft, readDraftHttpFailure, type DraftDocument, type DraftSaveIntent } from './run-drafts-client.ts';

type Screen = { kind: 'none' } | { kind: 'loading'; id: string }
  | { kind: 'editing'; document: DraftDocument; epoch: number } | { kind: 'reconciled'; document: DraftDocument; configuration: RunConfigurationDraft; epoch: number } | { kind: 'new'; configuration: RunConfigurationDraft; epoch: number };
type Saving = { kind: 'idle' } | { kind: 'saving'; intent: DraftSaveIntent }
  | { kind: 'uncertain'; intent: DraftSaveIntent; message: string }
  | { kind: 'validating'; document: DraftDocument; key: string } | { kind: 'validation-uncertain'; document: DraftDocument; key: string; message: string }
  | { kind: 'conflict'; local: RunConfigurationDraft; remote: DraftDocument; keepLocal: DraftSection[]; message: string };
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'No pudimos completar esta operación.'; }

export function RunDraftWorkspace(props: { catalog: CatalogPage['items'] }) {
  const [page, setPage] = React.useState<RunConfigurationDraftPage>({ items: [] });
  const [loading, setLoading] = React.useState(true);
  const [screen, setScreen] = React.useState<Screen>({ kind: 'none' });
  const [saving, setSaving] = React.useState<Saving>({ kind: 'idle' });
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [replacePrompt, setReplacePrompt] = React.useState<string | 'new' | undefined>();
  const epoch = React.useRef(0);
  const setDirtyState = React.useCallback((value: boolean) => setDirty(value), []);
  React.useEffect(() => {
    let active = true;
    listRunDrafts().then((result) => { if (active) setPage(result); }).catch((failure: unknown) => { if (active) setError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  React.useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) { if (dirty || saving.kind !== 'idle') event.preventDefault(); }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving.kind]);

  function addToList(document: DraftDocument) {
    const configuration = document.view.configuration;
    const summary = RunConfigurationDraftSummarySchema.parse({ kind: 'run-configuration-draft-summary', runId: configuration.runId, revision: configuration.revision, name: configuration.name.kind === 'empty' ? null : configuration.name.value, lifecycle: document.view.state.lifecycle, configurationRevision: document.view.state.configurationRevision, worldRevision: document.view.state.worldRevision, validation: { kind: document.view.validation.kind, promotion: document.view.validation.promotion, issueCount: document.view.validation.kind === 'valid' ? 0 : document.view.validation.issues.length } });
    setPage((current) => ({ ...current, items: [summary, ...current.items.filter((item) => item.runId !== configuration.runId)] }));
  }
  async function open(id: string | 'new') {
    if (saving.kind !== 'idle') return;
    if (dirty) { setReplacePrompt(id); return; }
    await openConfirmed(id);
  }
  async function openConfirmed(id: string | 'new') {
    setReplacePrompt(undefined); setError(''); setMessage(''); setDirty(false);
    if (id === 'new') {
      setScreen({ kind: 'new', configuration: createEmptyRunConfigurationDraft({ runId: crypto.randomUUID(), revision: 0 }), epoch: ++epoch.current });
      return;
    }
    const currentEpoch = ++epoch.current;
    setScreen({ kind: 'loading', id });
    try {
      const document = await readRunDraft(id);
      if (epoch.current === currentEpoch) { setScreen({ kind: 'editing', document, epoch: currentEpoch }); addToList(document); }
    } catch (failure) { if (epoch.current === currentEpoch) { setScreen({ kind: 'none' }); setError(errorMessage(failure)); } }
  }
  async function persist(intent: DraftSaveIntent) {
    setSaving({ kind: 'saving', intent }); setError(''); setMessage('');
    try {
      const result = await saveRunDraft(intent);
      const document = result.document;
      addToList(document);
      if (result.kind === 'advanced') {
        const baseline = screen.kind === 'editing' || screen.kind === 'reconciled' ? screen.document.view.configuration : createEmptyRunConfigurationDraft({ runId: result.acknowledged.configuration.runId, revision: 0 });
        setSaving({ kind: 'conflict', local: result.acknowledged.configuration, remote: document,
          keepLocal: changedDraftSections(baseline, result.acknowledged.configuration),
          message: `Tu guardado está confirmado en revisión ${result.acknowledged.configuration.revision}. La lectura actual ya está en revisión ${document.view.configuration.revision}; son operaciones distintas.` });
        return;
      }
      setScreen({ kind: 'editing', document, epoch: ++epoch.current }); addToList(document);
      setSaving({ kind: 'idle' }); setDirty(false); setMessage(`Guardado en revisión ${document.view.configuration.revision}.`);
    } catch (failure) {
      const http = readDraftHttpFailure(failure);
      if (http && (http.status === 409 || http.status === 412) && intent.kind === 'replace') {
        try {
          const remote = await readRunDraft(intent.configuration.runId);
          const base = screen.kind === 'editing' || screen.kind === 'reconciled' ? screen.document.view.configuration : remote.view.configuration;
          setSaving({ kind: 'conflict', local: intent.configuration, remote, keepLocal: changedDraftSections(base, intent.configuration), message: errorMessage(failure) });
        } catch (readFailure) { setSaving({ kind: 'uncertain', intent, message: `Tus cambios siguen acá. No pudimos leer la revisión vigente: ${errorMessage(readFailure)}` }); }
      } else if (!http || http.status >= 500) {
        setSaving({ kind: 'uncertain', intent, message: 'El guardado no tiene un resultado confirmado. Reintentá la misma operación; conserva el contenido y su clave.' });
      } else { setSaving({ kind: 'idle' }); setError(errorMessage(failure)); }
    }
  }
  function save(configuration: RunConfigurationDraft) {
    if (saving.kind !== 'idle') return;
    const intent = createDraftSaveIntent(screen.kind === 'editing' || screen.kind === 'reconciled'
      ? { kind: 'replace', configuration, key: crypto.randomUUID(), etag: screen.document.etag }
      : { kind: 'create', configuration, key: crypto.randomUUID() });
    void persist(intent);
  }
  async function performValidation(document: DraftDocument, key: string) {
    setSaving({ kind: 'validating', document, key }); setError('');
    try {
      const updated = await validateRunDraft({ document, key });
      setScreen({ kind: 'editing', document: updated, epoch: ++epoch.current }); addToList(updated); setSaving({ kind: 'idle' });
      setMessage(updated.view.state.lifecycle === 'ready' && updated.view.validation.promotion === 'promoted' ? 'Preparación validada. Falta comprobar los requisitos de ejecución; la obra sigue sin iniciar.' : 'La puesta sigue como borrador; mirá los puntos pendientes.');
    } catch (failure) {
      const http = readDraftHttpFailure(failure);
      if (!http || http.status >= 500) setSaving({ kind: 'validation-uncertain', document, key, message: 'La validación no tiene resultado confirmado. Reintentá la misma operación para conocer su resultado.' });
      else { setSaving({ kind: 'idle' }); setError(errorMessage(failure)); }
    }
  }
  function validate() {
    if (screen.kind !== 'editing' || saving.kind !== 'idle' || dirty || !['draft', 'ready'].includes(screen.document.view.state.lifecycle)) return;
    void performValidation(screen.document, crypto.randomUUID());
  }
  function reconcile() {
    if (saving.kind !== 'conflict' || !['draft', 'ready'].includes(saving.remote.view.state.lifecycle)) return;
    const configuration = reconcileDraft({ local: saving.local, remote: saving.remote.view.configuration, keepLocal: saving.keepLocal });
    setScreen({ kind: 'reconciled', document: saving.remote, configuration, epoch: ++epoch.current }); setSaving({ kind: 'idle' }); setDirty(true);
    setMessage('Edición reconciliada localmente. Guardá para crear una revisión nueva.');
  }
  const draft = screen.kind === 'editing' ? screen.document.view.configuration : screen.kind === 'new' || screen.kind === 'reconciled' ? screen.configuration : undefined;
  const validation = screen.kind === 'editing' || screen.kind === 'reconciled' ? screen.document.view.validation : undefined;
  return <div className="run-workspace">
    <aside className="run-list"><span className="eyebrow">REPRESENTACIONES</span><h1>Preparar la obra</h1><p>Elegí sus circunstancias y conservá versiones de la preparación.</p><button className="primary-button" disabled={saving.kind !== 'idle'} onClick={() => void open('new')}>＋ Nueva preparación</button>
      {loading && <p role="status">Leyendo borradores…</p>}
      {!loading && page.items.length === 0 && <p className="empty-note">Todavía no hay borradores guardados.</p>}
      <nav aria-label="Borradores guardados">{page.items.map((item) => <button key={item.runId} aria-current={draft?.runId === item.runId ? 'page' : undefined} disabled={saving.kind !== 'idle'} onClick={() => void open(item.runId)}><strong>{item.name ?? 'Sin nombre'}</strong><small>Revisión {item.revision} · {item.lifecycle === 'ready' ? 'Preparación válida' : item.lifecycle !== 'draft' ? item.lifecycle : 'Preparación pendiente'}</small></button>)}</nav>
      {page.nextCursor && <button onClick={() => { listRunDrafts(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }).then((next) => setPage((current) => ({ ...next, items: [...current.items, ...next.items] }))).catch((failure: unknown) => setError(errorMessage(failure))); }}>Ver más borradores</button>}
      <p className="field-help">Guardar conserva una preparación. Validar comprueba sus datos; los requisitos de ejecución se comprueban por separado.</p>
    </aside>
    <section className="run-detail" aria-label="Editor de preparación">
      {error && <p className="error" role="alert">{error}</p>}
      {replacePrompt && <div className="edit-notice" role="alert"><p>Hay cambios locales sin guardar. Podés seguir editándolos o descartarlos para abrir otra preparación.</p><button onClick={() => setReplacePrompt(undefined)}>Seguir editando</button><button onClick={() => void openConfirmed(replacePrompt)}>Descartar cambios y abrir</button></div>}
      {saving.kind === 'validation-uncertain' && <div className="edit-notice" role="alert"><p>{saving.message}</p><button onClick={() => void performValidation(saving.document, saving.key)}>Reintentar la misma validación</button></div>}
      {saving.kind === 'validating' && <p role="status">Validando la puesta guardada…</p>}
      {saving.kind === 'uncertain' && <div className="edit-notice" role="alert"><p>{saving.message}</p><button className="primary-button" onClick={() => void persist(saving.intent)}>Reintentar el mismo guardado</button></div>}
      {saving.kind === 'conflict' && <div className="draft-conflict" role="alert"><h2>El borrador cambió en otra edición</h2><p>{saving.message} Tu edición local está conservada.</p><p>Elegí qué secciones de tu edición mantener sobre la revisión guardada {saving.remote.view.configuration.revision}. Las otras usan lo guardado.</p>{!['draft', 'ready'].includes(saving.remote.view.state.lifecycle) && <p>La representación actual está activa o finalizada y está conservada. Podés abrirla; no se reconciliarán cambios sobre ella.</p>}<ul>{DRAFT_SECTIONS.filter(([field]) => changedDraftSections(saving.local, saving.remote.view.configuration).includes(field)).map(([field, label]) => <li key={field}><label><input type="checkbox" checked={saving.keepLocal.includes(field)} onChange={(event) => setSaving({ ...saving, keepLocal: event.target.checked ? [...saving.keepLocal, field] : saving.keepLocal.filter((item) => item !== field) })} />Mantener mi {label.toLocaleLowerCase('es')}</label><small>Mi edición: {describeDraftSection(saving.local, field)}</small><small>Guardado: {describeDraftSection(saving.remote.view.configuration, field)}</small></li>)}</ul><button className="primary-button" disabled={!['draft', 'ready'].includes(saving.remote.view.state.lifecycle)} onClick={reconcile}>Reconciliar en la edición local</button><button onClick={() => { const remote = saving.remote; setSaving({ kind: 'idle' }); setScreen({ kind: 'editing', document: remote, epoch: ++epoch.current }); setDirty(false); setMessage('Revisión guardada abierta; se descartaron los cambios locales.'); }}>Descartar mi edición y abrir lo guardado</button></div>}
      {screen.kind === 'none' && <div className="run-empty"><span className="ornament" aria-hidden="true">◈</span><h2>Una obra empieza por sus circunstancias</h2><p>Creá una preparación o abrí un borrador guardado. La fecha, el lugar y el conflicto quedan a tu elección.</p></div>}
      {screen.kind === 'loading' && <p role="status">Abriendo preparación…</p>}
      {draft && <RunDraftEditor key={`${draft.runId}:${screen.kind === 'editing' || screen.kind === 'new' || screen.kind === 'reconciled' ? screen.epoch : 0}`} draft={draft} catalog={props.catalog} saving={saving.kind !== 'idle'} {...(screen.kind === 'editing' ? { lifecycle: screen.document.view.state.lifecycle, readOnly: !['draft', 'ready'].includes(screen.document.view.state.lifecycle) } : {})} {...(message ? { message } : {})} initialDirty={screen.kind === 'new' || screen.kind === 'reconciled'} onDirty={setDirtyState} onSave={save} onValidate={() => void validate()} />}
      {validation && <section className="draft-validation" aria-label="Resultado de validación"><h3>{validation.kind === 'valid' ? 'Configuración válida' : validation.kind === 'invalid' ? 'Configuración incompatible' : 'Preparación pendiente'}</h3><p>{validation.promotion === 'promoted' ? 'Promoción durable confirmada. La obra no se inicia automáticamente.' : 'Preparación sin promover. Completá los puntos pendientes y validá la puesta guardada.'}</p>{validation.kind !== 'valid' && <ul>{validation.issues.map((issue, index) => <li key={`${issue.field}:${index}`}><a href={`#draft-${issue.field.split(/[.\[]/)[0]}`}>{DRAFT_SECTIONS.find(([field]) => field === issue.field.split(/[.\[]/)[0])?.[1] ?? issue.field}: {issue.detail}</a></li>)}</ul>}</section>}
      {(screen.kind === 'editing' || screen.kind === 'reconciled') && <RunPreflightPanel key={screen.document.view.configuration.runId} document={screen.document} disabled={dirty || saving.kind !== 'idle'} />}
    </section>
  </div>;
}
