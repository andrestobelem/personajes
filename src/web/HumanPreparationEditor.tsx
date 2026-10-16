import React from 'react';
import { z } from 'zod';
import { HumanParticipantProfileSchema, type HumanParticipantProfile } from '../domain/interaction-schema.ts';
import { HumanParticipantProfilesSchema, type RunConfigurationDraft } from '../domain/production.ts';
import { changeDraftField } from './draft-form.ts';

export type HumanForm = { participantId: string; displayName: string; identity: string; lifeStory: string; presence: string; sceneId: string; placeId: string; channelId: string; x: string; y: string };
export function humanForm(profile?: HumanParticipantProfile): HumanForm {
  return { participantId: profile?.identity.participantId ?? `humano-${crypto.randomUUID()}`, displayName: profile?.identity.displayName ?? '', identity: profile?.identity.identityMarkdown ?? '', lifeStory: profile?.identity.lifeStoryMarkdown ?? '', presence: profile?.presence.kind ?? '', sceneId: profile?.presence.kind === 'inScene' ? profile.presence.sceneId : '', placeId: profile?.presence.placeId ?? '', channelId: profile?.presence.channelId ?? '', x: profile === undefined ? '' : String(profile.presence.position.x), y: profile === undefined ? '' : String(profile.presence.position.y) };
}
export const HumanIdentitySuggestionSchema = z.enum(['visitor', 'reporter']);
/** Fictional starting points chosen explicitly; never a claim about the real user. */
export function suggestHumanForm(input: { draft: RunConfigurationDraft; kind: z.infer<typeof HumanIdentitySuggestionSchema> }): HumanForm {
  const form = humanForm();
  const world = input.draft.worldSnapshot.kind === 'empty' ? undefined : input.draft.worldSnapshot.value;
  const scene = world?.scenes?.find(value => value.id === world.activeSceneId && value.lifecycle?.kind === 'open');
  const place = world?.places?.find(value => scene?.placeIds?.some(id => id === value.id) && value.width !== undefined && value.height !== undefined
    && world.channels?.some(channel => channel.kind === 'speech' && channel.enabled && channel.placeIds.some(id => id === value.id)));
  const channel = world?.channels?.find(value => value.kind === 'speech' && value.enabled && place !== undefined && value.placeIds.some(id => id === place.id));
  const identity = input.kind === 'visitor'
    ? {displayName:'Visitante de CONTROL',identity:'Soy una persona visitante, curiosa y observadora. Puedo preguntar, escuchar y decidir qué contar. Mi presentación no me concede rango, acceso secreto ni autoridad sobre los demás.',lifeStory:'Biografía ficticia propuesta: mi experiencia cotidiana me enseñó a escuchar versiones distintas antes de sacar conclusiones. Busco conocer a quienes encuentre y formar mi propio criterio. No tengo recuerdos previos de esta representación ni conozco las conversaciones privadas del reparto.'}
    : {displayName:'Cronista visitante',identity:'Soy una persona que observa y hace preguntas para comprender lo que sucede. Puedo contrastar testimonios, reservar mi opinión y cambiar de interpretación. Mi oficio no me permite conocer secretos ni obligar a nadie a responder.',lifeStory:'Biografía ficticia propuesta: aprendí a distinguir lo que vi de lo que me contaron. Me interesan las personas, sus decisiones y las consecuencias. No presencié acontecimientos anteriores de esta representación ni dispongo de recuerdos o información privada de los personajes.'};
  return {...form,...identity,...(place?.width !== undefined && place.height !== undefined && place.id !== undefined && scene?.id !== undefined && channel !== undefined
    ? {presence:'inScene',sceneId:scene.id,placeId:place.id,channelId:channel.id,x:String(Math.min(1,place.width/2)),y:String(Math.min(1,place.height/2))}
    : {})};
}
export function compileHumanForm(input: { form: HumanForm; draft: RunConfigurationDraft }): HumanParticipantProfile {
  const { form } = input;
  if (!form.identity.trim() || !form.lifeStory.trim()) throw new Error('Redactá la identidad completa y la historia de vida; no se completan automáticamente.');
  if (!form.x.trim() || !form.y.trim()) throw new Error('Elegí ambas coordenadas de la presencia.');
  const profile = HumanParticipantProfileSchema.parse({ identity: { participantId: form.participantId, displayName: form.displayName, identityMarkdown: form.identity, lifeStoryMarkdown: form.lifeStory },
    presence: { kind: form.presence, placeId: form.placeId, channelId: form.channelId, position: { x: Number(form.x), y: Number(form.y) }, ...(form.presence === 'inScene' ? { sceneId: form.sceneId } : {}) } });
  const world = input.draft.worldSnapshot.kind === 'empty' ? undefined : input.draft.worldSnapshot.value;
  const place = world?.places?.find((item) => item.id === profile.presence.placeId);
  if (place === undefined) throw new Error('Elegí un lugar del escenario preparado.');
  if (place.width !== undefined && place.height !== undefined && (profile.presence.position.x < 0 || profile.presence.position.y < 0 || profile.presence.position.x > place.width || profile.presence.position.y > place.height)) throw new Error('La presencia debe ubicarse dentro del lugar.');
  const channel = world?.channels?.find((item) => item.id === profile.presence.channelId);
  if (!channel || channel.kind !== 'speech' || !channel.enabled || !channel.placeIds.includes(profile.presence.placeId)) throw new Error('Elegí un canal de habla habilitado para ese lugar.');
  if (profile.presence.kind === 'inScene') {
    const sceneId = profile.presence.sceneId;
    const scene = world?.scenes?.find((item) => item.id === sceneId);
    if (!scene || scene.lifecycle?.kind !== 'open' || !scene.placeIds?.includes(profile.presence.placeId)) throw new Error('Elegí una escena abierta que incluya ese lugar.');
  }
  return profile;
}
export function HumanPreparationEditor(props: { draft: RunConfigurationDraft; onChange: (draft: RunConfigurationDraft) => void; onPendingChange: (pending: boolean) => void }) {
  const existing = props.draft.humanParticipants.kind === 'empty' ? [] : props.draft.humanParticipants.value;
  const [forms, setForms] = React.useState(() => existing.map((profile) => humanForm(profile)));
  const [error, setError] = React.useState('');
  const [suggestion, setSuggestion] = React.useState<z.infer<typeof HumanIdentitySuggestionSchema>>('visitor');
  const world = props.draft.worldSnapshot.kind === 'empty' ? undefined : props.draft.worldSnapshot.value;
  function edit(next: HumanForm[]) { setForms(next); props.onPendingChange(true); setError(''); }
  function change(index: number, field: keyof HumanForm, value: string) { edit(forms.map((row, i) => i === index ? { ...row, [field]: value } : row)); }
  function apply() {
    try { const profiles = HumanParticipantProfilesSchema.parse(forms.map((form) => compileHumanForm({ form, draft: props.draft }))); props.onChange(changeDraftField({ draft: props.draft, field: 'humanParticipants', value: profiles })); props.onPendingChange(false); setError(''); }
    catch (failure) { setError(failure instanceof z.ZodError ? failure.issues.map((issue) => { const labels: Record<string, string> = {"identity": "Identidad", "presence": "Presencia", "displayName": "Nombre ficticio", "identityMarkdown": "Identidad completa", "lifeStoryMarkdown": "Historia de vida", "sceneId": "Escena", "channelId": "Canal", "placeId": "Lugar", "position": "Posición"}; const field = issue.path.findLast((part) => typeof part === 'string'); return `${typeof field === 'string' ? labels[field] ?? field : 'Configuración'}: ${issue.message}`; }).join(' · ') : failure instanceof Error ? failure.message : 'Revisá los perfiles humanos.'); }
  }
  return <section className="draft-section" id="draft-humanParticipants"><h3>Tu identidad dentro de la ficción</h3><div className="edit-notice"><label>Punto de partida para mi identidad<select value={suggestion} onChange={event => setSuggestion(HumanIdentitySuggestionSchema.parse(event.target.value))}><option value="visitor">Visitante de CONTROL · recomendado</option><option value="reporter">Cronista visitante</option></select></label><button type="button" onClick={() => edit([...forms,suggestHumanForm({draft:props.draft,kind:suggestion})])}>Proponer mi identidad ficticia</button><p>Agrega una identidad editable y propone ubicación sólo si hay una escena y un canal de habla disponibles. Es ficción elegida, no tu biografía real; no revela secretos ni te da permisos. Revisá y aplicá antes de guardar.</p></div><p className="field-help">Cada perfil pertenece a una persona usuaria. Es una identidad ficticia propia: no crea un actor Pi ni importa la memoria del reparto. La ficha y la historia no se revelan completas al hablar con un personaje.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {forms.length === 0 && <p>No hay perfiles redactados. Agregá tu identidad ficticia o confirmá explícitamente una puesta sin interlocutores humanos.</p>}
    {forms.map((form, index) => <section className="draft-section" key={form.participantId}><h4>Perfil {index + 1}{form.displayName ? ` · ${form.displayName}` : ' · Nombre pendiente'}</h4><label>Nombre ficticio<input maxLength={120} value={form.displayName} onChange={(event) => change(index, 'displayName', event.target.value)} /></label>
      <label>Identidad completa<textarea rows={10} value={form.identity} onChange={(event) => change(index, 'identity', event.target.value)} /></label><p className="field-help">Redactá apariencia y presencia, edad o etapa vital si corresponde, posición social, oficio y competencias, valores, contradicciones, deseos, temores, vínculos, hábitos y forma de hablar. Podés declarar desconocidos; no inferimos nada a partir de tu identidad real. Admite Markdown, hasta 32 KiB UTF-8.</p>
      <label>Historia de vida<textarea rows={14} value={form.lifeStory} onChange={(event) => change(index, 'lifeStory', event.target.value)} /></label><p className="field-help">Desarrollá origen, infancia y formación, acontecimientos decisivos, relaciones, pérdidas y logros, cambios de deseos y creencias, cronología y situación al inicio de la obra. Distinguí hechos vividos, versiones personales y vacíos. Admite Markdown, hasta 128 KiB UTF-8.</p>
      <label>Forma de presencia<select value={form.presence} onChange={(event) => change(index, 'presence', event.target.value)}><option value="">Pendiente</option><option value="inScene">En una escena</option><option value="remote">Remota, desde un lugar configurado</option></select></label>
      <div className="form-row"><label>Lugar<select value={form.placeId} onChange={(event) => change(index, 'placeId', event.target.value)}><option value="">Pendiente</option>{world?.places?.filter((place) => place.id !== undefined).map((place) => <option key={place.id} value={place.id}>{place.name || 'Lugar sin nombre'} · {place.id}</option>)}</select></label>
      {form.presence === 'inScene' && <label>Escena<select value={form.sceneId} onChange={(event) => change(index, 'sceneId', event.target.value)}><option value="">Pendiente</option>{world?.scenes?.filter((scene) => scene.id !== undefined).map((scene) => <option key={scene.id} value={scene.id}>{scene.label || 'Escena sin nombre'} · {scene.id}</option>)}</select></label>}
      <label>Canal de habla<select value={form.channelId} onChange={(event) => change(index, 'channelId', event.target.value)}><option value="">Pendiente</option>{world?.channels?.filter((channel) => channel.kind === 'speech').map((channel) => <option key={channel.id} value={channel.id} disabled={!channel.enabled}>{channel.label} · {channel.scope === 'broadcast' ? 'Difusión' : 'Dirigido'}</option>)}</select></label></div>
      <div className="form-row"><label>Posición X<input type="number" step="any" value={form.x} onChange={(event) => change(index, 'x', event.target.value)} /></label><label>Posición Y<input type="number" step="any" value={form.y} onChange={(event) => change(index, 'y', event.target.value)} /></label></div><p className="field-help">La ubicación, el canal y las condiciones perceptivas determinan quién puede oírte. Elegir un perfil no envía ningún mensaje.</p><button onClick={() => edit(forms.filter((_, i) => i !== index))}>Quitar este perfil</button>
    </section>)}
    <button disabled={forms.length >= 10} onClick={() => edit([...forms, humanForm()])}>Agregar identidad ficticia</button><button className="primary-button" onClick={apply}>{forms.length === 0 ? 'Confirmar sin perfiles humanos' : 'Aplicar perfiles humanos'}</button>
  </section>;
}
