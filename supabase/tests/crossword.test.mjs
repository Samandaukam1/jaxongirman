import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const {
  CROSSWORD_ALPHABETS, crosswordAnswer, crosswordCells, filledWords, layoutCrossword, lettersFromWords, readCrossword,
  solvedCount, withoutAnswers, wordCells,
} = await import(`${edge}/crossword.js`);

/** Every rule a printed crossword keeps, checked on the cells. */
function assertSound(crossword, entries) {
  const grid = new Map();
  for (const word of crossword.words) {
    const letters = Array.from(word.answer);
    assert.equal(letters.length, word.length, `${word.id} length`);
    const cells = wordCells(word);
    for (const [at, [row, col]] of cells.entries()) {
      assert.ok(row >= 0 && row < crossword.height && col >= 0 && col < crossword.width, `${word.id} inside the grid`);
      const where = `${row},${col}`;
      const before = grid.get(where);
      if (before) assert.equal(before, letters[at], `${word.id} crosses on the same letter at ${where}`);
      grid.set(where, letters[at]);
    }
    // Nothing right before or after a word.
    const [r0, c0] = cells[0];
    const [r1, c1] = cells.at(-1);
    const step = word.direction === "across" ? [0, 1] : [1, 0];
    assert.equal(grid.has(`${r0 - step[0]},${c0 - step[1]}`) && crossword.words.some((other) => other !== word && wordCells(other).some(([r, c]) => r === r0 - step[0] && c === c0 - step[1]) && other.direction === word.direction), false);
    void r1; void c1;
  }
  // Every run of letters in a row or a column is a word of the crossword —
  // no two words touch side by side to spell something nobody asked for.
  const runs = [];
  for (let row = 0; row < crossword.height; row += 1) {
    let run = [];
    for (let col = 0; col <= crossword.width; col += 1) {
      if (grid.has(`${row},${col}`)) run.push([row, col]);
      else { if (run.length > 1) runs.push({ direction: "across", start: run[0], text: run.map(([r, c]) => grid.get(`${r},${c}`)).join("") }); run = []; }
    }
  }
  for (let col = 0; col < crossword.width; col += 1) {
    let run = [];
    for (let row = 0; row <= crossword.height; row += 1) {
      if (grid.has(`${row},${col}`)) run.push([row, col]);
      else { if (run.length > 1) runs.push({ direction: "down", start: run[0], text: run.map(([r, c]) => grid.get(`${r},${c}`)).join("") }); run = []; }
    }
  }
  for (const run of runs) {
    const word = crossword.words.find((candidate) => candidate.direction === run.direction
      && candidate.row === run.start[0] && candidate.col === run.start[1]);
    assert.ok(word && word.answer === run.text, `the run ${run.text} (${run.direction}) is a word of the crossword`);
  }
  assert.equal(runs.length, crossword.words.length, "no word hides inside a longer run");

  // One piece: every word reaches every other through crossings.
  const seen = new Set([crossword.words[0].id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const word of crossword.words) {
      if (seen.has(word.id)) continue;
      const mine = new Set(wordCells(word).map(([r, c]) => `${r},${c}`));
      if (crossword.words.some((other) => seen.has(other.id) && wordCells(other).some(([r, c]) => mine.has(`${r},${c}`)))) {
        seen.add(word.id);
        grew = true;
      }
    }
  }
  assert.equal(seen.size, crossword.words.length, "every word is connected");

  // Each placed word is one of the entries, with its own clue.
  for (const word of crossword.words) {
    const entry = entries.find((candidate) => candidate.answer === word.answer);
    assert.ok(entry, `${word.answer} was asked for`);
    assert.equal(word.clue, entry.clue);
  }
}

const ENGLISH = [
  "PLANET", "ORBIT", "GALAXY", "COMET", "NEBULA", "ASTEROID", "TELESCOPE", "GRAVITY", "SATURN", "MERCURY",
  "ECLIPSE", "METEOR", "JUPITER", "VENUS", "STAR", "COSMOS", "ROCKET", "LUNAR", "SOLAR", "ATMOSPHERE",
].map((answer) => ({ answer, clue: `Clue for ${answer.toLowerCase()}` }));

test("a grid of real words: every crossing shares its letter, nothing touches, all in one piece", () => {
  const crossword = layoutCrossword(ENGLISH, { target: 15, maxSize: 15 });
  assert.ok(crossword);
  assert.ok(crossword.words.length >= 12, `placed ${crossword.words.length} of 15`);
  assert.ok(crossword.width <= 15 && crossword.height <= 15);
  assertSound(crossword, ENGLISH);
});

test("the same words always make the same grid", () => {
  assert.deepEqual(layoutCrossword(ENGLISH, { target: 12 }), layoutCrossword(ENGLISH, { target: 12 }));
});

test("numbers run in reading order, and a cell starting two words has one number", () => {
  const crossword = layoutCrossword(ENGLISH, { target: 15 });
  const starts = [...new Map(crossword.words.map((word) => [`${word.row},${word.col}`, word])).values()]
    .sort((a, b) => a.row - b.row || a.col - b.col);
  starts.forEach((word, at) => assert.equal(word.number, at + 1));
  for (const word of crossword.words) assert.equal(word.id, `${word.number}${word.direction === "across" ? "a" : "d"}`);
});

test("languages: Uzbek updated letters are one cell, Turkish keeps its dotted İ, Russian folds Ё", () => {
  assert.equal(crosswordAnswer("Ma’lumot", "uz"), "MALUMOT");
  assert.equal(crosswordAnswer("Öqituvçi", "uz"), "ÖQITUVÇI");
  assert.equal(Array.from(crosswordAnswer("Ğişt", "uz")).length, 4);
  assert.equal(crosswordAnswer("istanbul", "tr"), "İSTANBUL");
  assert.equal(crosswordAnswer("ılık", "tr"), "ILIK");
  assert.equal(crosswordAnswer("ёлка", "ru"), "ЕЛКА");
  assert.equal(crosswordAnswer("New York", "en"), "NEWYORK");
  // A letter the language does not have, a digit, or too short: not a grid word.
  assert.equal(crosswordAnswer("Wi-Fi", "uz"), null);
  assert.equal(crosswordAnswer("COVID19", "en"), null);
  assert.equal(crosswordAnswer("ox", "en"), null);
  for (const [language, letters] of Object.entries(CROSSWORD_ALPHABETS)) {
    assert.equal(new Set(letters).size, letters.length, `${language} keys are unique`);
    for (const letter of letters) assert.equal(Array.from(letter).length, 1, `${language} ${letter} is one character`);
  }
});

test("an Uzbek grid crosses on Ş and Ö like on any letter", () => {
  const words = ["MAKTAB", "ÖQITUVÇI", "DARSLIK", "ŞAHAR", "KITOB", "QALAM", "ÖQUVÇI", "SINF", "BILIM", "DAFTAR"]
    .map((answer) => ({ answer, clue: answer.toLowerCase() }));
  const crossword = layoutCrossword(words, { target: 10, maxSize: 13 });
  assert.ok(crossword && crossword.words.length >= 7);
  assertSound(crossword, words);
});

test("what a player is sent has no answers, and the cells are still all there", () => {
  const crossword = layoutCrossword(ENGLISH, { target: 10 });
  const shown = withoutAnswers(crossword);
  assert.ok(shown.words.every((word) => !("answer" in word)));
  assert.doesNotMatch(JSON.stringify(shown), new RegExp(crossword.words.map((word) => word.answer).join("|")));
  assert.equal(crosswordCells(shown).size, crosswordCells(crossword).size);
  assert.deepEqual(readCrossword(JSON.parse(JSON.stringify(shown))), shown);
});

test("solving: only whole words are sent, and they come back as the same letters", () => {
  const crossword = layoutCrossword(ENGLISH, { target: 10 });
  const first = crossword.words[0];
  const letters = {};
  wordCells(first).forEach(([row, col], at) => { letters[`${row},${col}`] = Array.from(first.answer)[at]; });
  const sent = filledWords(crossword, letters);
  assert.equal(sent[first.id], first.answer);
  assert.equal(solvedCount(crossword, sent), Object.keys(sent).filter((id) => sent[id] === crossword.words.find((word) => word.id === id).answer).length);
  assert.ok(solvedCount(crossword, sent) >= 1);
  assert.deepEqual(lettersFromWords(crossword, sent), Object.fromEntries(
    Object.entries(letters).filter(([where]) => crossword.words.some((word) => sent[word.id] && wordCells(word).some(([r, c]) => `${r},${c}` === where))),
  ));
  // One empty cell and the word is not sent.
  const partial = { ...letters };
  delete partial[`${first.row},${first.col}`];
  assert.equal(filledWords(crossword, partial)[first.id], undefined);
});

test("too few words that can cross is no crossword", () => {
  assert.equal(layoutCrossword([{ answer: "ABC", clue: "x" }], {}), null);
  assert.equal(layoutCrossword([{ answer: "ABC", clue: "x" }, { answer: "XYZ", clue: "y" }], {}), null);
});

test("the app's copy and the server's are the same file", () => {
  const root = new URL("../..", import.meta.url).pathname;
  assert.equal(readFileSync(`${root}supabase/functions/_shared/crossword.ts`, "utf8"),
    readFileSync(`${root}packages/types/src/crossword.ts`, "utf8"));
});
