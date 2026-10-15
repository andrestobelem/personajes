import React from 'react';
import { SourceKindSchema, type Dossier, type SourceRef } from '../domain/catalog.ts';
import { dossierEditableFields, replaceEditorialRow, type DossierEditableFields } from './dossier-editor-form.ts';

function StringRows(props: { label: string; values: readonly string[]; onChange: (values: string[]) => void; disabled: boolean }) {
  return <fieldset disabled={props.disabled}><legend>{props.label}</legend>{props.values.map((value, index) => <div key={index}><label>{props.label} {index + 1}<textarea value={value} onChange={(event) => props.onChange(replaceEditorialRow(props.values, index, event.target.value))} /></label><button type="button" onClick={() => props.onChange(props.values.filter((_, position) => position !== index))}>Quitar {props.label.toLowerCase()} {index + 1}</button></div>)}<button type="button" onClick={() => props.onChange([...props.values, ''])}>Agregar {props.label.toLowerCase()}</button></fieldset>;
}

export function DossierEditorForm(props: { initial: Dossier; onChange: (fields: DossierEditableFields) => void; disabled?: boolean; avatarSlugs?: readonly string[] }) {
  const [fields, setFields] = React.useState(() => dossierEditableFields(props.initial));
  const disabled = props.disabled ?? false;
  function change(next: DossierEditableFields) { setFields(next); props.onChange(next); }
  function sourceChange(index: number, next: SourceRef) { change({ ...fields, sourceRefs: fields.sourceRefs.map((source, position) => position === index ? next : source) }); }
  const currentAvatar = fields.avatarRef.kind === 'catalog-reference' ? fields.avatarRef.slug : '';
  const avatarSlugs = [...new Set([...(props.avatarSlugs ?? []), ...(currentAvatar ? [currentAvatar] : [])])];
  return <div className="dossier-editor-form">
    <p>Personaje: <code>{props.initial.characterId}</code> · Revisión de origen: {props.initial.revision} · Hash Markdown: <code>{props.initial.contentHash}</code></p>
    <details><summary>Procedencia inmutable ({props.initial.adaptations.length} adaptaciones anteriores)</summary><p>Autoría declarada en el archivo. Importar entradas heredadas no verifica la identidad de sus autores.</p>{props.initial.adaptations.map((adaptation) => <p key={adaptation.adaptationId}><code>{adaptation.adaptationId}</code> · {adaptation.createdAt} · {adaptation.reason} · Base <code>{adaptation.basedOnHash}</code>{adaptation.editorial && <> · Autor registrado: {adaptation.editorial.authorPrincipalId} · Archivo parental: <code>{adaptation.editorial.parentArchiveHash}</code></>}</p>)}</details>
    <fieldset disabled={disabled}><legend>Ficha e historia</legend>
      <label>Nombre mostrado<input value={fields.displayName} onChange={(event) => change({ ...fields, displayName: event.target.value })} /></label>
      <StringRows label="Alias" values={fields.aliases} disabled={disabled} onChange={(aliases) => change({ ...fields, aliases })} />
      <StringRows label="Intérpretes" values={fields.performers} disabled={disabled} onChange={(performers) => change({ ...fields, performers })} />
      <label>Manuscrito Markdown<textarea rows={22} value={fields.markdown} onChange={(event) => change({ ...fields, markdown: event.target.value })} /></label>
      <p>La vista previa del servidor normaliza el manuscrito y deriva sus secciones reconocidas y no reconocidas. Las secciones no se editan por separado.</p>
    </fieldset>
    <fieldset disabled={disabled}><legend>Fuentes y procedencia</legend>{fields.sourceRefs.map((source, index) => <fieldset key={index}><legend>Fuente {index + 1}</legend>
      <label>ID de fuente<input value={source.id} onChange={(event) => sourceChange(index, { ...source, id: event.target.value })} /></label>
      <label>Tipo<select value={source.kind} onChange={(event) => sourceChange(index, { ...source, kind: SourceKindSchema.parse(event.target.value) })}>{SourceKindSchema.options.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label>Referencia y licencia<textarea value={source.reference} onChange={(event) => sourceChange(index, { ...source, reference: event.target.value })} /></label>
      <label>Alcance<textarea value={source.scope} onChange={(event) => sourceChange(index, { ...source, scope: event.target.value })} /></label>
      <label>Incertidumbre<textarea value={source.uncertainty} onChange={(event) => sourceChange(index, { ...source, uncertainty: event.target.value })} /></label>
      <button type="button" onClick={() => change({ ...fields, sourceRefs: fields.sourceRefs.filter((_, position) => position !== index) })}>Quitar fuente {index + 1}</button>
    </fieldset>)}<button type="button" onClick={() => change({ ...fields, sourceRefs: [...fields.sourceRefs, { id: '', kind: 'documentary', reference: '', scope: '', uncertainty: '' }] })}>Agregar fuente</button></fieldset>
    <StringRows label="Vacíos" values={fields.unknowns} disabled={disabled} onChange={(unknowns) => change({ ...fields, unknowns })} />
    <StringRows label="Contradicciones" values={fields.contradictions} disabled={disabled} onChange={(contradictions) => change({ ...fields, contradictions })} />
    <fieldset disabled={disabled}><legend>Referencia visual</legend><label>Avatar del catálogo<select value={currentAvatar} onChange={(event) => change({ ...fields, avatarRef: event.target.value ? { kind: 'catalog-reference', slug: event.target.value } : { kind: 'unbound' } })}><option value="">Sin vincular</option>{avatarSlugs.map((slug) => <option key={slug} value={slug}>{slug}</option>)}</select></label><p>La referencia conserva el recurso del catálogo y su procedencia; no sube archivos ni declara otra licencia.</p></fieldset>
    <fieldset disabled={disabled}><legend>Receta de voz documental</legend><label>Estado<select value={fields.voiceRecipe.kind} onChange={(event) => change({ ...fields, voiceRecipe: event.target.value === 'reviewed' ? { kind: 'reviewed', recipe: '', sourceRefs: [] } : { kind: 'unreviewed' } })}><option value="unreviewed">Sin revisar</option><option value="reviewed">Revisada documentalmente</option></select></label>
      {fields.voiceRecipe.kind === 'reviewed' && <><label>Receta<textarea value={fields.voiceRecipe.recipe} onChange={(event) => { if (fields.voiceRecipe.kind === 'reviewed') change({ ...fields, voiceRecipe: { ...fields.voiceRecipe, recipe: event.target.value } }); }} /></label><StringRows label="IDs de fuentes de voz" values={fields.voiceRecipe.sourceRefs} disabled={disabled} onChange={(sourceRefs) => { if (fields.voiceRecipe.kind === 'reviewed') change({ ...fields, voiceRecipe: { ...fields.voiceRecipe, sourceRefs } }); }} /><p>Usar IDs de las fuentes declaradas arriba. La vista previa valida los vínculos. Esto no crea ni habilita una voz en ElevenLabs.</p></>}
    </fieldset>
  </div>;
}
