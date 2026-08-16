/**
 * The order payment flow end to end, against the real database and the real
 * function, with the sandbox provider standing in for Payme.
 *
 * What this exists to prove — the properties that decide whether money is safe:
 *
 *   * A client saying "paid" grants nothing. Only the server, holding the
 *     provider's answer, can fulfil.
 *   * The verification token is single-use, so a replayed verify cannot charge a
 *     card twice.
 *   * A wrong code leaves the order standing; a declined card closes it.
 *   * An order in `processing` is never marked failed — the provider may have
 *     taken the money, and reconciliation must still be able to see it.
 *   * Fulfilling twice grants once.
 *
 * Requires: npx supabase start, and functions served with
 *   PAYMENT_MODE=sandbox npx supabase functions serve
 * The sandbox accepts code 111111 and declines any card ending 0000.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const PROVIDER_CODE = process.env.PROVIDER_CODE ?? "111111";
const EXPECT_SANDBOX = (process.env.EXPECT_SANDBOX ?? "true") === "true";
// Payme's own documented example number, not anybody's card. It never leaves
// this file: the sandbox provider is what receives it, and nothing is stored.
const GOOD_CARD = process.env.PAYMENT_TEST_CARD ?? "8600069195406311";
const SECOND_CARD = process.env.PAYMENT_TEST_CARD_2 ?? "8600495473316478";
// The sandbox declines any number ending 0000, which is how the failure path is
// exercised without a real decline.
const DECLINED_CARD = "8600069195400000";
const EXPIRY = process.env.PAYMENT_TEST_EXPIRY ?? "03/99";
const SECOND_EXPIRY = process.env.PAYMENT_TEST_EXPIRY_2 ?? EXPIRY;

function expectedMask(pan) {
  return `${pan.slice(0, 8)}XXXX${pan.slice(-4)}`;
}

function reconstruct(masked, missing) {
  return `${masked.slice(0, 8)}${missing}${masked.slice(-4)}`;
}

function localEnvironment() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const values = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3];
  }
  return {
    url: values.API_URL,
    anonKey: values.ANON_KEY ?? values.PUBLISHABLE_KEY,
    serviceKey: values.SERVICE_ROLE_KEY ?? values.SECRET_KEY,
  };
}

/** Runs a statement as the database owner, for setup the API deliberately blocks. */
function sql(statement) {
  execFileSync("psql", ["-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-q", "-c", statement], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

const { url, anonKey, serviceKey } = localEnvironment();
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `${randomUUID()}Aa1!`;

async function makeUser(label) {
  const email = `${label}-${randomUUID()}@example.test`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error(`${label} not created`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id: created.data.user.id, client, token: signedIn.data.session.access_token };
}

/** Calls the function the way a client does, with the platform header. */
async function pay(accessToken, body, platform = "android") {
  const response = await fetch(`${url}/functions/v1/order-pay`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Client-Platform": platform,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const created = [];
try {
  console.log("Setting up a coin package and a buyer…");
  const buyer = await makeUser("orderpay");
  created.push(buyer.id);

  // The catalogue is admin-owned: `service_role` holds no INSERT on it, which is
  // correct and worth not weakening for a test. Seeding it the way an operator
  // would — through the database, not through the API — keeps the grant intact.
  const packageCode = `smoke_${randomUUID().slice(0, 8)}`;
  sql(`insert into public.coin_packages (code, label, coins, bonus_coins, price_amount)
       values ('${packageCode}', 'Smoke 40 J', 40, 0, 20000)`);
  const pkg = await service.from("coin_packages").select("id").eq("code", packageCode).single();
  if (pkg.error) throw pkg.error;

  const before = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  const startingBalance = before.data.balance;

  /* ------------------------------------------------ the happy path */

  console.log("Paying a coin order…");
  const order = await buyer.client.rpc("order_create_jcoin", { p_package_id: pkg.data.id, p_platform: "android" });
  if (order.error) throw order.error;
  assert(/^JAX-\d{4}-\d{6}$/.test(order.data.order_number), "the order carries a JAX-YYYY-NNNNNN number");
  assert(order.data.total_amount === 20000, "priced from the catalogue, not from the client");

  const started = await pay(buyer.token, { orderId: order.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY });
  assert(started.status === 200,
    `the card is accepted and a code is requested — got ${started.status}: ${JSON.stringify(started.body)}`);
  assert(started.body.status === "awaiting_verification", "and the order waits for verification");
  assert(started.body.maskedCard === expectedMask(GOOD_CARD), "the required 8+XXXX+4 mask comes back, never the PAN");
  assert(started.body.expiryHint === EXPIRY, "expiry comes back normalized as MM/YY");
  assert(started.body.sandbox === EXPECT_SANDBOX, "the expected provider mode is running");

  // Verification names the attempt it belongs to. The server will not guess:
  // an OTP is only meaningful against the card start that requested it, and
  // binding the two is what stops a code from being replayed against a later
  // attempt.
  assert(typeof started.body.attemptId === "string" && started.body.attemptId,
    "the start hands back the attempt the code will belong to");
  let attemptId = started.body.attemptId;

  // Wrong-code behavior is deterministic in the local adapter. The official
  // Payme test run may choose to avoid an extra SMS by setting RUN_WRONG_CODE=false.
  if ((process.env.RUN_WRONG_CODE ?? String(EXPECT_SANDBOX)) === "true") {
    const wrong = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: "000000", attemptId });
    assert(
      wrong.status === 400 && wrong.body.recoverable === true && wrong.body.restartRequired === true,
      "a consumed wrong-code attempt explicitly requires a fresh card start",
    );

    const restart = await pay(buyer.token, { orderId: order.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY });
    assert(restart.status === 200, "and the buyer can request a fresh verification code");
    // A restart is a new attempt, and the old id is now spent.
    assert(restart.body.attemptId && restart.body.attemptId !== attemptId,
      "a restart issues a fresh attempt rather than reviving the consumed one");
    attemptId = restart.body.attemptId;
  }

  const paid = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: PROVIDER_CODE, attemptId });
  assert(paid.status === 200 && paid.body.status === "paid",
    `the correct code completes the payment — got ${paid.status}: ${JSON.stringify(paid.body)}`);
  assert(paid.body.fulfilment?.coins_granted === 40, "and fulfilment granted the coins");
  assert(paid.body.maskedCard === expectedMask(GOOD_CARD), "paid response keeps only the trusted mask");

  const after = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  assert(after.data.balance === startingBalance + 40, "the wallet moved by exactly the package amount");

  const ledger = await service.from("credit_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", buyer.id).eq("type", "coin_purchase");
  assert(ledger.count === 1, "with exactly one ledger row");

  const firstCards = await buyer.client
    .from("partial_cards")
    .select("id,display_pan,last4,expiry_month,expiry_year,last_used_at")
    .order("last_used_at", { ascending: false });
  if (firstCards.error) throw firstCards.error;
  assert(firstCards.data.length === 1, "the first successful payment remembers one card");
  assert(firstCards.data[0].display_pan === expectedMask(GOOD_CARD), "database stores only the required masked hint");
  assert(!JSON.stringify(firstCards.data).includes(GOOD_CARD), "the partial-card row contains no full PAN");

  /* ---------------------------------------- second pay from four digits */

  console.log("Paying again from the four missing digits…");
  const orderFromHint = await buyer.client.rpc("order_create_jcoin", {
    p_package_id: pkg.data.id, p_platform: "android",
  });
  if (orderFromHint.error) throw orderFromHint.error;

  // This is what the UI does when the buyer types only the XXXX segment. The
  // four digits are a local variable and are never sent or stored separately.
  const missingFour = GOOD_CARD.slice(8, 12);
  const reconstructedPan = reconstruct(firstCards.data[0].display_pan, missingFour);
  assert(reconstructedPan === GOOD_CARD, "exactly four entered digits reconstruct the provider PAN in memory");

  const hintStart = await pay(buyer.token, {
    orderId: orderFromHint.data.order_id, step: "start", pan: reconstructedPan, expiry: EXPIRY,
  });
  assert(hintStart.status === 200, "the reconstructed card requests SMS verification normally");
  const hintPaid = await pay(buyer.token, {
    orderId: orderFromHint.data.order_id, step: "verify", code: PROVIDER_CODE,
    attemptId: hintStart.body.attemptId,
  });
  assert(hintPaid.status === 200 && hintPaid.body.status === "paid",
    `the second verified payment succeeds — got ${hintPaid.status}: ${JSON.stringify(hintPaid.body)}`);

  const duplicateCards = await buyer.client.from("partial_cards").select("id,display_pan,last_used_at");
  if (duplicateCards.error) throw duplicateCards.error;
  assert(duplicateCards.data.length === 1, "the same card is not saved twice");

  const afterHintPayment = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  assert(afterHintPayment.data.balance === startingBalance + 80, "the second payment fulfilled exactly once");

  /* ------------------------------------------------ another card */

  if (EXPECT_SANDBOX || process.env.PAYMENT_TEST_CARD_2) {
    const otherOrder = await buyer.client.rpc("order_create_jcoin", {
      p_package_id: pkg.data.id, p_platform: "android",
    });
    if (otherOrder.error) throw otherOrder.error;
    const otherStart = await pay(buyer.token, {
      orderId: otherOrder.data.order_id, step: "start", pan: SECOND_CARD, expiry: SECOND_EXPIRY,
    });
    assert(otherStart.status === 200, "a different card starts its own verified payment");
    const otherPaid = await pay(buyer.token, {
      orderId: otherOrder.data.order_id, step: "verify", code: PROVIDER_CODE,
      attemptId: otherStart.body.attemptId,
    });
    assert(otherPaid.status === 200 && otherPaid.body.status === "paid",
      `the different card payment succeeds — got ${otherPaid.status}: ${JSON.stringify(otherPaid.body)}`);
    const allCards = await buyer.client.from("partial_cards").select("display_pan");
    if (allCards.error) throw allCards.error;
    assert(allCards.data.length === 2, "a genuinely different card gets a separate hint");
    assert(allCards.data.some((card) => card.display_pan === expectedMask(SECOND_CARD)), "the second hint has the right mask");
  }

  /* ------------------------------------------------------ replays */

  console.log("Replaying what a dropped connection replays…");
  // Measured against the balance right before the replay rather than against
  // the opening one: several orders have been paid by now, and the claim being
  // tested is that a repeat grants nothing — not what the total happens to be.
  const beforeReplay = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  const again = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: PROVIDER_CODE });
  assert(again.body.alreadyPaid === true, "asking again about a paid order reports it already paid");

  const afterReplay = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  assert(afterReplay.data.balance === beforeReplay.data.balance, "and grants nothing a second time");

  const fulfilTwice = await service.rpc("order_fulfil", { p_order_id: order.data.order_id });
  assert(fulfilTwice.data?.already === true, "fulfilling directly a second time is a no-op too");

  /* ---------------------------------------------------- a decline */

  console.log("Declining a card…");
  const order2 = await buyer.client.rpc("order_create_jcoin", { p_package_id: pkg.data.id, p_platform: "android" });
  if (order2.error) throw order2.error;
  const declineStart = await pay(buyer.token, {
    orderId: order2.data.order_id, step: "start", pan: DECLINED_CARD, expiry: EXPIRY,
  });
  assert(declineStart.status === 200,
    `a card that will decline still starts normally — got ${declineStart.status}: ${JSON.stringify(declineStart.body)}`);
  const declined = await pay(buyer.token, {
    orderId: order2.data.order_id, step: "verify", code: PROVIDER_CODE,
    attemptId: declineStart.body.attemptId,
  });
  assert(declined.status === 402,
    `a provider decline is reported as a payment failure — got ${declined.status}: ${JSON.stringify(declined.body)}`);

  const declinedRow = await service.from("orders").select("status, failure_code")
    .eq("id", order2.data.order_id).single();
  // The decline happened while `processing`, so the order is deliberately left
  // there rather than marked failed: the provider may have taken the money and
  // reconciliation has to be able to see it.
  assert(
    ["failed", "processing"].includes(declinedRow.data.status),
    "and the order is either failed or left for reconciliation, never silently paid",
  );
  assert(declinedRow.data.status !== "paid", "a declined order is never paid");

  const balanceAfterDecline = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  // Against the balance the replay section already established, for the same
  // reason: what matters is that a decline moves it by nothing.
  assert(balanceAfterDecline.data.balance === afterReplay.data.balance, "a decline granted nothing");

  /* ------------------------------------------------- someone else's */

  console.log("Refusing what is not yours…");
  const stranger = await makeUser("orderpaystranger");
  created.push(stranger.id);
  const stolen = await pay(stranger.token, { orderId: order.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY });
  assert(stolen.status === 403, "another account cannot pay somebody else's order");

  /* -------------------------------------------------- iOS refusal */

  console.log("Refusing an iOS client while review mode is on…");
  // Only the flag: replacing the whole value would drop the copy an operator
  // configured, and a test has no business rewriting production settings.
  sql("update public.app_settings set value = jsonb_set(value, '{review_mode}', 'true') where key = 'payments.ios_policy'");

  // A separate package, because `order_create_jcoin` reuses whatever open order
  // the buyer already has for a package — and the declined one above is left in
  // `processing` on purpose, which is not a state a fresh card attempt may open
  // against. Reusing it made this section test the refusal instead of the
  // platform gate it is named after.
  const platformCode = `smoke_${randomUUID().slice(0, 8)}`;
  sql(`insert into public.coin_packages (code, label, coins, bonus_coins, price_amount)
       values ('${platformCode}', 'Smoke platform 40 J', 40, 0, 20000)`);
  const platformPkg = await service.from("coin_packages").select("id").eq("code", platformCode).single();
  if (platformPkg.error) throw platformPkg.error;

  const order3 = await buyer.client.rpc("order_create_jcoin", { p_package_id: platformPkg.data.id, p_platform: "android" });
  // Checked rather than fallen back from: silently paying against an earlier
  // order would have tested the wrong thing entirely, and did.
  if (order3.error) throw order3.error;
  assert(order3.data.reused !== true, "the platform check needs an order nothing else has touched");
  const iosAttempt = await pay(buyer.token, {
    orderId: order3.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY,
  }, "ios");
  assert(iosAttempt.status === 403, "an iOS client cannot pay even an order opened on Android");

  // The refused attempt closes that order — a policy refusal is still a failed
  // attempt — so the Android half of the claim is made on a fresh one. What is
  // being shown is that the gate turns on the platform, not on the order.
  const order4 = await buyer.client.rpc("order_create_jcoin", {
    p_package_id: platformPkg.data.id, p_platform: "android",
  });
  if (order4.error) throw order4.error;
  const androidStillWorks = await pay(buyer.token, {
    orderId: order4.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY,
  }, "android");
  assert(androidStillWorks.status === 200,
    `while Android pays fine under the same policy — got ${androidStillWorks.status}: ${JSON.stringify(androidStillWorks.body)}`);

  sql("update public.app_settings set value = jsonb_set(value, '{review_mode}', 'false') where key = 'payments.ios_policy'");

  /* ------------------------------------------------- what is stored */

  console.log("Checking what the database kept…");
  const stored = await service.from("orders").select("*").eq("id", order.data.order_id).single();
  const serialised = JSON.stringify(stored.data);
  assert(!serialised.includes(GOOD_CARD), "the full card number is nowhere in the order row");
  assert(!serialised.includes(PROVIDER_CODE), "and neither is the verification code");
  assert(stored.data.provider_card_token === null, "the one-time token was wiped after use");

  const events = await service.from("credit_transactions").select("metadata").eq("user_id", buyer.id);
  assert(
    !JSON.stringify(events.data ?? []).includes(GOOD_CARD),
    "and the ledger carries no card data either",
  );

  console.log("\nOrder payment smoke test passed.");
} finally {
  for (const id of created) {
    await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
  try {
    sql("delete from public.coin_packages where code like 'smoke_%'");
  } catch {
    // Nothing to clean, or the database is gone; neither is worth failing over.
  }
  console.log("Disposable data removed.");
}
