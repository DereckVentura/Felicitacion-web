import { stripImageMetadata } from "./image-safety";
import { env } from "cloudflare:workers";

type User = { id: string; email: string; name: string };
type StoreRow = { id: string; name: string; email: string; user_id: string | null; credits: number; unlimited: number; unlimited_until: number | null; logo_key: string | null; logo_mime: string | null; logo_mode: string; deleted_at: number | null; created_at: number; card_count?: number };
type CardRow = {
  id: string; store_id: string; store_name: string; store_logo_key: string | null; store_logo_mode: string; print_color: string | null; greeting_color: string | null; logo_mode: string | null; deleted_at: number | null; recipient: string; sender: string;
  consent_at:number|null; consent_version:string|null; gift_options:string; audio_key:string|null; activation_hash:string|null; seal_on_publish:number; sealed:number;
  pin_hash: string | null; pin_failures:number; pin_locked_until:number;
  occasion: string; theme: string; status: string; letter: string; edit_hash: string;
  created_by: string; created_at: number; published_at: number | null; photo_count: number;
};
type PhotoRow = { id: string; card_id: string; storage_key: string; mime: string; size: number; created_at: number };
type Context = { user: User | null; role: "owner" | "store" | "visitor"; store: StoreRow | null; setupRequired: boolean };
type Value = string | number | null;
type Body = Record<string, unknown>;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const CARD_SELECT = `SELECT c.*, s.name AS store_name, s.logo_key AS store_logo_key, s.logo_mode AS store_logo_mode,
  (SELECT count(*) FROM photos p WHERE p.card_id = c.id) AS photo_count
  FROM (SELECT * FROM cards WHERE deleted_at IS NULL) c JOIN (SELECT * FROM stores WHERE deleted_at IS NULL) s ON s.id = c.store_id`;
const STORE_SELECT = `SELECT s.*, (SELECT count(*) FROM cards c WHERE c.store_id = s.id AND c.deleted_at IS NULL) AS card_count FROM (SELECT * FROM stores WHERE deleted_at IS NULL) s`;
const ADMIN_EMAIL = "dereckenriquev@gmail.com";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const THEMES = new Set(["rosa", "olivo", "noche"]);

function db(): D1Database {
  if (!env.DB) throw new ApiError(503, "La base de datos todavía no está disponible.");
  return env.DB;
}
function bucket(): R2Bucket {
  if (!env.BUCKET) throw new ApiError(503, "El almacenamiento de fotos todavía no está disponible.");
  return env.BUCKET;
}
async function first<T>(sql: string, ...values: Value[]): Promise<T | null> {
  return db().prepare(sql).bind(...values).first<T>();
}
async function all<T>(sql: string, ...values: Value[]): Promise<T[]> {
  const result = await db().prepare(sql).bind(...values).all<T>();
  return result.results;
}
function response(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: {
    "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
function sameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, "Esta acción debe realizarse desde esta página.");
}
function userFromRequest(request: Request): User | null {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) return null;
  const email = (request.headers.get("oai-authenticated-user-email") || "").trim().toLowerCase();
  let name = request.headers.get("oai-authenticated-user-full-name") || email;
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); } catch { name = email; }
  }
  return { id, email, name };
}
async function context(request: Request): Promise<Context> {
  const user = userFromRequest(request);
  // Dispatch supplies authenticated identity. Historical hosting ownership is not app authorization.
  if (user?.email === ADMIN_EMAIL) {
    const owner = await first<{ user_id: string; email: string }>("SELECT user_id, email FROM app_owner WHERE id = 1");
    return { user, role: "owner", store: null, setupRequired: owner?.user_id !== user.id || owner?.email !== ADMIN_EMAIL };
  }
  const store = user ? await first<StoreRow>(`${STORE_SELECT} WHERE s.user_id = ?`, user.id) : null;
  return { user, role: store ? "store" : "visitor", store, setupRequired: false };
}
async function synchronizeOwner(ctx: Context): Promise<void> {
  const user = requireOwner(ctx);
  await db().prepare(`INSERT INTO app_owner (id, user_id, email, created_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email`)
    .bind(user.id, user.email, Date.now()).run();
}
function requireUser(ctx: Context): User {
  if (!ctx.user) throw new ApiError(401, "Inicia sesión para continuar.");
  return ctx.user;
}
function requireOwner(ctx: Context): User {
  const user = requireUser(ctx);
  if (ctx.role !== "owner") throw new ApiError(403, "Sólo el propietario puede realizar esta acción.");
  return user;
}
function requireManager(ctx: Context): User {
  const user = requireUser(ctx);
  if (ctx.role !== "owner" && ctx.role !== "store") throw new ApiError(403, "Esta cuenta todavía no tiene una tienda asignada.");
  return user;
}
function logoUrl(storeId: string, key: string | null): string | null {
  return key ? `/api/stores/${storeId}/logo?v=${key.split("/").at(-1)}` : null;
}
function logoMode(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (nullable && value === "none") return "none";
  if (value !== "original" && value !== "tinted") throw new ApiError(400, "Elige color original o integrado para la foto.");
  return value;
}
function printColor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new ApiError(400, "Elige un color válido de seis dígitos, por ejemplo #AABBCC.");
  return value.toLowerCase();
}
async function managedStore(storeId: string, ctx: Context): Promise<StoreRow> {
  requireManager(ctx);
  if (ctx.role !== "owner" && storeId !== ctx.store?.id) throw new ApiError(404, "No encontramos esta tienda.");
  const store = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, storeId);
  if (!store) throw new ApiError(404, "No encontramos esta tienda.");
  return store;
}
function storeOut(store: StoreRow) {
  return { id: store.id, name: store.name, email: store.email, credits: store.credits,
    logoUrl: logoUrl(store.id, store.logo_key), logoMode: store.logo_mode || "original",
    unlimited: store.unlimited === 1, unlimitedUntil: store.unlimited_until === null ? null : new Date(store.unlimited_until).toISOString(),
    unlimitedActive: store.unlimited === 1 && (store.unlimited_until === null || store.unlimited_until > Date.now()),
    createdAt: new Date(store.created_at).toISOString(), cardCount: store.card_count || 0 };
}
function cardOut(card: CardRow) {
  return { id: card.id, storeId: card.store_id, storeName: card.store_name,
    storeLogoUrl: logoUrl(card.store_id, card.store_logo_key), storeLogoMode: card.store_logo_mode || "original",
    logoPublicUrl:card.store_logo_key?`/api/gift-logo/${card.id}`:null, legalAccepted:card.consent_version===LEGAL_VERSION, options: JSON.parse(card.gift_options || "{}"), audioUrl:card.audio_key?`/api/audio/${card.id}`:null, sealed:Boolean(card.sealed), pendingActivation:Boolean(card.activation_hash), sealOnPublish:Boolean(card.seal_on_publish), pinProtected: Boolean(card.pin_hash), printColor: card.print_color, greetingColor: card.greeting_color, logoMode: card.logo_mode,
    recipient: card.recipient, sender: card.sender, occasion: card.occasion, theme: card.theme,
    status: card.status, createdAt: new Date(card.created_at).toISOString(),
    publishedAt: card.published_at ? new Date(card.published_at).toISOString() : null,
    photoCount: card.photo_count || 0, publicPath: `/r/${card.id}` };
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string") throw new ApiError(400, `Revisa el campo ${label}.`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max || trimmed.includes("\u0000")) throw new ApiError(400, `Revisa el campo ${label}.`);
  return trimmed;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(400, `Revisa el campo ${label}.`);
  return value;
}
function theme(value: unknown): string {
  if (typeof value !== "string" || !THEMES.has(value)) throw new ApiError(400, "Elige un diseño válido.");
  return value;
}
function email(value: unknown): string {
  const result = text(value, "correo", 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ApiError(400, "Escribe un correo válido.");
  return result;
}
async function boundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new ApiError(413, "El archivo o contenido es demasiado grande.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "El archivo o contenido es demasiado grande."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function jsonBody(request: Request): Promise<Body> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError(415, "Envía los datos como JSON.");
  const bytes = await boundedBytes(request, 40 * 1024);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, "Los datos no son válidos."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "Los datos no son válidos.");
  return parsed as Body;
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
function id(): string { return crypto.randomUUID().replaceAll("-", ""); }
async function tokenHash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
function bearer(request: Request): string {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new ApiError(401, "Este enlace de personalización no es válido.");
  return match[1];
}
async function editorCard(request: Request): Promise<CardRow> {
  const hash = await tokenHash(bearer(request));
  const card = await first<CardRow>(`${CARD_SELECT} WHERE c.edit_hash = ?`, hash);
  if (!card) throw new ApiError(401, "El enlace de personalización caducó o fue reemplazado. Pide uno nuevo a la tienda.");
  if(card.sealed)throw new ApiError(403,"Este sobre está sellado y ya no admite cambios.");
  if(card.activation_hash)throw new ApiError(403,"Activa primero la tarjeta con su código.");
  return card;
}
async function managedCard(cardId: string, ctx: Context): Promise<CardRow> {
  requireManager(ctx);
  const card = await first<CardRow>(`${CARD_SELECT} WHERE c.id = ?`, cardId);
  if (!card || (ctx.role !== "owner" && card.store_id !== ctx.store?.id)) throw new ApiError(404, "No encontramos esta tarjeta.");
  return card;
}
async function photoList(cardId: string) {
  const photos = await all<PhotoRow>("SELECT * FROM photos WHERE card_id = ? ORDER BY created_at, id", cardId);
  return photos.map(photo => ({ id: photo.id, url: `/api/media/${photo.id}` }));
}
function imageMime(bytes: Uint8Array): string {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width > 0 && height > 0 && width <= 10000 && height <= 10000) return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
  if (bytes.length >= 20 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12,16)))) {
    const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    if (declared + 8 === bytes.length) return "image/webp";
  }
  throw new ApiError(415, "La foto debe ser un archivo JPEG, PNG o WebP válido.");
}


function validPin(value:unknown):string{if(typeof value!=="string"||!/^\d{4}$/.test(value))throw new ApiError(400,"El PIN debe tener exactamente 4 dígitos.");return value;}
async function derivePin(pin:string,salt:string):Promise<string>{
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:100000,hash:"SHA-256"},key,256);
 return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashPin(pin:string):Promise<string>{const salt=token();return salt+":"+await derivePin(pin,salt);}
async function pinMatches(pin:string,stored:string):Promise<boolean>{const [salt,expected]=stored.split(":");const actual=await derivePin(pin,salt);let diff=actual.length^expected.length;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
function giftCookieName(cardId:string){return "ramo_gift_"+cardId;}
async function canReadGift(request:Request,card:Pick<CardRow,"id"|"pin_hash"|"edit_hash">):Promise<boolean>{
 if(!card.pin_hash)return true;
 if(request.headers.has("authorization")){try{if(await tokenHash(bearer(request))===card.edit_hash)return true}catch{}}
 const raw=(request.headers.get("cookie")||"").split(";").map(p=>p.trim()).find(p=>p.startsWith(giftCookieName(card.id)+"="))?.split("=")[1];
 if(!raw||!/^[a-f0-9]{64}$/.test(raw))return false;
 return Boolean(await first("SELECT token_hash FROM gift_sessions WHERE token_hash = ? AND card_id = ? AND pin_version = ? AND expires_at > ?",await tokenHash(raw),card.id,card.pin_hash,Date.now()));
}
async function unlockGift(request:Request,card:CardRow):Promise<Response>{
 const now=Date.now();if(card.pin_locked_until>now)return response({error:"Demasiados intentos. Espera antes de volver a intentarlo.",retryAfter:Math.ceil((card.pin_locked_until-now)/1000)},429);
 const body=await jsonBody(request),pin=validPin(body.pin);
 if(!await pinMatches(pin,card.pin_hash!)){
  // One atomic update counts concurrent guesses; after five, the whole gift waits 60 seconds.
  await db().prepare(`UPDATE cards SET pin_locked_until = CASE WHEN (CASE WHEN pin_locked_until > 0 THEN 0 ELSE pin_failures END) + 1 >= 5 THEN ? ELSE 0 END,
    pin_failures = (CASE WHEN pin_locked_until > 0 THEN 0 ELSE pin_failures END) + 1
    WHERE id = ? AND pin_hash = ? AND pin_locked_until <= ?`).bind(now+60000,card.id,card.pin_hash,now).run();
  const updated=await first<{pin_locked_until:number}>("SELECT pin_locked_until FROM cards WHERE id = ?",card.id);
  const retryAfter=Math.max(0,Math.ceil(((updated?.pin_locked_until||0)-now)/1000));return response({error:retryAfter?"Demasiados intentos. Espera 60 segundos.":"El PIN no es correcto.",retryAfter},retryAfter?429:403);
 }
 const session=token(),expires=now+3600000;
 await db().prepare("DELETE FROM gift_sessions WHERE card_id = ? AND expires_at <= ?").bind(card.id,now).run();
 const result=await db().prepare(`INSERT INTO gift_sessions(token_hash,card_id,pin_version,expires_at) SELECT ?,id,pin_hash,? FROM cards WHERE id = ? AND pin_hash = ? AND pin_locked_until <= ? AND deleted_at IS NULL`).bind(await tokenHash(session),expires,card.id,card.pin_hash,now).run();
 if(!result.meta.changes)return response({error:"El acceso cambió o está bloqueado. Inténtalo de nuevo.",retryAfter:60},429);
 await db().prepare("UPDATE cards SET pin_failures = 0, pin_locked_until = 0 WHERE id = ? AND pin_hash = ? AND pin_locked_until <= ?").bind(card.id,card.pin_hash,now).run();
 const res=response({ok:true});res.headers.set("Set-Cookie",`${giftCookieName(card.id)}=${session}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);return res;
}
const LEGAL_VERSION="2026-11-03-v1";
type LegalConfig={legalName:string;address:string;nit:string;phone:string;supportEmail:string;taxMode:string};
const DEFAULT_LEGAL:LegalConfig={legalName:"",address:"",nit:"",phone:"",supportEmail:"dereckenriquev@gmail.com",taxMode:"pending"};
async function legalConfig():Promise<LegalConfig>{const row=await first<{data:string}>("SELECT data FROM legal_settings WHERE id=1");return {...DEFAULT_LEGAL,...(row?JSON.parse(row.data):{})};}
async function consent(body:Body,actor:string,kind:string){if(body.consent!==true)throw new ApiError(400,"Acepta los Términos, el Aviso de Privacidad y confirma tu autorización para las fotografías.");await db().prepare("INSERT INTO legal_consents(id,actor,kind,version,created_at) VALUES(?,?,?,?,?)").bind(id(),actor,kind,LEGAL_VERSION,Date.now()).run();}
type Package = { id: string; name: string; kind: "credits" | "unlimited"; credits: number | null; priceCents: number | null; currency: string; durationDays: number | null; active: boolean };
type PackageRow = { id: string; name: string; kind: string; credits: number | null; price_cents: number | null; currency: string; duration_days: number | null; active: number };
type OrderRow = { id: string; store_id: string; store_name: string; package_id: string; package_name: string; kind: string; credits: number | null; price_cents: number | null; currency: string; duration_days: number | null; status: string; created_at: number; decided_at: number | null; note: string };
const DEFAULT_PACKAGES: readonly Package[] = [
  { id: "pack-10", name: "10 créditos", kind: "credits", credits: 10, priceCents: 1000, currency: "USD", durationDays: null, active: true },
  { id: "pack-25", name: "25 créditos", kind: "credits", credits: 25, priceCents: 2000, currency: "USD", durationDays: null, active: true },
  { id: "pack-50", name: "50 créditos", kind: "credits", credits: 50, priceCents: 3000, currency: "USD", durationDays: null, active: true },
  { id: "pack-100", name: "100 créditos", kind: "credits", credits: 100, priceCents: 5000, currency: "USD", durationDays: null, active: true },
  { id: "unlimited", name: "Ilimitado", kind: "unlimited", credits: null, priceCents: null, currency: "USD", durationDays: null, active: true },
];
const ORDER_SELECT = "SELECT o.*, s.name AS store_name FROM orders o JOIN (SELECT * FROM stores WHERE deleted_at IS NULL) s ON s.id = o.store_id";
async function catalog(includeInactive: boolean): Promise<Package[]> {
  const rows = await all<PackageRow>("SELECT * FROM packages");
  const overrides = new Map(rows.map(row => [row.id, row]));
  return DEFAULT_PACKAGES.map(item => {
    const row = overrides.get(item.id);
    if (!row) return { ...item };
    if (row.kind !== item.kind) throw new ApiError(500, "La configuración del paquete no es válida.");
    return { id: item.id, name: row.name, kind: item.kind, credits: row.credits,
      priceCents: row.price_cents, currency: row.currency, durationDays: row.duration_days, active: row.active === 1 };
  }).filter(item => includeInactive || item.active);
}
function packagePatch(base: Package, body: Body): Package {
  if (body.kind !== undefined && body.kind !== base.kind) throw new ApiError(400, "No se puede cambiar el tipo de un paquete.");
  const name = text(body.name ?? base.name, "nombre del paquete", 100, true);
  const price = Object.hasOwn(body, "priceCents") ? body.priceCents : base.priceCents;
  const priceCents = price === null ? null : number(price, "precio", 0, Number.MAX_SAFE_INTEGER);
  const currency = text(body.currency ?? base.currency, "moneda", 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, "La moneda debe tener tres letras, por ejemplo USD.");
  const active = body.active === undefined ? base.active : body.active;
  if (typeof active !== "boolean") throw new ApiError(400, "Revisa el estado del paquete.");
  const quantity = Object.hasOwn(body, "credits") ? body.credits : base.credits;
  const duration = Object.hasOwn(body, "durationDays") ? body.durationDays : base.durationDays;
  if (base.kind === "credits") {
    if (duration !== null) throw new ApiError(400, "Los paquetes de créditos no tienen un período ilimitado.");
    return { id: base.id, name, kind: base.kind, credits: number(quantity, "créditos", 1, 10000), priceCents, currency, durationDays: null, active };
  }
  if (quantity !== null) throw new ApiError(400, "El plan ilimitado no usa un saldo de créditos ficticio.");
  return { id: base.id, name, kind: base.kind, credits: null, priceCents, currency,
    durationDays: duration === null ? null : number(duration, "duración", 1, 36500), active };
}
function orderOut(order: OrderRow) {
  return { id: order.id, storeId: order.store_id, storeName: order.store_name, packageId: order.package_id,
    packageName: order.package_name, kind: order.kind, credits: order.credits, priceCents: order.price_cents,
    currency: order.currency, durationDays: order.duration_days, status: order.status,
    createdAt: new Date(order.created_at).toISOString(), decidedAt: order.decided_at === null ? null : new Date(order.decided_at).toISOString(), note: order.note };
}
function managerStoreId(ctx: Context, requested: unknown): string {
  requireManager(ctx);
  if (ctx.role === "store") {
    if (requested !== undefined && requested !== null && requested !== ctx.store!.id) throw new ApiError(403, "Sólo puedes gestionar solicitudes de tu tienda.");
    return ctx.store!.id;
  }
  return text(requested, "tienda", 64, true);
}
export async function handleApi(request: Request): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    if (!["GET", "HEAD"].includes(method)) sameOrigin(request);
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const route = parts.join("/");

    if(method==="GET"&&route==="public/catalog")return response({packages:await catalog(false),legal:await legalConfig(),version:LEGAL_VERSION});
    if(method==="GET"&&route==="public/legal")return response({legal:await legalConfig(),version:LEGAL_VERSION});
    if(method==="POST"&&parts[0]==="public"&&parts[2]==="removal-request"&&parts.length===3){
      const card=await first<CardRow>(`${CARD_SELECT} WHERE c.id=?`,parts[1]);if(!card||card.status!=="published")throw new ApiError(404,"Recuerdo no disponible.");if(!await canReadGift(request,card))throw new ApiError(403,"Desbloquea el recuerdo primero.");
      const body=await jsonBody(request),email=text(body.email,"correo de contacto",254,true).toLowerCase(),reason=text(body.reason??"","motivo",1000);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"Indica un correo válido.");
      const requestId=id();await db().prepare("INSERT INTO removal_requests(id,card_id,email,reason,status,created_at) VALUES(?,?,?,?,'pending',?) ON CONFLICT(card_id) DO NOTHING").bind(requestId,card.id,email,reason,Date.now()).run();const row=await first<{id:string}>("SELECT id FROM removal_requests WHERE card_id=?",card.id);return response({reference:row!.id,message:"Solicitud registrada. Verificaremos tu relación con el recuerdo por el correo indicado antes de eliminarlo."},202);
    }
    if(method==="POST"&&parts[0]==="activate"&&parts.length===2){
      const card=await first<CardRow>(`${CARD_SELECT} WHERE c.id = ?`,parts[1]);
      if(!card||!card.activation_hash)throw new ApiError(404,"Esta tarjeta ya fue activada o no existe.");
      const now=Date.now();if(card.pin_locked_until>now)return response({error:"Espera 60 segundos.",retryAfter:Math.ceil((card.pin_locked_until-now)/1000)},429);
      const body=await jsonBody(request),pin=validPin(body.pin);if(body.consent!==true)throw new ApiError(400,"Acepta los Términos y el Aviso de Privacidad.");
      if(!await pinMatches(pin,card.activation_hash)){
       await db().prepare("UPDATE cards SET pin_failures=CASE WHEN pin_locked_until>0 THEN 1 ELSE pin_failures+1 END, pin_locked_until=CASE WHEN (CASE WHEN pin_locked_until>0 THEN 0 ELSE pin_failures END)+1>=5 THEN ? ELSE 0 END WHERE id=? AND activation_hash=? AND pin_locked_until<=?").bind(now+60000,card.id,card.activation_hash,now).run();
       const row=await first<CardRow>("SELECT * FROM cards WHERE id=?",card.id);return response({error:"Código incorrecto.",retryAfter:row!.pin_locked_until>now?60:0},row!.pin_locked_until>now?429:403);
      }
      const edit=token();const changed=await db().prepare("UPDATE cards SET edit_hash=?,activation_hash=NULL,pin_failures=0,pin_locked_until=0,consent_at=?,consent_version=? WHERE id=? AND activation_hash=? AND pin_locked_until<=? AND deleted_at IS NULL").bind(await tokenHash(edit),now,LEGAL_VERSION,card.id,card.activation_hash,now).run();
      if(!changed.meta.changes)throw new ApiError(409,"Este código ya fue utilizado o está bloqueado.");await consent(body,card.id,"activation");return response({editPath:`/personalizar/${edit}`});
    }
    if(method==="GET"&&parts[0]==="gift-logo"&&parts.length===2){
     const card=await first<CardRow>(`${CARD_SELECT} WHERE c.id=?`,parts[1]);if(!card||card.status!=="published"||!card.store_logo_key||!await canReadGift(request,card))throw new ApiError(404,"Imagen no disponible.");
     const store=await first<StoreRow>("SELECT * FROM stores WHERE id=?",card.store_id),object=await bucket().get(card.store_logo_key);if(!object)throw new ApiError(404,"Imagen no disponible.");return new Response(object.body,{headers:{"Content-Type":store!.logo_mime!,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"}});
    }
    if(method==="GET"&&parts[0]==="audio"&&parts.length===2){
     const card=await first<CardRow>(`${CARD_SELECT} WHERE c.id=?`,parts[1]);if(!card||!card.audio_key)throw new ApiError(404,"Audio no disponible.");
     const editor=request.headers.has("authorization")&&await tokenHash(bearer(request))===card.edit_hash;
     if((card.status!=="published"&&!editor)||!await canReadGift(request,card))throw new ApiError(403,"Desbloquea el recuerdo.");
     const object=await bucket().get(card.audio_key);if(!object)throw new ApiError(404,"Audio no disponible.");
     return new Response(object.body,{headers:{"Content-Type":"audio/wav","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"}});
    }
    if (method === "POST" && parts[0] === "public" && parts[2] === "unlock" && parts.length === 3) {
      const card=await first<CardRow>(`${CARD_SELECT} WHERE c.id = ?`,parts[1]);
      if(!card||card.status!=="published")throw new ApiError(404,"No encontramos esta felicitación.");
      if(!card.pin_hash)throw new ApiError(400,"Esta carta no necesita PIN.");
      return await unlockGift(request,card);
    }
    if (method === "GET" && parts[0] === "public" && parts.length === 2) {
      const card = await first<CardRow>(`${CARD_SELECT} WHERE c.id = ?`, parts[1]);
      if (!card) throw new ApiError(404, "No encontramos esta felicitación.");
      if (card.status !== "published") return response({ ready: false, storeName: card.store_name, ...(card.activation_hash?{pendingActivation:true}:{}) });
      if(!await canReadGift(request,card))return response({ready:false,locked:true});
      return response({ ready: true, card: cardOut(card), letter: card.letter, photos: await photoList(card.id) });
    }
    if (method === "GET" && parts[0] === "media" && parts.length === 2) {
      const photo = await first<PhotoRow & { status: string; edit_hash: string; pin_hash:string|null }>(
        "SELECT p.*, c.status, c.edit_hash, c.pin_hash FROM photos p JOIN cards c ON c.id = p.card_id JOIN stores s ON s.id = c.store_id WHERE p.id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL", parts[1]);
      if (!photo) throw new ApiError(404, "No encontramos esta foto.");
      if (photo.status !== "published") {
        const hash = await tokenHash(bearer(request));
        if (hash !== photo.edit_hash) throw new ApiError(404, "No encontramos esta foto.");
      }
      if(!await canReadGift(request,{id:photo.card_id,pin_hash:photo.pin_hash,edit_hash:photo.edit_hash}))throw new ApiError(403,"Desbloquea esta carta con su PIN para ver las fotos.");
      const object = await bucket().get(photo.storage_key);
      if (!object) throw new ApiError(404, "No encontramos esta foto.");
      return new Response(object.body, { headers: { "Content-Type": photo.mime, "Content-Length": String(photo.size),
        "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Referrer-Policy": "no-referrer" } });
    }

    if (parts[0] === "editor") {
      const card = await editorCard(request);
      if (method === "GET" && parts.length === 1) return response({ card: cardOut(card), letter: card.letter, photos: await photoList(card.id) });
      if(method==="POST"&&route==="editor/consent"){
       const body=await jsonBody(request);await consent(body,card.id,"buyer");await db().prepare("UPDATE cards SET consent_at=?,consent_version=? WHERE id=? AND edit_hash=? AND sealed=0").bind(Date.now(),LEGAL_VERSION,card.id,card.edit_hash).run();return response({ok:true,version:LEGAL_VERSION});
      }
      if(method!=="GET"&&card.consent_version!==LEGAL_VERSION)throw new ApiError(428,"Acepta los Términos y el Aviso de Privacidad antes de guardar o subir contenido.");
      if(method==="PATCH"&&route==="editor/options"){
       const body=await jsonBody(request),o=body.options as Record<string,unknown>;
       if(!o||typeof o!=="object")throw new ApiError(400,"Revisa el diseño de carta.");
       const pick=(key:string,allowed:unknown[],fallback:unknown)=>{const value=o[key]??fallback;if(!allowed.includes(value))throw new ApiError(400,"Revisa "+key);return value};
       const captions=Array.isArray(o.captions)?o.captions.map(v=>text(v,"pie de foto",160)).slice(0,5):[];
       const phone=text(o.phone??"","WhatsApp",20);if(phone&&!/^\d{8,15}$/.test(phone))throw new ApiError(400,"WhatsApp debe incluir país y solo números.");
       const options={font:pick("font",["serif","sans","hand"],"serif"),align:pick("align",["left","center","right","justify"],"center"),size:pick("size",[18,22,26,30],26),lineHeight:pick("lineHeight",[1.5,1.8,2.1],1.8),music:pick("music",["none","rosa","olivo","noche","voice"],"none"),captions,phone};
       const result=await db().prepare("UPDATE cards SET gift_options=? WHERE id=? AND edit_hash=? AND sealed=0").bind(JSON.stringify(options),card.id,card.edit_hash).run();if(!result.meta.changes)throw new ApiError(409,"El sobre ya está sellado.");return response({options});
      }
      if(route==="editor/audio"&&(method==="POST"||method==="DELETE")){
       let key:string|null=null;
       if(method==="POST"){
        const bytes=await boundedBytes(request,1500000),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(a:number,b:number)=>new TextDecoder().decode(bytes.slice(a,b));
        if(bytes.length<44||ascii(0,4)!=="RIFF"||ascii(8,12)!=="WAVE"||ascii(12,16)!=="fmt "||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==16000||v.getUint32(28,true)!==32000||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16||ascii(36,40)!=="data"||v.getUint32(40,true)!==bytes.length-44||v.getUint32(4,true)!==bytes.length-8||(bytes.length-44)/32000>45)throw new ApiError(415,"Usa una nota WAV mono de hasta 45 segundos preparada por el editor.");
        key=`voice/${card.id}/${id()}`;await bucket().put(key,bytes,{httpMetadata:{contentType:"audio/wav"}});
       }
       const changed=await db().prepare("UPDATE cards SET audio_key=? WHERE id=? AND edit_hash=? AND sealed=0").bind(key,card.id,card.edit_hash).run();if(!changed.meta.changes){if(key)await bucket().delete(key);throw new ApiError(409,"El sobre ya fue sellado.");}if(card.audio_key)await bucket().delete(card.audio_key);return response({audioUrl:key?`/api/audio/${card.id}`:null});
      }
      if(method === "PATCH" && route === "editor/pin"){
       const body=await jsonBody(request);if(typeof body.enabled!=="boolean")throw new ApiError(400,"Revisa la protección de la carta.");
       const hash=body.enabled?await hashPin(validPin(body.pin)):null;
       const changed=await db().prepare("UPDATE cards SET pin_hash = ?, pin_failures = 0, pin_locked_until = 0 WHERE id = ? AND edit_hash = ? AND sealed=0 AND deleted_at IS NULL").bind(hash,card.id,card.edit_hash).run();
       if(!changed.meta.changes)throw new ApiError(409,"El acceso de edición cambió.");
       await db().prepare("DELETE FROM gift_sessions WHERE card_id = ?").bind(card.id).run();return response({pinProtected:body.enabled});
      }
      if (method === "PATCH" && parts.length === 1) {
        const body = await jsonBody(request);
        const recipient = text(body.recipient, "destinatario", 100, true);
        const sender = text(body.sender ?? "", "remitente", 100);
        const letter = text(body.letter ?? "", "carta", 12000);
        const selectedTheme = theme(body.theme);
        const greetingColor = printColor(Object.hasOwn(body, "greetingColor") ? body.greetingColor : card.greeting_color ?? null);
        const result = await db().prepare(`UPDATE cards SET recipient = ?, sender = ?, letter = ?, theme = ?, greeting_color = ?
          WHERE id = ? AND edit_hash = ? AND sealed=0 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL) AND (status = 'draft' OR length(trim(?)) > 0 OR EXISTS (SELECT 1 FROM photos WHERE card_id = cards.id))`)
          .bind(recipient, sender, letter, selectedTheme, greetingColor, card.id, card.edit_hash, letter).run();
        if (!result.meta.changes) throw new ApiError(409, "Una tarjeta publicada necesita una carta o al menos una foto. Revisa también que tu enlace siga vigente.");
        return response({ ok: true });
      }
      if (method === "POST" && route === "editor/photos") {
        const storage = bucket();
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new ApiError(415, "Selecciona una foto para subir.");
        const upload = await boundedBytes(request, MAX_IMAGE_BYTES + 128 * 1024);
        let form: FormData;
        try { form = await new Response(upload.buffer as ArrayBuffer, { headers: { "content-type": contentType } }).formData(); }
        catch { throw new ApiError(400, "No se pudo leer el archivo."); }
        const file = form.get("file");
        if (!(file instanceof File) || !file.size) throw new ApiError(400, "Selecciona una foto para subir.");
        if (!/^.+\.(png|jpe?g|webp)$/i.test(file.name)) throw new ApiError(415, "Solo se admiten archivos JPG, PNG o WebP.");
        if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "Cada foto debe pesar como máximo 3 MB.");
        let data:Uint8Array;
        try{data=stripImageMetadata(new Uint8Array(await file.arrayBuffer()));}catch{throw new ApiError(415,"La imagen no es válida.");}
        const mime = imageMime(data);
        const declaredMime = file.type.toLowerCase().replace("image/jpg", "image/jpeg");
        if (declaredMime !== mime) throw new ApiError(415, "El formato de la foto no coincide con su contenido.");
        const photoId = id();
        const key = `photos/${card.store_id}/${card.id}/${photoId}`;
        await storage.put(key, data, { httpMetadata: { contentType: mime } });
        try {
          const result = await db().prepare(`INSERT INTO photos (id, card_id, storage_key, mime, size, created_at)
            SELECT ?, id, ?, ?, ?, ? FROM cards WHERE id = ? AND edit_hash = ? AND sealed=0 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL)`)
            .bind(photoId, key, mime, data.byteLength, Date.now(), card.id, card.edit_hash).run();
          if (!result.meta.changes) throw new ApiError(401, "El enlace de personalización fue reemplazado.");
        } catch (error) { await storage.delete(key); throw error; }
        return response({ photo: { id: photoId, url: `/api/media/${photoId}` } }, 201);
      }
      if (method === "DELETE" && parts[1] === "photos" && parts.length === 3) {
        const photo = await first<PhotoRow>("SELECT * FROM photos WHERE id = ? AND card_id = ?", parts[2], card.id);
        if (!photo) throw new ApiError(404, "No encontramos esta foto.");
        const result = await db().prepare(`DELETE FROM photos WHERE id = ? AND card_id = ?
          AND EXISTS (SELECT 1 FROM cards c WHERE c.id = photos.card_id AND c.edit_hash = ? AND c.sealed=0 AND c.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM stores s WHERE s.id = c.store_id AND s.deleted_at IS NULL)
            AND (c.status = 'draft' OR length(trim(c.letter)) > 0 OR EXISTS (SELECT 1 FROM photos other WHERE other.card_id = c.id AND other.id != photos.id)))`)
          .bind(photo.id, card.id, card.edit_hash).run();
        if (!result.meta.changes) throw new ApiError(409, "Una tarjeta publicada necesita una carta o al menos una foto. Revisa también que tu enlace siga vigente.");
        // Once its row is removed the object is no longer retrievable through this API.
        try { await bucket().delete(photo.storage_key); } catch (error) { console.error("Photo object cleanup failed", error); }
        return response({ ok: true });
      }
      if (method === "POST" && route === "editor/publish") {
        const now = Date.now();
        const result = await db().prepare(`UPDATE cards SET status = 'published', published_at = COALESCE(published_at, ?), sealed=seal_on_publish
          WHERE id = ? AND edit_hash = ? AND sealed=0 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL) AND (length(trim(letter)) > 0 OR EXISTS (SELECT 1 FROM photos WHERE card_id = cards.id))`)
          .bind(now, card.id, card.edit_hash).run();
        if (!result.meta.changes) throw new ApiError(400, "Escribe una carta o agrega una foto antes de publicar. Comprueba que tu enlace siga vigente.");
        return response({ ok: true, publicPath: `/r/${card.id}` });
      }
      throw new ApiError(404, "Esta acción no existe.");
    }

    const ctx = await context(request);
    if (!["GET", "HEAD"].includes(method) && ctx.role === "owner") await synchronizeOwner(ctx);
    if(method==="PATCH"&&route==="legal-settings"){
     requireOwner(ctx);const body=await jsonBody(request),legalName=text(body.legalName??"","responsable",160),address=text(body.address??"","domicilio comercial",400),supportEmail=text(body.supportEmail,"correo de soporte",254,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))throw new ApiError(400,"Revisa el correo de soporte.");const taxMode=body.taxMode;if(!["pending","included","not_applicable"].includes(String(taxMode)))throw new ApiError(400,"Revisa el tratamiento tributario.");
     const legal={legalName,address,nit:text(body.nit??"","NIT",30),phone:text(body.phone??"","teléfono comercial",30),supportEmail,taxMode};await db().prepare("INSERT INTO legal_settings(id,data,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify(legal),Date.now()).run();return response({legal});
    }
    if(method==="GET"&&route==="removal-requests"){requireOwner(ctx);return response({requests:await all("SELECT r.*,c.recipient FROM removal_requests r JOIN cards c ON c.id=r.card_id ORDER BY r.created_at DESC")});}
    if(method==="POST"&&parts[0]==="removal-requests"&&parts[2]==="approve"&&parts.length===3){
     requireOwner(ctx);const body=await jsonBody(request);if(body.confirmed!==true)throw new ApiError(400,"Confirma que verificaste al solicitante.");
     const row=await first<{id:string;card_id:string;status:string}>("SELECT * FROM removal_requests WHERE id=?",parts[1]);if(!row)throw new ApiError(404,"Solicitud no disponible.");if(row.status==="done")return response({ok:true});
     const card=await first<CardRow>("SELECT * FROM cards WHERE id=?",row.card_id);if(!card)throw new ApiError(404,"Recuerdo no disponible.");
     await db().batch([db().prepare("UPDATE cards SET deleted_at=COALESCE(deleted_at,?),recipient='Recuerdo eliminado',sender='',letter='',gift_options='{}',pin_hash=NULL,activation_hash=NULL,edit_hash=? WHERE id=?").bind(Date.now(),await tokenHash(token()),card.id),db().prepare("UPDATE removal_requests SET status='processing' WHERE id=?").bind(row.id)]);
     const photos=await all<PhotoRow>("SELECT * FROM photos WHERE card_id=?",card.id);for(const photo of photos)await bucket().delete(photo.storage_key);if(card.audio_key)await bucket().delete(card.audio_key);
     await db().batch([db().prepare("DELETE FROM photos WHERE card_id=?").bind(card.id),db().prepare("DELETE FROM gift_sessions WHERE card_id=?").bind(card.id),db().prepare("UPDATE cards SET audio_key=NULL WHERE id=?").bind(card.id),db().prepare("UPDATE removal_requests SET status='done',email='',reason='',processed_at=? WHERE id=?").bind(Date.now(),row.id)]);return response({ok:true});
    }
    if (method === "GET" && route === "me") return response({ user: ctx.user, role: ctx.role, setupRequired: ctx.setupRequired, store: ctx.store ? storeOut(ctx.store) : null });
    if (method === "POST" && route === "setup") {
      requireOwner(ctx);
      await synchronizeOwner(ctx);
      return response({ ok: true });
    }
    if (method === "GET" && route === "packages") {
      requireManager(ctx);
      return response({ packages: await catalog(ctx.role === "owner") });
    }
    if (method === "PATCH" && parts[0] === "packages" && parts.length === 2) {
      requireOwner(ctx);
      const base = (await catalog(true)).find(item => item.id === parts[1]);
      if (!base) throw new ApiError(404, "No encontramos este paquete.");
      const updated = packagePatch(base, await jsonBody(request));
      await db().prepare(`INSERT INTO packages (id, name, kind, credits, price_cents, currency, duration_days, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, credits = excluded.credits, price_cents = excluded.price_cents,
        currency = excluded.currency, duration_days = excluded.duration_days, active = excluded.active`)
        .bind(updated.id, updated.name, updated.kind, updated.credits, updated.priceCents, updated.currency, updated.durationDays, updated.active ? 1 : 0).run();
      return response({ package: updated });
    }
    if (method === "GET" && route === "orders") {
      requireManager(ctx);
      const filter = url.searchParams.get("storeId");
      if (ctx.role === "store" && filter && filter !== ctx.store!.id) throw new ApiError(403, "Sólo puedes consultar las solicitudes de tu tienda.");
      const storeId = ctx.role === "store" ? ctx.store!.id : filter;
      const rows = storeId ? await all<OrderRow>(`${ORDER_SELECT} WHERE o.store_id = ? ORDER BY o.created_at DESC, o.id`, storeId)
        : await all<OrderRow>(`${ORDER_SELECT} ORDER BY o.created_at DESC, o.id`);
      return response({ orders: rows.map(orderOut) });
    }
    if (method === "POST" && route === "orders") {
      const user = requireManager(ctx);
      const body = await jsonBody(request);
      const storeId = managerStoreId(ctx, body.storeId);
      if (!await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, storeId)) throw new ApiError(404, "No encontramos esta tienda.");
      const product = (await catalog(false)).find(item => item.id === body.packageId);
      if (!product) throw new ApiError(400, "Este paquete no está disponible.");
      const orderId = id();
      await db().prepare(`INSERT INTO orders (id, store_id, package_id, package_name, kind, credits, price_cents, currency, duration_days, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(orderId, storeId, product.id, product.name, product.kind, product.credits, product.priceCents, product.currency, product.durationDays, user.id, Date.now()).run();
      const order = await first<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, orderId);
      return response({ order: orderOut(order!) }, 201);
    }
    if (method === "POST" && parts[0] === "orders" && ["approve", "reject"].includes(parts[2]) && parts.length === 3) {
      const user = requireOwner(ctx);
      const body = await jsonBody(request);
      const note = text(body.note ?? "", "nota", 500);
      let order = await first<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, parts[1]);
      if (!order) throw new ApiError(404, "No encontramos esta solicitud.");
      const decision = parts[2] === "approve" ? "approved" : "rejected";
      if (order.status !== "pending" && order.status !== decision) throw new ApiError(409, "Esta solicitud ya tiene una decisión distinta.");
      if (order.status === "pending") {
        // The schema trigger grants and audits only the winning pending -> approved transition.
        await db().prepare("UPDATE orders SET status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM stores s WHERE s.id = orders.store_id AND s.deleted_at IS NULL)")
          .bind(decision, note, user.id, Date.now(), order.id).run();
        order = await first<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, order.id);
        if (order!.status !== decision) throw new ApiError(409, "Esta solicitud ya tiene una decisión distinta.");
      }
      if (decision === "rejected") return response({ order: orderOut(order!) });
      const store = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, order!.store_id);
      return response({ order: orderOut(order!), store: storeOut(store!) });
    }
    if (parts[0] === "stores" && parts.length === 2 && method === "PATCH") {
      const store = await managedStore(parts[1], ctx);
      const body = await jsonBody(request);
      const name = text(body.name ?? store.name, "nombre de la tienda", 100, true);
      const mode = logoMode(body.logoMode ?? store.logo_mode);
      const result = await db().prepare("UPDATE stores SET name = ?, logo_mode = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(name, mode, store.id).run();
      if (!result.meta.changes) throw new ApiError(404, "No encontramos esta tienda.");
      return response({ store: storeOut((await managedStore(store.id, ctx))) });
    }
    if (parts[0] === "stores" && parts.length === 3 && parts[2] === "logo") {
      const store = await managedStore(parts[1], ctx);
      if (method === "GET") {
        if (!store.logo_key) throw new ApiError(404, "Esta tienda todavía no tiene una foto.");
        const object = await bucket().get(store.logo_key);
        if (!object) throw new ApiError(404, "No encontramos la foto de la tienda.");
        return new Response(object.body, { headers: { "Content-Type": store.logo_mime!, "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "X-Robots-Tag":"noindex, nofollow", "Referrer-Policy": "no-referrer" } });
      }
      if (method === "POST") {
        const raw = await boundedBytes(request, MAX_IMAGE_BYTES);
        let bytes:Uint8Array;try{bytes=stripImageMetadata(raw);}catch{throw new ApiError(415,"La imagen no es válida.");}
        const mime = imageMime(bytes);
        const declared = (request.headers.get("content-type") || "").split(";")[0].toLowerCase().replace("image/jpg", "image/jpeg");
        if (declared !== mime) throw new ApiError(415, "El formato de la foto no coincide con su contenido.");
        const key = `store-logos/${store.id}/${id()}`;
        const storage = bucket();
        await storage.put(key, bytes, { httpMetadata: { contentType: mime } });
        try {
          const result = await db().prepare("UPDATE stores SET logo_key = ?, logo_mime = ? WHERE id = ? AND deleted_at IS NULL AND logo_key IS ?")
            .bind(key, mime, store.id, store.logo_key).run();
          if (!result.meta.changes) throw new ApiError(409, "El perfil cambió. Actualiza la página e inténtalo de nuevo.");
        } catch (error) { await storage.delete(key); throw error; }
        if (store.logo_key) try { await storage.delete(store.logo_key); } catch (error) { console.error("Store logo cleanup failed", error); }
        return response({ store: storeOut(await managedStore(store.id, ctx)) }, 201);
      }
      if (method === "DELETE") {
        const result = await db().prepare("UPDATE stores SET logo_key = NULL, logo_mime = NULL WHERE id = ? AND deleted_at IS NULL AND logo_key IS ?")
          .bind(store.id, store.logo_key).run();
        if (!result.meta.changes) throw new ApiError(409, "El perfil cambió. Actualiza la página e inténtalo de nuevo.");
        if (store.logo_key) try { await bucket().delete(store.logo_key); } catch (error) { console.error("Store logo cleanup failed", error); }
        return response({ store: storeOut(await managedStore(store.id, ctx)) });
      }
    }
    if (method === "DELETE" && parts[0] === "stores" && parts.length === 2) {
      const user = requireOwner(ctx);
      const store = await managedStore(parts[1], ctx);
      const body = await jsonBody(request);
      if (text(body.confirmation, "confirmación", 100, true) !== store.name) throw new ApiError(400, "Escribe el nombre exacto de la tienda para eliminarla.");
      const now = Date.now();
      const result = await db().batch([
        db().prepare("UPDATE stores SET deleted_at = ?, invite_hash = NULL, invite_expires_at = NULL WHERE id = ? AND deleted_at IS NULL").bind(now, store.id),
        db().prepare("INSERT INTO credit_ledger (id, store_id, amount, reason, note, actor_id, created_at) SELECT ?, id, 0, 'store_deleted', 'Eliminada del acceso activo; historial conservado', ?, ? FROM stores WHERE id = ? AND deleted_at = ? AND changes() = 1")
          .bind(id(), user.id, now, store.id, now),
      ]);
      if (!result[0].meta.changes) throw new ApiError(404, "No encontramos esta tienda.");
      return response({ ok: true, deleted: true });
    }
    if (method === "PATCH" && parts[0] === "cards" && parts[2] === "print-style" && parts.length === 3) {
      const card = await managedCard(parts[1], ctx);
      const body = await jsonBody(request);
      const selectedTheme = theme(body.theme ?? card.theme);
      const color = printColor(Object.hasOwn(body, "printColor") ? body.printColor : card.print_color);
      const mode = logoMode(Object.hasOwn(body, "logoMode") ? body.logoMode : card.logo_mode, true);
      const result = await db().prepare("UPDATE cards SET theme = ?, print_color = ?, logo_mode = ? WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL)")
        .bind(selectedTheme, color, mode, card.id).run();
      if (!result.meta.changes) throw new ApiError(404, "No encontramos esta tarjeta.");
      return response({ card: cardOut(await managedCard(card.id, ctx)) });
    }
    if (method === "DELETE" && parts[0] === "cards" && parts.length === 2) {
      const user = requireOwner(ctx);
      const card = await managedCard(parts[1], ctx);
      const body = await jsonBody(request);
      if (text(body.confirmation, "confirmación", 100, true) !== card.recipient) throw new ApiError(400, "Escribe el destinatario exacto para eliminar la felicitación.");
      const now = Date.now();
      const result = await db().batch([
        db().prepare("UPDATE cards SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL)").bind(now, card.id),
        db().prepare("INSERT INTO credit_ledger (id, store_id, amount, reason, note, actor_id, created_at) SELECT ?, store_id, 0, 'card_deleted', ?, ?, ? FROM cards WHERE id = ? AND deleted_at = ? AND changes() = 1")
          .bind(id(), `Felicitación ${card.id}; no reembolsa créditos`, user.id, now, card.id, now),
      ]);
      if (!result[0].meta.changes) throw new ApiError(404, "No encontramos esta tarjeta.");
      return response({ ok: true, deleted: true });
    }
    if (method === "POST" && parts[0] === "stores" && parts[2] === "unlimited" && parts.length === 3) {
      const user = requireOwner(ctx);
      const body = await jsonBody(request);
      if (typeof body.enabled !== "boolean") throw new ApiError(400, "Indica si el plan ilimitado está activo.");
      const duration = body.durationDays === null ? null : number(body.durationDays, "duración", 1, 36500);
      const note = text(body.note ?? "", "nota", 500);
      const store = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, parts[1]);
      if (!store) throw new ApiError(404, "No encontramos esta tienda.");
      const now = Date.now();
      const change = body.enabled
        ? db().prepare(`UPDATE stores SET unlimited_until = CASE
            WHEN unlimited = 1 AND unlimited_until IS NULL THEN NULL
            WHEN ? IS NULL THEN NULL
            ELSE (CASE WHEN unlimited = 1 AND unlimited_until > ? THEN unlimited_until ELSE ? END) + ? * 86400000 END,
            unlimited = 1 WHERE id = ? AND deleted_at IS NULL`).bind(duration, now, now, duration, store.id)
        : db().prepare("UPDATE stores SET unlimited = 0, unlimited_until = NULL WHERE id = ? AND deleted_at IS NULL").bind(store.id);
      await db().batch([
        change,
        db().prepare("INSERT INTO credit_ledger (id, store_id, amount, reason, note, actor_id, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)")
          .bind(id(), store.id, body.enabled ? "unlimited_manual_activation" : "unlimited_manual_revocation", note, user.id, now),
      ]);
      const updated = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, store.id);
      return response({ store: storeOut(updated!) });
    }
    if (method === "GET" && route === "stores") {
      requireOwner(ctx);
      return response({ stores: (await all<StoreRow>(`${STORE_SELECT} ORDER BY s.created_at DESC, s.id`)).map(storeOut) });
    }
    if (method === "POST" && route === "stores") {
      const user = requireOwner(ctx);
      const body = await jsonBody(request);
      const name = text(body.name, "nombre de la tienda", 100, true);
      const contact = email(body.email);
      const customCredits = number(body.credits ?? 0, "créditos", 0, 10000);
      const packageId = body.packageId === undefined || body.packageId === null || body.packageId === "" ? null : text(body.packageId, "paquete", 64, true);
      if (packageId && customCredits) throw new ApiError(400, "Elige un paquete o créditos personalizados, no ambos.");
      const product = packageId ? (await catalog(false)).find(item => item.id === packageId) : null;
      if (packageId && !product) throw new ApiError(400, "Este paquete no está disponible.");
      const note = text(body.note ?? "", "referencia", 250);
      const credits = product?.kind === "credits" ? product.credits! : customCredits;
      const unlimited = product?.kind === "unlimited" ? 1 : 0;
      const storeId = id(), invite = token(), now = Date.now();
      const until = unlimited && product?.durationDays ? now + product.durationDays * 86400000 : null;
      const statements = [db().prepare("INSERT INTO stores (id, name, email, credits, unlimited, unlimited_until, invite_hash, invite_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(storeId, name, contact, credits, unlimited, until, await tokenHash(invite), now + 7 * 86400000, now)];
      if (credits || product) statements.push(db().prepare("INSERT INTO credit_ledger (id, store_id, amount, reason, note, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id(), storeId, credits, product ? "initial_package" : "initial_allocation", product ? JSON.stringify({ package: product, reference: note }) : note, user.id, now));
      await db().batch(statements);
      const store = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, storeId);
      return response({ store: storeOut(store!), invitePath: `/unirse/${invite}` }, 201);
    }
    if (method === "POST" && parts[0] === "stores" && parts[2] === "credits" && parts.length === 3) {
      const user = requireOwner(ctx);
      const body = await jsonBody(request);
      const amount = number(body.amount, "cantidad de créditos", 1, 10000);
      const note = text(body.note ?? "", "nota", 250);
      const existing = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, parts[1]);
      if (!existing) throw new ApiError(404, "No encontramos esta tienda.");
      await db().batch([
        db().prepare("UPDATE stores SET credits = credits + ? WHERE id = ? AND deleted_at IS NULL").bind(amount, existing.id),
        db().prepare("INSERT INTO credit_ledger (id, store_id, amount, reason, note, actor_id, created_at) VALUES (?, ?, ?, 'owner_topup', ?, ?, ?)")
          .bind(id(), existing.id, amount, note, user.id, Date.now()),
      ]);
      const updated = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, existing.id);
      return response({ store: storeOut(updated!) });
    }
    if (method === "POST" && parts[0] === "stores" && parts[2] === "invitation" && parts.length === 3) {
      requireOwner(ctx);
      const invite = token();
      const result = await db().prepare("UPDATE stores SET invite_hash = ?, invite_expires_at = ? WHERE id = ? AND user_id IS NULL AND deleted_at IS NULL")
        .bind(await tokenHash(invite), Date.now() + 7 * 86400000, parts[1]).run();
      if (!result.meta.changes) throw new ApiError(409, "La tienda no existe o ya tiene una cuenta vinculada.");
      return response({ invitePath: `/unirse/${invite}` });
    }
    if (method === "POST" && route === "invitations/redeem") {
      const user = requireUser(ctx);
      if (ctx.role === "owner" || ctx.store) throw new ApiError(409, "Esta cuenta ya tiene acceso. Usa la cuenta de la tienda invitada.");
      const body = await jsonBody(request);
      const invitation = text(body.token, "invitación", 128, true);
      if (!/^[a-f0-9]{64}$/i.test(invitation)) throw new ApiError(400, "La invitación no es válida.");
      const result = await db().prepare(`UPDATE stores SET user_id = ?, invite_hash = NULL, invite_expires_at = NULL
        WHERE invite_hash = ? AND invite_expires_at > ? AND email = ? AND user_id IS NULL AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM stores other WHERE other.user_id = ? AND other.deleted_at IS NULL)`)
        .bind(user.id, await tokenHash(invitation), Date.now(), user.email, user.id).run();
      if (!result.meta.changes) throw new ApiError(403, "La invitación venció, ya se utilizó o pertenece a otro correo. Inicia sesión con el correo invitado.");
      return response({ ok: true });
    }
    if (method === "GET" && route === "cards") {
      requireManager(ctx);
      const requestedStore = url.searchParams.get("storeId");
      if (ctx.role !== "owner" && requestedStore && requestedStore !== ctx.store!.id) throw new ApiError(403, "Sólo puedes consultar las tarjetas de tu tienda.");
      const storeId = ctx.role === "owner" ? requestedStore : ctx.store!.id;
      const cards = storeId ? await all<CardRow>(`${CARD_SELECT} WHERE c.store_id = ? ORDER BY c.created_at DESC, c.id`, storeId)
        : await all<CardRow>(`${CARD_SELECT} ORDER BY c.created_at DESC, c.id`);
      return response({ cards: cards.map(cardOut) });
    }
    if(method==="POST"&&route==="cards/batch"){
      const user=requireManager(ctx),body=await jsonBody(request);if(body.consent!==true)throw new ApiError(400,"Acepta los Términos y el Aviso de Privacidad.");if(ctx.role==="store"&&body.storeId&&body.storeId!==ctx.store!.id)throw new ApiError(403,"Solo puedes crear lotes para tu tienda.");const store=await managedStore(ctx.role==="store"?ctx.store!.id:text(body.storeId,"tienda",64,true),ctx);
      const selectedTheme=theme(body.theme??"rosa"),color=printColor(body.printColor??null),rows=[];const statements=[];
      for(let i=0;i<6;i++){const cardId=id(),random=new Uint32Array(1);crypto.getRandomValues(random);const pin=String(random[0]%10000).padStart(4,"0");const hash=await hashPin(pin);
       statements.push(db().prepare("INSERT INTO cards(id,store_id,recipient,theme,edit_hash,created_by,created_at,print_color,activation_hash,seal_on_publish) VALUES(?,?,?,?,?,?,?,?,?,1)").bind(cardId,store.id,"Para ti",selectedTheme,await tokenHash(token()),user.id,Date.now(),color,hash));rows.push({id:cardId,pin,publicPath:`/r/${cardId}`,storeName:store.name,storeLogoUrl:logoUrl(store.id,store.logo_key),logoMode:store.logo_mode,theme:selectedTheme,printColor:color});}
      await db().batch(statements);await consent(body,user.id,"batch");return response({cards:rows},201);
    }
    if (method === "POST" && route === "cards") {
      const user = requireManager(ctx);
      const body = await jsonBody(request);
      const storeId = ctx.role === "store" ? ctx.store!.id : text(body.storeId, "tienda", 64, true);
      if (ctx.role === "store" && body.storeId && body.storeId !== storeId) throw new ApiError(403, "Sólo puedes crear tarjetas para tu tienda.");
      const store = await first<StoreRow>(`${STORE_SELECT} WHERE s.id = ?`, storeId);
      if (!store) throw new ApiError(404, "No encontramos esta tienda.");
      const recipient = text(body.recipient, "destinatario", 100, true);
      const occasion = text(body.occasion ?? "especial", "ocasión", 80, true);
      const selectedTheme = theme(body.theme ?? "rosa");
      const selectedColor = printColor(body.printColor ?? null);
      const selectedLogoMode = logoMode(body.logoMode ?? null, true);
      if(body.consent!==true)throw new ApiError(400,"Acepta los Términos y el Aviso de Privacidad.");
      const cardId = id(), edit = token();
      // The schema trigger enforces both the balance and its single debit atomically.
      await db().prepare(`INSERT INTO cards (id, store_id, recipient, occasion, theme, edit_hash, created_by, created_at, print_color, logo_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(cardId, storeId, recipient, occasion, selectedTheme, await tokenHash(edit), user.id, Date.now(), selectedColor, selectedLogoMode).run();
      await consent(body,user.id,"creation");
      const card = await first<CardRow>(`${CARD_SELECT} WHERE c.id = ?`, cardId);
      return response({ card: cardOut(card!), editPath: `/personalizar/${edit}` }, 201);
    }
    if (method === "POST" && parts[0] === "cards" && parts[2] === "editor-link" && parts.length === 3) {
      const card = await managedCard(parts[1], ctx);
      if(card.sealed||card.activation_hash)throw new ApiError(403,"No puedes renovar el acceso de una tarjeta pendiente de activación o sellada.");
      const edit = token();
      await db().prepare("UPDATE cards SET edit_hash = ? WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM stores s WHERE s.id = cards.store_id AND s.deleted_at IS NULL)").bind(await tokenHash(edit), card.id).run();
      return response({ editPath: `/personalizar/${edit}` });
    }
    throw new ApiError(404, "Esta acción no existe.");
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, error.status);
    const message = error instanceof Error ? `${error.message} ${String(error.cause || "")}` : String(error);
    if (message.includes("STORE_DELETED") || message.includes("CARD_DELETED")) return response({ error: "La tienda o la felicitación ya no está disponible." }, 404);
    if (message.includes("INSUFFICIENT_CREDITS")) return response({ error: "Esta tienda no tiene créditos disponibles. Solicita una recarga." }, 409);
    if (message.includes("ORDER_ALREADY_DECIDED")) return response({ error: "Esta solicitud ya tiene una decisión distinta." }, 409);
    if (message.includes("PHOTO_LIMIT")) return response({ error: "Puedes agregar hasta cinco fotos por tarjeta." }, 409);
    if (message.includes("UNIQUE constraint")) return response({ error: "Este correo o esta cuenta ya está vinculado. Revisa los datos." }, 409);
    console.error("Ramo API failed", error);
    return response({ error: "No se pudo completar la acción. Inténtalo de nuevo." }, 500);
  }
}
