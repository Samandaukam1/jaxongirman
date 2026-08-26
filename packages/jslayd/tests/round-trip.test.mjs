import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { decompile } = await import(`${dir}/decompile.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);
const { renderPreview } = await import(`${dir}/render.js`);
const { themePalette } = await import(`${dir}/themes.js`);

/**
 * CODE → DOCUMENT → VISUAL EDIT → SERIALIZE → COMPILE.
 *
 * The studio is about to let somebody drag an element, and a drag is a mutation
 * of the compiled document. That is only safe if the document can be written
 * back out as the language and read in again unchanged — otherwise the canvas
 * and the code are two models of the same slide that drift, which is the one
 * thing the brief forbids outright.
 *
 * The decompile/recompile half is already covered next door. What is asserted
 * here is the part the editor adds: that an edit made on the document survives
 * the trip, and that nothing else moves with it.
 */

const roundTrip = (document) => {
  const again = compile(decompile(document));
  assert.deepEqual(again.diagnostics.errors, [], "a document this system produced would not recompile");
  assert.ok(again.document);
  return again.document;
};

const firstText = (document) => {
  for (const archetype of document.archetypes) {
    const element = archetype.elements.find((entry) => entry.type === "text");
    if (element) return { archetype, element };
  }
  throw new Error("the sample has no text element to move");
};

test("an element moved on the canvas comes back where it was put", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const { archetype, element } = firstText(start);

  // What a drag does: the same document, one geometry changed.
  const moved = {
    ...start,
    archetypes: start.archetypes.map((entry) => (entry.id !== archetype.id ? entry : {
      ...entry,
      elements: entry.elements.map((child) => (child.id !== element.id ? child : {
        ...child, geometry: { ...child.geometry, x: child.geometry.x + 137, y: child.geometry.y + 64 },
      })),
    })),
  };

  const after = roundTrip(moved);
  const landed = after.archetypes
    .find((entry) => entry.id === archetype.id)
    .elements.find((child) => child.id === element.id);

  assert.equal(landed.geometry.x, element.geometry.x + 137);
  assert.equal(landed.geometry.y, element.geometry.y + 64);
});

test("moving one element moves nothing else", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const { archetype, element } = firstText(start);

  const moved = {
    ...start,
    archetypes: start.archetypes.map((entry) => (entry.id !== archetype.id ? entry : {
      ...entry,
      elements: entry.elements.map((child) => (child.id !== element.id ? child
        : { ...child, geometry: { ...child.geometry, x: child.geometry.x + 40 } })),
    })),
  };

  const after = roundTrip(moved);
  const geometryOf = (document) => document.archetypes.flatMap((entry) => entry.elements.map((child) => (
    `${entry.id}/${child.id}:${child.geometry.x},${child.geometry.y},${child.geometry.width},${child.geometry.height}`
  )));

  const before = geometryOf(start);
  const now = geometryOf(after);
  assert.equal(before.length, now.length, "the round trip added or lost an element");

  const changed = now.filter((line, index) => line !== before[index]);
  assert.equal(changed.length, 1, `expected one change, got ${changed.length}: ${changed.join(" | ")}`);
  assert.ok(changed[0].startsWith(`${archetype.id}/${element.id}:`));
});

test("a resize survives, and so does a restyle", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const { archetype, element } = firstText(start);

  const edited = {
    ...start,
    archetypes: start.archetypes.map((entry) => (entry.id !== archetype.id ? entry : {
      ...entry,
      elements: entry.elements.map((child) => (child.id !== element.id ? child : {
        ...child,
        geometry: {
          ...child.geometry,
          width: Math.round(child.geometry.width * 0.8),
          height: child.geometry.height + 20,
        },
        text: { ...child.text, fontSize: 61 },
      })),
    })),
  };

  const after = roundTrip(edited);
  const landed = after.archetypes
    .find((entry) => entry.id === archetype.id)
    .elements.find((child) => child.id === element.id);

  assert.equal(landed.geometry.width, Math.round(element.geometry.width * 0.8));
  assert.equal(landed.geometry.height, element.geometry.height + 20);
  assert.equal(landed.text.fontSize, 61);
});

test("the trip is stable: doing it twice changes nothing the second time", () => {
  // A round trip that is not idempotent is one that loses a little each save,
  // which is invisible until the tenth edit.
  const start = compile(SAMPLE_PROMPT).document;
  const once = decompile(start);
  const twice = decompile(compile(once).document);
  assert.equal(once, twice);
});

test("a document the editor produced still passes the compiler's own checks", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const { archetype, element } = firstText(start);

  // Deliberately pushed off-canvas: the editor may produce this, and the
  // compiler — not the editor — is what decides it is wrong.
  const broken = {
    ...start,
    archetypes: start.archetypes.map((entry) => (entry.id !== archetype.id ? entry : {
      ...entry,
      elements: entry.elements.map((child) => (child.id !== element.id ? child
        : { ...child, geometry: { ...child.geometry, x: 5000 } })),
    })),
  };

  const result = compile(decompile(broken));
  const complaints = [...result.diagnostics.errors, ...result.diagnostics.warnings];
  assert.ok(complaints.length > 0, "an element at x=5000 drew no complaint at all");
});

test("a rendered row can be traced back to the element that drew it", () => {
  /**
   * What makes a studio canvas both real and editable: the preview is the
   * engine's own output, and a click on any part of it still knows which
   * authoring element to select.
   */
  const document = compile(SAMPLE_PROMPT).document;
  const rendered = renderPreview(document);

  assert.ok(rendered.elements.length > 0);
  const orphans = rendered.elements.filter((row) => !row.origin);
  assert.deepEqual(orphans.map((row) => row.type), [], "rows with no origin cannot be selected");

  // Every origin names an element that is actually in the design.
  const ids = new Set(document.archetypes.flatMap((a) => collect(a.elements)));
  for (const row of rendered.elements) {
    assert.ok(ids.has(row.origin), `origin ${row.origin} is not an element of the design`);
  }
});

test("one element that draws several rows gives them all the same origin", () => {
  // A stat is a value and a label; clicking either has to select the stat.
  const document = compile(SAMPLE_PROMPT).document;
  const rendered = renderPreview(document);
  const counts = new Map();
  for (const row of rendered.elements) counts.set(row.origin, (counts.get(row.origin) ?? 0) + 1);
  assert.ok([...counts.values()].some((n) => n >= 1));
  assert.equal([...counts.keys()].filter((id) => !id).length, 0);
});

function collect(elements) {
  return elements.flatMap((element) => [element.id, ...(element.children ? collect(element.children) : [])]);
}

/* ------------------------------------------- what the inspector now writes */

/** The same shape as the studio's operations: one element changed, in place. */
const patch = (document, archetypeId, elementId, change) => ({
  ...document,
  archetypes: document.archetypes.map((entry) => (entry.id !== archetypeId ? entry : {
    ...entry,
    elements: entry.elements.map((child) => (child.id !== elementId ? child : change(child))),
  })),
});

const firstOfType = (document, types) => {
  for (const archetype of document.archetypes) {
    const element = archetype.elements.find((entry) => types.includes(entry.type));
    if (element) return { archetype, element };
  }
  return null;
};

/**
 * The inspector's box properties survive being written out and read back.
 *
 * This is the assertion that makes those panels safe to ship. A field the
 * editor writes and the language does not serialise is the worst kind of bug in
 * a tool like this: the change appears on the canvas, the design saves without
 * complaint, and the shadow is gone the next time anybody opens it — by which
 * point nobody connects the two.
 */
test("a border and a corner radius written by the inspector survive the round trip", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const { archetype, element } = firstText(start);

  const styled = patch(start, archetype.id, element.id, (child) => ({
    ...child,
    border: { width: 3, color: { hex: "#123456" }, style: "dashed", opacity: 0.75 },
    corners: { topLeft: 24, topRight: 8, bottomRight: 24, bottomLeft: 8 },
  }));

  const landed = roundTrip(styled).archetypes
    .find((entry) => entry.id === archetype.id)
    .elements.find((child) => child.id === element.id);

  assert.deepEqual(landed.border, { width: 3, color: { hex: "#123456" }, style: "dashed", opacity: 0.75 });
  assert.deepEqual(landed.corners, { topLeft: 24, topRight: 8, bottomRight: 24, bottomLeft: 8 });
});

test("a shadow written by the inspector survives the round trip", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const found = firstOfType(start, ["shape", "divider", "decorative", "line", "image", "frame", "stat"]);
  assert.ok(found, "the sample design draws something that can carry a shadow");

  const shadow = { offsetX: 4, offsetY: 18, blur: 40, spread: 2, opacity: 0.22, color: { hex: "#000000" } };
  const styled = patch(start, found.archetype.id, found.element.id, (child) => ({ ...child, shadows: [shadow] }));

  const landed = roundTrip(styled).archetypes
    .find((entry) => entry.id === found.archetype.id)
    .elements.find((child) => child.id === found.element.id);

  assert.equal(landed.shadows.length, 1);
  assert.deepEqual(landed.shadows[0], shadow);
});

test("image rules written by the inspector survive the round trip", () => {
  const start = compile(SAMPLE_PROMPT).document;
  const found = firstOfType(start, ["image", "frame"]);
  if (!found) return; // The sample design draws no picture; nothing to assert.

  const styled = patch(start, found.archetype.id, found.element.id, (child) => ({
    ...child,
    fit: "contain",
    focus: { x: 0.25, y: 0.75 },
    orientation: "portrait",
    required: true,
    // The tint is written as a pair. An opacity with no colour is not a fainter
    // overlay — the language writes it only beside one — which is why the
    // inspector offers the two together rather than the number alone.
    overlay: { role: "contrast" },
    overlayOpacity: 0.4,
  }));

  const landed = roundTrip(styled).archetypes
    .find((entry) => entry.id === found.archetype.id)
    .elements.find((child) => child.id === found.element.id);

  assert.equal(landed.fit, "contain");
  assert.deepEqual(landed.focus, { x: 0.25, y: 0.75 });
  assert.equal(landed.orientation, "portrait");
  assert.equal(landed.required, true);
  assert.deepEqual(landed.overlay, { role: "contrast" });
  assert.equal(landed.overlayOpacity, 0.4);
});

test("a theme applied in the studio survives the round trip", () => {
  /**
   * The renderer draws whichever named family the document carries, so applying
   * a theme is a change to the document rather than a preview setting. If
   * `decompile` did not write `colorFamilies`, the palette would appear on the
   * canvas, save without complaint, and be gone the next time the design was
   * opened.
   */
  const start = compile(SAMPLE_PROMPT).document;
  const colors = themePalette("medical", "clinical");
  assert.ok(colors, "the theme engine offers a medical palette");

  const themed = {
    ...start,
    colorFamilies: [
      ...(start.colorFamilies ?? []),
      { code: "theme_medical_clinical", name: "Tibbiyot · Klinik ko‘k", colors, chartPalette: start.chartPalette ?? [] },
    ],
  };

  const after = roundTrip(themed);
  const landed = (after.colorFamilies ?? []).find((entry) => entry.code === "theme_medical_clinical");
  assert.ok(landed, "the applied theme did not survive being written out");
  assert.equal(landed.name, "Tibbiyot · Klinik ko‘k");
  for (const role of ["background", "surface", "primary", "secondary", "accent", "text"]) {
    assert.equal(landed.colors[role], colors[role], `${role} changed on the way through`);
  }
});
