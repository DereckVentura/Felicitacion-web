"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {optimizeImage,IMAGE_PRIVACY_NOTICE} from "@/lib/optimize-image";
import { Check, Flower2, ImagePlus, LoaderCircle, Save, Trash2 } from "lucide-react";

export type ProfileStore = { id: string; name: string; email: string; logoUrl: string | null; logoMode: "original" | "tinted" };

async function profileRequest(path: string, options: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json() as { error?: string; store?: ProfileStore };
  if (!response.ok) throw new Error(data.error || "No pudimos guardar el perfil.");
  return data;
}

export default function StoreProfile({ store, onChanged }: { store: ProfileStore; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(store.name);
  const [mode, setMode] = useState<"original" | "tinted">(store.logoMode || "original");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setName(store.name); setMode(store.logoMode || "original"); }, [store.id, store.name, store.logoMode]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function selectFile(value?:File){
    if(!value)return;setBusy(true);setError("");setNotice("");
    try{setFile(await optimizeImage(value));setRemoveImage(false);setNotice(IMAGE_PRIVACY_NOTICE);}
    catch(error){setError(error instanceof Error?error.message:"No pudimos preparar la imagen.");}
    finally{setBusy(false);}
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    let profileSaved = false;
    try {
      await profileRequest(`/api/stores/${store.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), logoMode: mode }) });
      profileSaved = true;
      if (file) await profileRequest(`/api/stores/${store.id}/logo`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      else if (removeImage) await profileRequest(`/api/stores/${store.id}/logo`, { method: "DELETE" });
      await onChanged(); setFile(null); setRemoveImage(false);
      if (input.current) input.current.value = "";
      setNotice("Perfil guardado. Tu nombre e imagen aparecerán al preparar nuevas impresiones.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pudimos guardar los cambios.";
      setError(profileSaved && (file || removeImage) ? `El nombre y el estilo se guardaron. La imagen sigue pendiente: ${message}` : message);
      if (profileSaved) await onChanged();
    } finally { setBusy(false); }
  }

  const image = removeImage ? "" : preview || store.logoUrl || "";
  const changed = name.trim() !== store.name || mode !== store.logoMode || Boolean(file) || removeImage;

  return <section className="store-profile-space">
    <form className="store-profile-form" onSubmit={event => void save(event)}>
      <fieldset disabled={busy}>
        <div className="profile-section-title"><span className="stat-icon"><ImagePlus size={22}/></span><div><h2>Tu marca acompaña cada regalo.</h2><p>El nombre y la imagen de tu floristería, también en la tarjeta impresa.</p></div></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <div className="success-message" role="status"><Check size={17}/>{notice}</div>}
        <div className="profile-image-row">
          <div className="profile-image-preview">{image ? <img src={image} alt={`Imagen de ${name || "tu tienda"}`}/> : <Flower2 size={43} strokeWidth={1.2}/>}</div>
          <div><h3>Imagen de la floristería</h3><p>Sube tu logo o la fotografía que quieres incluir en las tarjetas.</p><input ref={input} id={`profile-image-${store.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="profile-file-input" onChange={event => selectFile(event.target.files?.[0])}/><div className="profile-image-actions"><button className="small-button" type="button" onClick={() => input.current?.click()}><ImagePlus size={15}/>{image ? "Cambiar imagen" : "Elegir imagen"}</button>{image && <button className="small-button danger-link" type="button" onClick={() => { setFile(null); setRemoveImage(Boolean(store.logoUrl)); setNotice(""); if (input.current) input.current.value = ""; }}><Trash2 size={14}/>Quitar imagen</button>}</div><p className="profile-image-hint">JPG, PNG o WebP · entrada de hasta 5 MB · se optimiza a WebP. La imagen conserva sus proporciones.</p>{file && <p className="profile-pending">Imagen elegida · guarda los cambios para aplicarla.</p>}{removeImage && <p className="profile-pending">La imagen se quitará al guardar.</p>}</div>
        </div>
        <label className="field-label">NOMBRE DE LA FLORISTERÍA<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required placeholder="Ej. Floristería Magnolia"/></label>
        <div className="profile-access"><span>Correo de acceso</span><strong>{store.email}</strong><p>El cambio de nombre o imagen conserva el acceso de tu tienda.</p></div>
        <div className="profile-print-choice"><h3>Cómo se verá tu imagen al imprimir</h3><p>Elige el estilo inicial. Puedes cambiarlo para cada tarjeta desde su vista de impresión.</p><div className="profile-mode-options">{[{ value: "original" as const, title: "Color original", text: "Mantiene los colores de tu foto o logo." }, { value: "tinted" as const, title: "Solo contornos · un color", text: "Imprime las líneas del logo en un solo color, con fondo transparente." }].map(option => <label className={`profile-mode ${mode === option.value ? "selected" : ""}`} key={option.value}><input type="radio" name="logoMode" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)}/><span><strong>{option.title}</strong><small>{option.text}</small></span></label>)}</div></div>
        <div className="profile-save"><p>Las tarjetas ya impresas conservan su diseño. Los cambios se verán cuando vuelvas a preparar una impresión.</p><button className="button" disabled={busy || !name.trim() || !changed}>{busy ? <LoaderCircle className="spin" size={17}/> : <Save size={17}/>}Guardar perfil</button></div>
      </fieldset>
    </form>
    <aside className="profile-help"><Flower2 size={30} strokeWidth={1.2}/><h3>Un detalle con identidad.</h3><p>La imagen de tu floristería aparecerá junto al nombre, dejando libre el QR para que siga siendo fácil de escanear.</p><p>Desde <strong>Mis tarjetas → Imprimir</strong> también puedes elegir un color personalizado para cada diseño.</p></aside>
  </section>;
}
