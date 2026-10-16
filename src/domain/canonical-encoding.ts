import {z} from 'zod';

/** Stable JSON encoding shared by the host and browser after schema validation. */
export function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=='object'){
    if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Valor no serializable');
    const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Valor no serializable');return encoded;
  }
  if(Array.isArray(value))return `[${Array.from(value,canonicalJson).join(',')}]`;
  const record=z.record(z.string(),z.unknown()).parse(value);
  return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
