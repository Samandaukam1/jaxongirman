import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = readFileSync(path.join(webRoot, "app", "tarif", "TariffCheckout.tsx"), "utf8");
const orders = readFileSync(path.join(webRoot, "lib", "orders.ts"), "utf8");
const css = readFileSync(path.join(webRoot, "app", "globals.css"), "utf8");
const cors = readFileSync(path.join(webRoot, "..", "supabase", "functions", "_shared", "cors.ts"), "utf8");

/** Protects the browser half of the real partial-card flow from UI-only regressions. */

test("saved cards come from the RLS-protected source of truth", () => {
  assert.match(orders, /export async function listPartialCards\(\): Promise<PartialCard\[\]>/);
  assert.match(orders, /\.from\("partial_cards"\)/);
  assert.match(orders, /\.eq\("is_active", true\)/);
  assert.match(orders, /\.order\("last_used_at", \{ ascending: false/);
  assert.match(checkout, /hasSession \? listPartialCards\(\)/,
    "card hints must only be loaded for an authenticated account");
});

test("the picker shows the full safe hint and has an explicit new-card path", () => {
  assert.ok(checkout.includes("Chala kartalardan"));
  assert.match(checkout, /formatCardPan\(card\.display_pan\)/,
    "the list must show first eight, XXXX and last four — not only the tail");
  assert.match(checkout, /formatStoredCardExpiry\(card\.expiry_month, card\.expiry_year\)/);
  assert.ok(checkout.includes("Yangi karta"));
  assert.match(checkout, /disabled=\{busy \|\| expired\}/,
    "an expired remembered card must remain visible but cannot be selected");
});

test("selecting a hint changes state and never starts or verifies a payment", () => {
  const start = checkout.indexOf("function selectPartialCard");
  const end = checkout.indexOf("function selectNewCard", start);
  assert.ok(start >= 0 && end > start, "the partial-card selection handler must be named and inspectable");
  const selection = checkout.slice(start, end);
  assert.match(selection, /setSelectedCard\(card\)/);
  assert.doesNotMatch(selection, /payStart|payVerify|functions\.invoke/,
    "choosing a card is presentation only, never an automatic charge");
  assert.equal((checkout.match(/payStart\(/g) ?? []).length, 1,
    "payment may begin only in the explicit submit path");
});

test("only XXXX is editable and a complete 16-digit PAN exists for one request", () => {
  assert.ok(checkout.includes("Yetishmayotgan 4 ta raqamni kiriting"));
  assert.match(checkout, /className="checkout-missing-digits"[\s\S]*?maxLength=\{4\}/);
  assert.match(checkout, /reconstructPartialCardPan\(selectedCard\.display_pan, missingCardDigits\)/);
  assert.match(checkout, /panDigits\.length === 16/);
  assert.doesNotMatch(checkout, /slice\(0, 19\)/,
    "the four-missing-digits contract cannot represent a 17–19 digit PAN");

  const request = checkout.indexOf("const request = payStart");
  const clearPan = checkout.indexOf('setPan("")', request);
  const clearMissing = checkout.indexOf('setMissingDigits("")', request);
  const awaitResponse = checkout.indexOf("await request", request);
  assert.ok(request >= 0 && clearPan > request && clearMissing > request && awaitResponse > clearMissing,
    "sensitive input state must be cleared immediately after request creation, before its response");
});

test("MM/YY validity and consumed OTP attempts are enforced in the UI contract", () => {
  assert.match(checkout, /validateCardExpiry\(expiry\)/);
  assert.match(checkout, /isStoredCardExpired\(selectedCard\.expiry_month, selectedCard\.expiry_year\)/);
  assert.match(checkout, /disabled=\{busy \|\| !cardReady\}/);
  assert.match(checkout, /failure\.restartRequired \|\| OTP_RESTART_CODES\.has\(failure\.code\)/);
  assert.match(checkout, /setStep\("card"\)/,
    "a consumed or expired verification token must restart card/SMS, not retry the dead token");
  assert.match(checkout, /const verifyRequest = payVerify\([\s\S]*?setCode\(""\);[\s\S]*?await verifyRequest/,
    "the SMS code must leave component state before the provider responds");
  assert.match(orders, /payVerify = \(orderId: string, attemptId: string, code: string\)/);
  assert.match(checkout, /setAttemptId\(started\.attemptId\)/);
  assert.match(checkout, /payVerify\(order\.order_id, attemptId, code\)/,
    "verification must be bound to the exact immutable attempt returned by start");
});

test("the Payme attribution and partial-card focus states stay visible", () => {
  assert.ok(checkout.includes("Powered by <strong>Payme</strong>"));
  for (const selector of [
    ".partial-card-picker", ".partial-card-option.is-active", ".checkout-masked-pan",
    ".checkout-missing-digits", ".checkout-provider",
  ]) {
    assert.ok(css.includes(selector), `${selector} must have an explicit style`);
  }
  assert.match(css, /\.partial-card-option:focus-visible/,
    "keyboard users need a visible selection focus");
});

test("browser payment requests pass CORS preflight with the platform policy header", () => {
  assert.match(orders, /"X-Client-Platform": CLIENT_PLATFORM/);
  assert.match(cors, /x-client-platform/);
});
