"use client";
import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";

export type DeleteTarget = { kind: "card" | "store"; id: string; name: string; cardCount?: number };
export default function AdminDeleteDialog({ target, onClose, onDeleted }: { target: DeleteTarget; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [busy, onClose]);
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || (target.kind === "store" && confirmation.trim() !== target.name.trim())) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/${target.kind === "store" ? "stores" : "cards"}/${target.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: target.kind === "card" ? target.name : confirmation.trim() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No pudimos eliminar este elemento.");
      await onDeleted(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos eliminar este elemento."); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><section className="modal-card delete-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" type="button" disabled={busy} aria-label="Cerrar confirmación" onClick={onClose}><X size={21}/></button><span className="modal-icon delete-icon"><Trash2 size={25}/></span><p className="eyebrow">ADMINISTRACIÓN</p><h2 id="delete-dialog-title">{target.kind === "store" ? "Eliminar esta tienda" : "Eliminar esta felicitación"}</h2><p className="delete-target-name">{target.name}</p><div className="delete-impact">{target.kind === "store" ? <><p>La tienda perderá su acceso y sus {target.cardCount ?? 0} tarjetas dejarán de estar disponibles. Los QR y los enlaces de personalización de esas tarjetas dejarán de funcionar.</p><p>Se conserva el historial administrativo. No se devuelven créditos automáticamente.</p></> : <><p>Esta felicitación dejará de estar disponible. Su QR y su enlace de personalización dejarán de funcionar.</p><p>Se conserva el historial administrativo y no se devuelve el crédito utilizado.</p></>}</div><form onSubmit={event => void remove(event)}><fieldset disabled={busy}>{target.kind === "store" && <label className="field-label">ESCRIBE «{target.name}» PARA CONFIRMAR<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" autoFocus required/></label>}{error && <p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-light" type="button" onClick={onClose}>Cancelar</button><button className="button button-reject" disabled={busy || (target.kind === "store" && confirmation.trim() !== target.name.trim())}>{busy ? <LoaderCircle className="spin" size={16}/> : <Trash2 size={16}/>}{target.kind === "store" ? "Eliminar tienda" : "Confirmar eliminación"}</button></div></fieldset></form></section></div>;
}
