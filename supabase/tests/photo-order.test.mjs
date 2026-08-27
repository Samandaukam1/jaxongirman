import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { findFromProviders } = await import(`${edge}/photo-order.js`);

/**
 * The provider order, proved without breaking Unsplash on purpose.
 *
 * Which index answers is the one decision in this path that cannot be checked
 * against the live internet: to watch the fallback work you would have to make
 * the preferred provider fail, and the only way to do that in production is to
 * take the key away from everybody. So the order takes its searches as
 * arguments and this asks it every question directly.
 */

const hit = (url) => ({ url, width: 1, height: 1, attribution: {
  title: "t", creator: "c", license: "l", licenseUrl: "u", sourceUrl: "https://s", provider: "p",
} });

const spy = (answer) => {
  const calls = [];
  const fn = async (query, orientation, skip) => {
    calls.push({ query, orientation, skip });
    if (typeof answer === "function") return answer(calls.length);
    return answer;
  };
  fn.calls = calls;
  return fn;
};

const providers = (over = {}) => ({
  unsplashConfigured: () => true,
  unsplash: spy(null),
  openverse: spy(null),
  ...over,
});

test("Unsplash answers first when it has anything at all", async () => {
  const p = providers({ unsplash: spy(hit("u.jpg")), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "clean water" });

  assert.equal(found.source, "unsplash");
  assert.equal(found.hit.url, "u.jpg");
  assert.equal(p.openverse.calls.length, 0, "the fallback must not be called when the first provider answered");
});

test("Openverse answers when Unsplash finds nothing on any rung", async () => {
  const p = providers({ unsplash: spy(null), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "clean water drops leaf" });

  assert.equal(found.source, "openverse");
  // The whole ladder is tried on the preferred index before dropping to the
  // other one; alternating would trade a good match for a vague one.
  assert.ok(p.unsplash.calls.length > 1, "Unsplash was not given the full ladder");
  assert.equal(p.openverse.calls[0].query, p.unsplash.calls[0].query, "both start from the same query");
});

test("a provider that throws does not end the search", async () => {
  // An expired key, a rate limit that surfaces as an error, a DNS blip: from
  // here they are one fact — nothing came back, and the deck still needs a
  // picture.
  const angry = async () => { throw new Error("401 unauthorized"); };
  const p = providers({ unsplash: angry, openverse: spy(hit("o.jpg")) });

  const found = await findFromProviders(p, { query: "bridge" });
  assert.equal(found.source, "openverse");
});

test("no key means Unsplash is never asked", async () => {
  const p = providers({ unsplashConfigured: () => false, unsplash: spy(hit("u.jpg")), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "bridge" });

  assert.equal(found.source, "openverse");
  assert.equal(p.unsplash.calls.length, 0, "an install with no key must not call Unsplash at all");
});

test("nothing anywhere is null, not a throw", async () => {
  // A deck with no picture is a slide on the palette ground, which several
  // designs treat as a deliberate composition. It is never a reason to fail.
  assert.equal(await findFromProviders(providers(), { query: "bridge" }), null);
});

test("what the design asked for reaches the provider", async () => {
  const p = providers({ unsplash: spy(hit("u.jpg")) });
  await findFromProviders(p, { query: "team at work", orientation: "portrait", skip: 2 });

  assert.equal(p.unsplash.calls[0].orientation, "portrait");
  assert.equal(p.unsplash.calls[0].skip, 2);
});

test("the style preference widens a failing search rather than narrowing the first", async () => {
  const withTheme = providers();
  await findFromProviders(withTheme, { query: "growth", theme: "editorial" });
  const rungs = withTheme.unsplash.calls.map((call) => call.query);

  assert.equal(rungs[0], "growth", "the subject is asked for first, unqualified");
  assert.ok(rungs.some((rung) => rung.includes("editorial")), "the theme was never tried");
});

/* ---------------------------------------------------------------- people */

const { looksLikePerson } = await import(`${edge}/photo-order.js`);

test("a name is recognised, a subject is not", () => {
  for (const name of ["Alisher Navoiy", "Jaxongir Qurbonnazarov", "Islom Karimov", "Ada Lovelace"]) {
    assert.ok(looksLikePerson(name), `${name} should read as a person`);
  }
  for (const subject of [
    "Korrupsiyaga qarshi kurash",
    "suv resurslarini tejash",
    "Toshkent metrosi",
    "Raqamli iqtisodiyot",
    "AI",
  ]) {
    assert.ok(!looksLikePerson(subject), `${subject} should not read as a person`);
  }
});

test("a name wearing a topic word is still a name", () => {
  // "Jaxongir Qurbonnazarov haqida" is a biography of one person, and the
  // picture it needs is of him.
  assert.ok(looksLikePerson("Jaxongir Qurbonnazarov haqida"));
  assert.ok(looksLikePerson("Alisher Navoiy hayoti"));
});

test("a person is never sent to the stock library", async () => {
  /**
   * The failure this exists to prevent. Asked for "Alisher Navoiy", a stock
   * library does not answer "I have no picture of him" — it returns a confident
   * portrait of somebody else, and a biography opens with a stranger's face.
   */
  const p = providers({ unsplash: spy(hit("stranger.jpg")), openverse: spy(hit("navoiy.jpg")) });
  const found = await findFromProviders(p, { query: "Alisher Navoiy" });

  assert.equal(found.source, "openverse");
  assert.equal(p.unsplash.calls.length, 0, "the stock library was asked about a person");
});

test("a person's name is asked for whole, not widened", async () => {
  // The ladder drops words to broaden a failing search. For a subject that
  // finds something near enough; for a person it finds a different person.
  const p = providers({ openverse: spy(null) });
  await findFromProviders(p, { query: "Alisher Navoiy hayoti va ijodi" });

  assert.equal(p.openverse.calls.length, 1, "a name must not be broadened into a search for anybody");
});

test("an ordinary subject still gets the stock library and the full ladder", async () => {
  const p = providers({ unsplash: spy(null), openverse: spy(hit("o.jpg")) });
  await findFromProviders(p, { query: "suv resurslarini tejash" });
  assert.ok(p.unsplash.calls.length > 1, "a subject must still get the preferred index and the whole ladder");
});
