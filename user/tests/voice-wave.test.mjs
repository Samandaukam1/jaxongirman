import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-voice-wave-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "voiceWave.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { WAVE_MAX, WAVE_SIZE, easeLevel, meterLevel, readWaveform, rollLevels, waveBars, waveformFrom } = await import(`${outDir}/voiceWave.js`);

/**
 * A voice message carries the shape of the voice, measured while it was
 * recorded: both phones draw the same bars, and they no longer change when the
 * message is confirmed. What arrives from another phone is only data, so it is
 * believed only when it looks like a waveform.
 */

test("a take becomes 48 bars of five bits", () => {
  const levels = Array.from({ length: 137 }, (_, at) => -45 + 40 * Math.abs(Math.sin(at / 6)));
  const wave = waveformFrom(levels);
  assert.equal(wave.length, WAVE_SIZE);
  for (const bar of wave) assert.ok(Number.isInteger(bar) && bar >= 0 && bar <= WAVE_MAX, `bar ${bar} out of range`);
  assert.ok(Math.max(...wave) === WAVE_MAX, "the loudest moments reach the top");
});

test("silence stays flat, and a loud moment stands out where it was", () => {
  assert.deepEqual(waveformFrom(Array(50).fill(-160)), Array(WAVE_SIZE).fill(0));
  const levels = Array(96).fill(-60);
  levels[48] = -3;
  const wave = waveformFrom(levels);
  assert.equal(wave.indexOf(Math.max(...wave)), 24, "the peak is in the middle bar, as it was in the middle of the take");
});

test("a take shorter than the bars repeats its samples instead of leaving gaps", () => {
  const wave = waveformFrom([-10, -40, -10]);
  assert.equal(wave.length, WAVE_SIZE);
  assert.ok(wave.every((bar) => bar >= 0));
  assert.ok(wave.filter((bar) => bar > 0).length >= WAVE_SIZE / 2);
});

test("nothing recorded is a flat line, never an error", () => {
  assert.deepEqual(waveformFrom([]), Array(WAVE_SIZE).fill(0));
  assert.deepEqual(waveformFrom([Number.NaN, Number.NEGATIVE_INFINITY]), Array(WAVE_SIZE).fill(0));
});

test("only something that looks like a waveform is believed", () => {
  assert.deepEqual(readWaveform([0, 5, 31, 40, -2, 3.4, 7, 8]), [0, 5, 31, 31, 0, 3, 7, 8]);
  assert.equal(readWaveform(null), null);
  assert.equal(readWaveform("31,31,31"), null);
  assert.equal(readWaveform([1, 2, 3]), null, "too short");
  assert.equal(readWaveform(Array(300).fill(4)), null, "too long");
  assert.equal(readWaveform([1, 2, 3, 4, 5, 6, 7, "8"]), null, "not all numbers");
});

test("drawn at another width, each bar keeps the loudest it covers", () => {
  const wave = Array(48).fill(0);
  wave[47] = 31;
  const bars = waveBars(wave, 32);
  assert.equal(bars.length, 32);
  assert.equal(bars[31], 1);
  assert.ok(bars.slice(0, 31).every((bar) => bar === 0));
  assert.deepEqual(waveBars([], 4), [0, 0, 0, 0]);
});

/**
 * While a voice records, the bars and the glow follow the microphone: loud speech fills them, the room leaves them
 * low, a phone that gives no reading leaves them at rest — and they rise with the voice at once but fall slowly.
 */
test("the live meter lifts speech and rests on silence or no reading", () => {
  assert.equal(meterLevel(-160), 0);
  assert.equal(meterLevel(undefined), 0);
  assert.equal(meterLevel(null), 0);
  assert.equal(meterLevel(Number.NaN), 0);
  assert.equal(meterLevel(0), 1);
  assert.equal(meterLevel(6), 1, "never past full");
  const speech = meterLevel(-20);
  const whisper = meterLevel(-45);
  assert.ok(speech > 0.7 && speech < 1, `speech fills most of it (${speech})`);
  assert.ok(whisper > 0 && whisper < speech, "a whisper still shows, below speech");
});

test("the meter rises with the voice at once and falls back slowly", () => {
  const up = easeLevel(0, 1);
  const down = easeLevel(1, 0);
  assert.ok(up > 0.5, "most of the way up in one sample");
  assert.ok(down > 0.5, "less than half the way down in one sample");
  let level = 1;
  for (let step = 0; step < 20; step += 1) level = easeLevel(level, 0);
  assert.ok(level < 0.01, "and at rest after a second and a half of silence");
  assert.equal(easeLevel(Number.NaN, Number.NaN), 0);
});

test("the live wave rolls: the newest reading comes in on the right", () => {
  assert.deepEqual(rollLevels([0.1, 0.2, 0.3], 0.9), [0.2, 0.3, 0.9]);
  assert.deepEqual(rollLevels([0, 0], 4), [0, 1], "kept within 0 to 1");
  assert.deepEqual(rollLevels([], 0.5), []);
});
