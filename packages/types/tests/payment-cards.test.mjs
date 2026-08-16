import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

// The package intentionally publishes TypeScript source to the workspace. Build
// this one dependency-free module in memory so the tests also run on Node 20,
// where native type stripping is not available yet.
const source = readFileSync(new URL("../src/payment-cards.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cards = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("a PAN is only maskable when exactly 16 digits are present", () => {
  assert.equal(cards.maskCardPan("8600 4954 7331 6478"), "86004954XXXX6478");
  assert.equal(cards.maskCardPan("860049547331647"), null);
  assert.equal(cards.maskCardPan("86004954733164781"), null);
  assert.equal(cards.formatCardPan("86004954XXXX6478"), "8600 4954 XXXX 6478");
});

test("MM/YY validates the month and treats the current month as usable", () => {
  const august2026 = new Date(2026, 7, 15);

  assert.deepEqual(cards.validateCardExpiry("08/26", august2026), {
    valid: true, digits: "0826", normalized: "08/26", month: 8, year: 26,
  });
  assert.equal(cards.validateCardExpiry("07/26", august2026).error, "expired");
  assert.equal(cards.validateCardExpiry("13/29", august2026).error, "invalid_month");
  assert.equal(cards.validateCardExpiry("7/29", august2026).error, "incomplete");
  assert.equal(cards.validateCardExpiry("01/27", august2026).valid, true);
});

test("partial PAN reconstruction requires the stored mask and four fresh digits", () => {
  assert.equal(cards.reconstructPartialCardPan("86004954XXXX6478", "7331"), "8600495473316478");
  assert.equal(cards.reconstructPartialCardPan("86004954XXXX6478", "733"), null);
  assert.equal(cards.reconstructPartialCardPan("8600495473316478", "7331"), null);
});

test("stored expiry formatting and expiry checks share the same rule", () => {
  const august2026 = new Date(2026, 7, 15);
  assert.equal(cards.formatStoredCardExpiry(7, 2029), "07/29");
  assert.equal(cards.isStoredCardExpired(8, 26, august2026), false);
  assert.equal(cards.isStoredCardExpired(7, 26, august2026), true);
  assert.equal(cards.isStoredCardExpired(0, 29, august2026), true);
});
