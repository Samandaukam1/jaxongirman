import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-voice-report-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "voiceReport.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { SETTLE_MS, readReport } = await import(`${outDir}/voiceReport.js`);

/**
 * The app plays every voice on one player, and its reports say nothing of which file they are about. A tap on
 * another voice puts a new file in while the old one's pause or end is still on its way: that must not stop,
 * pause or relabel the new voice, nor throw its file away.
 */

const report = (fields) => ({ isLoaded: true, playing: true, isBuffering: false, currentTime: 0, duration: 0, ...fields });

test("the old voice's end, arriving after the next was put in, is not the new one's", () => {
  const reading = readReport(report({ didJustFinish: true, playing: false, currentTime: 7.4, duration: 7.4 }), { playing: true, sinceLoad: 40 });
  assert.equal(reading.kind, "stale");
});

test("the new voice's own end is its end, however short it is", () => {
  assert.equal(readReport(report({ didJustFinish: true, playing: false, currentTime: 0.2, duration: 0.2 }), { playing: true, sinceLoad: 260 }).kind, "ended");
  assert.equal(readReport(report({ didJustFinish: true, playing: false, currentTime: 12, duration: 12 }), { playing: false, sinceLoad: 12_300 }).kind, "ended");
});

test("the old voice's pause, with its position and length, does not reach the new bubble", () => {
  const reading = readReport(report({ playing: false, currentTime: 3.1, duration: 9 }), { playing: true, sinceLoad: 30 });
  assert.equal(reading.kind, "stale");
});

test("just put in and not playing yet, the button stays on pause instead of flickering back to play", () => {
  const loading = readReport(report({ isLoaded: false, playing: false }), { playing: true, sinceLoad: 20 });
  assert.deepEqual(loading, { kind: "progress", playing: true, position: 0, duration: 0 });
  const buffering = readReport(report({ playing: false, isBuffering: true, currentTime: 1, duration: 5 }), { playing: true, sinceLoad: 2_000 });
  assert.equal(buffering.kind === "progress" && buffering.playing, true);
  const settling = readReport(report({ playing: false, currentTime: 0, duration: 5 }), { playing: true, sinceLoad: SETTLE_MS - 50 });
  assert.equal(settling.kind === "progress" && settling.playing, true);
});

test("once settled, a pause the phone made (a call, headphones out) shows as paused", () => {
  const reading = readReport(report({ playing: false, currentTime: 2, duration: 5 }), { playing: true, sinceLoad: 2_500 });
  assert.deepEqual(reading, { kind: "progress", playing: false, position: 2, duration: 5 });
});

test("a pause asked for here is a pause at once", () => {
  const reading = readReport(report({ playing: false, currentTime: 0.1, duration: 5 }), { playing: false, sinceLoad: 100 });
  assert.equal(reading.kind === "progress" && reading.playing, false);
});

test("an error is always the file that is in the player now", () => {
  assert.equal(readReport(report({ error: "Cannot Open", currentTime: 9 }), { playing: true, sinceLoad: 10 }).kind, "error");
});

test("nonsense numbers from the player are read as nothing", () => {
  const reading = readReport(report({ currentTime: Number.NaN, duration: Number.POSITIVE_INFINITY }), { playing: true, sinceLoad: 5_000 });
  assert.deepEqual(reading, { kind: "progress", playing: true, position: 0, duration: 0 });
});
