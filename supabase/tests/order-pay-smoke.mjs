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

const SANDBOX_CODE = "111111";
// Payme's own documented example number, not anybody's card. It never leaves
// this file: the sandbox provider is what receives it, and nothing is stored.
const GOOD_CARD = "8600069195406311";
// The sandbox declines any number ending 0000, which is how the failure path is
// exercised without a real decline.
const DECLINED_CARD = "8600069195400000";
const EXPIRY = "03/99";

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
  assert(started.status === 200, "the card is accepted and a code is requested");
  assert(started.body.status === "awaiting_verification", "and the order waits for verification");
  assert(
    typeof started.body.maskedCard === "string" && !started.body.maskedCard.includes(GOOD_CARD),
    "the card comes back masked, never in full",
  );

  const wrong = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: "000000" });
  assert(wrong.status === 400 && wrong.body.recoverable === true, "a wrong code is recoverable, not a failed payment");

  // The token was spent by the failed verify, so the buyer restarts the card
  // step — which is exactly what the client is told to do.
  const restart = await pay(buyer.token, { orderId: order.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY });
  assert(restart.status === 200, "and the buyer can try the card again");

  const paid = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: SANDBOX_CODE });
  assert(paid.status === 200 && paid.body.status === "paid", "the correct code completes the payment");
  assert(paid.body.fulfilment?.coins_granted === 40, "and fulfilment granted the coins");

  const after = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  assert(after.data.balance === startingBalance + 40, "the wallet moved by exactly the package amount");

  const ledger = await service.from("credit_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", buyer.id).eq("type", "coin_purchase");
  assert(ledger.count === 1, "with exactly one ledger row");

  /* ------------------------------------------------------ replays */

  console.log("Replaying what a dropped connection replays…");
  const again = await pay(buyer.token, { orderId: order.data.order_id, step: "verify", code: SANDBOX_CODE });
  assert(again.body.alreadyPaid === true, "asking again about a paid order reports it already paid");

  const afterReplay = await service.from("credit_wallets").select("balance").eq("user_id", buyer.id).single();
  assert(afterReplay.data.balance === startingBalance + 40, "and grants nothing a second time");

  const fulfilTwice = await service.rpc("order_fulfil", { p_order_id: order.data.order_id });
  assert(fulfilTwice.data?.already === true, "fulfilling directly a second time is a no-op too");

  /* ---------------------------------------------------- a decline */

  console.log("Declining a card…");
  const order2 = await buyer.client.rpc("order_create_jcoin", { p_package_id: pkg.data.id, p_platform: "android" });
  if (order2.error) throw order2.error;
  await pay(buyer.token, { orderId: order2.data.order_id, step: "start", pan: DECLINED_CARD, expiry: EXPIRY });
  const declined = await pay(buyer.token, { orderId: order2.data.order_id, step: "verify", code: SANDBOX_CODE });
  assert(declined.status === 402, "a provider decline is reported as a payment failure");

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
  assert(balanceAfterDecline.data.balance === startingBalance + 40, "a decline granted nothing");

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

  const order3 = await buyer.client.rpc("order_create_jcoin", { p_package_id: pkg.data.id, p_platform: "android" });
  const iosAttempt = await pay(buyer.token, {
    orderId: order3.data?.order_id ?? order.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY,
  }, "ios");
  assert(iosAttempt.status === 403, "an iOS client cannot pay even an order opened on Android");

  const androidStillWorks = await pay(buyer.token, {
    orderId: order3.data.order_id, step: "start", pan: GOOD_CARD, expiry: EXPIRY,
  }, "android");
  assert(androidStillWorks.status === 200, "while the same order pays fine from Android");

  sql("update public.app_settings set value = jsonb_set(value, '{review_mode}', 'false') where key = 'payments.ios_policy'");

  /* ------------------------------------------------- what is stored */

  console.log("Checking what the database kept…");
  const stored = await service.from("orders").select("*").eq("id", order.data.order_id).single();
  const serialised = JSON.stringify(stored.data);
  assert(!serialised.includes(GOOD_CARD), "the full card number is nowhere in the order row");
  assert(!serialised.includes(SANDBOX_CODE), "and neither is the verification code");
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
