/**
 * Painting Liquid Glass rows as HTML, for previews.
 *
 * The same vocabulary the renderers draw — absolute boxes, gradients, glass —
 * so a contact sheet shows what the phone shows. Shared by `glass-preview.mjs`
 * (a sample deck composed locally) and `deck-preview.mjs` (a real deck read
 * from the database).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------ the paint */

const css = (value) => String(value).replace(/"/g, "&quot;");
export const hexA = (hex) => {
  const body = String(hex ?? "").replace("#", "");
  if (body.length < 6) return "transparent";
  const a = body.length >= 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
  return `rgba(${Number.parseInt(body.slice(0, 2), 16)},${Number.parseInt(body.slice(2, 4), 16)},${Number.parseInt(body.slice(4, 6), 16)},${a.toFixed(3)})`;
};
const stops = (list) => list.map((stop) => `${hexA(stop.color)} ${stop.offset}%`).join(", ");

/** A CSS angle as the two ends of an SVG gradient on the unit square. */
const gradientEnds = (angle) => {
  const radians = ((angle ?? 135) * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return `x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}"`;
};
let gradientId = 0;

/** Per-corner radii when the row carries them (an arch), else its one radius. */
const corners = (s) => Array.isArray(s.borderRadiusCorners) && s.borderRadiusCorners.length === 4
  ? s.borderRadiusCorners.map((r) => `${r}px`).join(" ")
  : `${s.borderRadius ?? 0}px`;

export function paint(row, imageUrl = (row) => row.content.url ?? "") {
  const s = row.style;
  const box = `position:absolute;left:${row.x}px;top:${row.y}px;width:${row.width}px;${row.type === "text" ? `min-height:${row.height}px` : `height:${row.height}px`};transform:rotate(${row.rotation}deg);opacity:${row.opacity};box-sizing:border-box;`;
  if (row.type === "icon") {
    const vector = row.content.vector;
    if (!vector) return "";
    const id = `icon-${gradientId++}`;
    const graded = Array.isArray(s.gradientStops) && s.gradientStops.length >= 2;
    const defs = graded
      ? `<defs><linearGradient id="${id}" ${gradientEnds(s.gradientAngle)}>${s.gradientStops.map((stop) => `<stop offset="${stop.offset}%" stop-color="${hexA(stop.color)}"/>`).join("")}</linearGradient></defs>`
      : "";
    const fill = graded ? `url(#${id})` : hexA(s.color);
    const shadow = s.iconShadow
      ? `filter:drop-shadow(${s.iconShadow.dx}px ${s.iconShadow.dy}px ${s.iconShadow.blur}px ${hexA(s.iconShadow.color + Math.round(s.iconShadow.opacity * 255).toString(16).padStart(2, "0"))});`
      : "";
    return `<svg style="${box}${shadow}overflow:visible" viewBox="0 0 ${vector.box} ${vector.box}">${defs}${vector.paths.map((path) => `<path d="${path.d}" fill="${fill}" opacity="${path.opacity}"/>`).join("")}</svg>`;
  }
  if (row.type === "text") {
    return `<div style="${box}font-family:'${s.fontFamily}','Manrope',sans-serif;font-size:${s.fontSize}px;line-height:${s.lineHeight}px;color:${hexA(s.color)};text-align:${s.textAlign};letter-spacing:${s.letterSpacing ?? 0}px;white-space:pre-wrap;">${String(row.content.text).replace(/</g, "&lt;")}</div>`;
  }
  if (row.type === "line") {
    return `<div style="${box}"><div style="margin-top:${row.height / 2 - (s.strokeWidth ?? 1) / 2}px;height:${s.strokeWidth ?? 1}px;background:${hexA(s.color)}"></div></div>`;
  }
  if (row.type === "image") {
    const src = imageUrl(row);
    return `<img src="${css(src)}" style="${box}object-fit:cover;border-radius:${corners(s)}">`;
  }
  if (row.type === "chart") {
    const values = row.content.values;
    const series = s.series;
    if (row.content.chartType === "donut") {
      const total = values.reduce((a, b) => a + b, 0) || 1;
      let at = 0;
      const radius = row.width / 2 - s.strokeWidth / 2;
      const circumference = 2 * Math.PI * radius;
      const arcs = values.map((value, index) => {
        const length = (value / total) * circumference;
        const arc = `<circle cx="${row.width / 2}" cy="${row.height / 2}" r="${radius}" fill="none" stroke="${hexA(series[index % series.length])}" stroke-width="${s.strokeWidth}" stroke-dasharray="${length} ${circumference}" stroke-dashoffset="${-at}" transform="rotate(-90 ${row.width / 2} ${row.height / 2})"/>`;
        at += length;
        return arc;
      }).join("");
      return `<svg style="${box}" width="${row.width}" height="${row.height}"><circle cx="${row.width / 2}" cy="${row.height / 2}" r="${radius}" fill="none" stroke="${hexA(s.trackColor)}" stroke-width="${s.strokeWidth}"/>${arcs}</svg>`;
    }
    const max = Math.max(...values, 1);
    const band = 18;
    const plot = row.height - band;
    const gap = s.gap ?? 10;
    const bw = (row.width - gap * (values.length - 1)) / values.length;
    const bars = values.map((value, index) => {
      const h = Math.max(2, (value / max) * plot * 0.88);
      const x = index * (bw + gap);
      return `<rect x="${x}" y="${plot - h}" width="${bw}" height="${h}" rx="${Math.min(bw / 2, s.cornerRadius ?? 6)}" fill="${hexA(series[index % series.length])}"/>`
        + `<text x="${x + bw / 2}" y="${plot - h - 5}" fill="${hexA(s.labelColor)}" font-size="${s.labelSize}" text-anchor="middle" font-family="Manrope">${value}</text>`
        + `<text x="${x + bw / 2}" y="${row.height - 3}" fill="${hexA(s.labelColor)}" font-size="${s.labelSize}" text-anchor="middle" font-family="Manrope">${row.content.labels[index]}</text>`;
    }).join("");
    return `<svg style="${box}" width="${row.width}" height="${row.height}">${bars}</svg>`;
  }
  // shape
  const ellipse = s.shape === "ellipse";
  const radius = ellipse ? "50%" : corners(s);
  let background = s.fill ? hexA(s.fill) : "transparent";
  if (Array.isArray(s.gradientStops) && s.gradientStops.length >= 2) {
    background = s.gradientType === "radial"
      ? `radial-gradient(closest-side, ${stops(s.gradientStops)})`
      : `linear-gradient(${s.gradientAngle ?? 135}deg, ${stops(s.gradientStops)})`;
  }
  const border = s.stroke ? `border:${s.strokeWidth ?? 1}px solid ${hexA(s.stroke)};` : "";
  const shadow = Array.isArray(s.shadows) && s.shadows[0]
    ? `box-shadow:${s.shadows[0].offsetX ?? 0}px ${s.shadows[0].offsetY ?? 0}px ${s.shadows[0].blur ?? 0}px ${hexA(s.shadows[0].color + Math.round((s.shadows[0].opacity ?? 0.2) * 255).toString(16).padStart(2, "0"))};`
    : "";
  const blur = s.backdropBlur ? `backdrop-filter:blur(${s.backdropBlur}px) saturate(160%);` : "";
  return `<div style="${box}border-radius:${radius};background:${background};${border}${shadow}${blur}"></div>`;
}

export function slideHtml(slide, imageUrl) {
  const bg = slide.background;
  const ground = bg.gradientStops ? `linear-gradient(${bg.gradientAngle}deg, ${stops(bg.gradientStops)})` : hexA(bg.color);
  return `<div class="slide" style="background:${ground}">${slide.rows.map((row) => paint(row, imageUrl)).join("")}</div>`;
}

export function fontFaces(deck, { outDir, supabaseUrl }) {
  const seen = new Set();
  const rules = [];
  for (const slide of deck) for (const row of slide.rows) {
    const s = row.style;
    if (row.type !== "text" || !s.fontAsset || seen.has(s.fontFamily)) continue;
    seen.add(s.fontFamily);
    // Cached beside the pictures, so a screenshot never races a download.
    const local = path.join(outDir, "fonts", s.fontAsset.replace(/\//g, "_"));
    if (!existsSync(local)) {
      mkdirSync(path.dirname(local), { recursive: true });
      execFileSync("curl", ["-sf", "-o", local, `${supabaseUrl}/storage/v1/object/public/design-fonts/${s.fontAsset.split("/").map(encodeURIComponent).join("/")}`]);
    }
    rules.push(`@font-face{font-family:'${s.fontFamily}';src:url('file://${local}');}`);
  }
  return rules.join("\n");
}


const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** One deck as a two-column contact sheet: writes `<name>.html` and `<name>.png` into `outDir`. */
/**
 * Where a row's picture is read from: the public catalogue (the naqsh
 * ornaments, design assets) by its public address — or, before those are
 * uploaded, from the folder `NAQSH_LOCAL` names — and anything else as the
 * caller resolves it.
 */
function resolver(supabaseUrl, imageUrl) {
  return (row) => {
    const bucket = row.content.storageBucket;
    const where = row.content.storagePath;
    if (bucket === "design-assets" && where) {
      if (process.env.NAQSH_LOCAL && where.startsWith("naqsh/")) return `file://${process.env.NAQSH_LOCAL}/${where}`;
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${where}`;
    }
    return (imageUrl ?? ((one) => one.content.url ?? ""))(row);
  };
}

export function contactSheet({ deck, caption, outDir, name, supabaseUrl, imageUrl: given, scale = 0.62 }) {
  const imageUrl = resolver(supabaseUrl, given);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaces(deck, { outDir, supabaseUrl })}
    body{margin:0;background:#202024;font-family:Manrope}
    .grid{display:grid;grid-template-columns:repeat(2, ${1000 * scale}px);gap:14px;padding:14px}
    .cell{width:${1000 * scale}px;height:${562.5 * scale}px;overflow:hidden;border-radius:6px}
    .slide{position:relative;width:1000px;height:562.5px;overflow:hidden;transform:scale(${scale});transform-origin:0 0}
    .cap{color:#aaa;font:12px Manrope;padding:0 14px}
  </style></head><body><div class="cap">${caption}</div>
  <div class="grid">${deck.map((slide) => `<div class="cell">${slideHtml(slide, imageUrl)}</div>`).join("")}</div></body></html>`;
  const file = path.join(outDir, `${name}.html`);
  writeFileSync(file, html);
  const rowsCount = Math.ceil(deck.length / 2);
  const height = Math.ceil(30 + rowsCount * (562.5 * scale + 14) + 14);
  const png = path.join(outDir, `${name}.png`);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${Math.ceil(1000 * scale * 2 + 42)},${height}`, `--screenshot=${png}`,
    "--virtual-time-budget=10000", `file://${file}`], { stdio: "ignore" });
  return png;
}
