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
  wikimedia: spy(null),
  openverse: spy(null),
  // Neutral by default: most of these exercise the ordinary ladder, and a
  // subject that is not a person is what puts them on it. The person tests set
  // their own answer.
  person: async () => ({ kind: "not_a_person" }),
  ...over,
});

/** A person lookup that records what it was asked, like `spy` does. */
const personSpy = (answer) => {
  const calls = [];
  const fn = async (name, orientation, skip) => {
    calls.push({ name, orientation, skip });
    return typeof answer === "function" ? answer() : answer;
  };
  fn.calls = calls;
  return fn;
};

test("Unsplash answers first when it has anything at all", async () => {
  const p = providers({ unsplash: spy(hit("u.jpg")), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "clean water" });

  assert.equal(found.source, "unsplash");
  assert.equal(found.hit.url, "u.jpg");
  assert.equal(p.openverse.calls.length, 0, "the fallback must not be called when the first provider answered");
});

test("Openverse answers when Unsplash finds nothing on any rung", async () => {
  const p = providers({ unsplash: spy(null), wikimedia: spy(null), openverse: spy(hit("o.jpg")) });
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
  const p = providers({ unsplash: angry, wikimedia: spy(null), openverse: spy(hit("o.jpg")) });

  const found = await findFromProviders(p, { query: "bridge" });
  assert.equal(found.source, "openverse");
});

test("no key means Unsplash is never asked", async () => {
  const p = providers({ unsplashConfigured: () => false, unsplash: spy(hit("u.jpg")), wikimedia: spy(null), openverse: spy(hit("o.jpg")) });
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
  const p = providers({ unsplash: spy(hit("stranger.jpg")), wikimedia: spy(hit("wrong.jpg")), person: personSpy({ kind: "photo", hit: hit("navoiy.jpg") }) });
  const found = await findFromProviders(p, { query: "Alisher Navoiy" });

  assert.equal(found.source, "wikidata");
  assert.equal(p.unsplash.calls.length, 0, "the stock library was asked about a person");
  assert.equal(p.wikimedia.calls.length, 0, "an image search was asked about a person");
});

test("a person's name is asked for whole, not widened", async () => {
  // The ladder drops words to broaden a failing search. For a subject that
  // finds something near enough; for a person it finds a different person.
  const p = providers({ person: personSpy({ kind: "unverified", reason: "no_entity" }) });
  await findFromProviders(p, { query: "Alisher Navoiy hayoti va ijodi" });

  assert.equal(p.person.calls.length, 1, "a name must not be broadened into a search for anybody");
});

test("an ordinary subject still gets the stock library and the full ladder", async () => {
  const p = providers({ unsplash: spy(null), wikimedia: spy(null), openverse: spy(hit("o.jpg")) });
  await findFromProviders(p, { query: "suv resurslarini tejash" });
  assert.ok(p.unsplash.calls.length > 1, "a subject must still get the preferred index and the whole ladder");
});

/* ------------------------------------------------- the three-provider ladder */

test("Unsplash first: a stock answer stops the search", async () => {
  const p = providers({ unsplash: spy(hit("u.jpg")), wikimedia: spy(hit("w.jpg")), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "modern startup team office" });

  assert.equal(found.source, "unsplash");
  assert.equal(p.wikimedia.calls.length, 0, "Commons must not be asked when the stock library answered");
  assert.equal(p.openverse.calls.length, 0);
});

test("Wikimedia second: it answers when Unsplash cannot", async () => {
  const p = providers({ unsplash: spy(null), wikimedia: spy(hit("w.jpg")), openverse: spy(hit("o.jpg")) });
  // An unnamed subject, so the order is the ordinary one: a named subject goes
  // to Commons first and is covered by its own test below.
  const found = await findFromProviders(p, { query: "ancient stone archway" });

  assert.equal(found.source, "wikimedia");
  assert.equal(p.openverse.calls.length, 0, "the widest net is only for when the other two came back empty");
});

test("Openverse last: it answers when neither of the others could", async () => {
  const p = providers({ unsplash: spy(null), wikimedia: spy(null), openverse: spy(hit("o.jpg")) });
  const found = await findFromProviders(p, { query: "moon landing footage" });
  assert.equal(found.source, "openverse");
});

test("a provider that throws hands over rather than ending the deck", async () => {
  // A rate limit, an expired key, a DNS blip: from here they are one fact —
  // nothing came back — and the next index is the reason there is a next one.
  const angry = async () => { throw new Error("503 unavailable"); };

  const unsplashDown = providers({ unsplash: angry, wikimedia: spy(hit("w.jpg")) });
  assert.equal((await findFromProviders(unsplashDown, { query: "Amir Temur davri" })).source, "wikimedia");

  const bothDown = providers({ unsplash: angry, wikimedia: angry, openverse: spy(hit("o.jpg")) });
  assert.equal((await findFromProviders(bothDown, { query: "Amir Temur davri" })).source, "openverse");

  const allDown = providers({ unsplash: angry, wikimedia: angry, openverse: angry });
  assert.equal(await findFromProviders(allDown, { query: "Amir Temur davri" }), null, "a deck with no picture is not a failed deck");
});

test("what the design asked for reaches Commons too", async () => {
  const p = providers({ unsplash: spy(null), wikimedia: spy(hit("w.jpg")) });
  await findFromProviders(p, { query: "human heart anatomy", orientation: "portrait", skip: 1 });

  assert.equal(p.wikimedia.calls[0].orientation, "portrait");
  assert.equal(p.wikimedia.calls[0].skip, 1);
});

test("Commons gets the same ladder, not a query system of its own", async () => {
  // One query architecture for all three: a provider with its own rungs would
  // find a different picture for the same deck depending on who answered.
  const p = providers({ unsplash: spy(null), wikimedia: spy(null), openverse: spy(null) });
  await findFromProviders(p, { query: "historical portrait of Amir Temur in Samarkand" });

  assert.deepEqual(
    p.wikimedia.calls.map((call) => call.query),
    p.unsplash.calls.map((call) => call.query),
    "the rungs must be identical",
  );
});

test("a named subject goes to the encyclopaedia before the stock library", async () => {
  /**
   * A stock library always answers. Asked for "Amir Temur" it returns a
   * confident photograph of a monument somewhere else, and the deck looks
   * illustrated while showing the wrong thing.
   */
  const p = providers({ unsplash: spy(hit("generic.jpg")), wikimedia: spy(hit("temur.jpg")) });
  const found = await findFromProviders(p, { query: "Amir Temur dramatic" });

  assert.equal(found.source, "wikimedia");
  assert.equal(p.unsplash.calls.length, 0, "the stock library answered first for a named subject");
});

test("a named subject still falls to the stock library when Commons has nothing", async () => {
  // A place with no Commons photograph is better served by a generic one than
  // by an empty frame. Only a *person* is refused that.
  const p = providers({ unsplash: spy(hit("generic.jpg")), wikimedia: spy(null) });
  const found = await findFromProviders(p, { query: "Registan Samarkand ancient" });
  assert.equal(found.source, "unsplash");
});

test("an unnamed subject keeps the order it always had", async () => {
  const p = providers({ unsplash: spy(hit("u.jpg")), wikimedia: spy(hit("w.jpg")) });
  const found = await findFromProviders(p, { query: "blue water drops leaf" });

  assert.equal(found.source, "unsplash");
  assert.equal(p.wikimedia.calls.length, 0);
});

/* ----------------------------------------------- a person, or nobody at all */

test("a person nobody can verify gets no picture, not somebody else's", async () => {
  /**
   * The rule the whole exercise is for. Every index answers a name with
   * something: Commons with a comedy premiere, a stock library with a
   * confident stranger, Openverse with whichever person its index liked. All
   * three look like success.
   *
   * No picture is a slide the design already knows how to draw. The wrong
   * picture is a different person's face on somebody's biography.
   */
  const p = providers({
    person: personSpy({ kind: "unverified", reason: "no_entity" }),
    unsplash: spy(hit("stranger.jpg")),
    wikimedia: spy(hit("comedy-premiere.jpg")),
    openverse: spy(hit("some-man.jpg")),
  });

  assert.equal(await findFromProviders(p, { query: "Sherzodxon Qudratxo‘ja" }), null);
  assert.equal(p.unsplash.calls.length, 0);
  assert.equal(p.wikimedia.calls.length, 0);
  assert.equal(p.openverse.calls.length, 0, "not even the fallback may guess at a person");
});

test("a verified person is used, and nothing else is asked", async () => {
  const p = providers({ person: personSpy({ kind: "photo", hit: hit("verified.jpg") }), unsplash: spy(hit("stranger.jpg")) });
  const found = await findFromProviders(p, { query: "Sherzodxon Qudratxo‘ja" });

  assert.equal(found.source, "wikidata");
  assert.equal(found.hit.url, "verified.jpg");
});

test("a person provider that throws still yields nothing rather than a guess", async () => {
  const p = providers({
    person: async () => { throw new Error("wikidata down"); },
    unsplash: spy(hit("stranger.jpg")),
    openverse: spy(hit("some-man.jpg")),
  });

  assert.equal(await findFromProviders(p, { query: "Sherzodxon Qudratxo‘ja" }), null);
  assert.equal(p.openverse.calls.length, 0);
});

test("orientation is passed to the person lookup but never overrules identity", async () => {
  // The right person's less-than-ideal photograph beats the wrong person's
  // perfect portrait, so orientation is a preference the provider may ignore.
  const p = providers({ person: personSpy({ kind: "photo", hit: hit("verified.jpg") }) });
  await findFromProviders(p, { query: "Alisher Navoiy", orientation: "portrait" });
  assert.equal(p.person.calls[0].orientation, "portrait");
});

test("the subject is checked for person-ness, not the whole decorated query", async () => {
  /**
   * By the time a slide asks for a picture the query carries the scene as well
   * as the subject — "Sherzodxon Qudratxoja dramatic" — and testing the whole
   * string decides it is not a name. That is how the wrong photograph reached a
   * biography even after the person rule existed.
   */
  const p = providers({
    person: personSpy({ kind: "photo", hit: hit("verified.jpg") }),
    wikimedia: spy(hit("comedy-premiere.jpg")),
  });

  const found = await findFromProviders(p, { query: "Sherzodxon Qudratxoja dramatic" });
  assert.equal(found.source, "wikidata");
  assert.equal(p.person.calls[0].name, "Sherzodxon Qudratxoja", "the scene words must not reach the encyclopaedia");
  assert.equal(p.wikimedia.calls.length, 0);
});

test("a name that turns out to be a place carries on to the ordinary providers", async () => {
  /**
   * "Registan Samarkand" reads like a name by any shallow test, and it is a
   * square. Blocking it would lose the picture entirely, so the entity lookup
   * says what it found rather than only whether it found a portrait.
   */
  const p = providers({
    person: personSpy({ kind: "not_a_person" }),
    wikimedia: spy(hit("registan.jpg")),
  });

  const found = await findFromProviders(p, { query: "Registan Samarkand ancient" });
  assert.equal(found.source, "wikimedia");
});

test("a person the encyclopaedia cannot confirm blocks every other provider", async () => {
  const p = providers({
    person: personSpy({ kind: "unverified", reason: "entity_name_mismatch" }),
    unsplash: spy(hit("stranger.jpg")),
    wikimedia: spy(hit("someone-else.jpg")),
    openverse: spy(hit("any-man.jpg")),
  });

  assert.equal(await findFromProviders(p, { query: "Sherzodxon Qudratxoja portrait" }), null);
  assert.equal(p.wikimedia.calls.length, 0, "the search that returns a comedy premiere must not be reached");
});
