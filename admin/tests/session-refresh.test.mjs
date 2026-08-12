import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(adminRoot, "src", ...parts), "utf8");

/**
 * The console swaps itself for a loading screen until it knows the caller's
 * rank, and that screen unmounts every page beneath it.
 *
 * Supabase re-emits a sign-in on each token refresh, and a refresh happens when
 * a backgrounded tab comes back to the front. Re-checking the rank on every one
 * of those events therefore tore down whatever the admin had open: tab away to
 * fetch a font file, come back to an empty JSLAYD workbench and a lost prompt.
 *
 * The gate is right — an unranked session must not see admin pages. What has to
 * hold is that a refresh for the *same* account is checked quietly, without
 * ever passing back through that gate.
 */
test("a token refresh does not tear down the open page", () => {
  const provider = read("providers", "AuthProvider.tsx");
  const resets = [...provider.matchAll(/setAccessChecked\(false\)/g)];
  assert.equal(resets.length, 1, "there should be exactly one place the console goes back to the loading screen");

  const [reset] = resets;
  const line = provider.slice(0, reset.index).split("\n").at(-1);
  assert.match(
    line,
    /\bif\s*\(/,
    "clearing accessChecked unconditionally unmounts every page on each token refresh, "
      + "which is how an admin loses an unsaved JSLAYD prompt by switching tabs",
  );

  assert.ok(
    /checkedFor\.current\s*!==/.test(provider),
    "the guard must compare the account, so a genuine sign-in as someone else still re-gates the console",
  );
});

test("the loading gate still blocks a session of unknown rank", () => {
  const app = read("App.tsx");
  assert.ok(
    /if\s*\(loading\s*\|\|\s*\(session\s*&&\s*!accessChecked\)\)/.test(app),
    "an account whose rank has never been established must not be shown admin pages",
  );
});
