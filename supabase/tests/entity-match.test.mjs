import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { HUMAN, chooseEntity, nameParts, normaliseName, verifyPerson } = await import(`${edge}/entity-match.js`);

/**
 * The rule this file exists for: a deck about one person must never show
 * another person's face.
 *
 * Every image index answers a name with something. Commons offers a comedy
 * premiere for "Sherzodxon Qudratxo'ja"; a stock library offers a confident
 * portrait of a stranger. All of it looks like success. So identity is decided
 * here, on the entity's own statements, before any picture is chosen.
 */

const entity = (over = {}) => ({
  id: "Q56635395",
  labels: ["Sherzodxon Qudratxo‘ja"],
  aliases: [],
  instanceOf: [HUMAN],
  image: "Шерзодхон Кудратходжаев.jpg",
  ...over,
});

/* ------------------------------------------------------------------ names */

test("one name typed on three keyboards is one name", () => {
  // `Qudratxo'ja`, `Qudratxo'ja` and `Qudratxoʻja` are the same surname. A
  // comparison that treats them as different rejects the right person.
  const spellings = ["Qudratxo‘ja", "Qudratxo'ja", "Qudratxoʻja", "Qudratxoʼja"];
  const first = normaliseName(spellings[0]);
  for (const spelling of spellings) assert.equal(normaliseName(spelling), first, spelling);
});

test("a name is its parts, minus the particles", () => {
  assert.deepEqual(nameParts("Sherzodxon Qudratxo‘ja"), ["sherzodxon", "qudratxoja"]);
  assert.deepEqual(nameParts("Alisher Navoiy hayoti"), ["alisher", "navoiy"]);
});

/* --------------------------------------------------------------- identity */

test("the person's own entity is accepted", () => {
  const verdict = verifyPerson(entity(), "Sherzodxon Qudratxo‘ja");
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, "label_exact");
});

test("a different spelling of the same person is still accepted", () => {
  assert.equal(verifyPerson(entity(), "Sherzodxon Qudratxo'ja").ok, true);
  assert.equal(verifyPerson(entity({ labels: ["Шерзодхон Кудратходжаев"], aliases: ["Sherzodxon Qudratxoʻja"] }), "Sherzodxon Qudratxo‘ja").ok, true);
});

test("a different person is refused, however close the name", () => {
  /**
   * The whole point. Two of three parts lining up is not the same human, and
   * a similarity score is exactly how somebody else's photograph gets onto a
   * biography.
   */
  const other = entity({ id: "Q999", labels: ["Sherzod Qudratov"] });
  const verdict = verifyPerson(other, "Sherzodxon Qudratxo‘ja");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "name_mismatch");
});

test("a thing named after a person is not that person", () => {
  // "Alisher Navoiy" is a poet, a film and a listed building. Only one of them
  // has a face.
  const building = entity({ id: "Q121300239", labels: ["Alisher Navoiy"], instanceOf: ["Q35112127"], image: "Teatr.jpg" });
  assert.deepEqual(verifyPerson(building, "Alisher Navoiy"), { ok: false, reason: "not_human" });
});

test("a person the encyclopaedia has no picture of is refused, not approximated", () => {
  assert.deepEqual(verifyPerson(entity({ image: null }), "Sherzodxon Qudratxo‘ja"), { ok: false, reason: "no_image" });
});

test("parts scattered across separate aliases do not make a match", () => {
  // A merged entry can carry two people's names. Every part has to appear in
  // one single name, not one part in each.
  const merged = entity({ labels: ["Sherzodxon Ahmedov"], aliases: ["Bahodir Qudratxo‘ja"] });
  assert.equal(verifyPerson(merged, "Sherzodxon Qudratxo‘ja").ok, false);
});

/* --------------------------------------------------------------- choosing */

test("among several items with one name, the person wins", () => {
  const poet = entity({ id: "Q503340", labels: ["Alisher Navoiy"], image: "Navoi.jpg" });
  const film = entity({ id: "Q4062476", labels: ["Alisher Navoiy"], instanceOf: ["Q11424"], image: "Poster.jpg" });
  const chosen = chooseEntity([film, poet], "Alisher Navoiy");
  assert.equal(chosen.id, "Q503340");
});

test("no candidate is nothing, never the closest one", () => {
  const strangers = [entity({ id: "Q1", labels: ["Sherzod Qudratov"] }), entity({ id: "Q2", labels: ["Alisher Navoiy"] })];
  assert.equal(chooseEntity(strangers, "Sherzodxon Qudratxo‘ja"), null);
});

test("an exact label beats a looser match", () => {
  const loose = entity({ id: "Q1", labels: ["Sherzodxon Qudratxoja Muhammadovich"] });
  const exact = entity({ id: "Q9999", labels: ["Sherzodxon Qudratxo‘ja"] });
  assert.equal(chooseEntity([loose, exact], "Sherzodxon Qudratxo‘ja").id, "Q9999");
});
