import React from 'react';
import type { AvatarPage, CatalogPage, DossierResponse, LibraryPage, TextDocumentResponse } from '../domain/http.ts';
import { unreachable } from '../domain/values.ts';
import { bootstrapSession, readAvatars, readCatalog, readDocument, readDossier, readLibrary, searchCharacters, resolveReference } from './client.ts';
import type { CatalogReferenceQuery } from '../domain/catalog-links.ts';
import { DocumentBody } from './DocumentBody.tsx';
import { readStoredBackupIntent } from './backup-client.ts';

const BackupRestorePanel = React.lazy(async () => ({ default: (await import('./BackupRestorePanel.tsx')).BackupRestorePanel }));

const RunDraftWorkspace = React.lazy(async () => ({ default: (await import('./RunDraftWorkspace.tsx')).RunDraftWorkspace }));
const PiAccessPanel = React.lazy(async () => ({ default: (await import('./PiAccessPanel.tsx')).PiAccessPanel }));
const PiAccessCheckPanel = React.lazy(async () => ({ default: (await import('./PiAccessCheckPanel.tsx')).PiAccessCheckPanel }));
const DossierExchangePanel = React.lazy(async () => ({ default: (await import('./DossierExchangePanel.tsx')).DossierExchangePanel }));

type LibraryState = { kind: 'loading' } | { kind: 'error'; message: string } |
  { kind: 'ready'; catalog: CatalogPage; library: LibraryPage; avatars: AvatarPage };
type Selection = { kind: 'none' } | { kind: 'loading'; title: string } |
  { kind: 'dossier'; data: DossierResponse } | { kind: 'document'; data: TextDocumentResponse } |
  { kind: 'paper'; id: string; title: string } |
  { kind: 'error'; message: string };
type Tab = 'characters' | 'research' | 'sources' | 'runs' | 'access' | 'exchange';
type CharacterSearch = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; items: CatalogPage['items'] } | { kind: 'error'; message: string };

function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo cargar el contenido';
}

export function hasPendingHostRecovery(storage:Parameters<typeof readStoredBackupIntent>[0]):boolean {
  return readStoredBackupIntent(storage)?.kind==='recover';
}
function pendingHostRecovery(){
  if(typeof window==='undefined')return false;
  try{return hasPendingHostRecovery(window.sessionStorage);}catch{return false;}
}

export function OriginalRetainedLibraryNotice({refreshing,error,onReload}:{refreshing:boolean;error:string|null;onReload:()=>void}) {
  return <section aria-label="Biblioteca del host original"><p role="status">La recuperación se canceló y se conservó el host original. Podés cargar su biblioteca cuando termines de revisar los borradores abiertos.</p><button disabled={refreshing} onClick={onReload}>Cargar biblioteca del host original</button>{error!==null&&<p role="alert">{error}</p>}</section>;
}

export function App() {
  const [recoveryBoot] = React.useState(pendingHostRecovery);
  const [hostRecovered,setHostRecovered] = React.useState(false);
  const [originalRetained,setOriginalRetained] = React.useState(false);
  const [refreshingLibrary,setRefreshingLibrary] = React.useState(false);
  const [libraryRefreshError,setLibraryRefreshError] = React.useState<string|null>(null);
  const libraryEpoch=React.useRef(0);
  const [state, setState] = React.useState<LibraryState>({ kind: 'loading' });
  const [tab, setTab] = React.useState<Tab>('characters');
  const [openedTabs, setOpenedTabs] = React.useState<ReadonlySet<Tab>>(() => new Set(['characters']));
  const [query, setQuery] = React.useState('');
  const [openRunRequest, setOpenRunRequest] = React.useState<{runId:string} | undefined>();
  const [characterSearch, setCharacterSearch] = React.useState<CharacterSearch>({ kind: 'idle' });
  const [selection, setSelection] = React.useState<Selection>({ kind: 'none' });
  const selectionEpoch = React.useRef(0);
  const panelHeading = React.useRef<HTMLHeadingElement>(null);
  const catalogHeading = React.useRef<HTMLHeadingElement>(null);
  const reading = selection.kind !== 'none';

  React.useEffect(() => {
    if(recoveryBoot)return;
    let active = true;
    bootstrapSession().then(() => Promise.all([readCatalog(), readLibrary(), readAvatars()]))
      .then(([catalog, library, avatars]) => { if (active) setState({ kind: 'ready', catalog, library, avatars }); })
      .catch((error: unknown) => { if (active) setState({ kind: 'error', message: readableError(error) }); });
    return () => { active = false; };
  }, [recoveryBoot]);

  async function refreshLibrary(){
    if(refreshingLibrary)return;
    const epoch=++libraryEpoch.current;setRefreshingLibrary(true);setLibraryRefreshError(null);
    try{await bootstrapSession();const [catalog,library,avatars]=await Promise.all([readCatalog(),readLibrary(),readAvatars()]);if(epoch===libraryEpoch.current){setState({kind:'ready',catalog,library,avatars});setHostRecovered(false);setOriginalRetained(false);}}
    catch(error){if(epoch===libraryEpoch.current)setLibraryRefreshError(readableError(error));}
    finally{if(epoch===libraryEpoch.current)setRefreshingLibrary(false);}
  }

  React.useEffect(() => {
    if (selection.kind === 'dossier' || selection.kind === 'document' || selection.kind === 'paper') panelHeading.current?.focus();
  }, [selection]);

  function changeTab(next: Tab) {
    ++selectionEpoch.current;
    setSelection({ kind: 'none' });
    setQuery('');
    setCharacterSearch({ kind: 'idle' });
    setTab(next);
    setOpenedTabs((current) => current.has(next) ? current : new Set([...current, next]));
    requestAnimationFrame(() => catalogHeading.current?.focus());
  }

  async function select(input: { kind: 'dossier' | 'document'; id: string; title: string }) {
    const epoch = ++selectionEpoch.current;
    setSelection({ kind: 'loading', title: input.title });
    try {
      const result: Selection = input.kind === 'dossier'
        ? { kind: 'dossier', data: await readDossier({ id: input.id }) }
        : { kind: 'document', data: await readDocument({ id: input.id }) };
      if (selectionEpoch.current === epoch) setSelection(result);
    } catch (error) {
      if (selectionEpoch.current === epoch) setSelection({ kind: 'error', message: readableError(error) });
    }
  }

  async function followReference(input: CatalogReferenceQuery) {
    const epoch = ++selectionEpoch.current;
    setSelection({ kind: 'loading', title: 'referencia' });
    try {
      const target = await resolveReference(input);
      if (selectionEpoch.current !== epoch) return;
      switch (target.kind) {
        case 'character': await select({ kind: 'dossier', id: target.id, title: target.title }); return;
        case 'document': await select({ kind: 'document', id: target.id, title: target.title }); return;
        case 'paper': setSelection({ kind: 'paper', id: target.id, title: target.title }); return;
        case 'unavailable': setSelection({ kind: 'error', message: 'Esta referencia todavía no está incorporada a la biblioteca.' }); return;
        default: return unreachable(target);
      }
    } catch (error) {
      if (selectionEpoch.current === epoch) setSelection({ kind: 'error', message: readableError(error) });
    }
  }

  const needle = query.trim().toLocaleLowerCase('es');
  function matches(text: string) { return text.toLocaleLowerCase('es').includes(needle); }
  React.useEffect(() => {
    if (tab !== 'characters' || !needle || state.kind !== 'ready') {
      setCharacterSearch({ kind: 'idle' }); return;
    }
    let active = true;
    setCharacterSearch({ kind: 'loading' });
    const timer = setTimeout(() => {
      searchCharacters({ query: needle }).then((page) => {
        const ids = new Set(page.items.filter((item) => item.kind === 'character-match').map((item) => item.id));
        if (active) { setCharacterSearch({ kind: 'ready', items: state.catalog.items.filter((item) => ids.has(item.characterId)) }); }
      }).catch((error: unknown) => {
        if (active) { setCharacterSearch({ kind: 'error', message: readableError(error) }); }
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [tab, needle, state]);

  function renderSelection() {
    switch (selection.kind) {
      case 'none': return <div className="reader-empty"><span className="ornament">◈</span><h2>Una identidad, muchas posibilidades</h2><p>Abrí una ficha para conocer su historia, deseos, relaciones y forma de hablar.</p><p className="muted">Leer una fuente no modifica los recuerdos de los personajes.</p></div>;
      case 'loading': return <p role="status">Cargando {selection.title}…</p>;
      case 'error': return <p role="alert" className="error">{selection.message}</p>;
      case 'dossier': {
        const dossier = selection.data;
        const avatar = state.kind === 'ready' ? state.avatars.items.find((item) => item.slug === (dossier.avatarRef.kind === 'catalog-reference' ? dossier.avatarRef.slug : '')) : undefined;
        return <><div className="reader-title"><span className="eyebrow">Expediente de personaje</span><h2 tabIndex={-1} ref={panelHeading}>{dossier.displayName}</h2><p className="muted">Fuente de preparación · Contexto actoral todavía sin curar</p></div>
          {avatar && <details className="credits"><summary>Procedencia del retrato</summary><p>{avatar.sourceCredit}</p><p>{avatar.license}</p></details>}
          <DocumentBody text={dossier.markdown} onLocalReference={(reference) => void followReference({ sourceKind: 'character', sourceId: dossier.characterId, reference })} /></>;
      }
      case 'document': {
        const document = selection.data;
        return <><div className="reader-title"><span className="eyebrow">Biblioteca de la obra</span><h2 tabIndex={-1} ref={panelHeading}>{document.title}</h2></div><DocumentBody text={document.text} onLocalReference={(reference) => void followReference({ sourceKind: 'document', sourceId: document.id, reference })} /></>;
      }
      case 'paper': return <><h2 tabIndex={-1} ref={panelHeading}>{selection.title}</h2><p>Artículo conservado en PDF.</p><a href={`/api/v1/library/${encodeURIComponent(selection.id)}`} target="_blank" rel="noreferrer">Abrir el artículo ↗</a></>;
      default: return unreachable(selection);
    }
  }

  if(recoveryBoot&&state.kind!=='ready')return <main className="host-recovery-workspace" aria-label="Recuperación independiente del host"><h1>Recuperación del host</h1><p>La operación conservada se puede consultar aunque la biblioteca y las representaciones todavía no estén disponibles.</p><React.Suspense fallback={<p role="status">Abriendo el control de recuperación…</p>}><BackupRestorePanel recoveryOnly onHostRecovered={()=>{setHostRecovered(true);setOriginalRetained(false);}} onOriginalRetained={()=>{setOriginalRetained(true);setHostRecovered(false);}}/></React.Suspense>{hostRecovered&&<><p role="status">La recuperación fue verificada. Podés volver a cargar la biblioteca con la sesión nueva.</p><button disabled={refreshingLibrary} onClick={()=>void refreshLibrary()}>Cargar biblioteca recuperada</button></>}{originalRetained&&<OriginalRetainedLibraryNotice refreshing={refreshingLibrary} error={libraryRefreshError} onReload={()=>void refreshLibrary()}/>}{refreshingLibrary&&<p role="status">Cargando la biblioteca del host…</p>}{libraryRefreshError&&!originalRetained&&<p role="alert">{libraryRefreshError}</p>}</main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">P</span><div>Personajes<small>La obra agéntica</small></div></div>
      <div className="nav-label">LA OBRA</div><nav aria-label="Representaciones"><button aria-current={tab === 'runs' ? 'page' : undefined} onClick={() => changeTab('runs')}>▧ Preparar representación</button></nav><div className="nav-label">BIBLIOTECA</div><nav aria-label="Biblioteca">
        <button aria-current={tab === 'characters' ? 'page' : undefined} onClick={() => changeTab('characters')}>◇ Personajes</button>
        <button aria-current={tab === 'research' ? 'page' : undefined} onClick={() => changeTab('research')}>▤ Investigaciones</button>
        <button aria-current={tab === 'sources' ? 'page' : undefined} onClick={() => changeTab('sources')}>↗ Fuentes y paper</button>
        <button aria-current={tab === 'exchange' ? 'page' : undefined} onClick={() => changeTab('exchange')}>⇄ Importar y exportar</button>
      </nav><div className="nav-label">CONFIGURACIÓN</div><nav aria-label="Acceso"><button aria-current={tab === 'access' ? 'page' : undefined} onClick={() => changeTab('access')}>◎ Acceso a Pi</button></nav><div className="sidebar-note">Identidad · Historia · Memoria<br />Deseo · Acción · Consecuencia</div>
    </aside>
    <main><header className="topbar"><span>{tab === 'runs' ? 'Representaciones / Preparación' : tab === 'access' ? 'Configuración / Acceso a Pi' : tab === 'exchange' ? 'Biblioteca / Importar y exportar' : <>Biblioteca / {tab === 'characters' ? 'Reparto' : tab === 'research' ? 'Investigaciones' : 'Fuentes'}</>}</span>{reading && <button className="back-button" onClick={() => { ++selectionEpoch.current; setSelection({ kind: 'none' }); requestAnimationFrame(() => catalogHeading.current?.focus()); }}>← Volver al catálogo</button>}<span className="status-chip">{tab === 'access' ? 'Administración del host' : tab === 'runs' ? 'Estado consultado desde el host' : 'Biblioteca de preparación'}</span></header>
      {hostRecovered&&<section aria-label="Biblioteca después de recuperación"><p role="status">El host fue recuperado y verificado. Actualizá la biblioteca cuando termines de revisar los borradores abiertos.</p><button disabled={refreshingLibrary} onClick={()=>void refreshLibrary()}>Actualizar biblioteca recuperada</button>{libraryRefreshError&&<p role="alert">{libraryRefreshError}</p>}</section>}
      {originalRetained&&<OriginalRetainedLibraryNotice refreshing={refreshingLibrary} error={libraryRefreshError} onReload={()=>void refreshLibrary()}/>}
      {state.kind === 'ready' && openedTabs.has('runs') && <React.Suspense fallback={<p role="status">Abriendo la preparación…</p>}><div hidden={tab !== 'runs'}><RunDraftWorkspace catalog={state.catalog.items} {...(openRunRequest===undefined?{}:{openRequest:openRunRequest})} /></div></React.Suspense>}
      {openedTabs.has('access') && <React.Suspense fallback={<p role="status">Abriendo el acceso…</p>}><div hidden={tab !== 'access'}><PiAccessPanel /><PiAccessCheckPanel /></div></React.Suspense>}
      {state.kind==='ready'&&openedTabs.has('exchange')&&<React.Suspense fallback={<p role="status">Abriendo el intercambio…</p>}><div hidden={tab!=='exchange'}><DossierExchangePanel catalog={state.catalog.items} onHostRecovered={()=>{setHostRecovered(true);setOriginalRetained(false);}} onOriginalRetained={()=>{setOriginalRetained(true);setHostRecovered(false);}} onOpenRun={(runId)=>{setOpenRunRequest({runId});changeTab('runs');}}/></div></React.Suspense>}
      <div hidden={tab === 'runs' || tab === 'access' || tab === 'exchange'}><div className="workspace" data-reading={reading}><section className="catalog-panel" aria-label="Catálogo">
        <span className="eyebrow">EL MUNDO EMPIEZA CON SUS PERSONAJES</span><h1 tabIndex={-1} ref={catalogHeading}>{tab === 'characters' ? 'El reparto' : tab === 'research' ? 'Ideas para la obra' : 'Las fuentes'}</h1>
        <p className="intro">{tab === 'characters' ? 'Cada ficha conserva una voz, una historia y un punto de vista.' : 'Investigación, evidencia y propuestas de interpretación.'}</p>
        <label className="search-label" htmlFor="catalog-search">{tab === 'characters' ? 'Buscar por nombre, alias o texto' : 'Buscar por título'}</label><input id="catalog-search" type="search" maxLength={200} placeholder="Buscar en esta sección…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {characterSearch.kind === 'loading' && <p role="status">Buscando en las fichas…</p>}
        {characterSearch.kind === 'error' && <p role="alert" className="error">{characterSearch.message}</p>}
        {characterSearch.kind === 'ready' && characterSearch.items.length === 0 && <p>No hay coincidencias en las fichas.</p>}
        {state.kind === 'loading' && <p role="status">Abriendo la biblioteca…</p>}
        {state.kind === 'error' && <p role="alert" className="error">{state.message}</p>}
        {state.kind === 'ready' && (tab === 'characters' ? <div className="character-grid">{(characterSearch.kind === 'ready' ? characterSearch.items : state.catalog.items.filter((item) => matches(item.displayName))).map((item) => <button className="character-card" key={item.characterId} onClick={() => void select({ kind: 'dossier', id: item.characterId, title: item.displayName })}>
          <img src={`/api/v1/avatars/${encodeURIComponent(item.avatarRef.slug)}`} alt="" loading="lazy" /><span>{item.displayName}</span><small>Leer expediente ↗</small></button>)}</div> : <div className="research-list">{state.library.items.filter((item) => (tab === 'research' ? item.kind === 'research' : item.kind !== 'research') && matches(item.title)).map((item) => item.kind === 'paper'
          ? <a className="research-card" href={`/api/v1/library/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" key={item.id}><span className="document-icon">PDF</span><span>{item.title}<small>Abrir el artículo conservado ↗</small></span></a>
          : <button className="research-card" key={item.id} onClick={() => void select({ kind: 'document', id: item.id, title: item.title })}><span className="document-icon">▤</span><span>{item.title}<small>Leer documento ↗</small></span></button>)}</div>)}
      </section><section className="reader" aria-label="Expediente y lectura" aria-live="polite">{renderSelection()}</section></div></div>
    </main>
  </div>;
}
