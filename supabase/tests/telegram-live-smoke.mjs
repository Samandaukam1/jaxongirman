import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * Whether the Telegram bot is actually live.
 *
 * Everything else about the manual path is tested without Telegram: sessions,
 * tokens, bindings, candidates and the callback rules are all database and
 * function behaviour, and they pass today. What none of that can tell you is
 * whether a real Telegram server has ever heard of us — and the difference
 * between "the code is deployed" and "the bot is live" is exactly the thing
 * that must not be reported as a pass.
 *
 * So this asks Telegram, through the server, which is the only place the token
 * exists. The token is never read here, never printed, and never leaves the
 * function that holds it: what comes back is a username and a webhook URL.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/telegram-live-smoke.mjs
 *
 * Until TELEGRAM_IMAGE_BOT_TOKEN is configured this exits 2 and says so. That
 * is a blocker, not a failure, and not a pass.
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (() => {
  try {
    return readFileSync(new URL("../../user/.env", import.meta.url), "utf8")
      .match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  } catch { return ""; }
})();

if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and an anon key are required.");
  process.exit(1);
}

const EXPECTED_USERNAME = "JaxongirmanAppImagesBot";
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

const email = `telegram-live-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
let userId = "";

async function call(client, body) {
  const result = await client.functions.invoke("telegram-image-bot", { body });
  if (!result.error) return { data: result.data, code: null };
  let detail = null;
  try { detail = await result.error.context?.json?.(); } catch { /* consumed */ }
  return { data: null, code: detail?.code ?? "unknown", message: detail?.error ?? result.error.message };
}

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test admin not created");
  userId = created.data.user.id;
  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });
  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  console.log("Telegram Bot API:");
  const me = await call(admin, { action: "bot_info" });
  if (me.code === "missing_bot_token") {
    console.log("  ⚠︎  TELEGRAM_IMAGE_BOT_TOKEN sozlanmagan — Telegram bilan aloqa qilinmadi.");
    console.log("\nREAL TELEGRAM BOT BLOCKED: TELEGRAM_IMAGE_BOT_TOKEN NOT CONFIGURED");
    process.exit(2);
  }
  check(!me.code, `getMe answered${me.code ? ` — ${me.code}` : ""}`);
  check(me.data?.username === EXPECTED_USERNAME, `the token belongs to @${EXPECTED_USERNAME} (@${me.data?.username ?? "?"})`);

  console.log("\nWebhook:");
  const hook = await call(admin, { action: "configure_webhook" });
  check(!hook.code, `setWebhook accepted${hook.code ? ` — ${hook.code}` : ""}`);
  const expectedUrl = `${url.replace(/\/$/, "")}/functions/v1/telegram-image-bot`;
  check(hook.data?.url === expectedUrl, `Telegram points at this project (${hook.data?.url ?? "—"})`);
  check(!hook.data?.last_error_message, `Telegram reports no delivery error (${hook.data?.last_error_message ?? "none"})`);
  console.log(`  ℹ  pending updates: ${hook.data?.pending_update_count ?? "?"}`);

  console.log("\nWebhook secret:");
  const wrong = await fetch(`${url.replace(/\/$/, "")}/functions/v1/telegram-image-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      // A plausible-looking update with the wrong secret: what an attacker who
      // found the URL would send.
      "X-Telegram-Bot-Api-Secret-Token": "not-the-secret",
    },
    body: JSON.stringify({ update_id: Date.now() % 1_000_000, message: { text: "/start" } }),
  });
  check(wrong.status === 403, `an update with the wrong secret is refused (${wrong.status})`);
} finally {
  if (userId) {
    await service.from("user_roles").delete().eq("user_id", userId);
    await service.auth.admin.deleteUser(userId);
  }
}

console.log(failures ? `\n${failures} Telegram live check(s) failed.` : "\nAll Telegram live checks passed.");
process.exit(failures ? 1 : 0);
