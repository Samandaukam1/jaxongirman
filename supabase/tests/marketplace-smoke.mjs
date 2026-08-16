/**
 * End-to-end check of the marketplace money path against a running local stack.
 *
 * Walks a real purchase: a seller lists a product, an admin approves it, a buyer
 * checks out, pays through the sandbox adapter, and downloads the file. Then it
 * verifies the two things that matter most about a sandbox purchase — that the
 * buyer really can download, and that the money never appears anywhere an
 * accountant looks.
 *
 * Requires: npx supabase start, and
 *   npx supabase functions serve --env-file supabase/functions/.env.test
 * with PAYMENT_MODE=sandbox in that env file.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

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
    dbUrl: values.DB_URL,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

const { url, anonKey, serviceKey, dbUrl } = localEnvironment();

/**
 * Removes this run's rows in dependency order.
 *
 * Deleting the seller is not enough and should not be: payment_transactions and
 * marketplace_purchases hold their references with ON DELETE RESTRICT, precisely
 * so a person with financial history cannot be erased by accident. A test has to
 * clear its own commerce rows first, out of band.
 */
function purge(emailPrefix) {
  // Dependency order, innermost first. Every one of these references is
  // ON DELETE RESTRICT on purpose — the schema refuses to let financial history
  // vanish because a user row went away — so a test has to unwind it explicitly.
  const sql = [
    "delete from public.seller_settlement_items where ledger_entry_id in (select id from public.seller_ledger_entries where seller_id in (select id from victims))",
    "delete from public.seller_settlements where seller_id in (select id from victims)",
    "delete from public.seller_ledger_entries where seller_id in (select id from victims)",
    "delete from public.purchase_entitlements where user_id in (select id from victims)",
    "delete from public.marketplace_purchases where buyer_id in (select id from victims) or seller_id in (select id from victims)",
    "delete from public.payment_transactions where buyer_id in (select id from victims) or seller_id in (select id from victims)",
    "delete from public.marketplace_products where seller_id in (select id from victims)",
  ].map((statement) =>
    `with victims as (select id from auth.users where email like '${emailPrefix}%') ${statement};`
  ).join("\n");
  execFileSync("psql", [dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
}

// Anything a previous interrupted run left behind.
purge("mp-smoke-");
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function makeAccount(label) {
  const email = `mp-smoke-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Mp!${randomUUID().slice(0, 10)}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

const created = [];

try {
  console.log("Creating accounts…");
  const seller = await makeAccount("seller");
  const buyer = await makeAccount("buyer");
  const stranger = await makeAccount("stranger");
  const admin = await makeAccount("admin");
  created.push(seller.id, buyer.id, stranger.id, admin.id);
  await service.from("user_roles").insert({ user_id: admin.id, role: "admin" });

  const productTitle = `Smoke taqdimoti ${randomUUID().slice(0, 8)}`;
  console.log("Listing a product…");
  const { data: productId, error: saveError } = await seller.client.rpc("marketplace_save_product", {
    p_product_id: null,
    p_material_type: "presentation",
    p_title: productTitle,
    p_description: "Avtomatik tekshiruv uchun",
    p_base_price: 10000,
    p_content_units: 12,
    p_file_format: "pptx",
    p_submit: false,
  });
  if (saveError) throw saveError;
  assert(typeof productId === "string", "seller creates a listing");

  // A real object, so the download step exercises storage rather than a stub.
  const filePath = `${seller.id}/${productId}/main-${randomUUID()}.pptx`;
  const { error: uploadError } = await seller.client.storage
    .from("marketplace-files")
    // The Blob carries its own type; storage trusts that over the option.
    .upload(filePath, new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }), { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  if (uploadError) throw uploadError;

  const { error: attachError } = await seller.client.rpc("marketplace_attach_file", {
    p_product_id: productId,
    p_kind: "main",
    p_storage_path: filePath,
    p_mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    p_size_bytes: 8,
    p_original_name: "smoke.pptx",
  });
  if (attachError) throw attachError;
  assert(true, "seller uploads and attaches the main file");

  const strangerAttach = await stranger.client.rpc("marketplace_attach_file", {
    p_product_id: productId, p_kind: "preview", p_storage_path: `${stranger.id}/${productId}/x.jpg`,
    p_mime_type: "image/jpeg", p_size_bytes: 10,
  });
  assert(Boolean(strangerAttach.error), "a stranger cannot attach files to someone else's product");

  await seller.client.rpc("marketplace_save_product", {
    p_product_id: productId, p_material_type: "presentation", p_title: productTitle,
    p_description: "Avtomatik tekshiruv uchun", p_base_price: 10000, p_submit: true,
  });

  console.log("Moderating…");
  const buyerBeforeApproval = await buyer.client.rpc("marketplace_search", { p_query: productTitle });
  assert((buyerBeforeApproval.data?.items ?? []).length === 0, "an unapproved product is invisible in search");

  const { error: moderateError } = await admin.client.rpc("admin_moderate_product", {
    p_product_id: productId, p_action: "approve",
  });
  if (moderateError) throw moderateError;
  const buyerAfterApproval = await buyer.client.rpc("marketplace_search", { p_query: productTitle });
  assert((buyerAfterApproval.data?.items ?? []).length === 1, "an approved product appears in search");

  console.log("Checking out…");
  const { data: checkout, error: checkoutError } = await buyer.client.rpc("marketplace_create_checkout", {
    p_product_id: productId, p_idempotency_key: `smoke-${randomUUID()}`,
  });
  if (checkoutError) throw checkoutError;
  assert(checkout.buyer_total === 12000, "the buyer is quoted 12 000 for a 10 000 product");
  const transactionId = checkout.transaction_id;

  const earlyDownload = await buyer.client.functions.invoke("download-marketplace-file", {
    body: { productId, kind: "main" },
  });
  assert(Boolean(earlyDownload.error), "a buyer cannot download before paying");

  console.log("Paying through the sandbox adapter…");
  const start = await buyer.client.functions.invoke("pay-marketplace", {
    body: { transactionId, step: "start", pan: "8600123456789012", expiry: "12/29" },
  });
  if (start.error) {
    const detail = start.error.context instanceof Response ? await start.error.context.clone().text() : "";
    throw new Error(`payment start failed: ${start.error.message} ${detail}`);
  }
  assert(start.data.state === "otp_requested", "the provider asks for a verification code");
  assert(start.data.sandbox === true, "the sandbox adapter is the one running");
  // The card comes back already masked, and the client is never asked to echo
  // the ends of the number back: the server holds them privately against the
  // attempt it just opened, so nothing a caller sends can substitute a
  // different card into the charge.
  assert(start.data.maskedCard === "86001234XXXX9012", "only the masked hint comes back");
  assert(typeof start.data.attemptId === "string" && start.data.attemptId,
    "and the attempt the verification code will belong to");

  const wrongCode = await buyer.client.functions.invoke("pay-marketplace", {
    body: { transactionId, step: "verify", code: "000000", attemptId: start.data.attemptId },
  });
  assert(Boolean(wrongCode.error), "a wrong verification code is refused");

  // The failed attempt dropped its token, so the flow restarts cleanly.
  const restart = await buyer.client.functions.invoke("pay-marketplace", {
    body: { transactionId, step: "start", pan: "8600123456789012", expiry: "12/29" },
  });
  assert(!restart.error, "a fresh attempt can start after a failure");
  assert(restart.data.attemptId && restart.data.attemptId !== start.data.attemptId,
    "and it is a new attempt rather than the consumed one revived");

  const paid = await buyer.client.functions.invoke("pay-marketplace", {
    body: { transactionId, step: "verify", code: "111111", attemptId: restart.data.attemptId },
  });
  if (paid.error) {
    const detail = paid.error.context instanceof Response ? await paid.error.context.clone().text() : "";
    throw new Error(`payment failed: ${paid.error.message} ${detail}`);
  }
  assert(paid.data.state === "paid", "the sandbox payment completes");

  console.log("Checking what the payment created…");
  const { count: entitlements } = await service
    .from("purchase_entitlements").select("id", { count: "exact", head: true }).eq("user_id", buyer.id);
  assert(entitlements === 1, "exactly one entitlement was granted");

  const { data: card } = await service.from("partial_cards").select("display_pan,last4").eq("user_id", buyer.id).maybeSingle();
  assert(card?.display_pan === "86001234XXXX9012", "the card is remembered masked, and only masked");

  const { data: storedTransaction } = await service
    .from("payment_transactions").select("provider_card_token,is_sandbox,state").eq("id", transactionId).single();
  assert(storedTransaction.provider_card_token === null, "the one-time token was cleared after settlement");
  assert(storedTransaction.is_sandbox === true, "the transaction is flagged as sandbox");

  const download = await buyer.client.functions.invoke("download-marketplace-file", { body: { productId, kind: "main" } });
  assert(!download.error && typeof download.data?.url === "string", "the buyer can now download the file");
  assert(!String(download.data.url).includes(filePath.split("/").pop()) === false, "the signed URL points at the object");

  const strangerDownload = await stranger.client.functions.invoke("download-marketplace-file", {
    body: { productId, kind: "main" },
  });
  assert(Boolean(strangerDownload.error), "someone without an entitlement is refused the file");

  const repeat = await buyer.client.rpc("marketplace_create_checkout", {
    p_product_id: productId, p_idempotency_key: `smoke-again-${randomUUID()}`,
  });
  assert(Boolean(repeat.error), "the same product cannot be bought twice");

  console.log("Checking that sandbox money stays out of the books…");
  const { data: finance } = await admin.client.rpc("admin_marketplace_finance");
  assert(finance.all_time.gmv === 0, "sandbox purchases do not appear in GMV");
  assert(finance.all_time.platform_gross === 0, "sandbox purchases do not appear in platform revenue");
  assert(finance.sandbox_purchases >= 1, "sandbox purchases are reported separately, not hidden");

  const { data: earnings } = await seller.client.rpc("seller_earnings_summary", {});
  assert(earnings.net_total === 0, "the seller is not owed anything for a sandbox sale");
  assert(earnings.sandbox_sales >= 1, "the sandbox sale is visible to the seller as a test");

  const { data: settlement } = await admin.client.rpc("admin_create_settlement", {
    p_seller_id: seller.id,
    p_period_start: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    p_period_end: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  });
  assert(settlement.payable_amount === 0, "a payout run never claims a sandbox sale");

  // Read as the seller: notifications are granted to `authenticated` only, so
  // the service role sees nothing here and a count from it would be meaningless.
  const { count: sellerNotified } = await seller.client
    .from("notifications").select("id", { count: "exact", head: true }).eq("kind", "marketplace_sale");
  assert(sellerNotified === 0, "the seller is not told they earned money they did not earn");

  const { count: buyerNotified } = await buyer.client
    .from("notifications").select("id", { count: "exact", head: true }).eq("kind", "marketplace_purchase");
  assert(buyerNotified === 1, "the buyer is told their purchase completed");

  console.log("\nMarketplace smoke test passed.");
} finally {
  // Commerce rows first — they are the ones holding the restrict references.
  purge("mp-smoke-");
  for (const id of created) {
    await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
  console.log("Disposable data removed.");
}
