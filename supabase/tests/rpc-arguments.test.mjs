import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENTS = ["user", "web", "admin"];
const SKIP = new Set(["node_modules", ".git", "dist", ".expo", ".next", "ios", "android", "packages"]);

function sources(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * `undefined` is not "leave this argument out" — it is "do not send this key".
 *
 * `JSON.stringify` drops an undefined value, so the request body arrives without
 * the key at all. PostgREST then looks for a function matching the arguments it
 * did receive, and if the missing parameter has no `DEFAULT` there is no such
 * function: the call fails before reaching a single line of the logic that would
 * have accepted it.
 *
 * That is how "create a new listing" and "save a new survey template" were both
 * broken — every new row, silently, from the first day. The marketplace table
 * was still empty. `null` is a value; it is sent, it resolves, and the function's
 * own `if … is null` branch does what the caller meant.
 */
test("no RPC argument is passed as undefined", () => {
  const offenders = [];

  for (const client of CLIENTS) {
    for (const file of sources(path.join(repoRoot, client))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^\s*(p_[a-z0-9_]+):\s*undefined\b/gm)) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(repoRoot, file)}:${line} sends ${match[1]} as undefined —`
          + " the key is dropped and the function may not resolve. Use null.",
        );
      }
    }
  }

  assert.deepEqual(offenders, [], `${offenders.length} RPC argument(s) will vanish from the request:\n${offenders.join("\n")}`);
});

/**
 * A screen that can set an error must be able to show it.
 *
 * The sell screen kept its error line inside the block that renders file
 * pickers, and that block is hidden for a game listing — the one kind of listing
 * with no file to pick. So a game submission could fail with a message set, a
 * button re-enabled, and nothing whatever on screen: no error, no confirmation,
 * no clue.
 */
test("the sell screen can always show what went wrong", () => {
  const file = path.join(repoRoot, "user", "app", "(app)", "marketplace", "sell.tsx");
  const text = readFileSync(file, "utf8");

  const errorLine = text.indexOf("{error ? <InlineError");
  const blockEnd = text.indexOf("</>) : null}");
  assert.notEqual(errorLine, -1, "the screen must render its error somewhere");
  assert.notEqual(blockEnd, -1, "the conditional block must still exist");
  assert.ok(
    errorLine > blockEnd,
    "the error line must sit outside the block that is hidden for game listings",
  );

  // And the guard must never clear the error on its way out: `setError(problem)`
  // with a null `problem` is a press that does nothing and says nothing.
  assert.ok(
    !/if \(!user \|\| problem \|\| !materialType\) \{ setError\(problem\); return; \}/.test(text),
    "the guard must name its reason rather than setting a possibly-null error",
  );
});

/**
 * Supabase does not throw `Error`s. A PostgrestError is a plain object, and
 * `error instanceof Error` is false for every database refusal there is.
 */
test("a database refusal keeps its own message", () => {
  const text = readFileSync(path.join(repoRoot, "user", "src", "lib", "format.ts"), "utf8");
  const start = text.indexOf("export function asErrorMessage");
  const body = text.slice(start, text.indexOf("\n}", start));
  assert.match(body, /typeof error === "object"/, "a plain error object must be read, not discarded");
  assert.match(body, /row\.message/, "and its message is the sentence worth showing");
});
