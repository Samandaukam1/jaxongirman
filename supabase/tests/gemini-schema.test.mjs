import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { toGeminiSchema, fallbackReason } = await import(`${edge}/gemini-schema.js`);

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

/* ------------------------------------------------------------- fallback */

test("an outage, a rate limit and a malformed answer all fall back", () => {
  for (const reason of ["rate_limited", "http_503", "malformed_json", "empty_response", "not_configured"]) {
    assert.equal(
      fallbackReason({ name: "GeminiUnavailable", reason }),
      reason,
      `${reason} should be answered by trying the other provider`,
    );
  }
  assert.equal(fallbackReason(new TypeError("fetch failed")), "network");
});

test("a request this code built wrongly is not hidden behind a fallback", () => {
  // OpenAI would refuse the same thing the same way. Falling back would turn a
  // bug into a bill.
  assert.equal(fallbackReason(new Error("schemaName is required")), null);
  assert.equal(fallbackReason(null), null);
  assert.equal(fallbackReason(undefined), null);
});
