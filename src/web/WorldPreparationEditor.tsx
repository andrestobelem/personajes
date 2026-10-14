import React from 'react';
import { z } from 'zod';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { applyWorldSection, chooseActiveScene, confirmNoInitialOffers, formArray, formBlank, formObject, parseWorldNumericInput, parseWorldFormSchema, worldCandidate, worldMapItems, worldPreparationIssues, worldReferences, worldSectionForm, WORLD_SECTIONS, CharacterPlacementSchema, placePreparedCharacter, type FormSchema, type WorldPreparationSection } from './world-preparation.ts';

const LABELS: Record<string, string> = {
  id: 'Identificador', entityId: 'Identificador de entidad', name: 'Nombre', label: 'Nombre visible', description: 'Descripción',
  width: 'Ancho', height: 'Alto', lighting: 'Iluminación', kind: 'Tipo', state: 'Estado', from: 'Desde', to: 'Hasta',
  durationMs: 'Duración (milisegundos)', arrivalPoint: 'Punto de llegada', doorId: 'Puerta', position: 'Posición',
  materialChoices: 'Materializar inventario preparado', itemId: 'Objeto preparado', visibleLabel: 'Nombre visible elegido', physicalDescription: 'Aspecto visible elegido', quantity: 'Cantidad del lote', condition: 'Condición', sourceItemId: 'Procedencia del objeto', sourceGoalId: 'Objetivo de origen', characterId: 'Personaje preparado', displayName: 'Nombre real del personaje', species: 'Naturaleza del personaje', presentation: 'Presentación ante los demás', additionalCapabilities: 'Acciones adicionales elegidas', recognizedCharacterIds: 'Identidades que reconoce al inicio', routine: 'Rutina', human: 'Humano', animal: 'Animal', robot: 'Robot', always: 'Siempre disponible', windows: 'Intervalos de disponibilidad', defaultState: 'Disponibilidad fuera de los intervalos', available: 'Disponible', unavailable: 'No disponible', ordinary: 'Sin cobertura', cover: 'Identidad de cobertura', observe: 'Observar', take: 'Tomar objetos', offer: 'Ofrecer objetos', wait: 'Esperar', rest: 'Descansar', placeId: 'Lugar', placeIds: 'Lugares', participantIds: 'Personajes participantes', sceneId: 'Escena', lifecycle: 'Apertura y cierre',
  startedAt: 'Inicio ficticio (milisegundos UTC)', closedAt: 'Cierre ficticio (milisegundos UTC)', reason: 'Motivo',
  channelId: 'Canal', enabled: 'Habilitado', maxRange: 'Alcance máximo', scope: 'Audiencia', modality: 'Medio perceptivo',
  transparentWhenClosed: 'Permite ver al estar cerrada', soundPassesWhenClosed: 'Permite oír al estar cerrada',
  throughDoorIds: 'Puertas atravesadas', distance: 'Distancia', objectEntityId: 'Objeto', location: 'Ubicación',
  collisionRadius: 'Radio de colisión', blocksMovement: 'Bloquea el paso', portable: 'Transportable',
  availability: 'Disponibilidad', power: 'Energía', operations: 'Operaciones', revision: 'Revisión inicial',
  observeMs: 'Observar (ms)', speechMs: 'Hablar (ms)', gestureMs: 'Gesto (ms)', takeMs: 'Tomar (ms)',
  offerMs: 'Ofrecer (ms)', acceptOfferMs: 'Aceptar (ms)', maxWaitMs: 'Espera máxima (ms)', maxRestMs: 'Descanso máximo (ms)',
  offerValidityMs: 'Vigencia de ofertas (ms)', interactionRange: 'Distancia de interacción',
  dark: 'Oscuro', dim: 'Tenue', normal: 'Normal', bright: 'Brillante', open: 'Abierta', closed: 'Cerrada', locked: 'Cerrada con llave',
  addressed: 'Dirigida', broadcast: 'A todos los que puedan percibir', speech: 'Habla', gesture: 'Gesto', visual: 'Visual', auditory: 'Auditivo',
  object: 'Objeto', device: 'Dispositivo', character: 'Personaje preparado', on: 'Encendido', off: 'Apagado',
  atPlace: 'En un lugar', heldBy: 'En posesión de un personaje', consumed: 'Consumido', setPower: 'Cambiar energía', setLight: 'Cambiar iluminación',
};
const label = (key: string) => LABELS[key] ?? key;
function optionLabel(variant: FormSchema, index: number) {
  const discriminator = variant.properties?.kind?.const ?? variant.properties?.state?.const;
  return typeof discriminator === 'string' ? label(discriminator) : `Opción ${index + 1}`;
}
function matchesVariant(variant: FormSchema, value: unknown): boolean {
  if (variant.type === 'null') return value === null;
  if (variant.type === 'string') return typeof value === 'string';
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = formObject(value);
  return Object.entries(variant.properties ?? {}).filter(([, child]) => child.const !== undefined).every(([key, child]) => object[key] === child.const);
}
function Field(props: { schema: FormSchema; value: unknown; name: string; draft: RunConfigurationDraft; onChange: (value: unknown) => void; technicalId?: boolean }) {
  const { schema, value, name, draft, onChange } = props;
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined && variants.every((variant) => variant.type === 'string')) return <Field {...props} schema={{ type: 'string', pattern: variants[0]?.pattern }} />;
  if (variants !== undefined) {
    const selected = variants.findIndex((variant) => matchesVariant(variant, value));
    const variant = variants[selected];
    return <div className="world-variant"><label>{label(name)}<select value={selected < 0 ? '' : String(selected)} onChange={(event) => { const next = variants[Number(event.target.value)]; if (next !== undefined) onChange(next.type === 'null' ? null : formBlank(next, () => crypto.randomUUID())); }}><option value="">Elegir tipo</option>{variants.map((entry, index) => (entry.properties?.kind?.const === 'character' || entry.properties?.kind?.const === 'consumed') && selected !== index ? null : <option key={index} value={index}>{entry.type === 'null' ? 'Sin conexión' : optionLabel(entry, index)}</option>)}</select></label>{variant !== undefined && variant.type !== 'null' && <Field {...props} schema={variant} />}</div>;
  }
  if (schema.const !== undefined) return <span>{label(String(schema.const))}</span>;
  if (schema.type === 'object') {
    const object = formObject(value);
    return <fieldset><legend>{label(name)}</legend>{Object.entries(schema.properties ?? {}).filter(([key, child]) => child.const === undefined && (object.kind !== 'character' || ['placeId', 'position', 'presence', 'availability', 'routine', 'collisionRadius', 'blocksMovement'].includes(key))).map(([key, child]) => <Field key={key} schema={child} value={object[key]} name={key} draft={draft} technicalId={key === 'id' || (key === 'entityId' && object.kind !== 'heldBy')} onChange={(next) => onChange({ ...object, [key]: next })} />)}</fieldset>;
  }
  if (schema.type === 'array') {
    const array = formArray(value); const itemSchema = schema.items;
    return <div className="world-array"><h4>{label(name)}</h4>{array.map((entry, index) => itemSchema === undefined ? null : <div key={index} className="world-entry"><Field schema={itemSchema} value={entry} name={name} draft={draft} onChange={(next) => onChange(array.map((previous, at) => at === index ? next : previous))} /><button type="button" onClick={() => onChange(array.filter((_, at) => at !== index))}>Quitar entrada {index + 1}</button></div>)}<button type="button" disabled={itemSchema === undefined} onClick={() => { if (itemSchema !== undefined) onChange([...array, formBlank(itemSchema, () => crypto.randomUUID())]); }}>Agregar {label(name).toLowerCase()}</button></div>;
  }
  if (schema.type === 'boolean') return <label>{label(name)}<select value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select></label>;
  if (schema.enum !== undefined) return <label>{label(name)}<select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Pendiente</option>{schema.enum.map((entry) => <option key={String(entry)} value={String(entry)}>{label(String(entry))}</option>)}</select></label>;
  if (name === 'startedAt' || name === 'closedAt') {
    const date = typeof value === 'number' ? new Date(value) : undefined;
    const formatted = date !== undefined && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) : '';
    return <label>{name === 'startedAt' ? 'Inicio de la escena (UTC)' : 'Cierre de la escena (UTC)'}<input type="datetime-local" step="1" value={formatted} onChange={(event) => onChange(event.target.value ? Date.parse(`${event.target.value}Z`) : undefined)} />{draft.fictionalAt.kind !== 'empty' && <button type="button" onClick={() => onChange(draft.fictionalAt.kind === 'empty' ? undefined : draft.fictionalAt.value)}>Usar momento elegido de la representación</button>}</label>;
  }
  if (name === 'sourceItemId' || name === 'sourceGoalId') return <details><summary>Procedencia técnica</summary><output>{typeof value === 'string' ? value : 'Sin enlace de preparación'}</output></details>;
  if (name === 'revision') return <span>Revisión inicial: {typeof value === 'number' ? value : 'pendiente'}</span>;
  const references = worldReferences(draft, name);
  const numeric = schema.type === 'number' || schema.type === 'integer';
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (props.technicalId) return <details><summary>Identificador técnico{value ? ' creado' : ' pendiente'}</summary><output>{text || 'Todavía sin identificador'}</output>{!text && <button type="button" onClick={() => onChange(schema.pattern?.includes('[a-z0-9-]') ? `elemento-${crypto.randomUUID()}` : crypto.randomUUID())}>Crear identificador</button>}</details>;
  if (references !== undefined && !numeric) return <label>{label(name)}<select value={text} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Elegir referencia</option>{references.map((reference) => <option key={reference.id} value={reference.id}>{reference.label}</option>)}{text && !references.some((reference) => reference.id === text) && <option value={text}>{text} · referencia pendiente</option>}</select></label>;
  return <label>{label(name)}<input type={numeric ? 'number' : 'text'} step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum} maxLength={schema.maxLength} value={text} onChange={(event) => onChange(numeric ? parseWorldNumericInput(event.target.value) : event.target.value)} />{!numeric && (name === 'id' || name === 'entityId') && <button type="button" onClick={() => onChange(schema.pattern?.includes('[a-z0-9-]') ? `elemento-${crypto.randomUUID()}` : crypto.randomUUID())}>Crear identificador</button>}</label>;
}

export function WorldPreparationEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void; readOnly?: boolean }) {
  const [placing, setPlacing] = React.useState(false);
  const [placement, setPlacement] = React.useState<unknown>({ additionalCapabilities: [], recognizedCharacterIds: [], materialChoices: [] });
  const [section, setSection] = React.useState<WorldPreparationSection>('places');
  const [value, setValue] = React.useState<unknown>(() => worldCandidate(props.draft).places ?? []);
  const [pending, setPending] = React.useState(false); const [error, setError] = React.useState('');
  const candidate = worldCandidate(props.draft);
  React.useEffect(() => { setValue(worldCandidate(props.draft)[section]); setPending(false); setError(''); props.onPendingChange(false); }, [props.draft.runId, props.draft.revision, section]);
  function edit(next: unknown) { setValue(next); setPending(true); props.onPendingChange(true); setError(''); }
  function apply() {
    try { props.onChange(applyWorldSection({ draft: props.draft, section, value: value ?? formBlank(worldSectionForm(section)) })); setPending(false); props.onPendingChange(false); setError(''); }
    catch (failure) { setError(failure instanceof z.ZodError ? failure.issues.map((issue) => `${issue.path.map((part) => label(String(part))).join(' / ')}: ${issue.message}`).join('; ') : failure instanceof Error ? failure.message : 'Revisá esta sección.'); }
  }
  const issues = worldPreparationIssues(props.draft);
  return <section className="draft-section world-preparation" id="draft-worldSnapshot"><h3>Preparar el Escenario</h3><p>Este plano es un candidato inicial. Guardarlo no inicia una escena. Las posiciones y conexiones se verifican al validar la puesta.</p>
    <button type="button" disabled={props.readOnly || pending || placing || props.draft.roster.kind !== 'configured' || props.draft.roster.value.preparedCharacters.length === 0} onClick={() => { setPlacing(true); setPlacement({ additionalCapabilities: [], recognizedCharacterIds: [], materialChoices: [] }); setPending(true); props.onPendingChange(true); }}>Colocar personaje preparado</button>
    {placing && <fieldset disabled={props.readOnly}><legend>Colocar un personaje en la escena</legend><p>Elegí su presentación y situación. Sus objetivos y capacidades provienen de la versión preparada; no se copian datos globales del investigador ni estados privados de otro personaje. Elegir reconocimiento inicial no asigna confianza. Cada entrada de inventario representa un lote completo: tomar u ofrecer mueve toda su cantidad. Elegí su aspecto visible y sus propiedades materiales; no exponemos su descripción privada curada automáticamente.</p>
      <Field schema={parseWorldFormSchema(z.toJSONSchema(CharacterPlacementSchema))} value={placement} name="Presentación y situación" draft={props.draft} onChange={(next) => { setPlacement(next); setPending(true); props.onPendingChange(true); }} />
      <label><input type="checkbox" checked={formObject(placement).recognitionConfirmed === true} onChange={(event) => { setPlacement({ ...formObject(placement), recognitionConfirmed: event.target.checked ? true : undefined }); setPending(true); props.onPendingChange(true); }} />Confirmo las identidades reconocidas elegidas; la lista puede estar vacía sin borrar su historia ni sus relaciones.</label>
      <button type="button" onClick={() => { try { props.onChange(placePreparedCharacter({ draft: props.draft, placement, uuid: () => crypto.randomUUID() })); setPlacing(false); setPending(false); props.onPendingChange(false); setError(''); } catch (failure) { setError(failure instanceof z.ZodError ? failure.issues.map((issue) => `${issue.path.map((part) => label(String(part))).join(' / ')}: ${issue.message}`).join('; ') : failure instanceof Error ? failure.message : 'Revisá la situación.'); } }}>Confirmar colocación</button>
      <button type="button" onClick={() => { setPlacing(false); setPending(false); props.onPendingChange(false); setError(''); }}>Cancelar colocación</button>
    </fieldset>}
    <fieldset disabled={props.readOnly || placing}><div className="form-row"><label>Sección<select value={section} disabled={pending} onChange={(event) => { const selected = WORLD_SECTIONS.find(([key]) => key === event.target.value); if (selected !== undefined) setSection(selected[0]); }}>{WORLD_SECTIONS.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><button type="button" onClick={apply}>Aplicar sección</button>{pending && <button type="button" onClick={() => { setValue(candidate[section]); setPending(false); props.onPendingChange(false); }}>Descartar edición local</button>}</div>
      {section === 'entities' && <p>Los personajes requieren contextos preparados mediante la curación del reparto. Aquí podés editar entidades existentes y preparar objetos o dispositivos; no se inventa un actor preparado.</p>}
      <Field schema={worldSectionForm(section)} value={value} name={WORLD_SECTIONS.find(([key]) => key === section)?.[1] ?? section} draft={props.draft} onChange={edit} />
      <button type="button" disabled={pending} onClick={() => props.onChange(applyWorldSection({ draft: props.draft, section: 'inventory', value: candidate.inventory ?? [] }))}>Confirmar inventario inicial{candidate.inventory?.length ? ' conservado' : ' vacío'}</button>
      {(candidate.offers?.length ?? 0) === 0 && <button type="button" disabled={pending} onClick={() => props.onChange(confirmNoInitialOffers(props.draft))}>Confirmar que no hay ofertas previas</button>}
      <label>Escena inicial<select value={candidate.activeSceneId ?? ''} disabled={pending} onChange={(event) => { try { props.onChange(chooseActiveScene({ draft: props.draft, sceneId: event.target.value })); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Escena no disponible.'); } }}><option value="">Elegir escena abierta</option>{(candidate.scenes ?? []).filter((scene) => scene.lifecycle?.kind === 'open').map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
    </fieldset>{error && <p role="alert" className="error">{error}</p>}{pending && <p role="status">Edición local pendiente de aplicar; todavía no forma parte del borrador guardable.</p>}
    <div className="place-preview" aria-label="Planos del candidato">{(candidate.places ?? []).map((place, index) => <figure key={place.id ?? index}><figcaption>{place.name ?? 'Lugar por completar'}</figcaption>{place.width !== undefined && place.height !== undefined && <svg viewBox={`0 0 ${place.width} ${place.height}`} role="img" aria-label={`Plano de ${place.name ?? 'lugar'}: ${place.width} por ${place.height}`} width="240" height="180"><rect x="0" y="0" width={place.width} height={place.height} fill="#edf2f5" stroke="#526879" />{place.id !== undefined && worldMapItems(props.draft, place.id).map((entry) => <g key={entry.id}><circle cx={entry.x} cy={entry.y} r={Math.max(entry.radius, Math.min(place.width ?? 1, place.height ?? 1) / 50)} fill={entry.kind === 'object' ? '#ad6521' : '#1a7059'} /><title>{`${entry.label} · ${entry.x}, ${entry.y}`}</title></g>)}</svg>}<ul>{place.id !== undefined && worldMapItems(props.draft, place.id).map((entry) => <li key={entry.id}>{entry.label} · posición {entry.x}, {entry.y}</li>)}</ul></figure>)}</div>
    <details><summary>Validación estructural del candidato · {issues.length} asuntos pendientes</summary><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>
  </section>;
}
