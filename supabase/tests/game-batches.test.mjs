import assert from "node:assert/strict";
import test from "node:test";

/**
 * Asking for a quiz a few questions at a time.
 *
 * One request for the whole game — up to thirty questions, a twelve-field
 * schema with a union in every second property, a sixteen-thousand-token
 * ceiling — is the shape Gemini answers with "Request contains an invalid
 * argument", naming nothing. The deck writer met exactly this and was changed
 * to one slide per request; every game since the sixteenth of August had
 * failed, with one generic sentence recorded for all of them.
 *
 * The batching itself is arithmetic and is tested as arithmetic. What matters
 * is that no batch is empty, none is over the limit, and the count asked for is
 * the count planned — a batcher that quietly drops the last two questions of a
 * ten-question game is worse than the request it replaced.
 */

const source = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../functions/generate-game/index.ts", import.meta.url), "utf8"));

/** The function under test, lifted out of a Deno module Node cannot import. */
const batchSizes = (() => {
  const at = source.indexOf("export function batchSizes");
  const start = source.indexOf("{", at);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(start, index + 1).replace(/: number\[\]|: number/g, "");
        return new Function("QUESTIONS_PER_BATCH", `return function batchSizes(count) ${body}`)(4);
      }
    }
  }
  throw new Error("batchSizes topilmadi");
})();

test("the batches add up to what was asked for", () => {
  for (const count of [1, 2, 4, 5, 9, 10, 13, 30]) {
    const sizes = batchSizes(count);
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), count, `${count} ta savol`);
  }
});

test("no batch is empty and none is over the limit", () => {
  for (const count of [1, 3, 7, 10, 30]) {
    for (const size of batchSizes(count)) {
      assert.ok(size >= 1 && size <= 4, `noto‘g‘ri to‘plam: ${size}`);
    }
  }
});

test("the default ten-question game is three requests, not one", () => {
  assert.deepEqual(batchSizes(10), [4, 4, 2]);
});

test("regenerating one question is one request", () => {
  assert.deepEqual(batchSizes(1), [1]);
});

test("a count of zero still asks for something rather than nothing", () => {
  assert.deepEqual(batchSizes(0), [1]);
});
