import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Dark mode, checked by arithmetic rather than by eye.
 *
 * A palette swap fails in one specific way: a colour pair that was fine on a
 * white canvas becomes two shades of the same darkness, and the text is simply
 * not there. It is invisible in a screenshot of the light build, invisible in
 * a typecheck, and obvious only to the person holding the phone at night.
 *
 * So the pairs are read out of the source — every style object that sets both a
 * foreground and a background — and measured in both palettes. Nothing here
 * knows what the screens look like; it knows what a person can read.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hex;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parse(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)).concat(1);
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

/** Alpha is resolved against whatever the colour is drawn on. */
function over(colour, ground) {
  const [r, g, b, a] = colour;
  if (a >= 1) return [r, g, b];
  return [0, 1, 2].map((i) => colour[i] * a + ground[i] * (1 - a));
}

function contrast(fg, bg, ground) {
  const back = over(bg, ground);
  const front = over(fg, back.concat(1));
  const a = luminance(front);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The palettes, read from source rather than imported: this is a .ts module. */
function palettes() {
  const src = readFileSync(join(ROOT, "src/theme/palettes.ts"), "utf8");
  const read = (name) => {
    const at = src.indexOf(`export const ${name}: Palette = {`);
    assert.ok(at > 0, `${name} palitrasi topilmadi`);
    const body = src.slice(at, src.indexOf("\n};", at));
    const out = {};
    for (const [, key, value] of body.matchAll(/^\s{2}(\w+):\s*("(?:[^"]+)"),/gm)) {
      out[key] = JSON.parse(value);
    }
    return out;
  };
  return { light: read("light"), dark: read("dark") };
}

function brandInk() {
  const src = readFileSync(join(ROOT, "src/theme/tokens.ts"), "utf8");
  const body = src.slice(src.indexOf("export const brandInk = {"), src.indexOf("} as const;", src.indexOf("export const brandInk = {")));
  const out = {};
  for (const [, key, value] of body.matchAll(/^\s{2}(\w+):\s*("(?:[^"]+)"),/gm)) out[key] = JSON.parse(value);
  return out;
}

function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) found.push(path);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "src"));
  return found;
}

/**
 * Every style object that states both a text colour and a fill under it.
 *
 * Only same-object pairs: a `color` whose background is set two components up
 * cannot be resolved from the source, and guessing at it would produce failures
 * nobody can act on.
 *
 * Either side may be a literal, which is the case worth catching most — a
 * themed ink laid on a hard-coded surface is exactly the pairing that survives
 * a palette swap in the type system and dies on the screen.
 */
const REF = String.raw`(?:(colors|brandInk)\.(\w+)|("(?:#[0-9A-Fa-f]{3,8}|rgba?\([^"]*\))"))`;

function reference(match, at) {
  if (match[at]) return { from: match[at], key: match[at + 1] };
  if (match[at + 2]) return { literal: JSON.parse(match[at + 2]) };
  return null;
}

function pairs() {
  const out = [];
  for (const path of sources()) {
    const src = readFileSync(path, "utf8");
    for (const [, body] of src.matchAll(/\{([^{}]*)\}/g)) {
      const fg = new RegExp(String.raw`(?:^|[\s,])color:\s*` + REF).exec(body);
      const bg = new RegExp(String.raw`backgroundColor:\s*` + REF).exec(body);
      if (!fg || !bg) continue;
      out.push({ file: path.slice(ROOT.length), fg: reference(fg, 1), bg: reference(bg, 1) });
    }
  }
  return out;
}

const { light, dark } = palettes();
const ink = brandInk();

const lookup = (scheme, ref) => {
  if (!ref) return null;
  if (ref.literal) return ref.literal;
  return ref.from === "brandInk" ? ink[ref.key] : scheme[ref.key];
};

const name = (ref) => (ref.literal ? ref.literal : `${ref.from}.${ref.key}`);

test("both palettes define exactly the same tokens", () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  assert.ok(Object.keys(light).length > 20, "palitra juda kichik — o‘qish buzilgan");
});

test("the canvas and the ink on it are readable in both palettes", () => {
  for (const [name, scheme] of [["yorug‘", light], ["qorong‘i", dark]]) {
    const ground = parse(scheme.canvas).slice(0, 3);
    for (const key of ["ink", "inkMuted", "primary", "danger", "success", "warning"]) {
      const ratio = contrast(parse(scheme[key]), parse(scheme.canvas), ground);
      // 4.5:1 for body ink; the accents carry meaning and never carry it alone,
      // so 3:1 — the large-text and non-text floor — is where they are held.
      const floor = key === "ink" ? 4.5 : 3;
      assert.ok(ratio >= floor, `${name}: ${key} kanvasda ${ratio.toFixed(2)}:1 — kamida ${floor}`);
    }
    const onSurface = contrast(parse(scheme.ink), parse(scheme.surface), ground);
    assert.ok(onSurface >= 4.5, `${name}: kartadagi matn ${onSurface.toFixed(2)}:1`);
    const muted = contrast(parse(scheme.inkMuted), parse(scheme.surfaceMuted), ground);
    assert.ok(muted >= 3, `${name}: so‘nik matn so‘nik yuzada ${muted.toFixed(2)}:1`);
  }
});

test("a colour named `on<Surface>` is readable on the surface it is named for", () => {
  for (const [name, scheme] of [["yorug‘", light], ["qorong‘i", dark]]) {
    const ground = parse(scheme.canvas).slice(0, 3);
    for (const [fg, bg, floor] of [
      ["onPrimary", "primary", 4.5],
      ["onBrandNotApplicable", null, 0],
    ]) {
      if (!bg) continue;
      const ratio = contrast(parse(scheme[fg]), parse(scheme[bg]), ground);
      assert.ok(ratio >= floor, `${name}: ${fg} ${bg} ustida ${ratio.toFixed(2)}:1`);
    }
  }
});

test("brand ink is readable on the brand gradients, which never change", () => {
  const src = readFileSync(join(ROOT, "src/theme/tokens.ts"), "utf8");
  const block = src.slice(src.indexOf("export const gradients = {"), src.indexOf("} as const;", src.indexOf("export const gradients = {")));
  const stops = [...block.matchAll(/\[("#[0-9A-Fa-f]{6}"),\s*("#[0-9A-Fa-f]{6}")\]/g)]
    .flatMap((match) => [JSON.parse(match[1]), JSON.parse(match[2])]);
  assert.ok(stops.length >= 10, "gradiyentlar o‘qilmadi");

  const thin = stops
    .map((stop) => [stop, contrast(parse(ink.strong), parse(stop), parse(stop).slice(0, 3))])
    .filter(([, ratio]) => ratio < 3)
    .map(([stop, ratio]) => `${stop} — ${ratio.toFixed(2)}:1`);
  assert.deepEqual(thin, [], `oq matn o‘qilmaydigan gradiyent to‘xtashlari:\n${thin.join("\n")}`);
  // The plate is white, so its ink has to be dark enough to sit on white.
  const onPlate = contrast(parse(ink.onPlate), parse(ink.plate), [255, 255, 255]);
  assert.ok(onPlate >= 4.5, `plastinka siyohi ${onPlate.toFixed(2)}:1`);
});

test("every stated foreground/background pair in the app survives both palettes", () => {
  const found = pairs();
    // A floor, not a target: if a refactor stops the scan from matching, this
  // test would otherwise pass by finding nothing at all.
  assert.ok(found.length >= 40, `juftliklar topilmadi (${found.length})`);

  const failures = [];
  for (const pair of found) {
    for (const scheme of [{ ...light, label: "yorug‘" }, { ...dark, label: "qorong‘i" }]) {
      const fg = lookup(scheme, pair.fg);
      const bg = lookup(scheme, pair.bg);
      if (!fg || !bg) continue;
      const ground = parse(scheme.canvas).slice(0, 3);
      const ratio = contrast(parse(fg), parse(bg), ground);
      // 3:1 rather than 4.5: many of these are badge and chip labels set bold
      // at small sizes, and holding every one of them to body-text contrast
      // would fail pairs a person reads without difficulty.
      if (ratio < 3) {
        failures.push(`${pair.file}: ${name(pair.fg)} on ${name(pair.bg)} — ${scheme.label} ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `o‘qib bo‘lmaydigan juftliklar:\n${failures.join("\n")}`);
});
