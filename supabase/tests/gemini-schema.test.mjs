import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { toGeminiSchema } = await import(`${edge}/gemini-schema.js`);

/**
 * One schema, two vendors.
 *
 * The plan schemas are written once, for OpenAI's strict mode, and the renderer
 * is built against exactly those shapes. Gemini accepts a narrower dialect. A
 * second hand-written copy would drift, and the copy that drifted would be the
 * one producing decks — so the translation is code, and this is the test that
 * it stays faithful.
 */

test("what Gemini does not understand is dropped, not passed through", () => {
  const converted = toGeminiSchema({
    type: "object",
    additionalProperties: false,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    strict: true,
    properties: { title: { type: "string" } },
    required: ["title"],
  });

  assert.equal("additionalProperties" in converted, false, "Gemini rejects a schema carrying it");
  assert.equal("$schema" in converted, false);
  assert.equal("strict" in converted, false);
  assert.equal(converted.type, "object");
  assert.deepEqual(converted.required, ["title"]);
});

test("a nullable union becomes a nullable field, which is the same promise", () => {
  const converted = toGeminiSchema({ type: ["string", "null"] });
  assert.equal(converted.type, "string");
  assert.equal(converted.nullable, true);
});

test("a plain type is left exactly as it was", () => {
  const converted = toGeminiSchema({ type: "string", description: "a title" });
  assert.deepEqual(converted, { type: "string", description: "a title" });
  assert.equal("nullable" in converted, false, "nothing is made nullable that was not");
});

test("the translation reaches all the way down", () => {
  const converted = toGeminiSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            subtitle: { type: ["string", "null"] },
          },
          required: ["title", "subtitle"],
        },
      },
    },
    required: ["slides"],
  });

  const item = converted.properties.slides.items;
  assert.equal("additionalProperties" in item, false, "a nested object is converted too");
  assert.equal(item.properties.subtitle.nullable, true);
  assert.equal(item.properties.subtitle.type, "string");
  assert.deepEqual(item.required, ["title", "subtitle"]);
});

test("enums and array bounds survive, because they are what constrain the answer", () => {
  const converted = toGeminiSchema({
    type: "array",
    minItems: 3,
    maxItems: 5,
    items: { type: "string", enum: ["cover", "statistic", "quote"] },
  });
  assert.equal(converted.minItems, 3);
  assert.equal(converted.maxItems, 5);
  assert.deepEqual(converted.items.enum, ["cover", "statistic", "quote"]);
});

/* --------------------------------------------------------- nullable unions */

const { contentSchema, editorOperationsSchema, outlineSchema, rewriteSchema } =
  await import(`${edge}/plan-schema.js`);

test("«this or nothing» survives the crossing", () => {
  /**
   * OpenAI's strict mode has no `nullable`, so the only way it can say a field
   * is optional is `anyOf: [X, { type: "null" }]`. Gemini has `nullable` and no
   * `type: "null"`. The same promise, two vocabularies — and dropping it,
   * which is what happened before, does not loosen the schema. It empties it.
   */
  const converted = toGeminiSchema({
    anyOf: [
      { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },
      { type: "null" },
    ],
  });

  assert.equal(converted.type, "object", "an empty schema is invalid, not permissive");
  assert.equal(converted.nullable, true);
  assert.deepEqual(converted.required, ["text"]);
  assert.equal("anyOf" in converted, false, "one member and null is a nullable member");
});

test("a union of real alternatives stays a union", () => {
  const converted = toGeminiSchema({
    anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
  });
  assert.equal(converted.nullable, true);
  assert.deepEqual(converted.anyOf, [{ type: "string" }, { type: "number" }]);
});

test("what the wrapper says about itself outranks the member", () => {
  const converted = toGeminiSchema({
    description: "The quotation, if the research contained one.",
    anyOf: [{ type: "object", description: "a quotation", properties: {} }, { type: "null" }],
  });
  assert.equal(converted.description, "The quotation, if the research contained one.");
  assert.equal(converted.type, "object");
});

/**
 * Every node Gemini is actually asked to honour has a type.
 *
 * This is the check that would have caught the writing stage failing in
 * production. `quote`, `statistic`, `chart` and `table` were each converted to
 * `{}`, Gemini refused the whole request with an HTTP 400, and the old routing
 * read that as a reason to bill the other vendor — so the schema bug stayed
 * invisible for exactly as long as that account had money in it.
 *
 * Written against the real schemas rather than a sample, because the bug was
 * not in the converter's idea of a schema. It was in ours.
 */
function typelessNodes(node, path = "$", insideProperties = false) {
  if (Array.isArray(node)) return node.flatMap((entry, index) => typelessNodes(entry, `${path}[${index}]`));
  if (!node || typeof node !== "object") return [];

  const found = [];
  // A `properties` map is a bag of schemas, not a schema. Everything else that
  // reaches here is a node Gemini will try to read.
  if (!insideProperties) {
    if (Object.keys(node).length === 0) found.push(`${path} is empty`);
    else if (!("type" in node) && !("anyOf" in node)) found.push(`${path} has no type`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "required" || key === "enum" || key === "propertyOrdering") continue;
    found.push(...typelessNodes(value, `${path}.${key}`, key === "properties"));
  }
  return found;
}

test("every schema the pipeline sends converts to something Gemini can read", () => {
  const schemas = {
    presentation_outline: outlineSchema(10),
    presentation_content: contentSchema(10),
    content_rewrite: rewriteSchema(),
    editor_operations: editorOperationsSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    const problems = typelessNodes(toGeminiSchema(schema));
    assert.deepEqual(problems, [], `${name}: ${problems.join("; ")}`);
  }
});

test("the nullable slide fields keep their shape, not just their name", () => {
  // The four that were emptied. Named individually so a regression says which.
  const slide = toGeminiSchema(contentSchema(10)).properties.slides.items.properties;

  for (const field of ["quote", "statistic", "chart", "table"]) {
    assert.equal(slide[field].type, "object", `${field} lost its type`);
    assert.equal(slide[field].nullable, true, `${field} lost its optionality`);
    assert.ok(
      Object.keys(slide[field].properties ?? {}).length > 0,
      `${field} lost the properties that say what it is`,
    );
  }
});
