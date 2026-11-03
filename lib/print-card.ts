import QRCode from "qrcode";

export type CardTheme = "rosa" | "olivo" | "noche";
export interface PrintCardOptions {
  publicUrl: string;
  storeName: string;
  recipient: string;
  theme: CardTheme | string;
  sample?: boolean;
  logoDataUrl?: string | null;
  logoMode?: "original" | "tinted" | "none";
  printColor?: string | null;
}

const themes = {
  rosa: { paper: "#fff9f4", ink: "#29463b", muted: "#7f706d", bloom: "#ba777b", leaf: "#a1ac94", border: "#dcc9c0" },
  olivo: { paper: "#f7f8ee", ink: "#2f4534", muted: "#70796a", bloom: "#9b8c5e", leaf: "#7e9575", border: "#cfd5be" },
  noche: { paper: "#203f34", ink: "#fff8e9", muted: "#d1d8c9", bloom: "#e2b7a3", leaf: "#9eb9a0", border: "#6c8775" },
} as const;

type Palette = { paper: string; ink: string; muted: string; bloom: string; leaf: string; border: string };
function rgb(hex: string): number[] { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
function mix(background: string, foreground: string, weight: number): string {
  const a = rgb(background), b = rgb(foreground);
  return "#" + a.map((value, index) => Math.round(value * (1 - weight) + b[index] * weight).toString(16).padStart(2, "0")).join("");
}
export function cardPalette(theme: string, custom?: string | null): Palette {
  if (custom === null || custom === undefined) return themes[theme as CardTheme] ?? themes.rosa;
  if (!/^#[0-9a-f]{6}$/i.test(custom)) throw new Error("Escribe un color válido, por ejemplo #B87D91.");
  const paper = custom.toLowerCase();
  const lightContrast = 1.05 / (luminance(paper) + .05);
  const darkContrast = (luminance(paper) + .05) / (luminance("#152b22") + .05);
  const ink = lightContrast >= darkContrast ? "#ffffff" : "#152b22";
  return { paper, ink, muted: mix(paper, ink, .78), bloom: mix(paper, ink, .62), leaf: mix(paper, ink, .48), border: mix(paper, ink, .28) };
}

// Only embedded raster images can enter downloadable artwork. Never accept a remote URL or SVG.
export function validatedLogoDataUrl(value?: string | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 4 * 1024 * 1024 || match[2].length % 4 !== 0) throw new Error("La imagen de la tienda debe ser PNG, JPEG o WebP de hasta 3 MB.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)); }
  catch { throw new Error("No pudimos leer la imagen de la tienda."); }
  const png = bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const webp = bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16))) && new DataView(bytes.buffer).getUint32(4, true) + 8 === bytes.length;
  if (!(match[1] === "image/png" && png || match[1] === "image/jpeg" && jpeg || match[1] === "image/webp" && webp)) throw new Error("El contenido de la imagen no coincide con su formato.");
  if (png) {
    const view = new DataView(bytes.buffer), width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 10000 || height > 10000) throw new Error("La imagen tiene dimensiones no admitidas.");
  }
  return value;
}

function logoArtwork(dataUrl: string, mode: "original" | "tinted", palette: Palette): string {
  const outline = mix(palette.paper, luminance(palette.paper) > .4 ? "#000000" : "#ffffff", .38);
  const id = "ramo-logo-tone-" + palette.paper.slice(1) + palette.ink.slice(1);
  const filter = mode === "tinted" ? `<defs><filter id="${id}" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB"><feFlood flood-color="white" result="background"/><feComposite in="SourceGraphic" in2="background" operator="over"/><feColorMatrix type="saturate" values="0"/><feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" divisor="1" bias="0" preserveAlpha="true"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .333 .333 .333 0 0"/><feComponentTransfer result="${id}-edges"><feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1"/></feComponentTransfer><feFlood flood-color="${outline}"/><feComposite operator="in" in2="${id}-edges"/></filter></defs>` : "";
  return `${filter}<image x="260" y="44" width="130" height="90" preserveAspectRatio="xMidYMid meet" href="${escapeSVG(dataUrl)}"${mode === "tinted" ? ` filter="url(#${id})"` : ""}/>`;
}

export function escapeSVG(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function lines(value: string, width: number, maximum: number): string[] {
  const words = String(value).trim().replace(/\s+/g, " ").slice(0, 100).split(" ");
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width && current) {
      result.push(current);
      current = word;
    } else current = (current + " " + word).trim();
  }
  if (current) result.push(current);
  if (result.length > maximum) {
    result.length = maximum;
    result[maximum - 1] = result[maximum - 1].slice(0, width - 1) + "…";
  }
  return result.map((line) => line.length > width + 8 ? line.slice(0, width + 7) + "…" : line);
}

export function qrMarkup(publicUrl: string): { inner: string; modules: number } {
  const parsed = new URL(publicUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("El QR necesita un enlace web válido.");
  const qr = QRCode.create(parsed.href, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (qr.modules.get(row, column)) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return {
    modules: size + quiet * 2,
    inner: `<rect width="100%" height="100%" fill="#ffffff"/><path d="${path}" fill="#152b22"/>`,
  };
}

export async function renderQRSVG(publicUrl: string): Promise<string> {
  const qr = qrMarkup(publicUrl);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="46mm" height="46mm" viewBox="0 0 ${qr.modules} ${qr.modules}" shape-rendering="crispEdges" role="img"><title>Código QR para abrir la felicitación</title><desc>${escapeSVG(publicUrl)}</desc>${qr.inner}</svg>`;
}

function branch(stem: string, leaf: string, blossom: string): string {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M0 0C48-66 66-122 70-204M26-45C7-82-1-111-2-144M53-104C95-121 120-149 136-178M65-162C39-189 28-213 29-246" stroke="${stem}" stroke-width="3"/><g fill="${leaf}" fill-opacity=".13" stroke="${leaf}" stroke-width="2.5"><path d="M26-45C-5-49-28-78-24-102C7-97 26-72 26-45Z"/><path d="M53-103C82-106 101-89 102-70C76-66 54-82 53-103Z"/><path d="M70-178C92-182 108-204 102-226C79-220 69-198 70-178Z"/><path d="M30-213C7-216-8-235-8-256C13-252 29-237 30-213Z"/><path d="M111-147C132-143 153-154 160-173C138-180 119-166 111-147Z"/></g><g transform="translate(68,-255)" stroke="${blossom}" stroke-width="2.7" fill="${blossom}" fill-opacity=".06"><path d="M0 0C-38-9-42-37-23-45C-23-70 10-76 23-53C46-52 52-21 28-9C24 14 4 18 0 0Z"/><path d="M-3-7C-22-14-24-30-11-34C-6-48 13-46 18-33C35-27 29-9 12-7C5 2-2 2-3-7Z"/><path d="M-4-20C0-32 15-31 16-20C13-11 3-11-4-20Z"/></g><g transform="translate(-4,-151)" stroke="${blossom}" stroke-width="2.5" fill="${blossom}" fill-opacity=".08"><path d="M0 0C-30-8-33-31-15-37C-10-58 17-54 21-35C44-24 30-1 13-2C10 12 1 13 0 0Z"/><path d="M-3-14C-15-27 1-39 12-29C28-19 10-7-3-14Z"/></g></g>`;
}

export async function renderCardSVG(options: PrintCardOptions): Promise<string> {
  const t = cardPalette(options.theme, options.printColor);
  const logo = options.logoMode === "none" ? null : validatedLogoDataUrl(options.logoDataUrl);
  if (options.logoMode !== undefined && !["original", "tinted", "none"].includes(options.logoMode)) throw new Error("Elige cómo integrar la imagen de la tienda.");
  const qr = qrMarkup(options.publicUrl);
  const shop = lines(options.storeName || "Tu floristería", logo ? 28 : 32, 2);
  const recipient = lines(`Para ${options.recipient || "alguien especial"}`, 29, 2);
  const host = new URL(options.publicUrl).hostname;
  const footer = options.sample ? "MUESTRA · NO ES UNA VENTA" : host.slice(0, 56);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="65mm" height="85mm" viewBox="0 0 650 850" role="img" aria-labelledby="card-title card-description">
<title id="card-title">Tarjeta de ${escapeSVG(options.storeName || "tu floristería")} para ${escapeSVG(options.recipient || "alguien especial")}</title>
<desc id="card-description">Tarjeta floral de 65 por 85 milímetros, con QR de 46 por 46 milímetros y margen libre de cuatro módulos. El código QR abre ${escapeSVG(options.publicUrl)}. Solo permite ver la felicitación.</desc>
<rect width="650" height="850" rx="10" fill="${t.paper}"/>
<rect x="22" y="22" width="606" height="806" rx="5" fill="none" stroke="${t.border}" stroke-width="1.3"/>
<path d="M48 132V48H137M513 48H602V132M48 718V802H137M513 802H602V718" fill="none" stroke="${t.border}" stroke-width="1.3"/>
<g transform="translate(552,208) rotate(-12) scale(.48)" opacity=".78">${branch(t.leaf, t.leaf, t.bloom)}</g>
<g transform="translate(44,816) rotate(43) scale(.36)" opacity=".7">${branch(t.leaf, t.leaf, t.bloom)}</g>
${logo ? logoArtwork(logo, options.logoMode === "tinted" ? "tinted" : "original", t) : ""}
${shop.map((line, i) => `<text x="325" y="${(logo ? 158 : 73) + i * (logo ? 20 : 23)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${logo ? 16 : 17}" letter-spacing="${logo ? 1.2 : 1.8}" fill="${t.ink}">${escapeSVG(line.toUpperCase())}</text>`).join("")}
${logo ? "" : `<path d="M278 115H372" stroke="${t.bloom}" stroke-width="1.6"/>`}
${recipient.map((line, i) => `<text x="325" y="${(logo ? 205 : 156) + i * (logo ? 26 : 31)}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-style="italic" font-size="${logo ? 24 : 27}" fill="${t.ink}">${escapeSVG(line)}</text>`).join("")}
${logo ? "" : `<text x="325" y="224" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="23" fill="${t.ink}">Un detalle que florece.</text>`}
<rect x="83" y="243" width="484" height="484" rx="9" fill="#ffffff"/>
<svg x="95" y="255" width="460" height="460" viewBox="0 0 ${qr.modules} ${qr.modules}" shape-rendering="crispEdges">${qr.inner}</svg>
<text x="325" y="767" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="${t.ink}">Escanea tu regalo</text>
<text x="325" y="806" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${options.sample ? 16 : 12.5}" letter-spacing="${options.sample ? 1 : .25}" fill="${t.muted}">${escapeSVG(footer)}</text>
</svg>`;
}

export function renderPrintHTML(svg: string, options: { copies?: number; paper?: "a4" | "card" } = {}): string {
  const paper = options.paper === "card" ? "card" : "a4";
  const requested = Number.isFinite(options.copies) ? Number(options.copies) : 6;
  const copies = paper === "card" ? 1 : Math.max(1, Math.min(6, Math.floor(requested)));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>Ramo — tarjeta lista para imprimir</title><style>
@page{size:${paper === "card" ? "65mm 85mm" : "A4 portrait"};margin:${paper === "card" ? "0" : "10mm"}}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:white}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,sans-serif}.sheet{display:grid;grid-template-columns:${paper === "card" ? "65mm" : "65mm 65mm"};gap:8mm;${paper === "a4" ? "width:138mm;margin:3mm auto" : "width:65mm;margin:0"}}.card{position:relative;width:65mm;height:85mm;break-inside:avoid;page-break-inside:avoid}.card>svg:not(.marks){display:block;width:65mm;height:85mm}.marks{position:absolute;left:-3mm;top:-3mm;width:71mm;height:91mm;pointer-events:none;overflow:visible}@media screen{body{background:#eaece6;padding:20px}.sheet{box-shadow:0 0 0 10mm white;background:white}.note{max-width:680px;margin:0 auto 28px;color:#29463b;line-height:1.6;text-align:center}}@media print{.note{display:none}}
</style></head><body><p class="note">Tarjeta 65 × 85 mm, con QR de 46 × 46 mm. Imprime al <strong>100 % / tamaño real</strong>, sin encabezados ni pies de página. ${paper === "a4" ? `${copies} ${copies === 1 ? "copia" : "copias"} de la misma tarjeta. Recorta siguiendo las guías exteriores.` : "Selecciona papel personalizado de 65 × 85 mm."}</p><main class="sheet">${Array.from({ length: copies }, () => `<div class="card">${svg}${paper === "a4" ? '<svg class="marks" viewBox="-30 -30 710 910" aria-hidden="true"><path d="M-25 0H-5M0-25V-5M655 0H675M650-25V-5M-25 850H-5M0 855V875M655 850H675M650 855V875" fill="none" stroke="#9eaaa1" stroke-width="1.6"/></svg>' : ""}</div>`).join("")}</main></body></html>`;
}

export function renderLogoSVG(dataUrl:string,mode:"original"|"tinted",theme:string,color?:string|null):string{
 const logo=validatedLogoDataUrl(dataUrl);if(!logo)throw Error("Logo no válido.");return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="240 35 170 110">${logoArtwork(logo,mode,cardPalette(theme,color))}</svg>`;
}
