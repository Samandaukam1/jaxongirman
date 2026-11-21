import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-double-tap-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "doubleTap.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { DOUBLE_TAP_MIN_MS, DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, isDoubleTap, tapOf, withMine } = await import(`${outDir}/doubleTap.js`);

/**
 * A double tap on a message puts the heart on it; two taps that only happen to
 * follow each other must not. The difference is a few hundred milliseconds and
 * a few dozen points, and a wrong guess either way is a reaction nobody meant
 * or a gesture that "does not work".
 */

const tap = (at, x = 100, y = 300) => ({ at, x, y });

test("two quick taps on one spot are a double tap", () => {
  assert.equal(isDoubleTap(tap(1000), tap(1200, 104, 306)), true);
  assert.equal(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MS)), true, "the window's own edge still counts");
});

test("a tap too long after the first starts over", () => {
  assert.equal(isDoubleTap(tap(1000), tap(1450)), false);
  assert.equal(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MS + 1)), false);
});

test("a second tap somewhere else on the bubble is not a double tap", () => {
  assert.equal(isDoubleTap(tap(1000), tap(1200, 160, 300)), false, "60 pt to the side");
  assert.equal(isDoubleTap(tap(1000), tap(1200, 100, 300 + DOUBLE_TAP_SLOP + 1)), false);
  assert.equal(isDoubleTap(tap(1000), tap(1200, 100 + 24, 300 + 32)), true, "40 pt away, diagonally, is still close enough");
});

test("without a first tap there is nothing to complete", () => {
  assert.equal(isDoubleTap(null, tap(1200)), false);
});

test("one touch reported twice, or out of order, is not two taps", () => {
  assert.equal(isDoubleTap(tap(1000), tap(1000)), false);
  assert.equal(isDoubleTap(tap(1000), tap(1000 + DOUBLE_TAP_MIN_MS - 1)), false);
  assert.equal(isDoubleTap(tap(1200), tap(1000)), false);
});

test("a phone's press is timed by the touch itself, not by when JavaScript got to it", () => {
  // iOS and Android: `nativeEvent.timestamp` in milliseconds; the synthetic `timeStamp` is only when JS saw it.
  assert.deepEqual(tapOf({ timeStamp: 1_763_000_000_000, nativeEvent: { timestamp: 5_000, pageX: 12, pageY: 34 } }), { at: 5_000, x: 12, y: 34 });
});

test("a browser's click has no touch time, so its event time is used", () => {
  assert.deepEqual(tapOf({ timeStamp: 812.5, nativeEvent: { pageX: 40, pageY: 50 } }), { at: 812.5, x: 40, y: 50 });
});

test("a press with no place on the screen is no half of a double tap", () => {
  assert.equal(tapOf({ timeStamp: 900, nativeEvent: { actionName: "activate" } }), null);
  assert.equal(tapOf({ timeStamp: 900, nativeEvent: null }), null);
  assert.equal(tapOf({ nativeEvent: { pageX: 1, pageY: 2 } }), null, "and with no time at all, neither");
  assert.equal(tapOf({ timeStamp: Number.NaN, nativeEvent: { pageX: 1, pageY: 2 } }), null);
});

test("a late echo cannot bring back one's own reaction, and others' still show", () => {
  const echo = { me: "❤️", them: "😂" };
  assert.deepEqual(withMine(echo, "me", null), { them: "😂" }, "taken off here stays off");
  assert.deepEqual(withMine({ them: "😂" }, "me", "👍"), { them: "😂", me: "👍" }, "put on here stays on");
  assert.deepEqual(withMine({}, "me", null), {});
  assert.deepEqual(echo, { me: "❤️", them: "😂" }, "the echo itself is left as it came");
});
