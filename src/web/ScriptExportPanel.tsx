import React from 'react';
import type { ScriptExportReceipt } from '../domain/script-export.ts';
import { createScriptExportClient, ScriptExportIntentSchema, ScriptExportRejection, type ScriptExportIntent, type ScriptExportClient } from './script-export-client.ts';
import { subscribeToHostSessionReset } from './host-session-reset.ts';

const client = createScriptExportClient();
export function ScriptExportPanel({ runId, commitIndex, api = client }: { runId: string; commitIndex: number; api?: ScriptExportClient }) {
  const [receipt, setReceipt] = React.useState<ScriptExportReceipt | null>(null), [intent, setIntent] = React.useState<ScriptExportIntent | null>(null);
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  const controller = React.useRef<AbortController | null>(null), inFlight = React.useRef(false), epoch = React.useRef(0);
  React.useEffect(() => {
    const current = new AbortController(); controller.current = current; ++epoch.current; inFlight.current = false;
    setReceipt(null); setIntent(null); setBusy(false); setMessage('');
    try { const stored = sessionStorage.getItem(`personajes:script-export:${runId}`); const pending = stored === null ? undefined : ScriptExportIntentSchema.safeParse(JSON.parse(stored)); if (pending?.success && pending.data.runId === runId) setIntent(pending.data); } catch { /* Host receipts remain authoritative. */ }
    const unsubscribe = subscribeToHostSessionReset(() => {
      controller.current?.abort(); controller.current = new AbortController(); ++epoch.current; inFlight.current = false;
      setReceipt(null); setBusy(false); setMessage('La sesión del host cambió. Una exportación pendiente sólo se recupera al pedirlo explícitamente.');
    });
    return () => { unsubscribe(); controller.current?.abort(); controller.current = null; ++epoch.current; };
  }, [runId, api]);
  async function execute(saved: ScriptExportIntent) {
    const current = controller.current; if (current === null || inFlight.current) return;
    const generation = epoch.current; inFlight.current = true; setBusy(true); setIntent(saved); setMessage('Guardando el guion completo del corte confirmado…');
    try { sessionStorage.setItem(`personajes:script-export:${runId}`, JSON.stringify(saved)); } catch { /* Exact intent still survives in this mounted panel. */ }
    try {
      const result = await api.export(saved, current.signal);
      if (current.signal.aborted || generation !== epoch.current) return;
      setReceipt(result); setIntent(null); setMessage('Guion guardado y verificado.');
      try { sessionStorage.removeItem(`personajes:script-export:${runId}`); } catch { /* A later replay remains harmless. */ }
    } catch (error) {
      if (current.signal.aborted || generation !== epoch.current) return;
      if (error instanceof ScriptExportRejection && ![401,403].includes(error.status)) {
        setIntent(null); setMessage('El host rechazó la exportación. Revisá el corte o el archivo existente; no se sobrescribió otro resultado.');
        try { sessionStorage.removeItem(`personajes:script-export:${runId}`); } catch { /* No mutation is retried automatically. */ }
      } else setMessage('La exportación no tiene resultado confirmado. Recuperá la misma operación; si la sesión venció, restablecela desde los controles.');
    } finally { if (generation === epoch.current) { inFlight.current = false; if (!current.signal.aborted) setBusy(false); } }
  }
  return <section aria-label="Exportar guion"><button disabled={busy || intent !== null} onClick={() => void execute(ScriptExportIntentSchema.parse({ runId, commitIndex, idempotencyKey: crypto.randomUUID() }))}>Exportar guion Fountain</button>
    <p>Guarda todos los acontecimientos y emisiones públicas hasta el commit {commitIndex} en docs/output. No llama al modelo ni exporta pensamientos o memoria privada.</p>
    {message && <p role="status">{message}</p>}{intent !== null && !busy && <button onClick={() => void execute(intent)}>Recuperar la misma exportación</button>}
    {receipt !== null && receipt.runId === runId && <><p>Guardado: <strong>{receipt.relativePath}</strong> · commit {receipt.commitIndex} · {receipt.eventCount} eventos · {receipt.communicationCount} comunicaciones · {receipt.narrationCount} narraciones.</p><a href={`/api/v1/runs/${receipt.runId}/script-exports/${receipt.filename}`} download={receipt.filename}>Descargar guion .fountain</a></>}
  </section>;
}
