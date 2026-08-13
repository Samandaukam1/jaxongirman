import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const functionsRoot = path.join(repoRoot, "supabase", "functions");
const provider = readFileSync(path.join(functionsRoot, "_shared", "payment-provider.ts"), "utf8");

/**
 * The Subscribe API splits its methods into two groups that authenticate
 * differently, and every failure this integration has had came from that seam:
 *
 *   * `cards.*` are client-side and take `X-Auth: <merchant_id>`. The key must
 *     not be sent — doing so hands the merchant key to a call that never needed
 *     it.
 *   * `receipts.*` are server-side and take `X-Auth: <merchant_id>:<key>`.
 *
 * Getting a call into the wrong group is both a refusal and, in one direction,
 * a needless exposure. None of it shows up in a type check.
 */

function sources() {
  const found = [];
  for (const entry of readdirSync(functionsRoot, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "deno.lock") continue;
    const full = path.join(functionsRoot, entry.name);
    if (entry.isDirectory()) {
      for (const file of readdirSync(full)) {
        if (file.endsWith(".ts")) found.push(path.join(full, file));
      }
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

/** The scope a `this.call(...)` for a method is closed with. */
function scopeOf(method) {
  const at = provider.indexOf(`this.call`);
  assert.notEqual(at, -1, "the provider must route its calls through one place");
  const start = provider.indexOf(`"${method}"`);
  assert.notEqual(start, -1, `${method} is not called anywhere`);
  // Every call ends `}, "<scope>")`; take the first one after the method name.
  const closing = /\}\s*,\s*"(merchant|card)"\s*\)/.exec(provider.slice(start));
  assert.ok(closing, `${method} does not close with a scope argument`);
  return closing[1];
}

test("every receipts call is sent with the merchant credential", () => {
  // `receipts.pay` refused with -32504 is what a receipts call sent as a card
  // call looks like from the outside.
  for (const method of ["receipts.create", "receipts.pay", "receipts.check"]) {
    assert.equal(scopeOf(method), "merchant", `${method} must be sent with the merchant credential`);
  }
});

test("every cards call is sent without the merchant key", () => {
  for (const method of ["cards.create", "cards.get_verify_code", "cards.verify"]) {
    assert.equal(scopeOf(method), "card", `${method} must not carry the merchant key`);
  }
});

test("the header is exactly what each scope calls for", () => {
  assert.match(
    provider,
    /"X-Auth": scope === "merchant" \? `\$\{merchantId\}:\$\{key\}` : merchantId/,
    "merchant scope is id:key, card scope is the id alone",
  );
  assert.match(provider, /"Content-Type": "application\/json"/, "and the body is JSON");
});

test("the environment is read in one place, and trimmed", () => {
  // A key pasted out of a cabinet arrives with a trailing newline more often
  // than anyone expects, and a credential one character wrong is refused
  // without explanation — which is the shape of the failure being chased.
  assert.match(provider, /function env\(name: string\): string \{\s*return \(Deno\.env\.get\(name\) \?\? ""\)\.trim\(\);/,
    "every environment read must be trimmed");

  const direct = [...provider.matchAll(/Deno\.env\.get\(/g)].length;
  assert.equal(direct, 1, "only the `env` helper may read the environment, so nothing can read an untrimmed value");

  for (const file of sources()) {
    if (file.endsWith("payment-provider.ts")) continue;
    const text = readFileSync(file, "utf8");
    assert.ok(
      !/Deno\.env\.get\(\s*["']PAYME/.test(text),
      `${path.relative(repoRoot, file)} reads a PAYME variable directly — the config belongs in one place`,
    );
  }
});

test("no credential is written into the source", () => {
  // A merchant id is a 24-character hex string and a key is longer; either one
  // pasted "just to test" is a credential in git history for ever.
  for (const file of sources()) {
    const text = readFileSync(file, "utf8");
    for (const [line, index] of text.split("\n").map((l, i) => [l, i])) {
      if (/\b[0-9a-f]{24,}\b/i.test(line) && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//")) {
        assert.fail(`${path.relative(repoRoot, file)}:${index + 1} looks like a hardcoded credential`);
      }
    }
  }
});

test("production is the default endpoint, and test is never reached by accident", () => {
  assert.match(provider, /https:\/\/checkout\.paycom\.uz\/api/, "the production endpoint must be the fallback");
  assert.match(
    provider,
    /environment === "test" \? "https:\/\/checkout\.test\.paycom\.uz\/api" : "https:\/\/checkout\.paycom\.uz\/api"/,
    "the test host must require the environment to say so explicitly",
  );
});

test("the provider's own error code survives normalisation", () => {
  // -32504 turned into "the payment system is unavailable" is right for a buyer
  // and useless for whoever has to fix it: the number is the only thing that
  // says which refusal it was.
  assert.match(provider, /public providerCode\?: string/, "the raw code must be carried on the failure");
  // `data` is where the answer actually was: production returned -32504 with
  // `data: "invalid_key"`, and the number alone would never have said which
  // -32504 it was or who could fix it.
  assert.match(provider, /public providerData\?: string/, "the provider's data must be carried too");
  assert.match(provider, /return new PaymentFailed\(known\.code, known\.message, code, detail\)/,
    "a mapped code must still keep the provider's own code and data");
  assert.match(provider, /paymeFailure\(String\(payload\.error\.code\), redactDigits\(message\), payload\.error\.data\)/,
    "the data from the response must reach the failure");

  for (const name of ["order-pay", "pay-marketplace"]) {
    const text = readFileSync(path.join(functionsRoot, name, "index.ts"), "utf8");
    assert.match(text, /error\.providerCode/, `${name} must record the provider's code, not only ours`);
    assert.match(text, /error\.providerData/, `${name} must record the provider's data, which is the diagnosable part`);
  }
});

test("a refused call is logged with what the provider actually said", () => {
  assert.match(provider, /console\.error\("payme\.error"/, "a refusal must be logged");
  for (const field of ["code:", "message:", "data:"]) {
    assert.ok(provider.includes(field), `the log must carry the provider's ${field.replace(":", "")}`);
  }
});

test("no log or diagnostic can carry a credential", () => {
  const logs = [...provider.matchAll(/console\.(log|error)\([^;]+?\);/gs)].map((m) => m[0]);
  assert.ok(logs.length > 0, "there should be diagnostics to check");
  for (const entry of logs) {
    for (const forbidden of ["key", "X-Auth", "token"]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\b(?!Length)`).test(entry),
        `a diagnostic mentions ${forbidden}: ${entry.slice(0, 120)}`,
      );
    }
  }
  // The merchant id is reduced to a tail rather than logged whole.
  assert.match(provider, /merchantTail: merchantId\.slice\(-4\)/, "only the last four characters are identifying enough");
});
