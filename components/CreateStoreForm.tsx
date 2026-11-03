"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Package, RefreshCw, ShieldCheck } from "lucide-react";

type InitialPlan = { id: string; name: string; kind: "credits" | "unlimited"; credits: number | null; priceCents: number | null; currency: string; durationDays: number | null; active: boolean };
function price(plan: InitialPlan) { return plan.priceCents === null ? "Consultar precio" : `${(plan.priceCents / 100).toFixed(2)} ${plan.currency}`; }

export default function CreateStoreForm({ busy, onBusyChange, onCreated }: { busy: boolean; onBusyChange: (value: boolean) => void; onCreated: (path: string) => Promise<void> }) {
  const [plans, setPlans] = useState<InitialPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setCatalogError("");
    (async () => {
      try {
        const response = await fetch("/api/packages", { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as { packages?: InitialPlan[]; error?: string };
        if (!response.ok || !data.packages) throw new Error(data.error || "No pudimos cargar los planes.");
        setPlans(data.packages.filter(plan => plan.active));
      } catch (cause) { if (!controller.signal.aborted) setCatalogError(cause instanceof Error ? cause.message : "No pudimos cargar los planes."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [reload]);
  const selected = plans.find(plan => plan.id === selection);
  const granting = Boolean(selected) || selection === "custom" && quantity > 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || (granting && !confirmed)) return;
    const values = new FormData(event.currentTarget);
    onBusyChange(true); setError("");
    try {
      if (selection && selection !== "custom" && !selected) throw new Error("Elige un plan disponible.");
      const response = await fetch("/api/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), email: values.get("email"), ...(selected ? { packageId: selected.id } : { credits: selection === "custom" ? quantity : 0 }), note: String(values.get("note") || "").trim(), confirmed: granting && confirmed }) });
      const data = await response.json() as { invitePath?: string; error?: string };
      if (!response.ok || !data.invitePath) throw new Error(data.error || "No pudimos crear la tienda.");
      await onCreated(data.invitePath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos crear la tienda."); }
    finally { onBusyChange(false); }
  }
  return <form onSubmit={event => void submit(event)} className="create-store-form"><fieldset disabled={busy}>
    <p>Crea su espacio y elige el acceso inicial. Después entrega la invitación a la tienda.</p>
    <label className="field-label">NOMBRE DE LA TIENDA<input name="name" placeholder="Ej. Floristería Magnolia" required maxLength={100} autoFocus/></label>
    <label className="field-label">CORREO DE ACCESO<input type="email" name="email" placeholder="hola@tutienda.com" required maxLength={200}/></label>
    <label className="field-label">PLAN O PAQUETE INICIAL<select name="initialPlan" value={selection} onChange={event => { setSelection(event.target.value); setConfirmed(false); }}><option value="">Sin plan · 0 créditos</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {price(plan)}</option>)}<option value="custom">Cantidad personalizada de créditos</option></select></label>
    {loading && <p className="field-hint" role="status">Cargando paquetes disponibles…</p>}
    {catalogError && <div className="create-catalog-error"><p>{catalogError}</p><button className="text-link" type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={13}/>Reintentar</button></div>}
    {selected && <div className="initial-plan-summary"><Package size={22}/><div><strong>{selected.name}</strong><span>{selected.kind === "unlimited" ? selected.durationDays === null ? "Acceso ilimitado sin vencimiento" : `Acceso ilimitado durante ${selected.durationDays} días` : `${selected.credits} créditos para activar tarjetas`}</span><span>{price(selected)}</span></div></div>}
    {selection === "custom" && <label className="field-label">CRÉDITOS INICIALES<input type="number" name="credits" value={quantity} onChange={event => { setQuantity(Number(event.target.value)); setConfirmed(false); }} min={0} max={10000} step={1} required/></label>}
    {granting ? <><label className="field-label">REFERENCIA O MOTIVO<input name="note" required maxLength={250} placeholder="Pago confirmado o cortesía autorizada"/></label><label className="checkbox-label payment-confirmation"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required/><span>Confirmo el pago recibido o autorizo esta asignación inicial. El acceso se activará al crear la tienda.</span></label></> : <p className="field-hint">La tienda podrá solicitar un paquete desde su espacio cuando esté lista.</p>}
    <div className="form-note"><ShieldCheck size={17}/><p>Crear la tienda no realiza ningún cobro. Los pagos se confirman por fuera de Ramo.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="button full-button" disabled={busy || granting && !confirmed}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>}Crear tienda e invitación</button>
  </fieldset></form>;
}
