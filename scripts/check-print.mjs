import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, "work");
mkdirSync(work, { recursive: true });
const source = readFileSync(path.join(root, "lib", "print-card.ts"), "utf8");
const generated = path.join(work, "print-renderer.generated.mjs");
writeFileSync(generated, stripTypeScriptTypes(source, { mode: "strip" }), "utf8");
const { renderCardSVG, renderPrintHTML, renderQRSVG, qrMarkup } = await import(pathToFileURL(generated).href);
const publicUrl = "https://ramo-recuerdos-floristerias.civilchub131.chatgpt.site/muestra";
const svg = await renderCardSVG({ publicUrl, storeName: "Floristería · Ramo", recipient: "Alguien especial", theme: "rosa", sample: true });
writeFileSync(path.join(work, "print-card.svg"), svg, "utf8");

// The smaller physical card must carry a physically larger, public-only QR.
assert.match(svg, /width="65mm" height="85mm" viewBox="0 0 650 850"/);
assert.match(svg, /<svg x="95" y="255" width="460" height="460"/);
assert.equal(65 * (460 / 650), 46);
assert.ok(46 > 40, "The QR must be larger than the previous 40 mm QR.");
assert.ok(svg.includes(publicUrl));
assert.ok(!svg.includes("personalizar/"));
assert.ok(!svg.includes("Bearer "));
assert.ok(!svg.includes("editor-link"));
assert.ok(svg.includes("MUESTRA · NO ES UNA VENTA"));

// User text may never introduce SVG elements, attributes or scripts.
const escaped = await renderCardSVG({ publicUrl, storeName: 'Flores & <Rosas> "Día"', recipient: '<script>alert(1)</script>', theme: "olivo" });
assert.ok(escaped.includes("&amp;"));
assert.ok(escaped.includes("&lt;ROSAS&gt;"));
assert.ok(escaped.includes("&quot;DÍA&quot;"));
assert.ok(escaped.includes("&lt;script&gt;"));
assert.ok(!escaped.includes("<script>"));
assert.ok(!escaped.includes("<Rosas>"));

// Inspect the QR drawing itself. All black modules must leave four empty cells on each side.
const qr = qrMarkup(publicUrl);
const modules = [...qr.inner.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((match) => [Number(match[1]), Number(match[2])]);
assert.ok(modules.length > 100, "A QR must contain a substantial matrix, not a decorative placeholder.");
assert.equal(Math.min(...modules.map(([column]) => column)), 4);
assert.equal(Math.min(...modules.map(([, row]) => row)), 4);
assert.equal(Math.max(...modules.map(([column]) => column)), qr.modules - 5);
assert.equal(Math.max(...modules.map(([, row]) => row)), qr.modules - 5);
const plainQR = await renderQRSVG(publicUrl);
assert.match(plainQR, /width="46mm" height="46mm"/);
writeFileSync(path.join(work, "print-qr.svg"), plainQR, "utf8");

// Six identical 65×85 mm cards, with eight-millimetre gaps, fit one A4 sheet.
const sixUp = renderPrintHTML(svg, { paper: "a4", copies: 6 });
assert.equal((sixUp.match(/<div class="card">/g) || []).length, 6);
assert.match(sixUp, /size:A4 portrait/);
assert.ok(sixUp.includes('viewBox="-30 -30 710 910"'));
assert.ok(sixUp.includes("width:65mm;height:85mm"));
assert.ok(sixUp.includes("6 copias de la misma tarjeta"));
assert.ok(2 * 65 + 8 <= 210 - 2 * 10);
assert.ok(3 * 85 + 2 * 8 + 2 * 3 <= 297 - 2 * 10);
for (const count of [1, 2, 4, 6]) {
  const sheet = renderPrintHTML(svg, { paper: "a4", copies: count });
  assert.equal((sheet.match(/<div class="card">/g) || []).length, count);
}
assert.equal((renderPrintHTML(svg).match(/<div class="card">/g) || []).length, 6);
assert.equal((renderPrintHTML(svg, { copies: 99 }).match(/<div class="card">/g) || []).length, 6);
assert.equal((renderPrintHTML(svg, { copies: NaN }).match(/<div class="card">/g) || []).length, 6);
writeFileSync(path.join(work, "print-a4.html"), sixUp, "utf8");
const single = renderPrintHTML(svg, { paper: "card", copies: 6 });
assert.equal((single.match(/<div class="card">/g) || []).length, 1);
assert.match(single, /size:65mm 85mm/);
writeFileSync(path.join(work, "print-single.html"), single, "utf8");
await assert.rejects(() => renderCardSVG({ publicUrl: "javascript:alert(1)", storeName: "Ramo", recipient: "María", theme: "rosa" }));

let pngCreated = false;
try {
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(svg), { density: 180 }).png().toFile(path.join(work, "print-card.png"));
  await sharp(Buffer.from(plainQR), { density: 240 }).png().toFile(path.join(work, "print-qr.png"));
  pngCreated = true;
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND" && !String(error?.message).includes('Could not load the "sharp" module')) throw error;
  console.warn("Vista PNG opcional no disponible; las comprobaciones vectoriales sí se ejecutaron.");
}
console.log(JSON.stringify({ ok: true, publicUrl, card: "65×85 mm", qr: "46×46 mm", quietZoneModules: 4, a4Copies: 6, pngCreated, files: ["work/print-card.svg", "work/print-qr.svg", "work/print-a4.html", "work/print-single.html"] }, null, 2));
const withoutLogo = await renderCardSVG({publicUrl, storeName:"Tienda", recipient:"Ana", theme:"rosa", printColor:"#123456", logoMode:"none", logoDataUrl:"ignored when hidden"});
assert.ok(!withoutLogo.includes("<image"), "Hidden logo must not enter printed artwork.");
assert.ok(withoutLogo.includes('fill="#123456"'), "Hiding the logo preserves the custom card color.");
