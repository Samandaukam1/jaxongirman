import { readFileSync } from "node:fs";

const token = process.env.TELEGRAM_IMAGE_BOT_TOKEN;
const secret = process.env.TELEGRAM_IMAGE_WEBHOOK_SECRET;
const configuredUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
let projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) {
  try { projectRef = readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim(); }
  catch { projectRef = ""; }
}
const base = configuredUrl || (projectRef ? `https://${projectRef}.supabase.co` : "");

if (!token || !secret || !base) {
  console.error("TELEGRAM_IMAGE_BOT_TOKEN, TELEGRAM_IMAGE_WEBHOOK_SECRET and SUPABASE_URL (or linked project ref) are required.");
  process.exit(1);
}

const webhookUrl = `${base.replace(/\/$/, "")}/functions/v1/telegram-image-bot`;
const endpoint = (method) => `https://api.telegram.org/bot${token}/${method}`;

async function call(method, body = {}) {
  const response = await fetch(endpoint(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(`Telegram ${method} failed (${response.status}).`);
  return payload.result;
}

await call("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "inline_query"],
  drop_pending_updates: false,
});
const info = await call("getWebhookInfo");

// Deliberately limited to non-secret operational fields.
console.log(`URL: ${info.url || webhookUrl}`);
console.log(`pending_update_count: ${Number(info.pending_update_count || 0)}`);
console.log(`last_error_message: ${info.last_error_message || ""}`);
