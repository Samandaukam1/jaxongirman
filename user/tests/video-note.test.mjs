import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-video-note-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "videoNote.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const {
  MAX_LOOPS, NoteDeck, notesNear, notesToLoop, partLengths, playLoud, progressAt, restLoop, sameKeys,
} = await import(`${outDir}/videoNote.js`);

/**
 * A video note plays as one, though it was recorded in parts: the next part must already be loaded when
 * one ends (or the camera's turn becomes a pause), a tap on a note looping on screen must play that very
 * player (or the note goes dark and loads again), and nothing asked for a note already stopped may ever
 * start playing — least of all in the middle of a recording.
 */

/** A player as the deck sees one: it remembers what was done to it, and its loads answer when told. */
class FakePlayer {
  constructor(name) {
    this.name = name;
    this.currentTime = 4;
    this.muted = true;
    this.loop = true;
    this.timeUpdateEventInterval = 0;
    this.duration = 0;
    this.playing = false;
    this.source = null;
    this.loads = [];
  }
  play() { this.playing = true; }
  pause() { this.playing = false; }
  /**
   * As Android's ExoPlayer does it: a player that reached the end of its part still means to play, and a
   * source given to a player that means to play starts playing as soon as it is ready — `playing` at the load
   * is remembered, so a test can say no part was ever loaded to be heard before its turn.
   */
  replaceAsync(source) {
    let answer;
    const done = new Promise((resolve, reject) => { answer = { resolve, reject }; });
    this.loads.push({ source, playing: this.playing, ...answer });
    this.source = source?.uri ?? null;
    return done;
  }
  /** The last load, answered. */
  land(duration = 2) {
    this.duration = duration;
    this.loads.at(-1)?.resolve();
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deck({ open } = {}) {
  const a = new FakePlayer("a");
  const b = new FakePlayer("b");
  const views = [];
  const shares = [];
  const holds = { taken: [], letGo: [] };
  const opened = new Map();
  const needs = {
    open: open ?? ((file) => {
      let answer;
      const done = new Promise((resolve, reject) => { answer = { resolve, reject }; });
      opened.set(file.path, answer);
      return done;
    }),
    hold: (path) => { holds.taken.push(path); return () => holds.letGo.push(path); },
  };
  const subject = new NoteDeck([a, b], needs, { view: (view) => views.push(view), progress: (share) => shares.push(share) });
  let ends = 0;
  subject.connect(() => { ends += 1; });
  return { subject, a, b, views, shares, holds, opened, ended: () => ends };
}

const files = (count) => Array.from({ length: count }, (_, at) => ({ path: `c/s/part${at}.mp4`, local: null, ms: 2000 }));
const lastView = (views) => views.at(-1) ?? null;

test("each part's length: measured, else recorded, else an even share of what is left", () => {
  assert.deepEqual(partLengths([2000, 3000], [null, null], 5000), [2, 3]);
  assert.deepEqual(partLengths([2000, 3000], [2.4, null], 5000), [2.4, 3], "a player's own measure wins");
  assert.deepEqual(partLengths([0, 0, 0], [null, 1, null], 7000), [3, 1, 3], "unknown parts share what the known leave");
  assert.deepEqual(partLengths([0], [null], 0), [0]);
});

test("progress runs over the whole note, each part counted by its own length", () => {
  const lengths = [2, 6];
  assert.equal(progressAt(lengths, 0, 1), 1 / 8);
  assert.equal(progressAt(lengths, 1, 0), 2 / 8, "the first part counts in full once it is over");
  assert.equal(progressAt(lengths, 1, 3), 5 / 8);
  assert.equal(progressAt(lengths, 0, 9), 2 / 8, "a part never runs past its own share");
  assert.equal(progressAt(lengths, 1, 99), 1);
  assert.equal(progressAt([0, 0], 0, 1), 0, "nothing known is nothing shown");
});

test("only the newest few notes on screen loop", () => {
  const rows = [
    { id: "1", kind: "text" }, { id: "2", kind: "video" }, { id: "3", kind: "video", deleted_at: "x" },
    { id: "4", kind: "video" }, { id: "5", kind: "video" }, { id: "6", kind: "video" },
  ];
  assert.deepEqual(notesToLoop(rows, (row) => row.id), ["2", "4", "5"]);
  assert.equal(MAX_LOOPS, 3);
  assert.deepEqual(notesToLoop(rows, (row) => row.id, 1), ["2"]);
  assert.equal(sameKeys(new Set(["2", "4"]), ["4", "2"]), true);
  assert.equal(sameKeys(new Set(["2", "4"]), ["2"]), false);
});

test("notes near the screen are the ones fetched ahead, never one still being sent", () => {
  const list = Array.from({ length: 30 }, (_, at) => ({ id: String(at), kind: at % 3 === 0 ? "video" : "text" }));
  list[12] = { ...list[12], pending: "sending" };
  const near = notesNear(list, 10, 14, 4).map((row) => row.id);
  assert.deepEqual(near, ["6", "9", "15", "18"], "12 is on its way and stays out");
  assert.deepEqual(notesNear(list, 0, 1, 2).map((row) => row.id), ["0", "3"], "the window stops at the list's ends");
});

test("a player's moods: loud once through from the start, or silent and round", () => {
  const player = new FakePlayer("p");
  playLoud(player);
  assert.deepEqual([player.muted, player.loop, player.currentTime, player.playing], [false, false, 0, true]);
  restLoop(player);
  assert.deepEqual([player.muted, player.loop, player.playing], [true, true, true]);
});

test("a tap on a looping note plays that player at once, and the next part loads meanwhile", async () => {
  const { subject, a, b, views, holds, opened, ended } = deck();
  const loop = new FakePlayer("loop");
  loop.playing = true;
  loop.duration = 2;
  subject.play(files(3), 6000, loop);
  // Synchronously: the frame on screen goes on from the start, with sound.
  assert.deepEqual(lastView(views), { player: loop, waiting: false });
  assert.deepEqual([loop.muted, loop.loop, loop.currentTime, loop.playing], [false, false, 0, true]);
  assert.deepEqual(holds.taken, ["c/s/part0.mp4", "c/s/part1.mp4", "c/s/part2.mp4"], "every part is kept while it plays");
  assert.equal(opened.has("c/s/part0.mp4"), false, "the first part is not fetched: it is on screen");

  await settle();
  opened.get("c/s/part1.mp4").resolve("file:///p1.mp4");
  opened.get("c/s/part2.mp4").resolve("file:///p2.mp4");
  await settle();
  assert.equal(a.source, "file:///p1.mp4", "the second part loads in the deck's first player");
  assert.equal(b.source, null, "the third waits its turn: one part ahead at a time");
  a.land(2);
  await settle();

  subject.partEnded(loop);
  assert.deepEqual(lastView(views), { player: a, waiting: false }, "no wait at the turn of the camera");
  assert.equal(a.playing, true);
  assert.equal(b.source, "file:///p2.mp4", "as the second begins, the third loads in the player nobody shows");
  subject.onScreen(a);
  b.land(2);
  await settle();

  subject.partEnded(a);
  assert.deepEqual(lastView(views), { player: b, waiting: false });
  subject.partEnded(b);
  assert.equal(ended(), 1);
  assert.deepEqual(lastView(views), { player: null, waiting: false });
  assert.deepEqual([loop.playing, loop.currentTime, loop.timeUpdateEventInterval], [false, 0, 0], "the lent player goes back still, at its start");
  assert.equal(holds.letGo.length, 3, "and its files may go again");
});

test("with nothing on screen to lend, the note waits for its first file, then plays", async () => {
  const { subject, a, views, opened } = deck();
  subject.play(files(1), 2000);
  assert.deepEqual(lastView(views), { player: null, waiting: true });
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  assert.equal(a.source, "file:///p0.mp4");
  assert.equal(a.playing, false, "not before it has loaded");
  a.land(2);
  await settle();
  assert.deepEqual(lastView(views), { player: a, waiting: false });
  assert.deepEqual([a.muted, a.loop, a.currentTime, a.playing], [false, false, 0, true]);
});

test("a player just taken off screen is loaded only once the screen has caught up", async () => {
  const { subject, a, b, views, opened } = deck();
  subject.play(files(3), 6000);
  await settle();
  for (const at of [0, 1, 2]) opened.get(`c/s/part${at}.mp4`).resolve(`file:///p${at}.mp4`);
  await settle();
  a.land(2);
  await settle();
  subject.onScreen(a);
  await settle();
  assert.equal(b.source, "file:///p1.mp4");
  b.land(2);
  await settle();
  subject.partEnded(a);
  assert.deepEqual(lastView(views), { player: b, waiting: false });
  assert.equal(a.loads.length, 1, "the third part's player is still on screen until the second is drawn: loading it now would go dark");
  subject.onScreen(b);
  await settle();
  assert.equal(a.source, "file:///p2.mp4");
  assert.equal(a.loads.at(-1).playing, false,
    "the player the first part ended on is still when the third goes in: on Android it would start at once, over the second");
  a.land(2);
  await settle();
  assert.equal(a.playing, false, "loaded, it waits for its turn");
  assert.equal(b.playing, true);
  subject.partEnded(b);
  assert.equal(a.playing, true, "and plays when its turn comes");
  assert.equal(b.playing, false, "the one before it holds its last frame, still");
});

test("a part is never loaded into a player that still means to play", async () => {
  const { subject, a, b, opened } = deck();
  const loop = new FakePlayer("loop");
  loop.duration = 2;
  subject.play(files(4), 8000, loop);
  await settle();
  for (const at of [1, 2, 3]) opened.get(`c/s/part${at}.mp4`).resolve(`file:///p${at}.mp4`);
  await settle();
  a.land(2);
  await settle();
  subject.partEnded(loop);
  subject.onScreen(a);
  await settle();
  b.land(2);
  await settle();
  // The end of a part reported late, or not at all: the player is still playing when the next part goes in.
  subject.partEnded(a);
  a.play();
  subject.onScreen(b);
  await settle();
  assert.equal(a.source, "file:///p3.mp4");
  assert.equal(a.loads.at(-1).playing, false, "it is stilled before the new file goes in");
  for (const player of [a, b]) for (const load of player.loads) assert.equal(load.playing, false, `${player.name}: ${load.source?.uri}`);
});

test("the part due is told to play again once it is drawn (a browser starts a player only then)", async () => {
  const { subject, a, opened } = deck();
  let plays = 0;
  const play = a.play.bind(a);
  a.play = () => { plays += 1; play(); };
  subject.play(files(1), 2000);
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  a.land(2);
  await settle();
  assert.equal(plays, 1);
  subject.onScreen(a);
  assert.equal(plays, 2);
  subject.stop();
  subject.onScreen(a);
  assert.equal(plays, 2, "nothing stopped is started again");
});

test("a part still downloading at its turn keeps the last frame on screen until it lands", async () => {
  const { subject, a, views, opened } = deck();
  const loop = new FakePlayer("loop");
  subject.play(files(2), 4000, loop);
  await settle();
  subject.partEnded(loop);
  assert.deepEqual(lastView(views), { player: loop, waiting: true });
  opened.get("c/s/part1.mp4").resolve("file:///p1.mp4");
  await settle();
  a.land(2);
  await settle();
  assert.deepEqual(lastView(views), { player: a, waiting: false });
  assert.equal(a.playing, true);
});

test("a part that cannot be had ends the note where it is", async () => {
  const { subject, views, opened, ended } = deck();
  subject.play(files(2), 4000);
  await settle();
  opened.get("c/s/part0.mp4").reject(new Error("offline"));
  await settle();
  assert.equal(ended(), 1);
  assert.deepEqual(lastView(views), { player: null, waiting: false });
});

test("nothing asked for a stopped note plays when it arrives", async () => {
  const { subject, a, opened, holds } = deck();
  subject.play(files(2), 4000);
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  subject.stop();
  assert.equal(holds.letGo.length, 2);
  a.land(2);
  await settle();
  assert.equal(a.playing, false, "a recording may have begun meanwhile");
  opened.get("c/s/part1.mp4").resolve("file:///p1.mp4");
  await settle();
  assert.equal(a.loads.length, 1, "and nothing more is loaded for it");
});

test("a newer note wins over an older one's late answers", async () => {
  const { subject, a, views, opened } = deck();
  subject.play(files(1), 2000);
  await settle();
  const older = opened.get("c/s/part0.mp4");
  subject.play([{ path: "c/s/other.mp4", local: null, ms: 1000 }], 1000);
  await settle();
  older.resolve("file:///old.mp4");
  await settle();
  assert.equal(a.loads.length, 0);
  opened.get("c/s/other.mp4").resolve("file:///other.mp4");
  await settle();
  a.land(1);
  await settle();
  assert.equal(a.source, "file:///other.mp4");
  assert.deepEqual(lastView(views), { player: a, waiting: false });
});

test("a lent player whose bubble leaves ends the note, and is not touched again", () => {
  const { subject, views, ended } = deck();
  const loop = new FakePlayer("loop");
  subject.play(files(2), 4000, loop);
  loop.pause = () => { throw new Error("released"); };
  subject.forget(loop);
  assert.equal(ended(), 1);
  assert.deepEqual(lastView(views), { player: null, waiting: false });
});

test("progress follows the part playing, over the whole note", async () => {
  const { subject, shares } = deck();
  const loop = new FakePlayer("loop");
  loop.duration = 2;
  subject.play([{ path: "c/s/a.mp4", local: null, ms: 2000 }, { path: "c/s/b.mp4", local: null, ms: 6000 }], 8000, loop);
  subject.timeUpdate(loop, 1);
  assert.equal(shares.at(-1), 1 / 8);
  subject.timeUpdate(new FakePlayer("stranger"), 1.5);
  assert.equal(shares.at(-1), 1 / 8, "only the player of the part playing moves the ring");
  subject.stop();
  assert.equal(shares.at(-1), 0);
});

test("when nothing plays, the deck's players let go of their files", async () => {
  const { subject, a, opened } = deck();
  subject.play(files(1), 2000);
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  a.land(2);
  await settle();
  subject.unload();
  assert.equal(a.loads.length, 1, "not while the note plays");
  subject.stop();
  subject.unload();
  assert.equal(a.loads.length, 2);
  assert.equal(a.source, null);
});

test("a part that cannot play ends the note there, and its file is not kept", async () => {
  const failedFiles = [];
  const a = new FakePlayer("a");
  const b = new FakePlayer("b");
  const views = [];
  const opened = new Map();
  const subject = new NoteDeck([a, b], {
    open: (file) => new Promise((resolve) => opened.set(file.path, resolve)),
    hold: () => () => undefined,
    failed: (file) => failedFiles.push(file.path),
  }, { view: (view) => views.push(view), progress: () => undefined });
  let ends = 0;
  subject.connect(() => { ends += 1; });
  subject.play(files(2), 4000);
  await settle();
  opened.get("c/s/part0.mp4")("file:///p0.mp4");
  await settle();
  a.land(2);
  await settle();
  assert.equal(a.playing, true);
  a.status = "error";
  subject.failed(a);
  assert.equal(ends, 1, "the ring does not hang on a part that will never end");
  assert.deepEqual(views.at(-1), { player: null, waiting: false });
  assert.deepEqual(failedFiles, ["c/s/part0.mp4"]);
});

test("a later part that cannot play is missing, and the note ends when it comes due", async () => {
  const { subject, a, opened, ended } = deck();
  const loop = new FakePlayer("loop");
  subject.play(files(2), 4000, loop);
  await settle();
  opened.get("c/s/part1.mp4").resolve("file:///p1.mp4");
  await settle();
  a.land(2);
  await settle();
  a.status = "error";
  subject.failed(a);
  assert.equal(ended(), 0, "the first part plays on");
  subject.partEnded(loop);
  assert.equal(ended(), 1);
});

test("a word of failure from a source since replaced changes nothing", async () => {
  const { subject, a, opened, ended } = deck();
  subject.play(files(1), 2000);
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  a.land(2);
  await settle();
  a.status = "readyToPlay";
  subject.failed(a);
  assert.equal(ended(), 0);
});

test("a bubble's loop that cannot play is not lent: the first part loads into the deck's own player", async () => {
  const { subject, a, views, opened } = deck();
  const loop = new FakePlayer("loop");
  loop.status = "error";
  subject.play(files(1), 2000, loop);
  assert.equal(loop.playing, false);
  assert.deepEqual(views.at(-1), { player: null, waiting: true });
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  assert.equal(a.source, "file:///p0.mp4");
});

test("a lent player let go of while the next part is still coming is not left on screen", async () => {
  const { subject, views, ended } = deck();
  const loop = new FakePlayer("loop");
  subject.play(files(2), 4000, loop);
  await settle();
  subject.partEnded(loop);
  assert.deepEqual(views.at(-1), { player: loop, waiting: true });
  subject.forget(loop);
  assert.equal(ended(), 0, "the note goes on once its next part lands");
  assert.deepEqual(views.at(-1), { player: null, waiting: true }, "but nothing draws the released player");
});

test("only the part playing reports its time: the deck's players are quiet once it stops", async () => {
  const { subject, a, opened } = deck();
  subject.play(files(1), 2000);
  await settle();
  opened.get("c/s/part0.mp4").resolve("file:///p0.mp4");
  await settle();
  a.land(2);
  await settle();
  assert.equal(a.timeUpdateEventInterval, 0.1);
  subject.stop();
  assert.equal(a.timeUpdateEventInterval, 0);
});
