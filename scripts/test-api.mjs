/**
 * Real Ramo request-handler integration checks, using only Node built-ins.
 * Usage: node scripts/test-api.mjs
 * Uses :memory: SQLite and an in-memory R2 adapter; never opens a customer DB.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = path.join(root, "drizzle");
// An explicit test-only SQL path allows backend checks when the build toolchain is unavailable.
// The default always exercises the actual generated production migrations.
const explicitMigration = process.env.RAMO_TEST_MIGRATION;
if (!explicitMigration) {
  const sqlFiles = (await readdir(migrationsDirectory)).filter(name => name.endsWith(".sql"));
  assert.ok(sqlFiles.every(name => /^\d{4}_.*\.sql$/.test(name)), "Keep only journaled numeric migrations in drizzle; staging SQL files would be applied twice by hosting.");
}
const migrationFiles = explicitMigration
  ? [path.resolve(root, explicitMigration)]
  : (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort().map(name => path.join(migrationsDirectory, name));
const migrations = migrationFiles.map(filename => path.basename(filename));
if (!migrationFiles.length) {
  throw new Error("Generate the numeric Drizzle schema migration with its credit/photo triggers before running API checks. For isolated fallback checks only, set RAMO_TEST_MIGRATION to the test SQL file.");
}
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");
let upgradeFixture = false;
for (let index = 0; index < migrationFiles.length; index++) {
  sqlite.exec(await readFile(migrationFiles[index], "utf8"));
  if (index === 0 && migrationFiles.length > 1) {
    // Isolated upgrade fixture: real existing records before the NEW migration is applied.
    sqlite.exec(`INSERT INTO app_owner (id, user_id, email, created_at) VALUES (1, 'legacy-owner-fixture', 'lovosdavid@gmail.com', 1);
      INSERT INTO stores (id, name, email, credits, created_at) VALUES ('legacy-store', 'Legacy store', 'legacy-store@example.test', 2, 1);
      INSERT INTO cards (id, store_id, recipient, letter, status, edit_hash, created_by, created_at, published_at)
      VALUES ('legacy-card', 'legacy-store', 'Legacy recipient', 'Preserved legacy letter', 'published', 'legacy-edit-hash', 'legacy-owner-fixture', 1, 1);`);
    upgradeFixture = true;
  }
}
if (upgradeFixture) {
  const legacy = sqlite.prepare("SELECT credits, unlimited, unlimited_until FROM stores WHERE id = 'legacy-store'").get();
  assert.equal(legacy.credits, 1, "Upgrade preserves existing finite credit balance.");
  assert.equal(legacy.unlimited, 0, "Upgrade does not grant unlimited to existing stores.");
  assert.equal(legacy.unlimited_until, null, "Upgrade adds a nullable plan expiry.");
  assert.equal(sqlite.prepare("SELECT letter FROM cards WHERE id = 'legacy-card'").get().letter, "Preserved legacy letter", "Upgrade preserves existing card content.");
  assert.equal(sqlite.prepare("SELECT sum(amount) AS n FROM credit_ledger WHERE store_id = 'legacy-store'").get().n, -1, "Upgrade preserves existing debit history.");
  console.log("PASS populated 0000 -> latest migration upgrade: existing store/card/balance/ledger preserved.");
}
if (!sqlite.prepare("SELECT id FROM app_owner WHERE id = 1").get()) {
  sqlite.prepare("INSERT INTO app_owner (id, user_id, email, created_at) VALUES (1, 'legacy-owner-fixture', 'lovosdavid@gmail.com', 1)").run();
}
if (explicitMigration) console.log(`TEST-ONLY explicit SQL: ${path.basename(explicitMigration)}; this does not verify a generated production migration.`);
const triggers = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map(row => row.name));
assert(triggers.has("cards_debit_credit") && triggers.has("photos_limit"), "Append the credit/photo triggers to the generated migration before testing.");

class PreparedStatement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new PreparedStatement(this.sql, values); }
  async first(column) {
    const row = sqlite.prepare(this.sql).get(...this.values) ?? null;
    return column && row ? row[column] : row;
  }
  async all() {
    const results = sqlite.prepare(this.sql).all(...this.values);
    return { success: true, results, meta: { changes: 0 } };
  }
  execute() {
    const result = sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() { return this.execute(); }
}
const testDb = {
  prepare(sql) { return new PreparedStatement(sql); },
  async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.execute());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const objects = new Map();
const testBucket = {
  async put(key, data, options) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data).slice() : new Uint8Array(data).slice();
    objects.set(key, { bytes, options });
    return { key, size: bytes.byteLength };
  },
  async get(key) {
    const item = objects.get(key);
    if (!item) return null;
    return { body: new Blob([item.bytes]).stream(), size: item.bytes.byteLength, key };
  },
  async delete(key) { objects.delete(key); },
};
globalThis.__ramoApiTestEnv = { DB: testDb, BUCKET: testBucket };
const sourcePath = path.join(root, "lib", "server.ts");
let source = await readFile(sourcePath, "utf8");
const envImport = /^import\s+\{\s*env\s*\}\s+from\s+["']cloudflare:workers["'];?\s*$/m;
assert(envImport.test(source), "Expected the actual cloudflare:workers env import in lib/server.ts.");
// This is the sole source substitution: actual validation and authorization stay intact.
source = source.replace(envImport, "const env = globalThis.__ramoApiTestEnv;");
const imageSource=stripTypeScriptTypes(await readFile(path.join(root,"lib","image-safety.ts"),"utf8"),{mode:"strip"});
source=source.replace('"./image-safety"',JSON.stringify(`data:text/javascript;base64,${Buffer.from(imageSource).toString("base64")}`));
const javascript = stripTypeScriptTypes(source, { mode: "transform", sourceUrl: sourcePath });
const { handleApi } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const base = "https://ramo.example.test";
const owner = { id: "owner-fixture", email: "dereckenriquev@gmail.com", name: "Dueño Ramo" };
const oldOwner = { id: "legacy-owner-fixture", email: "lovosdavid@gmail.com", name: "Anterior propietario de hosting" };
const storeAUser = { id: "shop-a-fixture", email: "A@EXAMPLE.TEST", name: "Tienda A" };
const storeBUser = { id: "shop-b-fixture", email: "b@example.test", name: "Tienda B" };
const visitor = { id: "visitor-fixture", email: "visitor@example.test", name: "Visitante" };
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
let assertions = 0;
function check(value, message) { assertions++; assert(value, message); }
function status(result, expected, label) {
  assertions++;
  assert.equal(result.status, expected, `${label}: ${JSON.stringify(result.body)}`);
  return result.body;
}
function tokenFrom(pathname) { return pathname.split("/").at(-1); }
async function call(endpoint, { method = "GET", user, token, cookie, json, form, bytes, mime = "image/png", origin = base, skipConsent=false } = {}) {
  const headers = new Headers();
  if (user) {
    headers.set("oai-authenticated-user-id", user.id);
    headers.set("oai-authenticated-user-email", user.email);
    headers.set("oai-authenticated-user-full-name", encodeURIComponent(user.name));
    headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  }
  if (cookie) headers.set("Cookie",cookie);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!["GET", "HEAD"].includes(method) && origin !== null) headers.set("Origin", origin);
  // Existing scenarios accept through the real endpoint, as the current editor does.
  // Explicit Phase 3 refusal tests opt out and exercise the server rejection directly.
  if(!skipConsent&&method!=="GET"&&/^editor(?:\/|$)/.test(endpoint)&&endpoint!=="editor/consent"&&token){await handleApi(new Request(`${base}/api/editor/consent`,{method:"POST",headers:{Authorization:`Bearer ${token}`,Origin:origin||base,"Content-Type":"application/json"},body:JSON.stringify({consent:true})}));}
  if(!skipConsent&&method==="POST"&&(endpoint==="cards"||endpoint==="cards/batch"||endpoint.startsWith("activate/")))json={consent:true,...json};
  let body;
  if (json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(json); }
  else if (form) body = form;
  else if (bytes) { headers.set("Content-Type", mime); body = bytes; }
  const result = await handleApi(new Request(`${base}/api/${endpoint}`, { method, headers, body }));
  const contentType = result.headers.get("content-type") || "";
  return { status: result.status, headers: result.headers,
    body: contentType.includes("application/json") ? await result.json() : Buffer.from(await result.arrayBuffer()) };
}
function pngForm(name = "recuerdo.png") {
  const form = new FormData();
  form.set("file", new File([tinyPng], name, { type: "image/png" }));
  return form;
}
function balance(storeId) { return sqlite.prepare("SELECT credits FROM stores WHERE id = ?").get(storeId).credits; }
function cardCount(storeId) { return sqlite.prepare("SELECT count(*) AS n FROM cards WHERE store_id = ?").get(storeId).n; }

try {
  let result = await call("me");
  let data = status(result, 200, "anonymous identity");
  check(data.user === null && data.role === "visitor" && !data.setupRequired, "Anonymous visitor cannot inherit a role.");
  status(await call("setup", { method: "POST" }), 401, "anonymous bootstrap denied");
  status(await call("setup", { method: "POST", user: owner, origin: "https://elsewhere.example" }), 403, "cross-origin bootstrap denied");
  status(await call("setup", { method: "POST", user: owner, origin: null }), 403, "missing Origin denied");
  data = status(await call("me", { user: oldOwner }), 200, "legacy hosting owner identity");
  check(data.role === "visitor" && !data.setupRequired, "Historical app_owner user ID does not authorize a different email or expose bootstrap.");
  status(await call("stores", { user: oldOwner }), 403, "legacy hosting owner denied application admin");
  status(await call("setup", { method: "POST", user: oldOwner }), 403, "legacy hosting owner cannot reclaim admin");
  status(await call("setup", { method: "POST", user: visitor, json: { email: owner.email, role: "owner" } }), 403, "body email/role cannot spoof admin identity");
  data = status(await call("me", { user: { ...oldOwner, email: `${owner.email}.attacker.test` } }), 200, "similar email rejected");
  check(data.role === "visitor", "Admin email requires an exact normalized match.");
  data = status(await call("me", { user: { ...owner, id: "" } }), 200, "email without authenticated user ID");
  check(data.user === null && data.role === "visitor", "An email alone is not an authenticated identity.");
  data = status(await call("me", { user: { ...owner, email: owner.email.toUpperCase() } }), 200, "target admin immediately recognized");
  check(data.role === "owner", "Target verified identity has immediate application admin access.");
  check(sqlite.prepare("SELECT user_id FROM app_owner WHERE id = 1").get().user_id === oldOwner.id, "Read-only identity checks never modify owner metadata.");
  if (upgradeFixture) {
    data = status(await call("public/legacy-card"), 200, "anonymous pre-upgrade published gift");
    check(data.ready && data.letter === "Preserved legacy letter", "Existing recipient content survives and is anonymously readable.");
  }
  status(await call("setup", { method: "POST", user: owner }), 200, "owner bootstrap");
  status(await call("setup", { method: "POST", user: visitor }), 403, "owner cannot be replaced");
  data = status(await call("me", { user: owner }), 200, "owner identity");
  check(data.role === "owner" && !data.setupRequired && data.user.name === owner.name, "Owner identity and percent-encoded display name are read from actual platform headers.");
  status(await call("stores"), 401, "anonymous store list denied");
  status(await call("stores", { user: visitor }), 403, "unassigned store list denied");
  status(await call("stores", { method: "POST", user: visitor, json: { name: "No", email: "no@example.test", credits: 99 } }), 403, "visitor cannot provision credits");

  const a = status(await call("stores", { method: "POST", user: owner, json: { name: "Tienda A", email: "a@example.test", credits: 1 } }), 201, "create store A");
  const b = status(await call("stores", { method: "POST", user: owner, json: { name: "Tienda B", email: "b@example.test", credits: 2 } }), 201, "create store B");
  check(a.store.credits === 1 && b.store.credits === 2, "Only explicitly allocated credits exist.");
  const inviteA = tokenFrom(a.invitePath), inviteB = tokenFrom(b.invitePath);
  const storedInvite = sqlite.prepare("SELECT invite_hash FROM stores WHERE id = ?").get(a.store.id).invite_hash;
  check(storedInvite !== inviteA && storedInvite.length === 64, "Invitation capabilities are stored hashed.");
  status(await call("invitations/redeem", { method: "POST", user: visitor, json: { token: inviteA } }), 403, "invitation email binding");
  status(await call("invitations/redeem", { method: "POST", user: storeAUser, json: { token: inviteA } }), 200, "redeem store A invitation");
  status(await call("invitations/redeem", { method: "POST", user: storeAUser, json: { token: inviteA } }), 409, "already-assigned account cannot redeem twice");
  status(await call("invitations/redeem", { method: "POST", user: { ...storeAUser, id: "second-same-email" }, json: { token: inviteA } }), 403, "used invitation cannot assign another account");
  status(await call("invitations/redeem", { method: "POST", user: storeBUser, json: { token: inviteB } }), 200, "redeem store B invitation");
  data = status(await call("me", { user: storeAUser }), 200, "store A membership");
  check(data.role === "store" && data.store.id === a.store.id && data.store.credits === 1, "Store membership comes from DB, not supplied browser state.");
  status(await call("stores", { user: storeAUser }), 403, "store cannot list other stores");
  status(await call(`stores/${a.store.id}/credits`, { method: "POST", user: storeAUser, json: { amount: 100 } }), 403, "store cannot self-topup");
  status(await call(`cards?storeId=${b.store.id}`, { user: storeAUser }), 403, "cross-store card filter denied");
  status(await call("cards", { method: "POST", user: storeAUser, json: { storeId: b.store.id, recipient: "Ajeno", theme: "rosa" } }), 403, "cross-store card creation denied");
  check(balance(a.store.id) === 1 && balance(b.store.id) === 2, "Rejected cross-store writes do not alter balances.");

  const createdA = status(await call("cards", { method: "POST", user: storeAUser, json: { recipient: "Ana", occasion: "cumpleaños", theme: "olivo" } }), 201, "activate one-credit card A");
  const createdB = status(await call("cards", { method: "POST", user: storeBUser, json: { recipient: "Bruno", occasion: "especial", theme: "noche" } }), 201, "activate card B");
  const cardA = createdA.card, cardB = createdB.card;
  let editorA = tokenFrom(createdA.editPath);
  const editorB = tokenFrom(createdB.editPath);
  check(balance(a.store.id) === 0 && balance(b.store.id) === 1, "Each successful activation consumes exactly one credit.");
  const storedEditor = sqlite.prepare("SELECT edit_hash FROM cards WHERE id = ?").get(cardA.id).edit_hash;
  check(storedEditor !== editorA && storedEditor.length === 64, "Editor capability is stored hashed.");
  status(await call("cards", { method: "POST", user: storeAUser, json: { recipient: "Sin saldo", theme: "rosa" } }), 409, "zero balance activation denied");
  check(cardCount(a.store.id) === 1 && balance(a.store.id) === 0, "A rejected activation rolls back its card and credit debit.");
  check(sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE card_id = ? AND amount = -1").get(cardA.id).n === 1, "Card activation has one ledger debit.");
  const listedA = status(await call("cards", { user: storeAUser }), 200, "own card list");
  check(listedA.cards.length === 1 && listedA.cards[0].id === cardA.id, "Store listing cannot leak another store's card.");
  check(!("letter" in listedA.cards[0]) && !("photos" in listedA.cards[0]) && !JSON.stringify(listedA).includes(editorA), "Management summaries exclude letters, photos and editor capabilities.");
  status(await call(`cards/${cardA.id}/editor-link`, { method: "POST", user: storeBUser }), 404, "cross-store editor recovery denied");

  data = status(await call(`public/${cardA.id}`), 200, "unpublished public card");
  check(data.ready === false && Object.keys(data).sort().join(",") === "ready,storeName", "Draft response contains neither letter, photos nor recipient.");
  status(await call("editor"), 401, "missing editor capability denied");
  status(await call("editor", { token: "0".repeat(64) }), 401, "wrong editor capability denied");
  data = status(await call("editor", { token: editorA }), 200, "authorized buyer editor");
  check(data.card.id === cardA.id && data.photos.length === 0, "Editor capability resolves exactly its card.");
  status(await call("editor/publish", { method: "POST", token: editorA }), 400, "empty card cannot publish");
  status(await call("editor", {method:"PATCH",token:editorA,json:{recipient:"Ana",sender:"",letter:"",theme:"rosa",greetingColor:"#ABCDEF"}}),200,"custom greeting color");
  data=status(await call("editor",{token:editorA}),200,"reload greeting color");
  check(data.card.greetingColor === "#abcdef", "Greeting override is persistent.");
  status(await call("editor", {method:"PATCH",token:editorA,json:{recipient:"Ana",sender:"",letter:"",theme:"rosa",greetingColor:null}}),200,"restore card color inheritance");
  data=status(await call("editor",{token:editorA}),200,"reload inherited color");
  check(data.card.greetingColor === null, "Greeting follows print color by default.");

  status(await call("editor", { method: "PATCH", token: editorA, origin: "https://evil.example", json: { recipient: "Changed", sender: "", letter: "No", theme: "rosa" } }), 403, "editor writes require matching Origin");
  status(await call("editor", { method: "PATCH", token: editorA, json: { recipient: "Ana", sender: "Dereck", letter: "Carta privada de A <script>literal</script>", theme: "olivo" } }), 200, "edit buyer letter");
  data = status(await call(`public/${cardA.id}`), 200, "draft with private letter");
  check(!("letter" in data) && !JSON.stringify(data).includes("Carta privada"), "Saving a draft never publishes its letter.");

  const fake = new FormData();
  fake.set("file", new File(["not really an image"], "pretend.png", { type: "image/png" }));
  status(await call("editor/photos", { method: "POST", token: editorA, form: fake }), 415, "fake image rejected by signature");
  status(await call("editor/photos",{method:"POST",token:editorA,form:pngForm("disfraz.html")}),415,"unsafe filename rejected despite valid raster signature");
  const noMime=new FormData();noMime.set("file",new File([tinyPng],"sin-tipo.png"));
  status(await call("editor/photos",{method:"POST",token:editorA,form:noMime}),415,"missing image MIME rejected");
  const large = new FormData();
  large.set("file", new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
  status(await call("editor/photos", { method: "POST", token: editorA, form: large }), 413, "oversized image rejected");
  check(objects.size === 0, "Rejected images do not reach R2.");
  const uploaded = [];
  for (let index = 0; index < 5; index++) {
    const uploadedPhoto = status(await call("editor/photos", { method: "POST", token: editorA, form: pngForm(`photo-${index}.png`) }), 201, `valid PNG upload ${index + 1}`);
    uploaded.push(uploadedPhoto.photo);
  }
  status(await call("editor/photos", { method: "POST", token: editorA, form: pngForm("sixth.png") }), 409, "sixth photo rejected atomically");
  check(objects.size === 5 && sqlite.prepare("SELECT count(*) AS n FROM photos WHERE card_id = ?").get(cardA.id).n === 5, "Photo quota rejection also cleans its unreferenced R2 upload.");
  const photoId = uploaded[0].id;
  status(await call(`media/${photoId}`), 401, "anonymous draft photo denied");
  status(await call(`media/${photoId}`, { token: editorB }), 404, "other card capability cannot read draft media");
  result = await call(`media/${photoId}`, { token: editorA });
  status(result, 200, "buyer draft photo");
  check(result.headers.get("content-type") === "image/png" && result.headers.get("x-content-type-options") === "nosniff" && Buffer.compare(result.body, tinyPng) === 0, "Image bytes use their verified MIME and nosniff.");
  status(await call(`editor/photos/${photoId}`, { method: "DELETE", token: editorB }), 404, "other card capability cannot delete photo");
  data = status(await call(`public/${cardA.id}`), 200, "draft with photos stays private");
  check(!("photos" in data) && !JSON.stringify(data).includes(photoId), "Draft public response excludes photo references.");

  const oldEditor = editorA;
  const rotated = status(await call(`cards/${cardA.id}/editor-link`, { method: "POST", user: storeAUser }), 200, "own editor capability rotation");
  editorA = tokenFrom(rotated.editPath);
  check(editorA !== oldEditor, "Recovered editor link creates a new random capability.");
  status(await call("editor", { token: oldEditor }), 401, "old capability cannot read editor");
  status(await call("editor", { method: "PATCH", token: oldEditor, json: { recipient: "Hijack", sender: "", letter: "No", theme: "noche" } }), 401, "old capability cannot edit");
  status(await call("editor/photos", { method: "POST", token: oldEditor, form: pngForm() }), 401, "old capability cannot upload");
  status(await call(`editor/photos/${photoId}`, { method: "DELETE", token: oldEditor }), 401, "old capability cannot delete");
  status(await call("editor/publish", { method: "POST", token: oldEditor }), 401, "old capability cannot publish");
  status(await call(`media/${photoId}`, { token: oldEditor }), 404, "old capability cannot read draft photo");
  check(objects.size === 5 && balance(a.store.id) === 0, "Revoked requests cannot change files or credits.");
  status(await call("editor", { token: editorA }), 200, "new capability works");

  const published = status(await call("editor/publish", { method: "POST", token: editorA }), 200, "publish card A");
  check(published.publicPath === cardA.publicPath && !published.publicPath.includes(editorA), "Public QR path stays stable and never contains its editor capability.");
  data = status(await call(`public/${cardA.id}`), 200, "published gift A");
  check(data.ready === true && data.card.id === cardA.id && data.letter.startsWith("Carta privada de A") && data.photos.length === 5, "Published card exposes only its own letter and photos.");
  check(!JSON.stringify(data).includes(editorA) && !JSON.stringify(data).includes(storedEditor), "Public gift has no capability or capability hash.");
  status(await call(`media/${photoId}`), 200, "published image can be viewed without editor token");
  data = status(await call(`public/${cardB.id}`), 200, "unrelated B remains draft");
  check(data.ready === false && !("letter" in data) && !("photos" in data), "Publishing A never publishes B.");
  status(await call("editor", { method: "PATCH", token: editorA, json: { recipient: "Ana actualizada", sender: "Dereck", letter: "Carta actualizada", theme: "rosa" } }), 200, "edit after publishing");
  status(await call("editor/publish", { method: "POST", token: editorA }), 200, "repeat publication is idempotent");
  status(await call("cards", { user: storeAUser }), 200, "management and print list after publication");
  check(balance(a.store.id) === 0 && sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE card_id = ?").get(cardA.id).n === 1, "Views, editor recovery, media, edits and repeated publication never charge again.");

  data = status(await call(`stores/${a.store.id}/credits`, { method: "POST", user: owner, json: { amount: 2, note: "Recarga manual confirmada" } }), 200, "owner credit topup");
  check(data.store.credits === 2 && balance(a.store.id) === 2, "Topup updates the persistent balance.");
  const ledger = sqlite.prepare("SELECT sum(amount) AS amount FROM credit_ledger WHERE store_id = ?").get(a.store.id);
  check(ledger.amount === 2, "Balance equals its ledger allocations less activations.");
  data = status(await call("cards", { user: owner }), 200, "owner sees all store summaries");
  check(data.cards.filter(card => [a.store.id, b.store.id].includes(card.storeId)).length === 2, "Only owner gets cards across stores.");

  const c = status(await call("stores", { method: "POST", user: owner, json: { name: "Tienda C", email: "c@example.test", credits: 0 } }), 201, "zero-credit store");
  const replacement = status(await call(`stores/${c.store.id}/invitation`, { method: "POST", user: owner }), 200, "replace unused invitation");
  const storeCUser = { id: "shop-c-fixture", email: "c@example.test", name: "Tienda C" };
  status(await call("invitations/redeem", { method: "POST", user: storeCUser, json: { token: tokenFrom(c.invitePath) } }), 403, "old invitation invalidated");
  status(await call("invitations/redeem", { method: "POST", user: storeCUser, json: { token: tokenFrom(replacement.invitePath) } }), 200, "new invitation works");
  status(await call("cards", { method: "POST", user: storeCUser, json: { recipient: "Sin recarga", theme: "rosa" } }), 409, "zero-credit store cannot activate");
  check(cardCount(c.store.id) === 0 && balance(c.store.id) === 0, "No seeded credits or accidental gift records.");
  // V2 catalog is configuration until explicitly overridden; requests never grant credits.
  status(await call("packages"), 401, "anonymous catalog denied");
  status(await call("packages", { user: visitor }), 403, "unassigned catalog denied");
  const defaults = status(await call("packages", { user: storeAUser }), 200, "default catalog available without seeds").packages;
  check(sqlite.prepare("SELECT count(*) AS n FROM packages").get().n === 0, "Catalog works without production seed rows.");
  check(defaults.length === 5 && defaults.filter(item => item.kind === "credits").map(item => `${item.credits}:${item.priceCents}:${item.currency}`).join(",") === "10:1000:USD,25:2000:USD,50:3000:USD,100:5000:USD", "Confirmed finite credit amounts and USD prices are exact.");
  check(defaults.find(item => item.id === "unlimited").durationDays === null && defaults.find(item => item.id === "unlimited").priceCents === null, "Default unlimited is perpetual with an unspecified quoted price.");
  status(await call("packages/pack-10", { method: "PATCH", user: storeAUser, json: { priceCents: 0 } }), 403, "store cannot alter catalog prices");
  status(await call("packages/unknown", { method: "PATCH", user: owner, json: { name: "Invalid" } }), 404, "only fixed package IDs accepted");
  status(await call("packages/pack-10", { method: "PATCH", user: owner, json: { kind: "unlimited" } }), 400, "package kind is fixed");
  status(await call("packages/pack-10", { method: "PATCH", user: owner, json: { credits: 0 } }), 400, "nonpositive quantity denied");
  status(await call("packages/unlimited", { method: "PATCH", user: owner, json: { durationDays: 0 } }), 400, "nonpositive duration denied");
  status(await call("orders"), 401, "anonymous orders denied");
  status(await call("orders", { method: "POST", user: storeAUser, json: { packageId: "pack-10", storeId: b.store.id } }), 403, "cross-store package request denied");
  const pendingA = status(await call("orders", { method: "POST", user: storeAUser, json: { packageId: "pack-10", credits: 9999, priceCents: 1 } }), 201, "request finite package").order;
  check(pendingA.status === "pending" && pendingA.credits === 10 && pendingA.priceCents === 1000 && balance(a.store.id) === 2, "Order snapshots server catalog and leaves balance unchanged until approval.");
  check(status(await call("orders", { user: storeBUser }), 200, "store B order isolation").orders.length === 0, "Store B cannot see store A's pending request.");
  status(await call(`orders?storeId=${a.store.id}`, { user: storeBUser }), 403, "cross-store order filter denied");
  status(await call(`orders/${pendingA.id}/approve`, { method: "POST", user: storeAUser, json: { note: "self approve" } }), 403, "store cannot approve its request");
  status(await call(`orders/${pendingA.id}/approve`, { method: "POST", user: oldOwner, json: { note: "old owner" } }), 403, "historical owner cannot approve credit");
  status(await call("packages/pack-10", { method: "PATCH", user: owner, json: { name: "12 créditos actualizados", credits: 12, priceCents: 1200 } }), 200, "persist catalog override");
  check(status(await call("orders", { user: storeAUser }), 200, "pending snapshot after catalog edit").orders.find(item => item.id === pendingA.id).credits === 10, "Catalog changes do not rewrite pending snapshots.");
  const approvals = await Promise.all([0, 1].map(index => call(`orders/${pendingA.id}/approve`, { method: "POST", user: owner, json: { note: `Pago externo confirmado ${index}` } })));
  approvals.forEach(result => status(result, 200, "concurrent same approval idempotent"));
  check(balance(a.store.id) === 12, "Concurrent approval adds the snapshotted quantity only once.");
  check(sqlite.prepare("SELECT count(*) AS n, sum(amount) AS amount FROM credit_ledger WHERE order_id = ?").get(pendingA.id).n === 1 && sqlite.prepare("SELECT sum(amount) AS amount FROM credit_ledger WHERE order_id = ?").get(pendingA.id).amount === 10, "Exactly one unique order ledger grant exists.");
  status(await call(`orders/${pendingA.id}/reject`, { method: "POST", user: owner, json: {} }), 409, "approved order cannot be rejected");
  const rejected = status(await call("orders", { method: "POST", user: storeBUser, json: { packageId: "pack-25" } }), 201, "request later rejected").order;
  status(await call(`orders/${rejected.id}/reject`, { method: "POST", user: owner, json: { note: "Pago no recibido" } }), 200, "reject pending request");
  status(await call(`orders/${rejected.id}/reject`, { method: "POST", user: owner, json: {} }), 200, "repeat rejection idempotent");
  status(await call(`orders/${rejected.id}/approve`, { method: "POST", user: owner, json: {} }), 409, "rejected order cannot grant later");
  check(balance(b.store.id) === 1 && sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE order_id = ?").get(rejected.id).n === 0, "Rejected order creates no grant.");
  status(await call("packages/pack-50", { method: "PATCH", user: owner, json: { active: false } }), 200, "deactivate product");
  check(!status(await call("packages", { user: storeAUser }), 200, "active store catalog").packages.some(item => item.id === "pack-50"), "Stores see active packages only.");
  check(status(await call("packages", { user: owner }), 200, "complete admin catalog").packages.some(item => item.id === "pack-50" && !item.active), "Admin can see and reactivate inactive products.");
  status(await call("orders", { method: "POST", user: storeAUser, json: { packageId: "pack-50" } }), 400, "inactive product cannot be requested");

  const perpetual = status(await call("orders", { method: "POST", user: storeCUser, json: { packageId: "unlimited", durationDays: 30, priceCents: 0 } }), 201, "request quoted perpetual unlimited").order;
  check(perpetual.durationDays === null && perpetual.priceCents === null && balance(c.store.id) === 0, "Client cannot turn a quoted perpetual request into a free paid plan or change its period.");
  data = status(await call(`orders/${perpetual.id}/approve`, { method: "POST", user: owner, json: { note: "Condiciones externas confirmadas" } }), 200, "approve perpetual unlimited");
  check(data.store.unlimited && data.store.unlimitedActive && data.store.unlimitedUntil === null && data.store.credits === 0, "Perpetual unlimited is a flag with no expiry, not a fake balance.");
  const unlimitedCards = await Promise.all([0, 1, 2].map(index => call("cards", { method: "POST", user: storeCUser, json: { recipient: `Ilimitado ${index}`, theme: "olivo" } })));
  unlimitedCards.forEach(result => status(result, 201, "zero-balance unlimited activation"));
  check(balance(c.store.id) === 0 && cardCount(c.store.id) === 3, "Unlimited activates multiple cards without touching the finite balance.");
  check(sqlite.prepare("SELECT count(*) AS n, sum(amount) AS amount FROM credit_ledger WHERE store_id = ? AND card_id IS NOT NULL").get(c.store.id).n === 3 && sqlite.prepare("SELECT sum(amount) AS amount FROM credit_ledger WHERE store_id = ? AND card_id IS NOT NULL").get(c.store.id).amount === 0, "Unlimited card activations record zero-debit audit entries.");
  status(await call(`stores/${c.store.id}/unlimited`, { method: "POST", user: storeCUser, json: { enabled: true, durationDays: null } }), 403, "store cannot self-enable unlimited");
  status(await call(`stores/${c.store.id}/unlimited`, { method: "POST", user: oldOwner, json: { enabled: true, durationDays: null } }), 403, "old hosting owner cannot enable unlimited");

  status(await call("packages/unlimited", { method: "PATCH", user: owner, json: { durationDays: 30, priceCents: 2500 } }), 200, "admin changes future unlimited period and price");
  const monthlyForPerpetual = status(await call("orders", { method: "POST", user: storeCUser, json: { packageId: "unlimited" } }), 201, "monthly request on perpetual store").order;
  data = status(await call(`orders/${monthlyForPerpetual.id}/approve`, { method: "POST", user: owner, json: {} }), 200, "monthly approval must preserve perpetual");
  check(data.store.unlimitedUntil === null && data.store.unlimitedActive, "A later monthly grant never shortens existing perpetual unlimited.");
  const monthlyB = status(await call("orders", { method: "POST", user: storeBUser, json: { packageId: "unlimited" } }), 201, "monthly order snapshot").order;
  status(await call("packages/unlimited", { method: "PATCH", user: owner, json: { durationDays: 60, priceCents: 5000 } }), 200, "change future period after pending snapshot");
  data = status(await call(`orders/${monthlyB.id}/approve`, { method: "POST", user: owner, json: {} }), 200, "approve original monthly snapshot");
  let remainingDays = (Date.parse(data.store.unlimitedUntil) - Date.now()) / 86400000;
  check(remainingDays > 29.9 && remainingDays <= 30.01 && data.order.durationDays === 30 && data.order.priceCents === 2500 && data.store.credits === 1, "Approval uses snapshotted duration/price and preserves finite credits.");
  const extensionB = status(await call("orders", { method: "POST", user: storeBUser, json: { packageId: "unlimited" } }), 201, "request updated extension").order;
  data = status(await call(`orders/${extensionB.id}/approve`, { method: "POST", user: owner, json: {} }), 200, "extend active unlimited");
  remainingDays = (Date.parse(data.store.unlimitedUntil) - Date.now()) / 86400000;
  check(remainingDays > 89.9 && remainingDays <= 90.01, "Timed grant extends from future active expiry, not from today.");
  status(await call("cards", { method: "POST", user: storeBUser, json: { recipient: "Sin débito", theme: "rosa" } }), 201, "timed unlimited activation");
  check(balance(b.store.id) === 1, "Timed active unlimited preserves stored finite credit.");
  sqlite.prepare("UPDATE stores SET unlimited_until = ? WHERE id = ?").run(Date.now() - 1000, b.store.id);
  data = status(await call("me", { user: storeBUser }), 200, "expired unlimited computed on server");
  check(data.store.unlimited && !data.store.unlimitedActive && data.store.credits === 1, "Expired flag does not provide active unlimited access.");
  status(await call("cards", { method: "POST", user: storeBUser, json: { recipient: "Saldo tras vencer", theme: "rosa" } }), 201, "expiry falls back to finite balance");
  check(balance(b.store.id) === 0, "First post-expiry card consumes the preserved finite credit.");
  status(await call("cards", { method: "POST", user: storeBUser, json: { recipient: "Agotado", theme: "rosa" } }), 409, "expired plan with zero balance denied");
  data = status(await call(`stores/${c.store.id}/unlimited`, { method: "POST", user: owner, json: { enabled: false, durationDays: null, note: "Revocación manual" } }), 200, "manual revoke perpetual plan");
  check(!data.store.unlimited && !data.store.unlimitedActive && data.store.credits === 0, "Revocation clears unlimited without inventing or consuming finite balance.");
  status(await call("cards", { method: "POST", user: storeCUser, json: { recipient: "Revocado", theme: "rosa" } }), 409, "revoked zero-balance unlimited cannot activate");
  status(await call(`stores/${c.store.id}/credits`, { method: "POST", user: owner, json: { amount: 2 } }), 200, "allocate finite reserve");
  status(await call(`stores/${c.store.id}/unlimited`, { method: "POST", user: owner, json: { enabled: true, durationDays: null, note: "Activación manual permanente" } }), 200, "manual enable perpetual");
  status(await call("cards", { method: "POST", user: storeCUser, json: { recipient: "Reserva intacta", theme: "rosa" } }), 201, "manual unlimited activates");
  check(balance(c.store.id) === 2, "Manual unlimited preserves finite reserve.");
  status(await call(`stores/${c.store.id}/unlimited`, { method: "POST", user: owner, json: { enabled: false, durationDays: null } }), 200, "manual revoke preserves reserve");
  status(await call("cards", { method: "POST", user: storeCUser, json: { recipient: "Usar reserva", theme: "rosa" } }), 201, "revocation restores finite charging");
  check(balance(c.store.id) === 1, "Finite reserve resumes after revocation.");

  const racingOrder = status(await call("orders", { method: "POST", user: storeBUser, json: { packageId: "pack-100" } }), 201, "approval/rejection race fixture").order;
  const decisions = await Promise.all(["approve", "reject"].map(decision => call(`orders/${racingOrder.id}/${decision}`, { method: "POST", user: owner, json: {} })));
  check(decisions.map(result => result.status).sort().join(",") === "200,409", "Concurrent opposing decisions have exactly one winning transition.");
  const decided = sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(racingOrder.id).status;
  check(balance(b.store.id) === (decided === "approved" ? 100 : 0), "Grant follows only the winning approval decision.");
  check(sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE order_id = ?").get(racingOrder.id).n === (decided === "approved" ? 1 : 0), "Race cannot duplicate or grant a rejected order.");
  assert.throws(() => sqlite.prepare("UPDATE orders SET credits = 999 WHERE id = ?").run(pendingA.id), /ORDER_SNAPSHOT_IMMUTABLE/, "Approved snapshots remain immutable at the database boundary.");
  assertions++;
  const finiteRaceStore = status(await call("stores", { method: "POST", user: owner, json: { name: "Último crédito", email: "race@example.test", credits: 1 } }), 201, "concurrent activation fixture").store;
  const activations = await Promise.all([0, 1].map(index => call("cards", { method: "POST", user: owner, json: { storeId: finiteRaceStore.id, recipient: `Simultáneo ${index}`, theme: "rosa" } })));
  check(activations.map(result => result.status).sort().join(",") === "201,409" && balance(finiteRaceStore.id) === 0 && cardCount(finiteRaceStore.id) === 1, "Concurrent activations atomically share one remaining finite credit.");

  // V4 store profile/branding and per-card print choices persist with strict tenancy.
  const brandA = status(await call("stores", { method: "POST", user: owner, json: { name: "Magnolia", email: "brand-a@example.test", packageId: "pack-25", note: "Paquete confirmado" } }), 201, "new store selects a catalog package");
  const brandUser = { id: "brand-a-user", email: "brand-a@example.test", name: "Magnolia" };
  status(await call("invitations/redeem", { method: "POST", user: brandUser, json: { token: tokenFrom(brandA.invitePath) } }), 200, "branding store joins");
  check(brandA.store.credits === 25 && brandA.store.logoUrl === null && brandA.store.logoMode === "original", "Initial store package and logo defaults are persistent.");
  const initialGrant = sqlite.prepare("SELECT * FROM credit_ledger WHERE store_id = ? AND reason = 'initial_package'").get(brandA.store.id);
  const initialSnapshot = JSON.parse(initialGrant.note);
  check(initialGrant.amount === 25 && initialSnapshot.package.id === "pack-25" && initialSnapshot.package.priceCents === 2000 && initialSnapshot.reference === "Paquete confirmado", "Initial package grant keeps a catalog snapshot and payment reference.");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", json: { name: "No" } }), 401, "anonymous profile edit denied");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: storeBUser, json: { name: "No" } }), 404, "other store cannot edit profile");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: brandUser, json: { name: " " } }), 400, "empty store name denied");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: brandUser, json: { logoMode: "javascript:alert(1)" } }), 400, "invalid image mode denied");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: brandUser, origin: "https://evil.example", json: { name: "No" } }), 403, "profile origin enforced");
  data = status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: brandUser, json: { name: "Magnolia & Jardín", logoMode: "tinted", credits: 9999, email: owner.email } }), 200, "store edits own name and logo treatment");
  check(data.store.name === "Magnolia & Jardín" && data.store.logoMode === "tinted" && data.store.credits === 25 && data.store.email === brandUser.email, "Profile patch cannot change identity or credit balance.");
  check(status(await call("me", { user: brandUser }), 200, "reload store profile").store.name === "Magnolia & Jardín", "Profile changes survive a fresh identity request.");
  const logoEndpoint = `stores/${brandA.store.id}/logo`;
  status(await call(logoEndpoint, { user: brandUser }), 404, "missing logo is not a placeholder object");
  status(await call(logoEndpoint, { method: "POST", user: storeBUser, bytes: tinyPng }), 404, "cross-store logo upload denied");
  status(await call(logoEndpoint, { method: "POST", user: brandUser, bytes: Buffer.from("<svg></svg>"), mime: "image/svg+xml" }), 415, "SVG logo not accepted as executable content");
  status(await call(logoEndpoint, { method: "POST", user: brandUser, bytes: tinyPng, mime: "image/jpeg" }), 415, "logo declared MIME mismatch denied");
  status(await call(logoEndpoint, { method: "POST", user: brandUser, bytes: new Uint8Array(3 * 1024 * 1024 + 1) }), 413, "oversize logo denied");
  const beforeLogos = objects.size;
  data = status(await call(logoEndpoint, { method: "POST", user: brandUser, bytes: tinyPng }), 201, "valid own logo upload");
  const firstLogoUrl = data.store.logoUrl;
  check(firstLogoUrl.startsWith(`/api/${logoEndpoint}?v=`) && objects.size === beforeLogos + 1, "Logo uses an authenticated versioned route and R2 object.");
  status(await call(logoEndpoint), 401, "anonymous logo denied");
  status(await call(logoEndpoint, { user: storeBUser }), 404, "cross-store logo read denied");
  result = await call(logoEndpoint, { user: brandUser });
  status(result, 200, "own logo read");
  check(result.headers.get("content-type") === "image/png" && result.headers.get("cache-control") === "private, no-store" && Buffer.compare(result.body, tinyPng) === 0, "Logo serves verified bytes without persistent caching.");
  data = status(await call(logoEndpoint, { method: "POST", user: owner, bytes: tinyPng }), 201, "owner can replace store logo");
  check(data.store.logoUrl !== firstLogoUrl && objects.size === beforeLogos + 1, "Replacing the logo changes its URL and cleans the old object.");
  const brandedCard = status(await call("cards", { method: "POST", user: brandUser, json: { recipient: "Para mamá", printColor: "#CDAABB", logoMode: "none" } }), 201, "activate branded card");
  check(brandedCard.card.storeName === "Magnolia & Jardín" && brandedCard.card.storeLogoUrl === data.store.logoUrl && brandedCard.card.storeLogoMode === "tinted", "Printing receives current store identity and logo preferences.");
  check(brandedCard.card.printColor === "#cdaabb" && brandedCard.card.logoMode === "none", "Creation persists custom color and logo selection before editing.");
  const styleEndpoint = `cards/${brandedCard.card.id}/print-style`;
  status(await call(styleEndpoint, { method: "PATCH", user: storeBUser, json: { printColor: "#aabbcc" } }), 404, "cross-store styling denied");
  status(await call(styleEndpoint, { method: "PATCH", user: brandUser, json: { printColor: "red;url(javascript:1)" } }), 400, "CSS injection color denied");
  status(await call(styleEndpoint, { method: "PATCH", user: brandUser, json: { printColor: "#abc" } }), 400, "partial hex denied");
  status(await call(styleEndpoint, { method: "PATCH", user: brandUser, json: { logoMode: "bad" } }), 400, "invalid per-card logo mode denied");
  const printBalance = balance(brandA.store.id);
  data = status(await call(styleEndpoint, { method: "PATCH", user: brandUser, json: { theme: "noche", printColor: "#AABBCC", logoMode: "original" } }), 200, "save individual print style");
  check(data.card.printColor === "#aabbcc" && data.card.logoMode === "original" && data.card.theme === "noche" && balance(brandA.store.id) === printBalance, "Custom color/mode persist without charging credits.");
  const reloadedStyle = status(await call("cards", { user: brandUser }), 200, "reload saved print style").cards[0];
  check(reloadedStyle.printColor === "#aabbcc" && reloadedStyle.logoMode === "original", "Saved print preferences survive fresh card list.");
  data = status(await call(styleEndpoint, {method:"PATCH",user:brandUser,json:{logoMode:"none",printColor:"#5435A2"}}),200,"hide logo while keeping custom color");
  check(data.card.logoMode === "none" && data.card.printColor === "#5435a2" && data.card.storeLogoUrl, "Hide mode preserves store logo and color.");
  data = status(await call(styleEndpoint, { method: "PATCH", user: brandUser, json: { printColor: null, logoMode: null } }), 200, "return to themed colors and profile logo mode");
  check(data.card.printColor === null && data.card.logoMode === null, "Null clears per-card overrides.");
  status(await call(logoEndpoint, { method: "DELETE", user: storeBUser }), 404, "other store cannot remove logo");
  data = status(await call(logoEndpoint, { method: "DELETE", user: brandUser }), 200, "remove logo");
  check(data.store.logoUrl === null && objects.size === beforeLogos, "Removing a logo clears both profile reference and object.");
  status(await call(logoEndpoint, { user: owner }), 404, "removed logo cannot be read");

  // Admin-only deletion revokes gifts/capabilities/media but preserves the credit history.
  const brandedToken = tokenFrom(brandedCard.editPath);
  status(await call("editor", { method: "PATCH", token: brandedToken, json: { recipient: "Para mamá", sender: "", letter: "Un recuerdo de prueba", theme: "rosa" } }), 200, "deleted gift fixture letter");
  const deletionPhoto = status(await call("editor/photos", { method: "POST", token: brandedToken, form: pngForm() }), 201, "deleted gift fixture media").photo;
  status(await call("editor/publish", { method: "POST", token: brandedToken }), 200, "deleted gift fixture publishes");
  status(await call(`cards/${brandedCard.card.id}`, { method: "DELETE", user: brandUser, json: { confirmation: "Para mamá" } }), 403, "store cannot delete a gift");
  status(await call(`cards/${brandedCard.card.id}`, { method: "DELETE", user: owner, json: { confirmation: "wrong" } }), 400, "deleting gift requires matching recipient");
  status(await call(`cards/${brandedCard.card.id}`, { method: "DELETE", user: owner, origin: "https://evil.example", json: { confirmation: "Para mamá" } }), 403, "cross-origin deletion denied");
  status(await call(`cards/${brandedCard.card.id}`, { method: "DELETE", user: owner, json: { confirmation: "Para mamá" } }), 200, "admin deletes published gift");
  check(balance(brandA.store.id) === printBalance && sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE card_id = ?").get(brandedCard.card.id).n === 1, "Deleting a gift does not refund or erase the activation audit.");
  status(await call(`public/${brandedCard.card.id}`), 404, "deleted gift public URL revoked");
  status(await call(`media/${deletionPhoto.id}`), 404, "deleted gift media revoked");
  status(await call("editor", { token: brandedToken }), 401, "deleted gift private editor revoked");
  status(await call("editor", { method: "PATCH", token: brandedToken, json: { recipient: "Revive", theme: "rosa" } }), 401, "deleted gift cannot be revived by editor");
  status(await call("editor/photos", { method: "POST", token: brandedToken, form: pngForm() }), 401, "deleted gift cannot receive photos");
  status(await call("editor/publish", { method: "POST", token: brandedToken }), 401, "deleted gift cannot republish");
  status(await call(`cards/${brandedCard.card.id}/editor-link`, { method: "POST", user: owner }), 404, "deleted gift editor rotation denied");
  status(await call(styleEndpoint, { method: "PATCH", user: owner, json: { printColor: "#ffffff" } }), 404, "deleted gift styling denied");
  check(status(await call("cards", { user: brandUser }), 200, "active cards exclude deleted gifts").cards.length === 0, "Deleted gift disappears from cards and print list.");
  check(status(await call("me", { user: brandUser }), 200, "active count after deletion").store.cardCount === 0, "Active card count excludes deleted gifts.");
  status(await call(`public/${cardA.id}`), 200, "other store public gift survives deletion");

  const liveForDelete = status(await call("cards", { method: "POST", user: brandUser, json: { recipient: "Otra flor" } }), 201, "active gift under deleted-store fixture");
  const liveToken = tokenFrom(liveForDelete.editPath);
  const livePhoto = status(await call("editor/photos", { method: "POST", token: liveToken, form: pngForm() }), 201, "deleted-store media fixture").photo;
  status(await call("editor/publish", { method: "POST", token: liveToken }), 200, "deleted-store gift publishes");
  status(await call(logoEndpoint, { method: "POST", user: brandUser, bytes: tinyPng }), 201, "deleted-store logo fixture");
  const pendingDeletedStore = status(await call("orders", { method: "POST", user: brandUser, json: { packageId: "pack-25" } }), 201, "deleted-store request fixture").order;
  status(await call(`stores/${brandA.store.id}`, { method: "DELETE", user: brandUser, json: { confirmation: "Magnolia & Jardín" } }), 403, "store cannot delete itself");
  status(await call(`stores/${brandA.store.id}`, { method: "DELETE", user: oldOwner, json: { confirmation: "Magnolia & Jardín" } }), 403, "historical hosting owner cannot delete store");
  status(await call(`stores/${brandA.store.id}`, { method: "DELETE", user: owner, json: { confirmation: "Magnolia" } }), 400, "store deletion requires exact current name");
  const beforeDeleteBalance = balance(brandA.store.id);
  status(await call(`stores/${brandA.store.id}`, { method: "DELETE", user: owner, json: { confirmation: "Magnolia & Jardín" } }), 200, "admin deletes store");
  const disabledIdentity = status(await call("me", { user: brandUser }), 200, "deleted-store identity revoked");
  check(disabledIdentity.role === "visitor" && disabledIdentity.store === null, "Deleted store member no longer has store authorization.");
  check(balance(brandA.store.id) === beforeDeleteBalance, "Deleting a store leaves historical balance intact without a refund.");
  status(await call(`public/${liveForDelete.card.id}`), 404, "deleting store revokes all remaining public gifts");
  status(await call(`media/${livePhoto.id}`), 404, "deleting store revokes remaining photos");
  status(await call("editor", { token: liveToken }), 401, "deleting store revokes buyer links");
  status(await call(logoEndpoint, { user: owner }), 404, "deleted store logo inaccessible");
  status(await call("cards", { user: brandUser }), 403, "deleted store cannot list gifts");
  status(await call("orders", { user: brandUser }), 403, "deleted store cannot list requests");
  status(await call(`orders/${pendingDeletedStore.id}/approve`, { method: "POST", user: owner, json: {} }), 404, "deleted-store pending request cannot be approved");
  status(await call(`stores/${brandA.store.id}/credits`, { method: "POST", user: owner, json: { amount: 10 } }), 404, "deleted store cannot receive credits");
  status(await call(`stores/${brandA.store.id}/unlimited`, { method: "POST", user: owner, json: { enabled: true, durationDays: null } }), 404, "deleted store cannot receive unlimited");
  status(await call(`stores/${brandA.store.id}/invitation`, { method: "POST", user: owner }), 409, "deleted store cannot renew invitation");
  status(await call(`stores/${brandA.store.id}`, { method: "PATCH", user: owner, json: { name: "No" } }), 404, "deleted store cannot edit profile");
  status(await call("cards", { method: "POST", user: owner, json: { storeId: brandA.store.id, recipient: "No" } }), 404, "admin cannot activate for deleted store");
  check(!status(await call("stores", { user: owner }), 200, "active store listing").stores.some(store => store.id === brandA.store.id), "Deleted store disappears from admin list.");
  check(!status(await call("cards", { user: owner }), 200, "admin cards after store deletion").cards.some(card => card.storeId === brandA.store.id), "Deleting store hides its cards from admin and print listing.");
  check(sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(pendingDeletedStore.id).status === "pending", "Deletion preserves unapproved order history without credit grants.");
  const recreated = status(await call("stores", { method: "POST", user: owner, json: { name: "Nueva Magnolia", email: brandUser.email, credits: 0 } }), 201, "same email can receive a fresh store after deletion");
  status(await call("invitations/redeem", { method: "POST", user: brandUser, json: { token: tokenFrom(recreated.invitePath) } }), 200, "same identity can join replacement active store");
  check(status(await call("me", { user: brandUser }), 200, "replacement membership").store.id === recreated.store.id, "Replacement membership never restores old store gifts.");
  status(await call(`public/${liveForDelete.card.id}`), 404, "replacement account does not revive prior gifts");
  const unusedInviteStore = status(await call("stores", { method: "POST", user: owner, json: { name: "Invitación descartada", email: "discard@example.test" } }), 201, "unused deleted invitation fixture");
  status(await call(`stores/${unusedInviteStore.store.id}`, { method: "DELETE", user: owner, json: { confirmation: "Invitación descartada" } }), 200, "delete unredeemed store");
  status(await call("invitations/redeem", { method: "POST", user: { id: "discard", email: "discard@example.test", name: "discard" }, json: { token: tokenFrom(unusedInviteStore.invitePath) } }), 403, "deleted store invitation permanently revoked");

  // All initial packages are resolved from the active, current server-side catalog.
  status(await call("stores", { method: "POST", user: owner, json: { name: "Invalid", email: "invalid-pack@example.test", packageId: "pack-50" } }), 400, "inactive initial package denied");
  status(await call("stores", { method: "POST", user: owner, json: { name: "Invalid", email: "invalid-pack@example.test", packageId: "unknown" } }), 400, "unknown initial package denied");
  status(await call("stores", { method: "POST", user: owner, json: { name: "Invalid", email: "invalid-pack@example.test", packageId: "pack-25", credits: 9999 } }), 400, "package cannot combine with arbitrary credits");
  status(await call("packages/pack-50", { method: "PATCH", user: owner, json: { active: true } }), 200, "reactivate initial pack fixture");
  status(await call("packages/unlimited", { method: "PATCH", user: owner, json: { durationDays: null } }), 200, "perpetual initial package fixture");
  for (const [packageId, expected] of [["pack-10",12],["pack-25",25],["pack-50",50],["pack-100",100],["unlimited",0]]) {
    const assigned = status(await call("stores", { method: "POST", user: owner, json: { name: `Inicial ${packageId}`, email: `${packageId}@initial.example.test`, packageId, priceCents: 0, durationDays: 1 } }), 201, `assign initial ${packageId}`).store;
    check(assigned.credits === expected && assigned.unlimited === (packageId === "unlimited"), `Initial ${packageId} uses actual catalog values.`);
    if (packageId === "unlimited") check(assigned.unlimitedActive && assigned.unlimitedUntil === null, "Initial unlimited is perpetual rather than a large credit balance.");
  }
  assert.throws(() => sqlite.prepare("INSERT INTO cards (id,store_id,recipient,edit_hash,created_by,created_at) VALUES ('deleted-race',?,'No','deleted-race','test',?)").run(brandA.store.id, Date.now()), /STORE_DELETED/, "Database guards activation against a deleted store, even after a stale authorization read.");
  assertions++;
  assert.throws(() => sqlite.prepare("UPDATE orders SET status='approved',decided_by='test',decided_at=? WHERE id=?").run(Date.now(), pendingDeletedStore.id), /STORE_DELETED/, "Database prevents approval after concurrent store deletion.");
  assertions++;
  // Optional PIN protects both JSON and image bytes. Fixtures stay in this isolated database.
  const pinShop = status(await call("stores", {method:"POST",user:owner,json:{name:"PIN fixture",email:"pin@example.test",credits:2}}),201,"PIN fixture store").store;
  const pinCards=[];
  for (let i=0;i<2;i++) {
    const created=status(await call("cards",{method:"POST",user:owner,json:{storeId:pinShop.id,recipient:`Privado ${i}`,theme:"rosa"}}),201,"PIN fixture card");
    const capability=tokenFrom(created.editPath);
    status(await call("editor",{method:"PATCH",token:capability,json:{recipient:`Privado ${i}`,letter:"Carta confidencial",theme:"rosa"}}),200,"private fixture letter");
    const photo=status(await call("editor/photos",{method:"POST",token:capability,form:pngForm()}),201,"private fixture photo").photo;
    status(await call("editor/pin",{method:"PATCH",token:capability,json:{enabled:true,pin:"0427"}}),200,"enable optional PIN before publication");
    status(await call("editor/publish",{method:"POST",token:capability}),200,"publish PIN fixture");
    pinCards.push({id:created.card.id,capability,photo});
  }
  const secret=pinCards[0], otherSecret=pinCards[1];
  const pinPath=`public/${secret.id}/unlock`;
  const pinPatch=body=>call("editor/pin",{method:"PATCH",token:secret.capability,json:body});
  check(balance(pinShop.id)===0,"PIN creation, publication and media do not spend extra credits.");
  status(await call("editor/pin",{method:"PATCH",json:{enabled:false}}),401,"anonymous cannot remove PIN");
  status(await call("editor/pin",{method:"PATCH",token:secret.capability,origin:"https://attacker.test",json:{enabled:false}}),403,"cross-origin cannot remove PIN");
  status(await pinPatch({enabled:true,pin:"123"}),400,"short PIN rejected");
  status(await pinPatch({enabled:true,pin:427}),400,"numeric PIN must retain leading zeros");
  status(await pinPatch({enabled:"true",pin:"0427"}),400,"PIN enabled flag is strictly boolean");
  let pinRow=sqlite.prepare("SELECT pin_hash,pin_failures,pin_locked_until FROM cards WHERE id=?").get(secret.id);
  check(/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(pinRow.pin_hash)&&pinRow.pin_hash!==sqlite.prepare("SELECT pin_hash FROM cards WHERE id=?").get(otherSecret.id).pin_hash,"PIN uses a separately salted derivation per card.");
  check(!JSON.stringify(status(await call("editor",{token:secret.capability}),200,"PIN private editor view")).includes(pinRow.pin_hash),"Editor never returns PIN/hash.");
  let locked=status(await call(`public/${secret.id}`),200,"locked public gift");
  check(locked.locked===true&&!('card' in locked)&&!('letter' in locked)&&!('photos' in locked),"Locked gift exposes neither letter, photo references nor card details.");
  status(await call(`media/${secret.photo.id}`),403,"published PIN photo is protected");
  status(await call(`media/${secret.photo.id}`,{token:secret.capability}),200,"private editor can preview protected photos");
  status(await call(`media/${secret.photo.id}`,{token:otherSecret.capability}),403,"other editor cannot preview protected photos");
  status(await call(pinPath,{method:"POST",json:{pin:"042"}}),400,"invalid unlock input rejected");
  status(await call(pinPath,{method:"POST",origin:"https://attacker.test",json:{pin:"0427"}}),403,"cross-origin unlock rejected");
  for(let i=0;i<4;i++) status(await call(pinPath,{method:"POST",json:{pin:"9999"}}),403,"incorrect PIN counted");
  const beforeLock=Date.now();
  const fifth=await call(pinPath,{method:"POST",json:{pin:"9999"}});
  status(fifth,429,"fifth incorrect PIN locks the gift");
  pinRow=sqlite.prepare("SELECT pin_locked_until,pin_failures FROM cards WHERE id=?").get(secret.id);
  check(pinRow.pin_failures===5&&pinRow.pin_locked_until>=beforeLock+60000&&fifth.body.retryAfter===60,"Five failures persist a 60-second server lock.");
  status(await call(pinPath,{method:"POST",json:{pin:"0427"}}),429,"correct PIN cannot bypass active lock");
  sqlite.prepare("UPDATE cards SET pin_locked_until=? WHERE id=?").run(Date.now()-1,secret.id);
  status(await call(pinPath,{method:"POST",json:{pin:"9999"}}),403,"expired lock starts a new failure window");
  check(sqlite.prepare("SELECT pin_failures FROM cards WHERE id=?").get(secret.id).pin_failures===1,"Failure window resets only after lock expiry.");
  const unlocked=await call(pinPath,{method:"POST",json:{pin:"0427"}});
  status(unlocked,200,"correct leading-zero PIN unlocks");
  const cookie=unlocked.headers.get("set-cookie").split(";")[0];
  check(/HttpOnly; Secure; SameSite=Lax; Max-Age=3600/.test(unlocked.headers.get("set-cookie")),"Access uses a secure HttpOnly session cookie.");
  check(!sqlite.prepare("SELECT token_hash FROM gift_sessions WHERE card_id=?").get(secret.id).token_hash.includes(cookie.split("=")[1]),"Database stores only session token hashes.");
  check(status(await call(`public/${secret.id}`,{cookie}),200,"unlocked public gift").letter==="Carta confidencial","Valid session grants the letter.");
  const protectedMedia=await call(`media/${secret.photo.id}`,{cookie});status(protectedMedia,200,"unlocked published photo");
  check(protectedMedia.headers.get("cache-control")==="private, no-store"&&protectedMedia.headers.get("x-robots-tag")==="noindex, nofollow","Protected media avoids shared caches and indexing.");
  check(status(await call(`public/${otherSecret.id}`,{cookie:cookie.replace(secret.id,otherSecret.id)}),200,"session cannot cross cards").locked===true,"Renamed cookie still cannot grant access to another card.");
  check(status(await call(`public/${secret.id}`,{cookie:`ramo_gift_${secret.id}=not-a-token`}),200,"malformed session ignored").locked===true,"Malformed session cannot open a gift.");
  sqlite.prepare("UPDATE gift_sessions SET expires_at=? WHERE card_id=?").run(Date.now()-1,secret.id);
  check(status(await call(`public/${secret.id}`,{cookie}),200,"expired session returns to PIN").locked===true,"Session expiry protects the gift again.");
  const renewed=await call(pinPath,{method:"POST",json:{pin:"0427"}});status(renewed,200,"renew session");
  const oldCookie=renewed.headers.get("set-cookie").split(";")[0];
  status(await pinPatch({enabled:true,pin:"1010"}),200,"change PIN");
  check(status(await call(`public/${secret.id}`,{cookie:oldCookie}),200,"changed PIN revokes session").locked===true,"Changing PIN revokes all existing sessions.");
  status(await call(`media/${secret.photo.id}`,{cookie:oldCookie}),403,"changed PIN revokes photo access");
  const guesses=await Promise.all(Array.from({length:5},()=>call(pinPath,{method:"POST",json:{pin:"9999"}})));
  check(guesses.every(r=>[403,429].includes(r.status))&&guesses.some(r=>r.status===429)&&sqlite.prepare("SELECT pin_failures FROM cards WHERE id=?").get(secret.id).pin_failures===5,"Concurrent wrong guesses cannot lose failed attempts.");
  status(await pinPatch({enabled:false}),200,"buyer can remove PIN");
  check(status(await call(`public/${secret.id}`),200,"PIN removal restores public gift").ready===true,"Optional protection can be removed without changing the QR.");
  status(await call(`media/${secret.photo.id}`),200,"PIN removal restores public photo");
  check(balance(pinShop.id)===0,"PIN changes and session attempts never debit credits.");
  // Phase 2: persistent typography, strict voice media, atomic batches and irreversible sealing.
  const phase2Shop=status(await call("stores",{method:"POST",user:owner,json:{name:"Phase two",email:"phase2@example.test",credits:6}}),201,"batch store").store;
  status(await call("cards/batch",{method:"POST",json:{storeId:phase2Shop.id}}),401,"anonymous cannot create batch");
  status(await call("cards/batch",{method:"POST",user:storeAUser,json:{storeId:phase2Shop.id}}),403,"store cannot create another store batch");
  const batch=status(await call("cards/batch",{method:"POST",user:owner,json:{storeId:phase2Shop.id}}),201,"atomic six-card batch").cards;
  check(batch.length===6&&new Set(batch.map(c=>c.id)).size===6&&batch.every(c=>/^\d{4}$/.test(c.pin)),"Batch has six random distinct QR paths and four digit activation codes.");
  check(balance(phase2Shop.id)===0,"Six cards charge exactly six credits at batch creation.");
  status(await call("cards/batch",{method:"POST",user:owner,json:{storeId:phase2Shop.id}}),409,"insufficient batch credits");
  check(cardCount(phase2Shop.id)===6,"Failed batch does not create partial cards or overspend.");
  const blank=batch[0], blank2=batch[1];
  check(status(await call(`public/${blank.id}`),200,"pending activation public view").pendingActivation===true,"Scan offers activation instead of editor credentials.");
  status(await call(`cards/${blank.id}/editor-link`,{method:"POST",user:owner}),403,"manager cannot bypass activation");
  const wrongPin=blank.pin==="9999"?"8888":"9999";
  for(let n=0;n<4;n++)status(await call(`activate/${blank.id}`,{method:"POST",json:{pin:wrongPin}}),403,"activation incorrect PIN counted");
  status(await call(`activate/${blank.id}`,{method:"POST",json:{pin:wrongPin}}),429,"activation locks after five tries");
  status(await call(`activate/${blank.id}`,{method:"POST",json:{pin:blank.pin}}),429,"correct activation PIN respects lock");
  sqlite.prepare("UPDATE cards SET pin_locked_until=? WHERE id=?").run(Date.now()-1,blank.id);
  const claim=status(await call(`activate/${blank.id}`,{method:"POST",json:{pin:blank.pin}}),200,"buyer claims blank QR");
  const batchEditor=tokenFrom(claim.editPath);
  status(await call(`activate/${blank.id}`,{method:"POST",json:{pin:blank.pin}}),404,"activation code cannot be reused");
  const simultaneous=await Promise.all([0,1].map(()=>call(`activate/${blank2.id}`,{method:"POST",json:{pin:blank2.pin}})));
  check(simultaneous.filter(r=>r.status===200).length===1,"Concurrent activation returns only one editor capability.");
  const options={font:"hand",align:"right",size:22,lineHeight:2.1,music:"voice",phone:"50377778888",captions:["Una tarde especial"]};
  status(await call("editor/options",{method:"PATCH",token:batchEditor,json:{options}}),200,"save letter options");
  check(status(await call("editor",{token:batchEditor}),200,"reload styled draft").card.options.align==="right","Letter options persist after reload.");
  status(await call("editor/options",{method:"PATCH",token:batchEditor,json:{options:{...options,font:"<script>"}}}),400,"font allowlist prevents injected CSS");
  status(await call("editor/options",{method:"PATCH",token:batchEditor,json:{options:{...options,phone:"javascript:alert(1)"}}}),400,"WhatsApp validates phone");
  const wav=Buffer.alloc(44+32000);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(32000,40);
  status(await call("editor/audio",{method:"POST",token:batchEditor,bytes:Buffer.from("<script>"),mime:"audio/wav"}),415,"fake audio signature rejected");
  status(await call("editor/audio",{method:"POST",token:batchEditor,bytes:wav,mime:"audio/wav"}),200,"verified one-second WAV");
  status(await call(`audio/${blank.id}`),403,"unpublished voice stays private");
  status(await call(`audio/${blank.id}`,{token:batchEditor}),200,"buyer can preview private voice");
  const longWav=Buffer.alloc(44+46*32000);wav.copy(longWav,0,0,44);longWav.writeUInt32LE(longWav.length-8,4);longWav.writeUInt32LE(longWav.length-44,40);
  status(await call("editor/audio",{method:"POST",token:batchEditor,bytes:longWav,mime:"audio/wav"}),415,"server rejects voice over 45 seconds");
  status(await call("editor",{method:"PATCH",token:batchEditor,json:{recipient:"Nuevo recuerdo",letter:"Sobre sellado",theme:"olivo"}}),200,"write batch letter");
  status(await call("editor/pin",{method:"PATCH",token:batchEditor,json:{enabled:true,pin:"8271"}}),200,"protect batch voice with separate recipient PIN");
  status(await call("editor/publish",{method:"POST",token:batchEditor}),200,"seal batch letter");
  check(sqlite.prepare("SELECT sealed FROM cards WHERE id=?").get(blank.id).sealed===1,"Batch publication seals persistently.");
  for(const [endpoint,json] of [["editor",{recipient:"No",letter:"No",theme:"rosa"}],["editor/options",{options}],["editor/pin",{enabled:false}]])status(await call(endpoint,{method:"PATCH",token:batchEditor,json}),403,"sealed content cannot change");
  status(await call("editor/photos",{method:"POST",token:batchEditor,form:pngForm()}),403,"sealed photos cannot change");
  status(await call("editor/audio",{method:"DELETE",token:batchEditor}),403,"sealed voice cannot change");
  status(await call(`cards/${blank.id}/editor-link`,{method:"POST",user:owner}),403,"manager cannot reopen sealed letter");
  status(await call(`audio/${blank.id}`),403,"published protected voice requires PIN");
  const audioUnlock=await call(`public/${blank.id}/unlock`,{method:"POST",json:{pin:"8271"}});status(audioUnlock,200,"unlock sealed gift");
  status(await call(`audio/${blank.id}`,{cookie:audioUnlock.headers.get("set-cookie").split(";")[0]}),200,"valid PIN session grants voice");
  check(balance(phase2Shop.id)===0,"Activation and sealing never debit credits twice.");
  // Phase 3: public catalog, actual acceptance, owner settings and verifiable deletion.
  const publicCatalog=status(await call("public/catalog"),200,"public commercial catalog");
  check(publicCatalog.packages.every(p=>p.active)&&publicCatalog.legal.supportEmail==="dereckenriquev@gmail.com","Public catalog uses active admin packages and approved support contact.");
  status(await call("legal-settings",{method:"PATCH",json:{}}),401,"anonymous cannot alter legal identity");
  status(await call("legal-settings",{method:"PATCH",user:storeAUser,json:{}}),403,"store cannot alter provider identity");
  status(await call("legal-settings",{method:"PATCH",user:owner,json:{legalName:"Responsable de prueba",address:"Domicilio de prueba",nit:"test-only",phone:"50300000000",supportEmail:"support@example.test",taxMode:"included"}}),200,"owner edits legal identity");
  check(status(await call("public/legal"),200,"updated public legal identity").legal.legalName==="Responsable de prueba","Public documents receive persistent owner settings.");
  status(await call("legal-settings",{method:"PATCH",user:owner,json:{supportEmail:"not-email",taxMode:"pending"}}),400,"legal support email validated");
  const privacyShop=status(await call("stores",{method:"POST",user:owner,json:{name:"Privacy fixture",email:"privacy@example.test",credits:2}}),201,"privacy fixture store").store;
  status(await call("cards",{method:"POST",user:owner,skipConsent:true,json:{storeId:privacyShop.id,recipient:"Privacy",theme:"rosa"}}),400,"card creation requires explicit acceptance");
  status(await call("cards/batch",{method:"POST",user:owner,skipConsent:true,json:{storeId:privacyShop.id}}),400,"batch requires explicit acceptance");
  check(balance(privacyShop.id)===2&&cardCount(privacyShop.id)===0,"Refusing terms does not create cards or debit credits.");
  const privacyCreated=status(await call("cards",{method:"POST",user:owner,json:{storeId:privacyShop.id,recipient:"Privacy",theme:"rosa"}}),201,"create accepted card"),privacyToken=tokenFrom(privacyCreated.editPath),privacyId=privacyCreated.card.id;
  check(status(await call("editor",{token:privacyToken}),200,"new buyer sees pending consent").card.legalAccepted===false,"Store acceptance never impersonates buyer acceptance.");
  status(await call("editor",{method:"PATCH",token:privacyToken,skipConsent:true,json:{recipient:"No",letter:"No",theme:"rosa"}}),428,"buyer must accept before saving");
  status(await call("editor/photos",{method:"POST",token:privacyToken,skipConsent:true,form:pngForm()}),428,"buyer must accept before upload");
  status(await call("editor/consent",{method:"POST",token:privacyToken,json:{consent:false}}),400,"unchecked buyer acceptance rejected");
  status(await call("editor/consent",{method:"POST",token:privacyToken,json:{consent:true}}),200,"buyer acceptance recorded");
  const acceptance=sqlite.prepare("SELECT consent_at,consent_version FROM cards WHERE id=?").get(privacyId);
  check(acceptance.consent_at>0&&acceptance.consent_version===publicCatalog.version&&sqlite.prepare("SELECT count(*) AS n FROM legal_consents WHERE actor=? AND kind='buyer'").get(privacyId).n===1,"Explicit buyer consent stores time and document version.");
  status(await call("editor",{method:"PATCH",token:privacyToken,skipConsent:true,json:{recipient:"Privacy",letter:"Private text to erase",theme:"rosa"}}),200,"accepted buyer saves without automatic test consent");
  const privacyPhoto=status(await call("editor/photos",{method:"POST",token:privacyToken,skipConsent:true,form:pngForm()}),201,"photo for deletion fixture").photo;
  status(await call("editor/audio",{method:"POST",token:privacyToken,skipConsent:true,bytes:wav,mime:"audio/wav"}),200,"voice for deletion fixture");
  status(await call("editor/pin",{method:"PATCH",token:privacyToken,skipConsent:true,json:{enabled:true,pin:"2418"}}),200,"PIN protects deletion request");
  status(await call("editor/publish",{method:"POST",token:privacyToken,skipConsent:true}),200,"publish privacy fixture");
  status(await call(`public/${privacyId}/removal-request`,{method:"POST",json:{email:"claim@example.test"}}),403,"PIN must be unlocked to request through the gift");
  const privacyUnlock=await call(`public/${privacyId}/unlock`,{method:"POST",json:{pin:"2418"}});status(privacyUnlock,200,"unlock privacy fixture");const privacyCookie=privacyUnlock.headers.get("set-cookie").split(";")[0];
  status(await call(`public/${privacyId}/removal-request`,{method:"POST",cookie:privacyCookie,json:{email:"invalid"}}),400,"requester email validated");
  const removal=status(await call(`public/${privacyId}/removal-request`,{method:"POST",cookie:privacyCookie,json:{email:"claim@example.test",reason:"Soy la persona del recuerdo."}}),202,"request verified deletion");
  const repeated=status(await call(`public/${privacyId}/removal-request`,{method:"POST",cookie:privacyCookie,json:{email:"different@example.test"}}),202,"duplicate request reuses reference");
  check(removal.reference===repeated.reference&&sqlite.prepare("SELECT count(*) AS n FROM removal_requests WHERE card_id=?").get(privacyId).n===1,"QR cannot flood duplicate requests or overwrite requester details.");
  check(status(await call(`public/${privacyId}`,{cookie:privacyCookie}),200,"request alone does not delete").ready===true,"A request never deletes another person's gift automatically.");
  status(await call("removal-requests"),401,"anonymous cannot list privacy contacts");
  status(await call("removal-requests",{user:storeAUser}),403,"store cannot see private support queue");
  status(await call(`removal-requests/${removal.reference}/approve`,{method:"POST",user:storeAUser,json:{confirmed:true}}),403,"store cannot approve deletion");
  status(await call(`removal-requests/${removal.reference}/approve`,{method:"POST",user:owner,json:{}}),400,"owner must confirm identity verification");
  const photoKey=sqlite.prepare("SELECT storage_key FROM photos WHERE id=?").get(privacyPhoto.id).storage_key,audioKey=sqlite.prepare("SELECT audio_key FROM cards WHERE id=?").get(privacyId).audio_key;
  const deleteObject=testBucket.delete;testBucket.delete=async()=>{throw Error("TEST_STORAGE_FAILURE")};
  const logError=console.error;console.error=()=>{};try{status(await call(`removal-requests/${removal.reference}/approve`,{method:"POST",user:owner,json:{confirmed:true}}),500,"storage failure leaves retryable deletion");}finally{testBucket.delete=deleteObject;console.error=logError}
  status(await call(`public/${privacyId}`,{cookie:privacyCookie}),404,"content withdrawn immediately while purge retries");
  check(sqlite.prepare("SELECT status FROM removal_requests WHERE id=?").get(removal.reference).status==="processing"&&sqlite.prepare("SELECT storage_key FROM photos WHERE id=?").get(privacyPhoto.id).storage_key===photoKey,"Failed purge retains object references for safe retry.");
  status(await call(`removal-requests/${removal.reference}/approve`,{method:"POST",user:owner,json:{confirmed:true}}),200,"retry completes active-storage purge");
  check(!objects.has(photoKey)&&!objects.has(audioKey)&&sqlite.prepare("SELECT count(*) AS n FROM photos WHERE card_id=?").get(privacyId).n===0,"Purge removes photo and voice objects and references.");
  const purged=sqlite.prepare("SELECT * FROM cards WHERE id=?").get(privacyId),done=sqlite.prepare("SELECT * FROM removal_requests WHERE id=?").get(removal.reference);
  check(purged.letter===""&&purged.sender===""&&purged.audio_key===null&&done.status==="done"&&done.email===""&&done.reason==="","Purge erases content and unnecessary requester details while retaining a minimal record.");
  status(await call(`media/${privacyPhoto.id}`,{cookie:privacyCookie}),404,"purged photo no longer served");
  status(await call(`audio/${privacyId}`,{cookie:privacyCookie}),404,"purged voice no longer served");
  status(await call(`removal-requests/${removal.reference}/approve`,{method:"POST",user:owner,json:{confirmed:true}}),200,"completed purge is idempotent");
  check(balance(privacyShop.id)===1,"Privacy requests and purge do not alter credit balance.");
  console.log(`PASS actual API handler: ${assertions} assertions; migrations ${migrations.join(", ")}; isolated SQLite/R2 only.`);
} finally {
  sqlite.close();
  objects.clear();
  delete globalThis.__ramoApiTestEnv;
}
