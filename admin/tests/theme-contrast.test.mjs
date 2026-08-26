import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The console's two palettes, measured rather than eyeballed.
 *
 * A theme fails in one specific way: a pair that was fine on white becomes two
 * shades of the same darkness, and the text is simply not there. It is
 * invisible in a screenshot of the light build and obvious only to whoever is
 * using the thing at night.
 */

const css = readFileSync(join(new URL("..", import.meta.url).pathname, "src/styles.css"), "utf8");

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const parse = (hex) => {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
};

const contrast = (fg, bg) => {
  const a = luminance(parse(fg));
  const b = luminance(parse(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** The tokens of one scope, by reading the block that defines them. */
function tokens(startsWith) {
  const at = css.indexOf(startsWith);
  assert.ok(at > 0, `${startsWith} not found`);
  const block = css.slice(at, css.indexOf("}", at));
  const found = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{3,6})/g)) found[name] = value;
  return found;
}

const light = tokens(":root {");
// Anchored on the block that carries the tokens: there is a one-line
// `:root[data-theme="dark"] { color-scheme: dark; }` before it.
const dark = tokens(':root[data-theme="dark"] { --brand-surface');

test("both palettes define the same tokens", () => {
  const missing = Object.keys(light).filter((name) => !(name in dark));
  assert.deepEqual(missing, [], `dark is missing: ${missing.join(", ")}`);
});

test("the two dark scopes agree", () => {
  // The media query and the explicit attribute are written out twice so the
  // toggle can win in both directions; they must not drift apart.
  const media = tokens(':root:not([data-theme="light"]) { --brand-surface');
  for (const [name, value] of Object.entries(dark)) {
    assert.equal(media[name], value, `${name} differs between the dark scopes`);
  }
});

test("body text is readable on every ground it sits on", () => {
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    for (const ground of ["canvas", "surface", "surface-muted", "field"]) {
      const ratio = contrast(palette.ink, palette[ground]);
      assert.ok(ratio >= 7, `${name}: ink on ${ground} is ${ratio.toFixed(2)}:1`);
      const body = contrast(palette["ink-body"], palette[ground]);
      assert.ok(body >= 4.5, `${name}: ink-body on ${ground} is ${body.toFixed(2)}:1`);
    }
    const muted = contrast(palette["ink-muted"], palette.surface);
    assert.ok(muted >= 4.5, `${name}: ink-muted on surface is ${muted.toFixed(2)}:1`);
  }
});

test("the brand reads as an accent on the canvas, and as a panel under its own ink", () => {
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    const accent = contrast(palette.brand, palette.canvas);
    assert.ok(accent >= 3, `${name}: brand on canvas is ${accent.toFixed(2)}:1`);

    // The sidebar and the primary button: a solid brand panel with ink on it.
    // This pair is why `--brand-surface` is separate from `--brand` — at night
    // the accent lightens to read on the canvas, and a panel must darken so its
    // text still does.
    const panel = contrast(palette["on-brand-solid"], palette["brand-surface"]);
    assert.ok(panel >= 4.5, `${name}: on-brand-solid on brand-surface is ${panel.toFixed(2)}:1`);
  }
});

test("a status colour is readable on its own soft ground", () => {
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    for (const kind of ["ok", "warn", "bad"]) {
      const ratio = contrast(palette[`${kind}-ink`], palette[`${kind}-soft`]);
      assert.ok(ratio >= 4.5, `${name}: ${kind}-ink on ${kind}-soft is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("night is a near-black with something in it, not pure black", () => {
  // An interface made of cards needs its edges; #000 makes every border float
  // and every shadow vanish.
  assert.notEqual(dark.canvas.toLowerCase(), "#000000");
  const separation = contrast(dark.surface, dark.canvas);
  assert.ok(separation > 1.05, `a card is indistinguishable from the page (${separation.toFixed(3)}:1)`);
});
