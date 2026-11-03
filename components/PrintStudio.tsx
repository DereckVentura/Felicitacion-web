"use client";

import {optimizeImage,IMAGE_PRIVACY_NOTICE} from "@/lib/optimize-image";
import {publicQRUrl} from "@/lib/public-url";
import CommercialSection from "@/components/CommercialSection";
import LegalLinks from "@/components/LegalLinks";
import PreprintBatch from "@/components/PreprintBatch";
import LetterControls from "@/components/LetterControls";
import {defaultOptions} from "@/lib/letter-options";
import GiftView from "@/components/GiftView";
import SampleGiftModal from "@/components/SampleGiftModal";
import CardColorPicker from "@/components/CardColorPicker";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Flower2, Info, LoaderCircle, LockKeyhole, Printer, ScanLine, Save, ImagePlus } from "lucide-react";
import { renderCardSVG, renderPrintHTML, renderQRSVG, validatedLogoDataUrl, type CardTheme } from "@/lib/print-card";

interface Card {
  id: string; storeId: string; storeName: string; recipient: string;
  theme: CardTheme; status: "draft" | "published"; publicPath: string;
  storeLogoUrl?: string | null; storeLogoMode?: "original" | "tinted";
  printColor?: string | null; logoMode?: "original" | "tinted" | "none" | null;
}
const designs: { value: CardTheme; name: string; detail: string; color: string }[] = [
  { value: "rosa", name: "Rosa de papel", detail: "Suave y romántica", color: "#e5b6b1" },
  { value: "olivo", name: "Jardín de olivo", detail: "Natural y serena", color: "#a1af88" },
  { value: "noche", name: "Noche botánica", detail: "Profunda y elegante", color: "#203f34" },
];

function decodeImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error("La imagen tardó demasiado en cargar. Vuelve a intentarlo.")); }, 15000);
    image.onload = () => { clearTimeout(timeout); resolve(); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error("No pudimos preparar la imagen de la tarjeta.")); };
    image.src = source;
  });
}
async function embeddedLogo(blob: Blob): Promise<string> {
  if (blob.size > 3 * 1024 * 1024) throw new Error("La imagen debe pesar como máximo 3 MB.");
  const value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No pudimos leer la imagen."));
    reader.readAsDataURL(blob);
  });
  const validated = validatedLogoDataUrl(value);
  if (!validated) throw new Error("La imagen está vacía.");
  await decodeImage(validated);
  return validated;
}

export default function PrintStudio({ cardId, sample = false }: { cardId?: string; sample?: boolean }) {
  const [sampleOptions,setSampleOptions]=useState(defaultOptions),[sampleVoice,setSampleVoice]=useState<string|null>(null);
  const [sampleOpen,setSampleOpen]=useState(false),[sampleLetter,setSampleLetter]=useState("Un detalle pequeño para recordarte lo especial que eres."),[samplePhotos,setSamplePhotos]=useState<string[]>([]),[imageNotice,setImageNotice]=useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [origin, setOrigin] = useState("");
  const [recipient, setRecipient] = useState("Alguien especial");
  const [theme, setTheme] = useState<CardTheme>("rosa");
  const [svg, setSvg] = useState("");
  const [busy, setBusy] = useState(!sample);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paper, setPaper] = useState<"a4" | "card">("a4");
  const [copies, setCopies] = useState(6);
  const [printColor, setPrintColor] = useState<string | null>(null);
  const [logoMode, setLogoMode] = useState<"original" | "tinted" | "none">("original");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [logoRetry, setLogoRetry] = useState(0);
  const [savedStyle, setSavedStyle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [printing, setPrinting] = useState(false);
  const colorInvalid = false;
  const styleKey = JSON.stringify({ theme, printColor, logoMode });
  const dirty = !sample && savedStyle !== "" && styleKey !== savedStyle;

  useEffect(() => {
    setOrigin(window.location.origin);
    if (sample) {
      setCard({ id: "muestra", storeId: "muestra", storeName: "Floristería · tu marca", recipient: "Alguien especial", theme: "rosa", status: "published", publicPath: "/muestra" });
      return;
    }
    const abort = new AbortController();
    (async () => {
      try {
        const meResponse = await fetch("/api/me", { signal: abort.signal, cache: "no-store" });
        const me = await meResponse.json() as { user: { id: string } | null; role: "owner" | "store" | "visitor"; error?: string };
        if (!meResponse.ok) throw new Error(me.error || "No pudimos comprobar tu acceso.");
        if (!me.user) { setSignedOut(true); return; }
        if (!["owner", "store"].includes(me.role)) throw new Error("Esta tarjeta está disponible únicamente para su tienda y el administrador.");
        const response = await fetch("/api/cards", { signal: abort.signal, cache: "no-store" });
        const data = await response.json() as { cards: Card[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No pudimos cargar tus tarjetas.");
        const found = (data.cards as Card[]).find((item) => item.id === cardId);
        if (!found) throw new Error("No encontramos esta tarjeta entre las de tu tienda.");
        setCard(found); setRecipient(found.recipient || "Alguien especial");
        const loadedTheme = designs.some((design) => design.value === found.theme) ? found.theme : "rosa";
        const loadedColor = found.printColor ?? null;
        const loadedMode = found.logoMode ?? found.storeLogoMode ?? "original";
        setTheme(loadedTheme); setPrintColor(loadedColor); setLogoMode(loadedMode);
        setSavedStyle(JSON.stringify({ theme: loadedTheme, printColor: loadedColor, logoMode: loadedMode }));
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos abrir la tarjeta.");
      } finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => abort.abort();
  }, [cardId, sample]);

  useEffect(() => {
    if (sample || !card?.storeLogoUrl) { if (!sample) setLogoDataUrl(null); return; }
    const abort = new AbortController();
    setLogoLoading(true); setLogoError(""); setLogoDataUrl(null);
    (async () => {
      try {
        const expected = `/api/stores/${encodeURIComponent(card.storeId)}/logo`;
        const parsed = new URL(card.storeLogoUrl!, window.location.origin);
        if (parsed.origin !== window.location.origin || parsed.pathname !== expected) throw new Error("La dirección de la imagen de la tienda no es válida.");
        const response = await fetch(parsed.href, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("No pudimos cargar la imagen de tu tienda. Reintenta o revisa su perfil antes de imprimir.");
        const logo = await embeddedLogo(await response.blob());
        if (!abort.signal.aborted) setLogoDataUrl(logo);
      } catch (cause) {
        if (!abort.signal.aborted) setLogoError(cause instanceof Error ? cause.message : "No pudimos cargar la imagen de la tienda.");
      } finally { if (!abort.signal.aborted) setLogoLoading(false); }
    })();
    return () => abort.abort();
  }, [card?.storeLogoUrl, card?.storeId, logoRetry, sample]);

  const publicUrl = origin && card ? publicQRUrl(card.publicPath, origin) : "";
  const local = origin ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) : false;
  useEffect(() => {
    setSvg("");
    if (!card || !publicUrl || colorInvalid || (logoMode !== "none" && (logoLoading || logoError || (card.storeLogoUrl && !logoDataUrl)))) return;
    let current = true;
    renderCardSVG({ publicUrl, storeName: card.storeName, recipient, theme, sample, printColor, logoMode, logoDataUrl })
      .then((image) => { if (current) setSvg(image); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "No pudimos crear el QR."); });
    return () => { current = false; };
  }, [card, publicUrl, recipient, theme, sample, printColor, logoMode, logoDataUrl, logoLoading, logoError, colorInvalid]);
  const svgUrl = useMemo(() => svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "", [svg]);

  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function printCard() {
    if (!svg) return;
    const popup = window.open("", "_blank", "width=940,height=900");
    if (!popup) { setError("Permite abrir la ventana de impresión para preparar la hoja."); return; }
    setPrinting(true); setError("");
    try {
      popup.document.open(); popup.document.write(renderPrintHTML(svg, { paper, copies })); popup.document.close();
      await decodeImage(svgUrl);
      if (logoMode !== "none" && logoDataUrl) await decodeImage(logoDataUrl);
      if (popup.document.fonts) await popup.document.fonts.ready;
      if (popup.closed) return;
      popup.focus();
      await new Promise<void>(resolve => { popup.requestAnimationFrame(() => { popup.requestAnimationFrame(() => resolve()); }); });
      if (!popup.closed) popup.print();
    } catch (cause) {
      if (!popup.closed) popup.close();
      setError(cause instanceof Error ? cause.message : "No pudimos preparar la impresión.");
    } finally { setPrinting(false); }
  }
  async function saveStyle() {
    if (!card || sample || saving || colorInvalid) return;
    setSaving(true); setSaveNotice(""); setError("");
    const snapshot = { theme, printColor, logoMode };
    try {
      const response = await fetch(`/api/cards/${card.id}/print-style`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No pudimos guardar el diseño.");
      setSavedStyle(JSON.stringify(snapshot));
      setSaveNotice("Diseño guardado para esta tarjeta. No consume créditos.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar el diseño."); }
    finally { setSaving(false); }
  }
  async function uploadLogo(inputFile?: File) {
    if (!inputFile || !card) return;
    setLogoLoading(true); setLogoError("");
    try {
      const file=await optimizeImage(inputFile);
      const data = await embeddedLogo(file);
      setImageNotice(IMAGE_PRIVACY_NOTICE);
      if (!sample) {
        const response = await fetch(`/api/stores/${card.storeId}/logo`, {method:"POST",headers:{"Content-Type":file.type},body:file});
        const result = await response.json() as {store?:{logoUrl:string};error?:string};
        if (!response.ok || !result.store) throw Error(result.error || "No pudimos guardar el logo.");
        setCard(current=>current?{...current,storeLogoUrl:result.store!.logoUrl}:current);
      }
      setLogoDataUrl(data);setLogoMode("original");setSaveNotice("");
    } catch (cause) {setLogoError(cause instanceof Error?cause.message:"No pudimos abrir la imagen.");}
    finally {setLogoLoading(false);}
  }

  async function addSamplePhoto(file?:File){if(!file)return;setLogoError("");try{const optimized=await optimizeImage(file);const data=await embeddedLogo(optimized);setSamplePhotos(current=>[...current,data].slice(0,5));setImageNotice(IMAGE_PRIVACY_NOTICE);}catch(e){setLogoError(e instanceof Error?e.message:"No pudimos preparar la foto.");}}
  async function copyLink() {
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("No pudimos copiar el enlace. Puedes abrirlo y copiarlo desde la barra de dirección."); }
  }

  return <main className="ps">
    <style>{styles}</style>
    <header className="ps-header"><a href="/" className="ps-brand"><Flower2 size={28} strokeWidth={1.2}/><span>ramo<span className="ps-brand-dot">.</span></span></a><a href="/" className="ps-back"><ArrowLeft size={16}/> Volver a mi espacio</a></header>
    <div className="ps-intro"><div><p className="ps-eyebrow">EL ÚLTIMO DETALLE</p><h1>Lista para acompañar<br/><em>algo especial.</em></h1><p className="ps-lead">Una tarjeta compacta, un QR grande y todo lo que quieres decir.<br className="ps-desktop"/> Preparada para imprimir y colocar en el ramo.</p></div><div className="ps-size"><span>65 × 85</span><small>MILÍMETROS · FORMATO TARJETA</small></div></div>
    {sample && <div className="ps-notice"><Info size={18}/><p><strong>Estás viendo una muestra.</strong> Su QR abre esta demostración. Para entregar un regalo real, activa una tarjeta desde tu espacio.</p></div>}
    {local && <div className="ps-notice ps-warning"><Info size={18}/><p><strong>Vista de prueba local.</strong> Este QR apunta a este equipo. Para entregarlo a un cliente, genera e imprime la tarjeta desde el sitio publicado.</p></div>}
    {error && <div role="alert" className="ps-notice ps-error"><Info size={18}/><p>{error}</p></div>}
    {logoError && <div role="alert" className="ps-notice ps-error"><Info size={18}/><div><p>{logoError}</p>{!sample && <button className="ps-text-button" onClick={() => setLogoRetry(value => value + 1)}>Volver a cargar imagen</button>}{sample && <button className="ps-text-button" onClick={() => { setLogoError(""); setLogoDataUrl(null); }}>Continuar sin imagen de muestra</button>}</div></div>}
    {busy ? <section className="ps-loading" aria-live="polite"><LoaderCircle className="ps-spin"/><p>Preparando tu tarjeta…</p></section> : signedOut ? <section className="ps-empty"><LockKeyhole size={32}/><h2>Tu tarjeta está en tu espacio.</h2><p>Inicia sesión con la cuenta de tu tienda para abrirla.</p><a className="ps-button" target="_top" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(`/imprimir/${cardId}`)}`}>Iniciar sesión</a></section> : card ? <div className="ps-studio">
      <section className="ps-preview" aria-label="Vista previa de la tarjeta"><div className="ps-preview-top"><span>VISTA PREVIA</span><span><ScanLine size={14}/> QR vectorial · 46 mm</span></div><div className="ps-card-wrap">{svgUrl ? <img className="ps-card" src={svgUrl} alt={`Tarjeta floral para ${recipient} de ${card.storeName}, con código QR`}/> : <div className="ps-card ps-card-loading"><LoaderCircle className="ps-spin"/></div>}</div><div className="ps-preview-bottom"><span>65 mm</span><span>85 mm de alto</span></div></section>
      <aside className="ps-options">
        <section><p className="ps-step">01 <span>ELIGE EL DISEÑO</span></p><div className="ps-designs">{designs.map((design) => <button key={design.value} type="button" className={`ps-design ${theme === design.value && !printColor ? "ps-selected" : ""}`} onClick={() => { setTheme(design.value); setPrintColor(null); setSaveNotice(""); }} aria-pressed={theme === design.value && !printColor}><span className="ps-swatch" style={{ background: design.color }}><Flower2 size={22} color={design.value === "noche" ? "#eed7bf" : "#fffaf4"} strokeWidth={1}/></span><span><strong>{design.name}</strong><small>{design.detail}</small></span><span className="ps-check">{theme === design.value && !printColor && <Check size={16}/>}</span></button>)}</div><div className="ps-custom-color"><CardColorPicker value={printColor} onChange={value=>{setPrintColor(value);setSaveNotice("");}}/>{printColor && <button type="button" className="ps-text-button" onClick={()=>setPrintColor(null)}>Volver al diseño predeterminado</button>}</div></section>
        <section><p className="ps-step">02 <span>LOGO DE LA FLORISTERÍA</span></p><label className="compact-logo-choice">Logo<select value={logoMode} onChange={e=>{setLogoMode(e.target.value as "original"|"tinted"|"none");setSaveNotice("");}}><option value="original">Imagen original</option><option value="tinted">Solo contorno</option><option value="none">Sin logo</option></select></label>{logoLoading?<p className="ps-hint">Preparando logo…</p>:logoDataUrl?<div className="ps-logo-preview"><img src={logoDataUrl} alt="Logo de la floristería"/><p>{logoMode==='none'?'El logo está guardado, pero no aparecerá en esta tarjeta.':logoMode==='tinted'?'Solo las líneas del logo, sin relleno, en un tono similar al fondo.':'La imagen conserva sus colores originales.'}</p></div>:<p className="ps-hint">Sube el logo de tu floristería para incluirlo en la tarjeta.</p>}<label className="ps-demo-upload"><ImagePlus size={16}/>{logoDataUrl?'Cambiar logo':'Subir logo'}<input disabled={logoLoading} type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void uploadLogo(event.target.files?.[0]);event.target.value="";}}/></label><p className="ps-hint">{sample?'Imagen de prueba, no se guarda.':'La imagen se guarda en el perfil de esta floristería. La opción «Sin logo» solo la oculta en esta tarjeta.'}</p>{!sample&&<a className="ps-text-button" href={`/?profile=${encodeURIComponent(card.storeId)}`}>Editar perfil <ExternalLink size={12}/></a>}</section>
        <section><p className="ps-step">03 <span>UN NOMBRE LO CAMBIA TODO</span></p><label className="ps-label" htmlFor="ps-recipient">¿Para quién es?</label><input className="ps-input" id="ps-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={60} placeholder="Ej. María"/><p className="ps-hint">Este nombre se usa en la tarjeta impresa. No cambia el contenido de la felicitación.</p></section>
        <section><p className="ps-step">04 <span>PREPARA LA IMPRESIÓN</span></p><div className="ps-paper"><button type="button" className={paper === "a4" ? "ps-active" : ""} onClick={() => setPaper("a4")} aria-pressed={paper === "a4"}>Hoja A4</button><button type="button" className={paper === "card" ? "ps-active" : ""} onClick={() => setPaper("card")} aria-pressed={paper === "card"}>Tarjeta individual</button></div>{paper === "a4" ? <label className="ps-count">Copias de la misma tarjeta <select value={copies} onChange={(event) => setCopies(Number(event.target.value))}><option value={1}>1 copia</option><option value={2}>2 copias</option><option value={4}>4 copias</option><option value={6}>6 copias</option></select></label> : <p className="ps-hint">Papel personalizado de 65 × 85 mm. Ideal si tu impresora admite ese formato.</p>}{!sample && <div className="ps-save-design"><button className="ps-button ps-outline" type="button" disabled={saving || colorInvalid || !dirty} onClick={() => void saveStyle()}>{saving ? <LoaderCircle className="ps-spin" size={17}/> : <Save size={17}/>} {saving ? "Guardando…" : "Guardar diseño de esta tarjeta"}</button>{saveNotice && <p className="ps-hint ps-saved" role="status">{saveNotice}</p>}{dirty && <p className="ps-hint">Tienes cambios sin guardar. La vista previa y la impresión usan tu selección actual.</p>}</div>}<button className="ps-button ps-print" type="button" onClick={() => void printCard()} disabled={!svg || printing}>{printing ? <LoaderCircle className="ps-spin" size={18}/> : <Printer size={18}/>} {printing ? "Preparando impresión…" : "Imprimir / guardar PDF"}</button><button className="ps-button ps-outline" type="button" onClick={() => download(svg, `ramo-tarjeta-${sample ? "muestra" : card.id}.svg`)} disabled={!svg}><Download size={17}/> Descargar tarjeta SVG</button><div className="ps-small-actions"><button type="button" onClick={async () => { try { download(await renderQRSVG(publicUrl), `ramo-qr-${sample ? "muestra" : card.id}.svg`); } catch { setError("No pudimos descargar el QR."); } }} disabled={!svg}>Solo el QR</button><span>·</span><button type="button" onClick={copyLink}>{copied ? <><Check size={13}/> Copiado</> : <><Copy size={13}/> Copiar enlace público</>}</button></div></section>
        <div className="ps-print-tip"><Printer size={19}/><p>Imprime al <strong>100 % / tamaño real</strong>, sin encabezados ni pies. Recomendamos cartulina mate y probar el QR con tu teléfono antes de entregar.</p></div>
      </aside>
    </div> : null}
    {sample&&<CommercialSection/>}<LegalLinks/>
    {imageNotice&&<p className="image-privacy-badge" role="status">{imageNotice}</p>}
    {sample&&<><PreprintBatch demo sampleLogo={logoDataUrl} sampleTheme={theme} sampleColor={printColor} sampleLogoMode={logoMode}/><LetterControls value={sampleOptions} onChange={setSampleOptions} photoCount={samplePhotos.length} audioUrl={sampleVoice} onVoice={async blob=>{if(sampleVoice)URL.revokeObjectURL(sampleVoice);setSampleVoice(blob?URL.createObjectURL(blob):null)}}/></>}{sample&&<details className="sample-content"><summary>Probar carta y fotos de la muestra</summary><label className="ps-label">Carta<textarea className="ps-input" maxLength={12000} value={sampleLetter} onChange={e=>setSampleLetter(e.target.value)}/></label><label className="ps-demo-upload">Añadir foto de prueba<input type="file" accept="image/png,image/jpeg,image/webp" disabled={samplePhotos.length>=5} onChange={e=>{void addSamplePhoto(e.target.files?.[0]);e.target.value="";}}/></label><p className="ps-hint">Hasta 5 fotos. Solo se usan en esta muestra; no se guardan en tu cuenta.</p>{samplePhotos.length>0&&<div className="sample-photo-list">{samplePhotos.map((photo,i)=><button type="button" key={i} onClick={()=>setSamplePhotos(old=>old.filter((_,index)=>index!==i))}><img src={photo} alt={`Foto de prueba ${i+1}`}/>Quitar</button>)}</div>}</details>}
    {sampleOpen&&card&&<SampleGiftModal onClose={()=>setSampleOpen(false)}><GiftView card={{recipient,storeName:card.storeName,theme,printColor,options:sampleOptions,audioUrl:sampleVoice}} letter={sampleLetter} photos={samplePhotos.map(url=>({url}))} logoDataUrl={logoMode==='none'?null:logoDataUrl} logoMode={logoMode}/></SampleGiftModal>}
    {card && <div className="ps-after"><div><span className={`ps-status ${card.status === "published" ? "ps-ready" : ""}`}/><p>{sample ? "La muestra no consume créditos." : card.status === "published" ? "La felicitación está publicada y lista para recibir visitas." : "Ya puedes imprimir. El regalo se abrirá cuando el comprador publique su felicitación."}</p></div>{sample?<button className="ps-sample-open" onClick={()=>setSampleOpen(true)}>Abrir muestra <ExternalLink size={14}/></button>:<a href={publicUrl} target="_blank" rel="noreferrer">Probar enlace del QR <ExternalLink size={14}/></a>}</div>}
    <footer className="ps-footer"><span>ramo. <span>Recuerdos que florecen.</span></span><p>El QR permite ver el regalo. El acceso privado de edición nunca se imprime.</p></footer>
  </main>;
}

const styles = `
.ps-custom-color{margin-top:18px;padding-top:17px;border-top:1px dashed #d6dbce}.ps-color-fields{display:flex;align-items:center;gap:10px}.ps-color-fields input[type=color]{appearance:none;width:48px;height:45px;flex:0 0 48px;border:1px solid #c5d0bd;border-radius:6px;padding:3px;background:#fffdf8;cursor:pointer}.ps-color-fields .ps-input{font-family:monospace;letter-spacing:1px}.ps-text-button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:0;color:#546d48!important;text-decoration:underline!important;text-underline-offset:3px;font-size:11px!important;margin-top:12px;cursor:pointer}.ps-logo-preview{display:flex;align-items:center;gap:14px;margin-bottom:14px}.ps-logo-preview img{width:68px;height:58px;object-fit:contain;background:#fffdf8;border:1px solid #d6dbce;border-radius:7px;padding:4px}.ps-logo-preview p{font-size:11px;line-height:1.7;color:#6b7666;margin:0;max-width:230px}.ps-demo-upload{position:relative;display:inline-flex;align-items:center;gap:7px;padding:10px 12px;margin-top:13px;border:1px solid #c5d0bd;border-radius:5px;font-size:11px;cursor:pointer;overflow:hidden}.ps-demo-upload input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}.ps-color-error{font-size:11px;color:#984b42;line-height:1.6}.ps-saved{color:#345c3a!important}.ps-save-design{margin-top:17px}

.ps{--forest:#203f34;--paper:#f7f5ef;--line:#dedfd4;--muted:#747e70;min-height:100vh;background:var(--paper);color:var(--forest);font-family:Arial,Helvetica,sans-serif;padding:0 max(24px,calc((100vw - 1160px)/2)) 24px}.ps *{box-sizing:border-box}.ps a{text-decoration:none;color:inherit}.ps button,.ps input,.ps select{font:inherit}.ps button{cursor:pointer}.ps button:disabled{opacity:.5;cursor:wait}.ps button:focus-visible,.ps a:focus-visible,.ps input:focus-visible,.ps select:focus-visible{outline:3px solid #b78374;outline-offset:4px}.ps-header{height:98px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.ps-brand{display:flex;align-items:center;gap:11px}.ps-brand>span{font-family:Georgia,'Times New Roman',serif;font-size:40px;letter-spacing:-2px}.ps-brand-dot{color:#ae7670}.ps-back{display:flex;align-items:center;gap:8px;font-size:13px;color:#586757!important}.ps-intro{display:flex;justify-content:space-between;align-items:end;padding:52px 0 33px;gap:30px}.ps-eyebrow{font-size:10px;letter-spacing:2.1px;font-weight:700;margin:0 0 17px;color:#81907c}.ps h1{font-family:Georgia,'Times New Roman',serif;font-size:clamp(35px,4vw,53px);font-weight:400;letter-spacing:-1.8px;line-height:1.09;margin:0}.ps h1 em{font-weight:400;color:#92756b}.ps-lead{font-size:14px;color:#6b7666;line-height:1.8;margin:20px 0 0}.ps-size{text-align:right;padding-bottom:7px}.ps-size>span{display:block;font-family:Georgia,serif;font-size:31px;letter-spacing:-1px}.ps-size small{display:block;letter-spacing:1.4px;font-size:8px;margin-top:10px;color:var(--muted)}.ps-notice{display:flex;align-items:flex-start;gap:11px;background:#edf0e6;border:1px solid #d7dfc9;padding:13px 17px;border-radius:7px;margin:0 0 19px;color:#5d6d51}.ps-notice>svg{flex-shrink:0;margin-top:1px}.ps-notice p{font-size:12px;line-height:1.65;margin:0}.ps-warning{background:#fff6e8;border-color:#ebd5ae;color:#866e46}.ps-error{background:#fff0ec;border-color:#e8b3a7;color:#984b42}.ps-studio{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.9fr);gap:54px;align-items:start}.ps-preview{background:#e9ece1;border:1px solid #dbe1d1;border-radius:12px;overflow:hidden}.ps-preview-top,.ps-preview-bottom{display:flex;justify-content:space-between;align-items:center;color:#728069;padding:20px 23px;font-size:9px;letter-spacing:1.3px}.ps-preview-top>span:last-child{display:flex;gap:5px;align-items:center;font-size:10px;letter-spacing:0}.ps-card-wrap{padding:4px 48px 21px;display:flex;justify-content:center}.ps-card{display:block;width:100%;max-width:355px;height:auto;aspect-ratio:65/85;box-shadow:0 14px 30px #384d321c,0 2px 4px #384d3210;transform:rotate(-1.6deg);border-radius:5px;background:#fff9f4}.ps-card-loading{display:grid;place-items:center;min-height:360px}.ps-preview-bottom{border-top:1px solid #dbe1d1;padding:15px 23px;font-size:10px;letter-spacing:.2px}.ps-options>section{padding:0 0 26px;margin-bottom:24px;border-bottom:1px solid var(--line)}.ps-step{display:flex;gap:13px;font-family:Georgia,serif;color:#ac8677;font-size:15px;margin:2px 0 18px}.ps-step>span{font-family:Arial,sans-serif;letter-spacing:1.5px;font-size:9px;font-weight:700;color:#687a61;padding-top:3px}.ps-designs{display:grid;gap:8px}.ps-design{display:flex;align-items:center;gap:12px;text-align:left;background:transparent;border:1px solid #dfe1d7;border-radius:8px;padding:10px 13px;color:var(--forest)}.ps-design.ps-selected{border-color:#73856b;background:#eef1e8}.ps-swatch{height:40px;width:34px;border-radius:4px;display:grid;place-items:center;flex-shrink:0}.ps-design strong{display:block;font-size:12px;font-weight:500}.ps-design small{display:block;font-size:10px;color:var(--muted);margin-top:5px}.ps-check{margin-left:auto;width:20px;display:grid;place-items:center}.ps-label{display:block;font-size:12px;margin-bottom:8px}.ps-input{display:block;width:100%;border:1px solid #d6dbce;border-radius:6px;background:#fffdf8;color:var(--forest);padding:13px 14px;font-size:13px}.ps-hint{font-size:10px;line-height:1.7;color:var(--muted);margin:9px 0 0}.ps-paper{display:flex;gap:5px;padding:4px;border:1px solid #dce0d3;border-radius:7px;background:#ecefe4}.ps-paper button{border:0;padding:11px 7px;font-size:11px;color:#6d7865;background:transparent;border-radius:4px;flex:1}.ps-paper button.ps-active{background:#fffdf7;color:var(--forest);box-shadow:0 1px 5px #203f3410}.ps-count{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;margin:16px 0}.ps-count select{border:1px solid #dce0d3;border-radius:5px;background:#fffdf7;padding:7px;color:var(--forest);font-size:11px}.ps-button{display:flex;justify-content:center;align-items:center;gap:9px;width:100%;border:1px solid var(--forest);border-radius:6px;background:var(--forest);color:#fffaf1!important;font-size:12px;font-weight:500;padding:14px 15px;text-decoration:none}.ps-print{margin-top:17px}.ps-outline{background:transparent;color:var(--forest)!important;border-color:#c5d0bd;margin-top:9px}.ps-small-actions{display:flex;align-items:center;justify-content:center;gap:11px;margin:15px 0 0;color:#87917d;font-size:10px;flex-wrap:wrap}.ps-small-actions button{display:flex;align-items:center;gap:4px;padding:2px;border:0;background:transparent;color:#617255;font-size:10px;text-decoration:underline;text-underline-offset:3px}.ps-print-tip{display:flex;gap:12px;color:#6f7a66}.ps-print-tip>svg{flex-shrink:0;margin-top:3px}.ps-print-tip p{margin:0;font-size:11px;line-height:1.8}.ps-after{display:flex;justify-content:space-between;align-items:center;gap:25px;border:1px solid #dfe2d5;border-radius:8px;padding:19px 22px;margin:35px 0 0;background:#f2f3ea}.ps-after>div{display:flex;align-items:center;gap:10px}.ps-after p{margin:0;font-size:11px;line-height:1.7;color:#6b7862}.ps-status{width:7px;height:7px;background:#c1a272;border-radius:100%;flex-shrink:0}.ps-ready{background:#77926a}.ps-after>a{display:flex;align-items:center;gap:7px;font-size:11px;white-space:nowrap}.ps-footer{display:flex;justify-content:space-between;align-items:center;gap:20px;border-top:1px solid var(--line);padding-top:25px;margin-top:52px}.ps-footer>span{font-family:Georgia,serif;font-size:23px}.ps-footer>span>span{font-family:Arial,sans-serif;font-size:10px;color:#8a927f;margin-left:10px}.ps-footer p{font-size:9px;color:#8a927f;max-width:320px;line-height:1.6;text-align:right;margin:0}.ps-loading,.ps-empty{min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px}.ps-loading p,.ps-empty p{font-size:13px;color:var(--muted)}.ps-empty h2{font-family:Georgia,serif;font-weight:400;font-size:31px;margin:0}.ps-empty .ps-button{max-width:220px}.ps-spin{animation:ps-spin 1s linear infinite}@keyframes ps-spin{to{transform:rotate(360deg)}}
@media(max-width:850px){.ps-studio{gap:28px;grid-template-columns:1fr 1fr}.ps-card-wrap{padding-left:25px;padding-right:25px}.ps-size{display:none}.ps-intro{padding-top:35px}.ps h1{font-size:39px}.ps-after{align-items:start;flex-direction:column;gap:12px}.ps-footer{margin-top:35px}}@media(max-width:620px){.ps{padding:0 20px 24px}.ps-header{height:76px}.ps-brand>span{font-size:33px}.ps-back{font-size:10px;gap:5px}.ps-studio{grid-template-columns:1fr;gap:27px}.ps-intro{padding:31px 0 24px}.ps h1{font-size:37px;letter-spacing:-1.2px}.ps-lead{font-size:12px;margin-top:16px}.ps-desktop{display:none}.ps-eyebrow{font-size:9px;margin-bottom:14px}.ps-card-wrap{padding:0 48px 22px}.ps-card{max-width:280px}.ps-options>section{margin-bottom:23px;padding-bottom:23px}.ps-footer{align-items:start;flex-direction:column;gap:12px}.ps-footer p{text-align:left}.ps-after{padding:16px}.ps-notice{padding:12px}.ps-notice p{font-size:11px}}
`;
