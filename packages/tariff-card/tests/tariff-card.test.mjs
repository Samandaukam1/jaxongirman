import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function build() {
  const cache = path.join(repoRoot, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const outDir = mkdtempSync(path.join(cache, "jaxongirman-tariff-"));
  const configPath = path.join(outDir, "tsconfig.json");
  const src = path.join(packageRoot, "src");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true,
      skipLibCheck: true, outDir, rootDir: src,
    },
    include: [path.join(src, "**", "*.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const dir = build();
const { cardLines, coinRate, detailSections, economicsOf, formatAmount, planWorth, priceLine } = await import(`${dir}/index.js`);
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

/** The plan as it ships, so the tests describe what a buyer actually sees. */
const plan = {
  code: "premium_monthly", name: "JAXONGIRMAN PREMIUM", subtitle: "", description: "",
  badge: "ENG OMMABOP", ctaLabel: "Premiumni faollashtirish",
  priceAmount: 36000, compareAtAmount: 0, currency: "UZS", periodDays: 30,
  features: {
    presentation_weekly: { enabled: true, limit: 4, period: "week", rollover: false },
    presentation_max_slides: { enabled: true, limit: 16 },
    marathon_unlock: { enabled: true, limit: 1, period: "week" },
    marketplace_buy: { enabled: true }, marketplace_sell: { enabled: true },
    marketplace_edit: { enabled: true }, marketplace_present: { enabled: true },
    marketplace_download: { enabled: false }, marketplace_resale: { enabled: false },
    game_free_daily: { enabled: true, unlimited: true, limit: null },
    game_cost_after_free: { enabled: true, cost: 20 },
    external_pptx_present: { enabled: true, cost: 24 },
  },
};

/**
 * The separator is a narrow no-break space, written here as an escape so the
 * intent is visible: a price is the one place a reader is counting digits, and
 * it must never wrap across a line in the middle of doing so.
 */
test("the price reads the way it is spoken, and cannot wrap mid-number", () => {
  assert.equal(formatAmount(36000), "36\u202F000");
  assert.equal(formatAmount(1200000), "1\u202F200\u202F000");
  assert.equal(formatAmount(500), "500", "a small number needs no separator");

  const { amount, unit } = priceLine(plan);
  assert.equal(amount, "36\u202F000");
  assert.equal(unit, "söm / oy");
  assert.ok(!amount.includes(" "), "an ordinary space here would let the price break in two");
});

/**
 * The card's lines are written from the plan's own numbers, so an admin
 * changing four to five changes the sentence rather than leaving it lying.
 */
test("every card line is generated from the plan, never hardcoded", () => {
  const labels = cardLines(plan).map((line) => line.label);
  assert.ok(labels.includes("Haftasiga 4 ta prezentatsiya"));
  assert.ok(labels.includes("Har birida 16 tagaça slayd"));
  assert.ok(labels.includes("Haftasiga 1 ta premium oçiş"));

  const five = { ...plan, features: { ...plan.features, presentation_weekly: { enabled: true, limit: 5, period: "week" } } };
  assert.ok(cardLines(five).map((l) => l.label).includes("Haftasiga 5 ta prezentatsiya"));
});

test("an allowance with no ceiling says so rather than showing a number", () => {
  assert.ok(cardLines(plan).map((l) => l.label).includes("Çeksiz Öyingoh öyinlari"));
  const limited = { ...plan, features: { ...plan.features, game_free_daily: { enabled: true, limit: 3, period: "day" } } };
  assert.ok(cardLines(limited).map((l) => l.label).includes("Kuniga 3 ta Öyingoh öyini"));
});

/**
 * A card is an argument for buying; the argument against belongs in the sheet.
 * So a capability an admin switched off is dropped from the card and shown as
 * absent in the detail, where somebody is comparing rather than being sold to.
 */
test("a switched-off capability leaves the card but appears in the detail", () => {
  const noSelling = { ...plan, features: { ...plan.features, marketplace_sell: { enabled: false } } };
  const labels = cardLines(noSelling).map((l) => l.label);
  assert.ok(!labels.includes("Marketplace’da sotiş"), "the card stops claiming it");
  assert.ok(!labels.some((label) => /xarid/i.test(label)), "and never sells buying, which is open to everyone");
  assert.ok(cardLines(plan).map((l) => l.label).includes("Marketplace’da sotiş"), "a plan that sells says so");

  const marketplace = detailSections(noSelling).find((s) => s.key === "marketplace");
  assert.ok(!marketplace.rows.some((r) => r.label === "Xarid qiliş"), "buying is no row of a plan");
  const sell = marketplace.rows.find((r) => r.label === "Sotiş");
  assert.equal(sell.included, false, "the detail says plainly that it is not included");
  assert.equal(sell.value, "✕");
});

test("the detail answers the questions a buyer arrives with", () => {
  const marketplace = detailSections(plan).find((s) => s.key === "marketplace");
  assert.equal(marketplace.rows.find((r) => r.label === "Yuklab oliş").value, "✕");
  assert.equal(marketplace.rows.find((r) => r.label === "Qayta sotiş").value, "✕");
  assert.equal(marketplace.rows.find((r) => r.label === "Tahrirlaş").value, "✓");

  const game = detailSections(plan).find((s) => s.key === "game");
  assert.equal(game.rows.find((r) => r.label === "Bepul öyinlar").value, "Çeksiz");
  assert.equal(game.rows.find((r) => r.label === "Limitdan keyin").value, "20 J");

  const pptx = detailSections(plan).find((s) => s.key === "pptx");
  assert.equal(pptx.rows[0].value, "24 J");
});

/**
 * The cost is a belief an admin typed, so the margin is an estimate and the
 * warning never blocks: running a plan at a loss to win a market is a decision.
 */
test("the economics warn about a lossy plan without refusing it", () => {
  const healthy = economicsOf({ priceAmount: 36000, estimatedCostAmount: 9000 });
  assert.equal(healthy.grossProfit, 27000);
  assert.equal(healthy.marginPercent, 75);
  assert.equal(healthy.lossy, false);

  const lossy = economicsOf({ priceAmount: 36000, estimatedCostAmount: 50000 });
  assert.equal(lossy.grossProfit, -14000);
  assert.ok(lossy.marginPercent < 0);
  assert.equal(lossy.lossy, true, "flagged");

  assert.equal(economicsOf({ priceAmount: 0, estimatedCostAmount: 0 }).marginPercent, 0,
    "a free plan divides by nothing rather than by zero");
});

/* ---------------------------------------------------------------- usage */

const { usageLines, resetLabel } = await import(`${dir}/index.js`);

/**
 * A "Premium" badge tells somebody they paid. This tells them what they have
 * left, which is what they opened the page to find out.
 */
test("usage says what is left, not merely that somebody is premium", () => {
  const lines = usageLines([
    { feature: "presentation_weekly", enabled: true, limit: 4, used: 3, remaining: 1 },
    { feature: "marathon_unlock", enabled: true, limit: 1, used: 0, remaining: 1 },
    { feature: "game_free_daily", enabled: true, unlimited: true, limit: null, remaining: null },
    { feature: "marketplace_buy", enabled: false },
  ]);

  assert.equal(lines.length, 3, "a capability that is switched off has no allowance to report");
  assert.deepEqual(lines.map((l) => l.detail), ["3 / 4 işlatildi", "0 / 1 işlatildi", "Çeksiz"]);
  assert.deepEqual(lines.map((l) => l.label), ["Prezentatsiyalar", "Premium oçiş", "Öyinlar"]);
  assert.equal(lines[2].limit, null, "an unlimited line has no bar to fill");
});

test("the reset is said as a day, because that is how a week is planned", () => {
  const today = new Date();
  assert.equal(resetLabel(today.toISOString()), "Yangi limitlar bugun yangilanadi");

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  assert.equal(resetLabel(tomorrow.toISOString()), "Yangi limitlar ertaga yangilanadi");

  const later = new Date(today);
  later.setDate(today.getDate() + 4);
  assert.match(resetLabel(later.toISOString()), /^Yangi limitlar \S+ kuni yangilanadi$/);

  assert.equal(resetLabel(null), null, "nothing to say when there is no reset");
  assert.equal(resetLabel("not a date"), null);
});

/**
 * The struck-through price on a card is what the plan's J Tanga would cost as
 * packages — a real figure a buyer can check on the J Tanga screen, never an
 * invented "old price". The prices are the ones on sale on 2026-10-22.
 */
test("a plan is compared with its own coins bought at the cheapest package rate", () => {
  const packages = [
    { coins: 100, priceAmount: 2900, currency: "UZS" },
    { coins: 1000, priceAmount: 29000, currency: "UZS" },
    { coins: 0, priceAmount: 2900, currency: "UZS" },
  ];
  assert.equal(coinRate(packages), 29);
  assert.equal(coinRate([...packages, { coins: 500, bonusCoins: 100, priceAmount: 14500, currency: "UZS" }]), 14500 / 600,
    "a bonus makes a package cheaper per coin, and the cheapest is what a plan has to beat");
  assert.equal(coinRate([]), null);
  assert.equal(coinRate([{ coins: 100, priceAmount: 5, currency: "USD" }]), null, "another currency is not compared with so'm");

  assert.deepEqual(planWorth({ priceAmount: 19000, includedCoins: 1230 }, 29), { worth: 35670, save: 16670, percent: 46 });
  assert.deepEqual(planWorth({ priceAmount: 34000, includedCoins: 2200 }, 29), { worth: 63800, save: 29800, percent: 46 });
});

test("a plan that saves nothing shows no saving", () => {
  assert.equal(planWorth({ priceAmount: 40000, includedCoins: 1000 }, 29), null, "dearer than its coins");
  assert.equal(planWorth({ priceAmount: 29000, includedCoins: 1000 }, 29), null, "exactly its coins");
  assert.equal(planWorth({ priceAmount: 19000, includedCoins: 0 }, 29), null, "a quota plan has no coins to compare");
  assert.equal(planWorth({ priceAmount: 19000, includedCoins: 1230 }, null), null, "no packages on sale");
});

