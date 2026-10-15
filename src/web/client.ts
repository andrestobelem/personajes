import { z } from 'zod';
import { CatalogReferenceTargetSchema, type CatalogReferenceQuery } from '../domain/catalog-links.ts';
import {
  ApiProblemSchema, AvatarPageSchema, BOOTSTRAP_META_NAME, CatalogPageSchema, CatalogSearchPageSchema,
  DossierResponseSchema, LibraryPageSchema, SessionCreatedSchema, TextDocumentResponseSchema,
} from '../domain/http.ts';

async function request<T>(input: { path: string; schema: z.ZodType<T>; init?: RequestInit }): Promise<T> {
  const response = await fetch(input.path, { credentials: 'same-origin', ...input.init });
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    throw new Error(problem.success ? problem.data.error.message : 'La solicitud no pudo completarse');
  }
  const parsed = input.schema.safeParse(body);
  if (!parsed.success) throw new Error('La respuesta del servidor no tiene el formato esperado');
  return parsed.data;
}

let session: Promise<z.infer<typeof SessionCreatedSchema>> | undefined;
let reconnecting: Promise<z.infer<typeof SessionCreatedSchema>> | undefined;
/** A directory recovery invalidates HTTP authority. Obtain a fresh one-use nonce;
 * reconnecting never retries the business mutation that initiated recovery. */
export function reconnectSession() {
  if (reconnecting !== undefined) return reconnecting;
  session = undefined;
  const pending = (async () => {
    const response = await fetch('/', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo restablecer la sesión local');
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const nonce = html.querySelector(`meta[name="${BOOTSTRAP_META_NAME}"]`)?.getAttribute('content');
    if (!nonce) throw new Error('El host no ofreció una sesión local nueva');
    const created = await request({ path: '/api/v1/session', schema: SessionCreatedSchema,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) } });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('personajes:host-session-reset'));
    return created;
  })();
  reconnecting = pending;
  session = pending;
  void pending.then(() => { if (reconnecting === pending) reconnecting = undefined; }, () => {
    if (session === pending) session = undefined;
    if (reconnecting === pending) reconnecting = undefined;
  });
  return pending;
}
export function bootstrapSession() {
  if (session === undefined) {
    const nonce = document.querySelector(`meta[name="${BOOTSTRAP_META_NAME}"]`)?.getAttribute('content');
    if (!nonce) return Promise.reject(new Error('Recargá la aplicación para abrir una sesión local'));
    session = request({
      path: '/api/v1/session', schema: SessionCreatedSchema,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootNonce: nonce }) },
    });
  }
  return session;
}

export const readCatalog = () => request({ path: '/api/v1/catalog?limit=100', schema: CatalogPageSchema });
export const searchCharacters = (input: { query: string }) => request({ path: `/api/v1/catalog/search?limit=100&query=${encodeURIComponent(input.query)}`, schema: CatalogSearchPageSchema });
export const readLibrary = () => request({ path: '/api/v1/library?limit=100', schema: LibraryPageSchema });
export const readAvatars = () => request({ path: '/api/v1/avatars?limit=100', schema: AvatarPageSchema });
export const readDossier = (input: { id: string }) => request({ path: `/api/v1/catalog/${encodeURIComponent(input.id)}`, schema: DossierResponseSchema });
export const readDocument = (input: { id: string }) => request({ path: `/api/v1/library/${encodeURIComponent(input.id)}`, schema: TextDocumentResponseSchema });
export const resolveReference = (input: CatalogReferenceQuery) => {
  const query = new URLSearchParams(input);
  return request({ path: `/api/v1/references?${query}`, schema: CatalogReferenceTargetSchema });
};
