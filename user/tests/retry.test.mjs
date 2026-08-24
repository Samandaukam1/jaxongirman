import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-retry-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    // `dom` only for `setTimeout`, which every runtime this ships to has.
    lib: ["ES2022", "dom"], strict: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "retry.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { isTransport, withNetworkRetry } = await import(`${outDir}/retry.js`);

/**
 * A phone on LTE loses a connection mid-request routinely — the radio hands
 * over, the app returns from the background, a packet is lost. The request
 * never reached the server, so asking again is free; and for somebody scanning
 * a QR code in a classroom, "start again" means scanning it again while
 * everybody waits.
 */

test("the sentences each platform uses for a lost connection are recognised", () => {
  for (const said of [
    "fetch failed: UnexpectedException: The network connection was lost",
    "Network request failed",
    "Failed to send a request to the Edge Function",
    "TypeError: Load failed",
    "read ECONNRESET",
    "The request timed out",
  ]) {
    assert.equal(isTransport(new Error(said)), true, said);
  }
});

test("a server that answered is an answer, not a thing to ask twice", () => {
  for (const said of [
    "Tangalar yetarli emas.",
    "duplicate key value violates unique constraint",
    "forbidden",
    "O‘yin topilmadi.",
  ]) {
    assert.equal(isTransport(new Error(said)), false, said);
  }
});

test("a dropped request is asked again and can succeed", async () => {
  let calls = 0;
  const answer = await withNetworkRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("The network connection was lost");
    return "ok";
  }, { delayMs: 1 });

  assert.equal(answer, "ok");
  assert.equal(calls, 3);
});

test("a refusal is not retried, however many attempts are allowed", async () => {
  let calls = 0;
  await assert.rejects(
    () => withNetworkRetry(async () => {
      calls += 1;
      throw new Error("Tangalar yetarli emas.");
    }, { attempts: 5, delayMs: 1 }),
    /Tangalar/,
  );
  assert.equal(calls, 1, "server javob berdi — qayta so‘ralmasin");
});

test("giving up throws what actually went wrong", async () => {
  let calls = 0;
  await assert.rejects(
    () => withNetworkRetry(async () => {
      calls += 1;
      throw new Error("Network request failed");
    }, { attempts: 3, delayMs: 1 }),
    /Network request failed/,
  );
  assert.equal(calls, 3);
});
