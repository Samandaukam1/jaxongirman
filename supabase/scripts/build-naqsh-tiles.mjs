/**
 * Builds the ornament pictures the "naqsh" deck style lays on its pages.
 *
 *   npm i --no-save sharp
 *   node supabase/scripts/build-naqsh-tiles.mjs <out dir>
 *   npx supabase --experimental storage cp -r <out dir>/naqsh ss:///design-assets/ --linked
 *
 * The colours and the shapes of the pictures are read from
 * `_shared/glass/naqsh-palette.ts`, the same table the engine colours its
 * pages from. Two seamless sources live in supabase/assets/naqsh/:
 *
 *   * the bodom (paisley) — its white shapes are set in each family's
 *     gradient, on a pale ground of the same family with a white girih lace
 *     between them, as bands and panels;
 *   * the girih (star lattice) — set in white over the family's deep
 *     gradient: a tilework wall.
 *
 * Every picture is whole tiles across its narrow side, repeated with no seam
 * in either direction, and the gradients run across the whole picture rather
 * than restarting with each tile. Pictures are drawn at twice slide resolution.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { buildEdgeModules } from "./build-edge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "../assets/naqsh");
const out = process.argv[2];
if (!out) throw new Error("usage: node build-naqsh-tiles.mjs <out dir>");

const edge = buildEdgeModules();
const { NAQSH_FAMILIES, NAQSH_FAMILY_KEYS, NAQSH_ASSETS, NAQSH_PAPER, naqshPath, paleGround, deepGround } = await import(`${edge}/glass/naqsh-palette.js`);

const SCALE = 2;
const GIRIH_PERIOD = { width: 500, height: 1486 };

/**
 * The bodom source has one dot split across its left and right edges sitting
 * in a square of white (x 0–97 and 3441–3499, y 547–687). It is redrawn:
 * cleared, then drawn again centred on x 16 so it wraps onto the right edge,
 * white inside a black ring, continuing across the join like every shape.
 */
function repairBodom(data, info) {
  const cx = 16;
  const cy = 617;
  for (let y = 547; y <= 687; y += 1) {
    for (const [x0, x1] of [[0, 97], [3441, info.width - 1]]) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x <= 97 ? x - cx : x - (info.width + cx);
        const d = Math.hypot(dx, y - cy);
        const o = (y * info.width + x) * 4;
        if (d <= 64) { data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = 255; }
        else if (d <= 70) { data[o] = data[o + 1] = data[o + 2] = 0; data[o + 3] = 255; }
        else data[o + 3] = 0;
      }
    }
  }
}

/** A source as one RGBA buffer, repaired, cropped to one period. */
async function period(file, crop, repair) {
  const { data, info } = await sharp(path.join(source, file)).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  repair?.(data, info);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const bodomPeriod = await period("bodom-source.png", { left: 0, top: 0, width: 3500, height: 3500 }, repairBodom);
const girihPeriod = await period("girih-source.png", { left: 0, top: 0, ...GIRIH_PERIOD });

/** Coverage 0–1 of a layer over a whole picture, the tile repeated from the top-left. */
async function coverage(tile, tileWidth, tileHeight, width, height, pick) {
  const { data, info } = await sharp(tile).resize(tileWidth, tileHeight, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const covered = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = ((y % info.height) * info.width + (x % info.width)) * 4;
      covered[y * width + x] = pick(data[o + 3] / 255, (data[o] + data[o + 1] + data[o + 2]) / 765);
    }
  }
  return covered;
}

const mix = (from, to, t) => from.map((value, index) => value + (to[index] - value) * t);
/** Down the picture and a little across it: one flow for the whole picture. */
const along = (x, y, width, height) => Math.min(1, Math.max(0, (y / height) * 0.85 + (x / width) * 0.15));

async function bodomPicture(family, asset) {
  const width = Math.round(asset.width * SCALE);
  const height = Math.round(asset.height * SCALE);
  const tile = Math.round(asset.tile * SCALE);
  const laceWidth = Math.round(tile / 2);
  const laceHeight = Math.round((laceWidth * GIRIH_PERIOD.height) / GIRIH_PERIOD.width);
  const shapes = await coverage(bodomPeriod, tile, tile, width, height, (a, lum) => a * lum);
  const lace = await coverage(girihPeriod, laceWidth, laceHeight, width, height, (a) => a * 0.5);
  const [groundFrom, groundTo] = paleGround(family);
  const { deep, bright } = NAQSH_FAMILIES[family];
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const t = along(x, y, width, height);
      let color = mix(groundFrom, groundTo, t);
      color = color.map((value) => value + (255 - value) * lace[i]);
      const ink = mix(deep, bright, t);
      color = color.map((value, n) => value + (ink[n] - value) * shapes[i]);
      pixels[i * 3] = color[0]; pixels[i * 3 + 1] = color[1]; pixels[i * 3 + 2] = color[2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

async function girihPicture(family, asset) {
  const width = Math.round(asset.width * SCALE);
  const height = Math.round(asset.height * SCALE);
  const tileWidth = Math.round(asset.tile * SCALE);
  const tileHeight = Math.round((tileWidth * GIRIH_PERIOD.height) / GIRIH_PERIOD.width);
  const lines = await coverage(girihPeriod, tileWidth, tileHeight, width, height, (a) => a * 0.62);
  const [from, to] = deepGround(family);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const ground = mix(from, to, along(x, y, width, height));
      const color = ground.map((value) => value + (255 - value) * lines[i]);
      pixels[i * 3] = color[0]; pixels[i * 3 + 1] = color[1]; pixels[i * 3 + 2] = color[2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

for (const family of NAQSH_FAMILY_KEYS) {
  for (const [name, asset] of Object.entries(NAQSH_ASSETS)) {
    const picture = asset.pattern === "bodom" ? await bodomPicture(family, asset) : await girihPicture(family, asset);
    const file = path.join(out, naqshPath(family, name));
    mkdirSync(path.dirname(file), { recursive: true });
    await picture.jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(file);
    console.log(file);
  }
}

// The paper: the girih in ink over transparency, for every family alike.
{
  const width = Math.round(NAQSH_PAPER.width * SCALE);
  const height = Math.round(NAQSH_PAPER.height * SCALE);
  const tileWidth = Math.round(NAQSH_PAPER.tile * SCALE);
  const tileHeight = Math.round((tileWidth * GIRIH_PERIOD.height) / GIRIH_PERIOD.width);
  const lines = await coverage(girihPeriod, tileWidth, tileHeight, width, height, (a) => a);
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < lines.length; i += 1) {
    pixels[i * 4] = 22; pixels[i * 4 + 1] = 20; pixels[i * 4 + 2] = 26; pixels[i * 4 + 3] = Math.round(lines[i] * 255);
  }
  const file = path.join(out, NAQSH_PAPER.path);
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, palette: true, effort: 10 }).toFile(file);
  console.log(file);
}
