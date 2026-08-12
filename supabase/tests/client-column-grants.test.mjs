import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Three tables grant a signed-in caller some of their columns and not others,
 * so that a provider's one-time card token is not merely filtered out of an
 * answer — it cannot be asked for at all.
 *
 * `select("*")` asks for every column including those, and Postgres refuses the
 * whole statement rather than trimming it: `permission denied for table orders`.
 * The app catches that and shows a load error, so the screen fails completely
 * and says nothing about why. Every one of these reads shipped broken.
 *
 * The grants are the right design; the wildcard is the mistake. This is the
 * check that keeps one from creeping back onto the other.
 */
const COLUMN_GRANTED = ["orders", "payment_transactions", "game_sessions"];
const CLIENTS = ["user", "web", "admin"];
const SKIP = new Set(["node_modules", ".git", "dist", ".expo", ".next", "ios", "android"]);

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

test("no client asks a column-granted table for every column", () => {
  const offenders = [];

  for (const client of CLIENTS) {
    for (const file of sources(path.join(repoRoot, client))) {
      const text = readFileSync(file, "utf8");
      for (const table of COLUMN_GRANTED) {
        const pattern = new RegExp(`\\.from\\("${table}"\\)`, "g");
        for (const match of text.matchAll(pattern)) {
          // The select may sit on the next line, so look at what follows.
          const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 240);
          const select = /\.select\(\s*(["'`])\s*\*\s*\1\s*\)/.exec(tail);
          if (!select) continue;
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${path.relative(repoRoot, file)}:${line} reads ${table} with select("*")`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `${offenders.length} query(s) will fail with "permission denied":\n${offenders.join("\n")}`);
});
