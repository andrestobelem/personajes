import React from 'react';
import { minuteTime, timeMinute } from './day-night-form.ts';
import { routineCalendarDiagnostics } from '../domain/routine-calendar.ts';
import { AvailabilityRoutineSchema, WorldClockSchema } from '../domain/world-schema.ts';
import { z } from 'zod';
import type { RunConfigurationDraft } from '../domain/production.ts';
import { applyWorldSection, chooseActiveScene, confirmNoInitialOffers, formArray, formBlank, matchesWorldFormVariant, formObject, parseWorldNumericInput, parseWorldFormSchema, worldCandidate, worldMapItems, worldPreparationIssues, worldReferences, worldSectionForm, WORLD_SECTIONS, CharacterPlacementSchema, placePreparedCharacter, type FormSchema, type WorldPreparationSection } from './world-preparation.ts';

const LABELS: Record<string, string> = {
  daily: 'Repetición diaria', fromMinute: 'Desde (hora local)', toMinute: 'Hasta (hora local)', disambiguation: 'Resolución de cambios horarios', compatible: 'Compatible: primera repetida; desplazar inexistente',
  circumstanceCatalog: 'Catálogo de circunstancias', environmentConditions: 'Condiciones ambientales', states: 'Estados autorizados', objectTemplates: 'Plantillas de objetos', allowedPlaceIds: 'Lugares de aparición autorizados', conditionId: 'Condición ambiental', stateId: 'Estado ambiental', sourceRefs: 'Referencias de procedencia',
  id: 'Identificador', entityId: 'Identificador de entidad', name: 'Nombre', label: 'Nombre visible', description: 'Descripción',
  width: 'Ancho', height: 'Alto', lighting: 'Iluminación', kind: 'Tipo', state: 'Estado', from: 'Desde', to: 'Hasta',
  durationMs: 'Duración (milisegundos)', arrivalPoint: 'Punto de llegada', doorId: 'Puerta', position: 'Posición',
  materialChoices: 'Materializar inventario preparado', itemId: 'Objeto preparado', visibleLabel: 'Nombre visible elegido', physicalDescription: 'Aspecto visible elegido', quantity: 'Cantidad del lote', condition: 'Condición', sourceItemId: 'Procedencia del objeto', sourceGoalId: 'Objetivo de origen', characterId: 'Personaje preparado', displayName: 'Nombre real del personaje', species: 'Naturaleza del personaje', presentation: 'Presentación ante los demás', additionalCapabilities: 'Acciones adicionales elegidas', recognizedCharacterIds: 'Identidades que reconoce al inicio', presence: 'Presencia en escena', present: 'Presente', absent: 'Ausente', routine: 'Rutina', human: 'Humano', animal: 'Animal', robot: 'Robot', always: 'Siempre disponible', windows: 'Intervalos de disponibilidad', defaultState: 'Disponibilidad fuera de los intervalos', available: 'Disponible', unavailable: 'No disponible', ordinary: 'Sin cobertura', cover: 'Identidad de cobertura', observe: 'Observar', take: 'Tomar objetos', offer: 'Ofrecer objetos', wait: 'Esperar', rest: 'Descansar', placeId: 'Lugar', placeIds: 'Lugares', participantIds: 'Personajes participantes', sceneId: 'Escena', lifecycle: 'Apertura y cierre',
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
function Field(props: { schema: FormSchema; value: unknown; name: string; draft: RunConfigurationDraft; onChange: (value: unknown) => void; technicalId?: boolean; conditionId?: string | undefined }) {
  const { schema, value, name, draft, onChange } = props;
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined && variants.every((variant) => variant.type === 'string')) return <Field {...props} schema={{ type: 'string', pattern: variants[0]?.pattern }} />;
  if (variants !== undefined) {
    const selected = variants.findIndex((variant) => matchesWorldFormVariant(variant, value));
    const variant = variants[selected];
    return <div className="world-variant"><label>{label(name)}<select value={selected < 0 ? '' : String(selected)} onChange={(event) => { const next = variants[Number(event.target.value)]; if (next !== undefined) onChange(next.type === 'null' ? null : formBlank(next, () => crypto.randomUUID())); }}><option value="">Elegir tipo</option>{variants.map((entry, index) => (entry.properties?.kind?.const === 'character' || entry.properties?.kind?.const === 'consumed') && selected !== index ? null : <option key={index} value={index}>{entry.type === 'null' ? 'Sin conexión' : optionLabel(entry, index)}</option>)}</select></label>{variant !== undefined && variant.type !== 'null' && <Field {...props} schema={variant} />}</div>;
  }
  if (schema.const !== undefined && name === 'disambiguation') return <label>Resolución de cambios horarios<select value={value === 'compatible' ? 'compatible' : ''} onChange={event => onChange(event.target.value || undefined)}><option value="">Elegir política</option><option value="compatible">Compatible: primera repetida; desplazar inexistente</option></select></label>;
  if (schema.const !== undefined) return <span>{label(String(schema.const))}</span>;
  if (schema.type === 'object') {
    const object = formObject(value);
    const routine=AvailabilityRoutineSchema.safeParse(value);
    const clock=WorldClockSchema.safeParse(worldCandidate(draft).clock);
    const diagnostics=routine.success && clock.success ? routineCalendarDiagnostics({routine:routine.data,clock:clock.data}) : [];
    return <fieldset><legend>{label(name)}</legend>{object.kind === 'daily' && <p>Horas locales de la convención del Escenario. Un fin anterior al inicio cruza medianoche. 00:00–24:00 cubre el día completo. Inicio y fin iguales no son válidos. Compatible elige la primera ocurrencia repetida y desplaza la inexistente por el salto horario.</p>}{diagnostics.map((detail,index)=><p key={index} role="status">Advertencia de calendario: {detail}</p>)}{Object.entries(schema.properties ?? {}).filter(([key, child]) => (child.const === undefined || key === 'disambiguation') && (object.kind !== 'character' || ['placeId', 'position', 'presence', 'availability', 'routine', 'collisionRadius', 'blocksMovement'].includes(key))).map(([key, child]) => <Field key={key} schema={child} value={object[key]} name={key} draft={draft} conditionId={typeof object.conditionId === 'string' ? object.conditionId : undefined} technicalId={key === 'id' || (key === 'entityId' && object.kind !== 'heldBy')} onChange={(next) => onChange({ ...object, [key]: next })} />)}</fieldset>;
  }
  if (schema.type === 'array') {
    const array = formArray(value); const itemSchema = schema.items;
    return <div className="world-array"><h4>{label(name)}</h4>{array.map((entry, index) => itemSchema === undefined ? null : <div key={index} className="world-entry"><Field schema={itemSchema} value={entry} name={name} draft={draft} onChange={(next) => onChange(array.map((previous, at) => at === index ? next : previous))} /><button type="button" onClick={() => onChange(array.filter((_, at) => at !== index))}>Quitar entrada {index + 1}</button></div>)}<button type="button" disabled={itemSchema === undefined} onClick={() => { if (itemSchema !== undefined) onChange([...array, formBlank(itemSchema, () => crypto.randomUUID())]); }}>Agregar {label(name).toLowerCase()}</button></div>;
  }
  if (schema.type === 'boolean') return <label>{label(name)}<select value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select></label>;
  if (schema.enum !== undefined) return <label>{label(name)}<select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Pendiente</option>{schema.enum.map((entry) => <option key={String(entry)} value={String(entry)}>{label(String(entry))}</option>)}</select></label>;
  if (name === 'fromMinute' || name === 'toMinute') return <label>{label(name)}<input type="text" inputMode="numeric" placeholder={name === 'toMinute' ? 'HH:mm o 24:00' : 'HH:mm'} value={typeof value === 'number' ? minuteTime(value) : typeof value === 'string' ? value : ''} onChange={event => { const text = event.target.value; try { onChange(timeMinute(text, name === 'toMinute')); } catch { onChange(text); } }} /></label>;
  if (name === 'startedAt' || name === 'closedAt') {
    const date = typeof value === 'number' ? new Date(value) : undefined;
    const formatted = date !== undefined && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) : '';
    return <label>{name === 'startedAt' ? 'Inicio de la escena (UTC)' : 'Cierre de la escena (UTC)'}<input type="datetime-local" step="1" value={formatted} onChange={(event) => onChange(event.target.value ? Date.parse(`${event.target.value}Z`) : undefined)} />{draft.fictionalAt.kind !== 'empty' && <button type="button" onClick={() => onChange(draft.fictionalAt.kind === 'empty' ? undefined : draft.fictionalAt.value)}>Usar momento elegido de la representación</button>}</label>;
  }
  if (name === 'sourceItemId' || name === 'sourceGoalId') return <details><summary>Procedencia técnica</summary><output>{typeof value === 'string' ? value : 'Sin enlace de preparación'}</output></details>;
  if (name === 'revision') return <span>Revisión inicial: {typeof value === 'number' ? value : 'pendiente'}</span>;
  const references = worldReferences(draft, name, props.conditionId);
  const numeric = schema.type === 'number' || schema.type === 'integer';
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (props.technicalId) return <details><summary>Identificador técnico{value ? ' creado' : ' pendiente'}</summary><output>{text || 'Todavía sin identificador'}</output>{!text && <button type="button" onClick={() => onChange(schema.pattern?.includes('[a-z0-9-]') ? `elemento-${crypto.randomUUID()}` : crypto.randomUUID())}>Crear identificador</button>}</details>;
  if (references !== undefined && !numeric) return <label>{label(name)}<select value={text} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Elegir referencia</option>{references.map((reference) => <option key={reference.id} value={reference.id}>{reference.label}</option>)}{text && !references.some((reference) => reference.id === text) && <option value={text}>{text} · referencia pendiente</option>}</select></label>;
  return <label>{label(name)}<input type={numeric ? 'number' : 'text'} step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum} maxLength={schema.maxLength} value={text} onChange={(event) => onChange(numeric ? parseWorldNumericInput(event.target.value) : event.target.value)} />{!numeric && (name === 'id' || name === 'entityId') && <button type="button" onClick={() => onChange(schema.pattern?.includes('[a-z0-9-]') ? `elemento-${crypto.randomUUID()}` : crypto.randomUUID())}>Crear identificador</button>}</label>;
}

export function WorldPreparationEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void; readOnly?: boolean; initialSection?: WorldPreparationSection }) {
  const [placing, setPlacing] = React.useState(false);
  const [placement, setPlacement] = React.useState<unknown>({ additionalCapabilities: [], recognizedCharacterIds: [], materialChoices: [] });
  const [section, setSection] = React.useState<WorldPreparationSection>(props.initialSection ?? 'places');
  const [localEdit, setLocalEdit] = React.useState<{ section: WorldPreparationSection; value: unknown }>(() => ({ section, value: worldCandidate(props.draft)[section] }));
  // A section change renders before its effect runs. Never parse the previous section's value with the new form schema.
  const value = localEdit.section === section ? localEdit.value : worldCandidate(props.draft)[section];
  function setValue(next: unknown) { setLocalEdit({ section, value: next }); }
  const [catalogConfirmed, setCatalogConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false); const [error, setError] = React.useState('');
  const candidate = worldCandidate(props.draft);
  React.useEffect(() => { setValue(worldCandidate(props.draft)[section]); setPending(false); setCatalogConfirmed(false); setError(''); props.onPendingChange(false); }, [props.draft.runId, props.draft.revision, section]);
  function edit(next: unknown) { setCatalogConfirmed(false); setValue(next); setPending(true); props.onPendingChange(true); setError(''); }
  function apply() {
    try { if (section === 'circumstanceCatalog' && !catalogConfirmed) throw new Error('Confirmá explícitamente el catálogo elegido, incluso si queda vacío.'); props.onChange(applyWorldSection({ draft: props.draft, section, value: section === 'circumstanceCatalog' ? { environmentConditions: [], objectTemplates: [], ...formObject(value) } : value ?? formBlank(worldSectionForm(section)) })); setPending(false); props.onPendingChange(false); setError(''); }
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
      {section === 'circumstanceCatalog' ? <div><p>Autorizá las condiciones y los objetos que Dirección podrá introducir. Puertas, iluminación y dispositivos se configuran en sus propias secciones. Los sonidos ambientales tienen alcance local; la descripción expresa lo percibido, sin instrucciones para el personaje.</p><p>Al aplicar se registra una nueva revisión y la procedencia de esta elección. Revisión actual: {candidate.circumstanceCatalog?.revision ?? 'sin catálogo confirmado'}.</p>
        <Field schema={worldSectionForm(section).properties?.environmentConditions ?? {}} value={formObject(value).environmentConditions} name="environmentConditions" draft={props.draft} onChange={(next) => edit({ ...formObject(value), environmentConditions: next })} />
        <Field schema={worldSectionForm(section).properties?.objectTemplates ?? {}} value={formObject(value).objectTemplates} name="objectTemplates" draft={props.draft} onChange={(next) => edit({ ...formObject(value), objectTemplates: next })} />
        <Field schema={{ type: 'array', items: { type: 'string' } }} value={formObject(formObject(value).provenance).sourceRefs} name="sourceRefs" draft={props.draft} onChange={(next) => edit({ ...formObject(value), provenance: { ...formObject(formObject(value).provenance), sourceRefs: next } })} />
        <label><input type="checkbox" checked={catalogConfirmed} onChange={(event) => { if (value === undefined) edit({ environmentConditions: [], objectTemplates: [], provenance: { sourceRefs: [] } }); setCatalogConfirmed(event.target.checked); }} />Confirmo este catálogo y su procedencia, incluso si no autorizo condiciones ni objetos.</label>
      </div> : <Field schema={worldSectionForm(section)} value={value} name={WORLD_SECTIONS.find(([key]) => key === section)?.[1] ?? section} draft={props.draft} onChange={edit} />}
      {section === 'environment' && <p>Elegí el estado inicial de las condiciones del catálogo para cada lugar. La validación verifica las referencias y evita duplicar la misma condición en un lugar.</p>}
      <button type="button" disabled={pending} onClick={() => props.onChange(applyWorldSection({ draft: props.draft, section: 'inventory', value: candidate.inventory ?? [] }))}>Confirmar inventario inicial{candidate.inventory?.length ? ' conservado' : ' vacío'}</button>
      {(candidate.offers?.length ?? 0) === 0 && <button type="button" disabled={pending} onClick={() => props.onChange(confirmNoInitialOffers(props.draft))}>Confirmar que no hay ofertas previas</button>}
      <label>Escena inicial<select value={candidate.activeSceneId ?? ''} disabled={pending} onChange={(event) => { try { props.onChange(chooseActiveScene({ draft: props.draft, sceneId: event.target.value })); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Escena no disponible.'); } }}><option value="">Elegir escena abierta</option>{(candidate.scenes ?? []).filter((scene) => scene.lifecycle?.kind === 'open').map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
    </fieldset>{error && <p role="alert" className="error">{error}</p>}{pending && <p role="status">Edición local pendiente de aplicar; todavía no forma parte del borrador guardable.</p>}
    <div className="place-preview" aria-label="Planos del candidato">{(candidate.places ?? []).map((place, index) => <figure key={place.id ?? index}><figcaption>{place.name ?? 'Lugar por completar'}</figcaption>{place.width !== undefined && place.height !== undefined && <svg viewBox={`0 0 ${place.width} ${place.height}`} role="img" aria-label={`Plano de ${place.name ?? 'lugar'}: ${place.width} por ${place.height}`} width="240" height="180"><rect x="0" y="0" width={place.width} height={place.height} fill="#edf2f5" stroke="#526879" />{place.id !== undefined && worldMapItems(props.draft, place.id).map((entry) => <g key={entry.id}><circle cx={entry.x} cy={entry.y} r={Math.max(entry.radius, Math.min(place.width ?? 1, place.height ?? 1) / 50)} fill={entry.kind === 'object' ? '#ad6521' : '#1a7059'} /><title>{`${entry.label} · ${entry.x}, ${entry.y}`}</title></g>)}</svg>}<ul>{place.id !== undefined && worldMapItems(props.draft, place.id).map((entry) => <li key={entry.id}>{entry.label} · posición {entry.x}, {entry.y}</li>)}</ul></figure>)}</div>
    <details><summary>Validación estructural del candidato · {issues.length} asuntos pendientes</summary><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>
  </section>;
}
