import React from 'react';
import { createHumanInteractionClient, captureHumanIntent, HumanRejection, type HumanInteractionClient, type HumanIntent, type SessionDocument } from './human-interaction-client.ts';
import { subscribeToHostSessionReset } from './host-session-reset.ts';
import { reconnectSession } from './client.ts';

const client = createHumanInteractionClient();
const restoreLocalSession = async () => { await reconnectSession(); };
function needsSessionRecovery(error: unknown) {
  return error instanceof HumanRejection && (error.status === 401 || error.status === 403);
}
/** Leaving a fictional role is explicit. It changes only the local session,
 * never the draft, character knowledge, history or running representation. */
export function PreparationSessionPanel({ onReady, api = client, restoreSession = restoreLocalSession }: {
  onReady: () => void;
  api?: Pick<HumanInteractionClient, 'session' | 'mutate'>;
  restoreSession?: () => Promise<void>;
}) {
  const [document, setDocument] = React.useState<SessionDocument | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [intent, setIntent] = React.useState<HumanIntent | null>(null);
  const [sessionRecoveryNeeded, setSessionRecoveryNeeded] = React.useState(false);
  const epoch = React.useRef(0);
  const lifetime = React.useRef(0);
  const inFlight = React.useRef(false);
  const restoring = React.useRef(false);
  const onReadyRef = React.useRef(onReady); onReadyRef.current = onReady;
  async function read() {
    if (inFlight.current) return;
    const current = ++epoch.current;
    try {
      const next = await api.session();
      if (current === epoch.current) setDocument(next);
    } catch (error) {
      if (current === epoch.current) {
        setDocument(null); setMessage('No se pudo consultar el modo de la sesión local.');
        if (needsSessionRecovery(error)) setSessionRecoveryNeeded(true);
      }
    }
  }
  React.useEffect(() => {
    ++lifetime.current; inFlight.current = false; restoring.current = false;
    setDocument(null); setIntent(null); setBusy(false); setMessage(''); setSessionRecoveryNeeded(false);
    void read();
    const unsubscribe = subscribeToHostSessionReset(() => {
      ++epoch.current;
      if (!restoring.current) { inFlight.current = false; setBusy(false); setSessionRecoveryNeeded(false); }
      setDocument(null); setIntent(null);
      setMessage('La sesión local cambió. Consultá su modo antes de continuar.');
    });
    return () => { ++epoch.current; ++lifetime.current; unsubscribe(); };
  }, [api]);
  async function prepare() {
    if (inFlight.current || sessionRecoveryNeeded || (document === null && intent === null)) return;
    const captured = intent ?? (document === null ? null : captureHumanIntent({ kind: 'mode', mode: { kind: 'observer' }, etag: document.etag, key: crypto.randomUUID() }));
    if (captured === null) return;
    const current = ++epoch.current;
    inFlight.current = true; setBusy(true); setIntent(captured); setMessage('Activando preparación…');
    try {
      const result = await api.mutate(captured);
      if (current !== epoch.current) return;
      if (result.kind !== 'mode' || result.document.view.mode.kind !== 'observer') throw new Error('Modo de preparación sin confirmar');
      setDocument(result.document); setIntent(null);
      setMessage('Preparación habilitada. Se vuelven a consultar las fuentes; el borrador se conserva.');
      onReadyRef.current();
    } catch (error) {
      if (current !== epoch.current) return;
      if (error instanceof HumanRejection) {
        setDocument(null);
        if (needsSessionRecovery(error)) {
          setSessionRecoveryNeeded(true);
          setMessage(`${error.message} Restablecé la sesión local; no se repetirá el cambio de modo.`);
        } else {
          setIntent(null);
          setMessage(`${error.message} Consultá de nuevo la sesión antes de cambiar su modo.`);
        }
      } else setMessage('El cambio de modo no tiene resultado confirmado. Recuperá la misma operación.');
    } finally {
      if (current === epoch.current) { inFlight.current = false; setBusy(false); }
    }
  }
  async function restoreConnection() {
    if (inFlight.current) return;
    const mountedLifetime = lifetime.current;
    ++epoch.current; inFlight.current = true; restoring.current = true;
    setBusy(true); setMessage('Restableciendo la sesión local sin repetir cambios de modo…');
    try {
      await restoreSession();
      if (mountedLifetime !== lifetime.current) return;
      // A successful reconnect emits a reset itself. The component lifetime is
      // separate from read epochs so that reset cannot discard this fresh read.
      const current = ++epoch.current;
      const next = await api.session();
      if (mountedLifetime !== lifetime.current || current !== epoch.current) return;
      setDocument(next); setIntent(null); setSessionRecoveryNeeded(false);
      if (next.view.mode.kind === 'observer') {
        setMessage('Sesión restablecida en preparación y observación. Se consultan las fuentes; tu borrador se conserva.');
        onReadyRef.current();
      } else setMessage('Sesión restablecida. Su modo actual requiere salir explícitamente del rol antes de preparar.');
    } catch {
      if (mountedLifetime !== lifetime.current) return;
      setDocument(null); setSessionRecoveryNeeded(true);
      setMessage('No se pudo restablecer y confirmar la sesión local. Podés volver a intentarlo; no se repitió ningún cambio de modo.');
    } finally {
      if (mountedLifetime === lifetime.current) { restoring.current = false; inFlight.current = false; setBusy(false); }
    }
  }
  const mode = document?.view.mode;
  return <section className="draft-section" aria-label="Sesión de preparación">
    <h3>Modo de preparación</h3>
    <p>{mode === undefined ? 'Consultando el modo local…' : mode.kind === 'observer' ? 'La sesión está en modo de preparación y observación.' : mode.kind === 'interlocutor' ? 'Seguís hablando como un personaje de una representación.' : 'La sesión conserva un alcance de Dirección.'}</p>
    {mode?.kind !== 'observer' && <p>Para consultar las fuentes de preparación, salí del rol de la ficción. Esto conserva tu borrador y la historia, sin iniciar ni detener actores.</p>}
    {mode?.kind !== 'observer' && intent === null && <button disabled={busy || document === null || sessionRecoveryNeeded} onClick={() => void prepare()}>Activar modo de preparación</button>}
    <button disabled={busy || intent !== null} onClick={() => void read()}>Consultar modo de sesión</button>
    {intent !== null && <button disabled={busy || sessionRecoveryNeeded} onClick={() => void prepare()}>Recuperar el mismo cambio de modo</button>}
    {(sessionRecoveryNeeded || intent !== null) && <><p>Restablecer la sesión no reenvía cambios de modo ni recupera permisos privados. La edición del borrador permanece abierta.</p><button disabled={busy} onClick={() => void restoreConnection()}>Restablecer sesión local</button></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
