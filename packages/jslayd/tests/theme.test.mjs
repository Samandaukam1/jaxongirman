import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { THEME_FAMILIES, GRADIENT_PRESETS, auditFamily, themePalette, themeVariants } = await import(`${dir}/themes.js`);
const { extractPalette, harmonise, temper, toHsl, veilFor } = await import(`${dir}/palette.js`);
const { contrastRatio, readableOn } = await import(`${dir}/colors.js`);

/**
 * A palette that cannot be read is not a taste question, so every variant this
 * product ships is measured rather than admired.
 */

test("every theme variant is readable, on every ground it offers", () => {
  const broken = [];
  for (const { familyId, variant } of themeVariants()) {
    const colors = themePalette(familyId, variant.id);
    assert.ok(colors, `${familyId}/${variant.id} produced no palette`);
    const problems = auditFamily(colors);
    if (problems.length > 0) broken.push(`${familyId}/${variant.id}: ${problems.join(", ")}`);
  }
  assert.deepEqual(broken, []);
});

test("the sixteen families the brief asks for are all there, with variants", () => {
  assert.equal(THEME_FAMILIES.length, 16);
  for (const family of THEME_FAMILIES) {
    assert.ok(family.variants.length >= 2, `${family.id} has only ${family.variants.length} variant`);
    assert.ok(family.name && family.description, `${family.id} is unnamed`);
  }
  const ids = THEME_FAMILIES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate family id");
});

test("a theme is a full family, derived the same way an authored one is", () => {
  const colors = themePalette("medical", "clinical");
  // Roles the variant never states, filled by `deriveColorFamily` rather than
  // by the theme having its own idea of what a border is.
  for (const role of ["surface", "surfaceAlt", "border", "muted", "textOnPrimary"]) {
    assert.ok(colors[role], `${role} was not derived`);
  }
});

test("an unknown family is null rather than a default nobody chose", () => {
  assert.equal(themePalette("nonexistent"), null);
  // A known family with an unknown variant falls back to that family's first.
  assert.deepEqual(themePalette("medical", "nope"), themePalette("medical", "clinical"));
});

test("gradients are written in roles, so a theme change moves them", () => {
  for (const preset of GRADIENT_PRESETS) {
    assert.ok(preset.stops.length >= 2, `${preset.id} is not a gradient`);
    assert.ok(["linear", "radial"].includes(preset.type));
    for (const stop of preset.stops) {
      assert.equal(typeof stop.role, "string", `${preset.id} has a literal stop`);
      assert.ok(stop.position >= 0 && stop.position <= 100);
    }
  }
  assert.ok(GRADIENT_PRESETS.some((p) => p.stops.length === 3), "no three-stop preset");
  assert.ok(GRADIENT_PRESETS.some((p) => p.stops.length >= 4), "no four-stop preset");
});

/* ------------------------------------------------------------ from an image */

/** A block of one colour, as RGBA bytes. */
const block = (hex, count) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) out.set([r, g, b, 255], i * 4);
  return out;
};
const join = (...blocks) => {
  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
};

test("the colour a person would point at wins, not the one with most pixels", () => {
  // A muddy grey covering most of the frame, and one saturated subject.
  const pixels = join(block("#8A8A88", 800), block("#D94F2B", 200));
  const palette = extractPalette(pixels);
  assert.ok(toHsl(palette.dominant).s > 0.3, `dominant came back grey: ${palette.dominant}`);
});

test("near-white and near-black become the neutrals, not the hue", () => {
  const palette = extractPalette(join(block("#FFFFFF", 500), block("#0A0A0A", 500), block("#2E86C1", 300)));
  assert.ok(toHsl(palette.lightNeutral).l > 0.85);
  assert.ok(toHsl(palette.darkNeutral).l < 0.2);
  assert.ok(toHsl(palette.dominant).s > 0.2, "the one hue in the picture was lost");
});

test("a photograph's colour is tempered before anything uses it", () => {
  // Neon, and nearly black: both are what a camera gives and neither is usable.
  const neon = temper("#00FF6A");
  const murk = temper("#050A07");
  // Not exactly at the clamp: the value round-trips through hex, which
  // quantises it. What matters is that a highlighter became a colour.
  assert.ok(toHsl(neon).s <= 0.65, `saturation was not clamped: ${toHsl(neon).s}`);
  assert.ok(toHsl(neon).s < toHsl("#00FF6A").s - 0.3);
  assert.ok(toHsl(murk).l >= 0.21, `lightness was not clamped: ${toHsl(murk).l}`);
  assert.ok(toHsl(murk).l > toHsl("#050A07").l + 0.15);
  // The hue survives — that is the whole point of taking it from the image.
  assert.ok(Math.abs(toHsl(neon).h - toHsl("#00FF6A").h) < 1);
});

test("an image supplies a hue; it does not repaint the deck", () => {
  const theme = themePalette("medical", "clinical");
  const image = extractPalette(join(block("#F2C744", 600), block("#E86AA6", 400)));
  const { colors, applied } = harmonise(theme, image);

  // The ground and the ink are the theme's, always.
  assert.equal(colors.background, theme.background);
  assert.equal(colors.text, theme.text);
  assert.ok(applied.length > 0, "the image changed nothing at all");
  assert.ok(applied.every((role) => ["accent", "secondary", "primary"].includes(role)),
    `an image touched a role it should not: ${applied.join(", ")}`);
});

test("a colour that disappears into the background is refused, and the theme's is kept", () => {
  /**
   * The refusal that can actually happen. An accent needs to be seen against
   * the ground; an accent the colour of the page is not an accent, however
   * readable its own ink is.
   */
  // A theme whose own ground is mid-toned, which is where this can bite: after
  // tempering, a candidate lands in the same band the background occupies.
  const theme = { ...themePalette("minimal", "paper"), background: "#8C8C8C" };
  const image = {
    dominant: "#8F8F8F", secondary: "#8F8F8F", accent: "#8F8F8F",
    lightNeutral: "#FFFFFF", darkNeutral: "#000000",
  };
  const { colors, applied, rejected } = harmonise(theme, image, ["accent"]);
  assert.equal(applied.length, 0, "an invisible accent was applied anyway");
  assert.ok(rejected.some((entry) => /ajralmaydi/.test(entry.reason)), "a refusal with no reason recorded");
  assert.equal(colors.accent, theme.accent);
});

test("a grey photograph does not tint the deck", () => {
  // The saturation floor, applied blindly, gives a neutral hue 0 and turns
  // concrete into rose. A picture with no colour in it contributes none.
  const grey = temper("#FBFBFB");
  assert.ok(toHsl(grey).s < 0.06, `a neutral was given a hue: ${grey}`);
  const dim = temper("#3A3A3A");
  assert.ok(toHsl(dim).s < 0.06, `a neutral was given a hue: ${dim}`);
});

test("every colour has an ink that reads on it, which is why there is no such refusal", () => {
  // The invariant the harmoniser leans on, asserted rather than assumed: the
  // black and white curves cross around luminance 0.18 and both clear 4.5 there.
  for (const hex of ["#000000", "#7F7F7F", "#B4B4B4", "#FFFFFF", "#2E86C1", "#F2C744"]) {
    const ratio = contrastRatio(readableOn(hex), hex);
    assert.ok(ratio >= 4.5, `${hex} has no readable ink (${ratio.toFixed(2)}:1)`);
  }
});

test("whatever an image is applied to still holds its own ink", () => {
  const theme = themePalette("business", "navy");
  const image = extractPalette(join(block("#1F6F3F", 500), block("#C24A1B", 300)));
  const { colors } = harmonise(theme, image);
  assert.ok(contrastRatio(colors.textOnPrimary, colors.primary) >= 4.5);
  assert.ok(contrastRatio(colors.textOnAccent, colors.accent) >= 4.5);
  assert.ok(contrastRatio(colors.text, colors.background) >= 4.5);
});

test("text over a photograph gets the veil it needs, and no more", () => {
  const bright = extractPalette(block("#F5F0E6", 400));
  const dark = extractPalette(block("#14181F", 400));

  const overBright = veilFor(bright);
  const overDark = veilFor(dark);
  assert.equal(overBright.ink, "#000000");
  assert.equal(overDark.ink, "#FFFFFF");
  // A quiet image needs no scrim at all; that is the "and no more" half.
  assert.equal(overDark.opacity, 0, `a dark image was veiled anyway (${overDark.opacity})`);
  assert.ok(overBright.opacity <= 0.85);
});
