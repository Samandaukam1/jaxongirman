import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { decompile } = await import(`${dir}/decompile.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);

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
