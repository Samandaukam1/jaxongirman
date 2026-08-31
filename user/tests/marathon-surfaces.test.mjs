import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const userRoot = path.resolve(here, "..");

/**
 * §32's audit, in the half a machine can answer.
 *
 * The spec asks for a screenshot audit and it is right to: no test sees that a
 * button is beautiful. What a test can hold is everything a refactor silently
 * breaks — that the vote button is still beside the bell rather than three
 * elements away, that the marathon section is still above Sozlamalar, that no
 * marathon surface draws itself without checking whether the feature is on, and
 * that nothing paints itself a colour the theme cannot flip.
 *
 * Every check here is written against the file that would have to change for it
 * to become false.
 */
const read = (relative) => readFileSync(path.join(userRoot, relative), "utf8");

/** Where a marker sits in a file, asserting it is there exactly once. */
function at(source, marker, label) {
  const first = source.indexOf(marker);
  assert.notEqual(first, -1, `${label}: "${marker}" topilmadi`);
  assert.equal(source.indexOf(marker, first + 1), -1, `${label}: "${marker}" bir necha marta uchradi`);
  return first;
}

/* ------------------------------------------------------- 1-5: placement -- */

test("home: the vote button sits between the profile and the bell", () => {
  const source = read("app/(app)/(tabs)/index.tsx");
  const identity = at(source, "styles.headerIdentity", "home");
  const vote = at(source, "<MarathonVoteButton />", "home");
  const bell = at(source, "accessibilityLabel={unreadCount", "home");
  assert.ok(identity < vote && vote < bell,
    "the button belongs between the greeting and the bell — §2 puts it beside the bell, not in a row of its own");
});

test("projects: the vote button sits beside the search control", () => {
  const source = read("app/(app)/(tabs)/projects.tsx");
  const vote = at(source, '<MarathonVoteButton variant="compact" />', "projects");
  // The search on this screen is a toggle that opens the field, so the element
  // it has to sit beside is that button, not the input it reveals.
  const search = at(source, 'accessibilityLabel={searching ? "Qidiruvni yopish" : "Qidirish"}', "projects");
  assert.ok(vote < search && search - vote < 400,
    "§3 puts it next to the existing search rather than under it");
});

test("marketplace: the vote button sits beside Sotish", () => {
  const source = read("app/(app)/(tabs)/marketplace.tsx");
  const vote = at(source, '<MarathonVoteButton variant="compact" />', "marketplace");
  const sell = at(source, 'accessibilityLabel="Mahsulot sotish"', "marketplace");
  assert.ok(vote < sell && sell - vote < 400, "§4 puts the two actions side by side");
});

test("games: the vote button sits beside the coin balance", () => {
  const source = read("app/(app)/(tabs)/games.tsx");
  const vote = at(source, '<MarathonVoteButton variant="compact" />', "games");
  // `styles.coinPill` rather than the icon asset: the asset's first mention is
  // its import, at the top of the file, which is beside nothing.
  const coins = at(source, "styles.coinPill", "games");
  assert.ok(vote < coins && coins - vote < 400, "§5 puts it beside the J Tanga element");
});

test("profile: the marathon section comes before Sozlamalar", () => {
  const source = read("app/(app)/(tabs)/profile.tsx");
  const marathon = at(source, "<MarathonProfileCard />", "profile");
  const settings = at(source, "SOZLAMALAR", "profile");
  assert.ok(marathon < settings, "§15: a competition is not a setting and must not be filed under them");
});

/* ------------------------------------------------------ 6-7: the poster -- */

test("the poster is 2.35:1 and covered, in every place it is drawn", () => {
  const poster = read("src/components/MarathonPoster.tsx");
  assert.match(poster, /aspectRatio: 2\.35/, "§12 fixes the ratio");
  assert.match(poster, /resizeMode="cover"/, "§12: cover, never stretched");
  // The screen's loading placeholder has to be the same shape, or the page
  // reflows by half a poster the moment the campaign arrives.
  assert.match(read("app/(app)/marathon/index.tsx"), /aspectRatio: 2\.35/);
});

test("what is under the poster is the description and the rewards", () => {
  const section = read("src/components/MarathonSection.tsx");
  const poster = at(section, "<MarathonPoster", "home section");
  const description = at(section, "styles.description", "home section");
  const rewards = at(section, "<MarathonRewards", "home section");
  const join = section.indexOf("Qatnashish");
  assert.ok(poster < description && description < rewards && rewards < join,
    "§13 orders it: poster, words, clock, rewards, and only then the button");
});

/* ------------------------------------------------- 12: nothing when off -- */

test("no marathon surface draws itself without checking the switch", () => {
  const gated = {
    "src/components/MarathonVoteButton.tsx": "useMarathonEnabled",
    "src/components/MarathonSection.tsx": "useMarathonCampaign",
    "src/components/MarathonProfileCard.tsx": "useMarathonCampaign",
    "app/(app)/marathon/index.tsx": "useMarathonCampaign",
    "app/(app)/marathon/vote.tsx": "useMarathonEnabled",
    "app/(app)/marathon/market.tsx": "useVoteMarketEnabled",
    "app/(app)/marathon/sell.tsx": "useVoteMarketEnabled",
  };
  for (const [file, hook] of Object.entries(gated)) {
    assert.match(read(file), new RegExp(hook), `${file} §30 bo‘yicha o‘chirilganda ham chiziladi`);
  }
});

test("the campaign hook answers nothing while the feature is off", () => {
  const library = read("src/lib/marathon.ts");
  assert.match(library, /if \(!enabled\) \{ setCampaign\(null\); return; \}/,
    "an off marathon must not merely hide a campaign it went and fetched");
});

/* --------------------------------------------------- 14: light and dark -- */

test("nothing in the marathon paints itself a colour the theme cannot flip", () => {
  const files = [
    "src/components/MarathonVoteButton.tsx",
    "src/components/MarathonSection.tsx",
    "src/components/MarathonRewards.tsx",
    "src/components/MarathonProfileCard.tsx",
    "src/components/MarathonMilestoneModal.tsx",
    "app/(app)/marathon/index.tsx",
    "app/(app)/marathon/vote.tsx",
    "app/(app)/marathon/market.tsx",
    "app/(app)/marathon/sell.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    const hexes = source.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
    assert.deepEqual(hexes, [], `${file} da qattiq rang bor: ${hexes.join(", ")}`);
  }

  // Two deliberate exceptions, and they are exceptions for the same reason: a
  // QR code is black on white in both themes because a scanner reads contrast,
  // not taste, and a dark card behind one inverts it.
  const qr = read("src/components/QrCode.tsx");
  assert.match(qr, /#FFFFFF/);
  assert.match(qr, /#000000/);
  const share = read("src/components/MarathonShareRow.tsx");
  assert.match(share, /backgroundColor: "#FFFFFF"/,
    "the plate under the code is white on purpose, and says so");
});

/* ------------------------------------------------------ 15: small screen -- */

test("three of the four headers use the compact button", () => {
  const compact = ["projects", "marketplace", "games"].map((screen) =>
    read(`app/(app)/(tabs)/${screen}.tsx`).includes('variant="compact"'));
  assert.deepEqual(compact, [true, true, true],
    "§28: a full-width label beside a search field is what overflows a 320-point screen");
  // The home header has the room for the label, and it is the one screen where
  // the button has to teach what it is.
  assert.match(read("src/components/MarathonVoteButton.tsx"), /variant\?: "full" \| "compact"/);
});

/* ----------------------------------------------- 9-11: what is said, and -- */
/*                                                  what is deliberately not  */

test("a direct vote names the voter and a bought one cannot", () => {
  const voting = readFileSync(path.join(userRoot, "..", "supabase/migrations/202608311800_marathon_voting.sql"), "utf8");
  assert.match(voting, /v_voter_name.*\|\|\s*coalesce\(' \(@' \|\| v_voter_username/s,
    "§11: a direct vote carries the name and the username");

  const purchase = readFileSync(path.join(userRoot, "..", "supabase/migrations/202609010800_marathon_vote_purchase.sql"), "utf8");
  const fulfil = purchase.slice(purchase.indexOf("marathon_fulfil_vote_sale"));
  for (const forbidden of ["username", "full_name", "profiles"]) {
    assert.equal(fulfil.includes(forbidden), false,
      `§23: the marketplace notification must not be able to name anybody (${forbidden})`);
  }
});
