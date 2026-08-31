import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * A deck, drawn and photographed.
 *
 * Every other check in this repository reads rows and reasons about them. That
 * catches geometry and misses everything a person sees: type that wraps into
 * the wrong shape, a scrim that is too dark, a photograph cropped through its
 * subject, a colour that is technically readable and looks wrong.
 *
 * So this draws the stored rows the way the app draws them — the same 1000-wide
 * model, the same absolute geometry, the same styles — and takes a picture of
 * each page with the browser already on this machine. What comes out is a PNG
 * somebody can look at, which is the only way to audit a design.
 *
 *   PID=<presentation id> node supabase/tests/render-deck.mjs
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const presentationId = process.env.PID;
if (!url || !serviceKey || !presentationId) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PID are required.");
  process.exit(1);
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT ?? "/tmp/deck";
const SCALE = 2;
const WIDTH = 1000;
const HEIGHT = 562.5;

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const escape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A signed URL, because the buckets these pictures live in are private. */
async function pictureFor(content) {
  const bucket = content?.storageBucket;
  const path = content?.storagePath;
  if (typeof content?.url === "string") return content.url;
  if (typeof bucket !== "string" || typeof path !== "string") return null;
  const signed = await service.storage.from(bucket).createSignedUrl(path, 600);
  return signed.data?.signedUrl ?? null;
}

function gradientCss(style) {
  const stops = Array.isArray(style?.gradientStops) ? style.gradientStops : null;
  if (!stops || stops.length < 2) return null;
  const angle = Number(style.gradientAngle ?? 180);
  const parts = stops.map((stop) => `${stop.color ?? "#000"} ${Number(stop.offset ?? 0)}%`);
  return `linear-gradient(${angle}deg, ${parts.join(", ")})`;
}

async function slideHtml(slide, elements) {
  const background = slide.background ?? {};
  const ground = gradientCss(background) ?? background.color ?? "#ffffff";
  const drawn = [];

  for (const row of [...elements].sort((a, b) => a.z_index - b.z_index)) {
    const style = row.style ?? {};
    const content = row.content ?? {};
    const box = `position:absolute;left:${row.x}px;top:${row.y}px;width:${row.width}px;height:${row.height}px;opacity:${row.opacity ?? 1};`;

    if (row.type === "text") {
      /**
       * The text sits flush against its tags.
       *
       * `pre-wrap` renders the indentation of the template itself, so the
       * first line of every heading arrived pushed ten spaces to the right —
       * a fault in the tool that reads exactly like a fault in the deck, which
       * is the worst kind of tool.
       */
      const type = [
        `width:100%`,
        `color:${style.color ?? "#111"}`,
        `font-size:${style.fontSize ?? 16}px`,
        `line-height:${style.lineHeight ?? 20}px`,
        `text-align:${style.textAlign ?? "left"}`,
        `font-weight:${style.fontWeight ?? 400}`,
        `letter-spacing:${style.letterSpacing ?? 0}px`,
        `font-family:'${String(style.fontFamily ?? "Helvetica").replace(/'/g, "")}',Helvetica,Arial,sans-serif`,
        "white-space:pre-wrap",
        "overflow-wrap:break-word",
      ].join(";");
      drawn.push(`<div style="${box}display:flex;align-items:center;"><div style="${type}">${escape(content.text)}</div></div>`);
      continue;
    }
    if (row.type === "image") {
      const src = await pictureFor(content);
      drawn.push(src
        ? `<img src="${src}" style="${box}object-fit:${style.objectFit ?? "cover"};border-radius:${style.borderRadius ?? 0}px;" />`
        : `<div style="${box}background:#d8d8d8;border-radius:${style.borderRadius ?? 0}px;"></div>`);
      continue;
    }
    if (row.type === "chart") {
      const values = Array.isArray(content.values) ? content.values : [];
      const labels = Array.isArray(content.labels) ? content.labels : [];
      const palette = Array.isArray(style.palette) ? style.palette : ["#888"];
      const top = Math.max(...values, 1);
      const bars = values.map((value, at) =>
        `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;">
           <div style="width:70%;height:${(value / top) * 70}%;background:${palette[at % palette.length]};border-radius:4px;"></div>
           <div style="font-size:9px;color:#666;">${escape(labels[at])}</div></div>`).join("");
      drawn.push(`<div style="${box}display:flex;gap:6px;align-items:flex-end;">${bars}</div>`);
      continue;
    }
    if (row.type === "line") {
      drawn.push(`<div style="${box}display:flex;align-items:center;"><div style="width:100%;height:${style.strokeWidth ?? 2}px;background:${style.color ?? "#000"};"></div></div>`);
      continue;
    }
    const fill = gradientCss(style) ?? style.fill ?? "transparent";
    drawn.push(`<div style="${box}background:${fill};border-radius:${style.borderRadius ?? 0}px;
      border:${style.borderWidth ? `${style.borderWidth}px solid ${style.borderColor ?? "#ccc"}` : "none"};"></div>`);
  }

  return `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#222;">
  <div style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;background:${ground};overflow:hidden;">
    ${drawn.join("\n")}
  </div>
</body>`;
}

const deck = await service.from("presentations").select("title,topic,design_engine").eq("id", presentationId).single();
const slides = await service.from("slides").select("id,position,background,quality_score").eq("presentation_id", presentationId).order("position");
const elements = await service.from("slide_elements").select("*").eq("presentation_id", presentationId);
if (slides.error || elements.error) throw slides.error ?? elements.error;

mkdirSync(OUT, { recursive: true });
console.log(`«${deck.data?.title ?? deck.data?.topic}» — ${deck.data?.design_engine ?? "jslayd"} — ${(slides.data ?? []).length} slayd\n`);

for (const slide of slides.data ?? []) {
  const mine = (elements.data ?? []).filter((row) => row.slide_id === slide.id);
  const html = await slideHtml(slide, mine);
  const page = `${OUT}/slide-${String(slide.position).padStart(2, "0")}.html`;
  const shot = `${OUT}/slide-${String(slide.position).padStart(2, "0")}.png`;
  writeFileSync(page, html);
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    `--screenshot=${shot}`,
    `--window-size=${WIDTH},${Math.round(HEIGHT)}`,
    `--force-device-scale-factor=${SCALE}`,
    `file://${page}`,
  ], { stdio: "ignore", timeout: 60_000 });
  console.log(`  ${String(slide.position).padStart(2)}  ${String(slide.quality_score).padStart(3)}/100  ${String(mine.length).padStart(2)} element  →  ${shot}`);
}
console.log(`\n${OUT} ichida ${(slides.data ?? []).length} ta rasm.`);
