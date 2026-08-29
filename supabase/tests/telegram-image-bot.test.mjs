import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildEdgeModules, repoRoot } from "../scripts/build-edge.mjs";

const out = buildEdgeModules();
const security = await import(pathToFileURL(path.join(out, "telegram-image-security.js")));

test("SSRF guard accepts only ordinary public HTTP(S) addresses", () => {
  assert.equal(security.safeRemoteUrl("https://images.unsplash.com/photo.jpg").hostname, "images.unsplash.com");
  for (const address of [
    "http://localhost/a", "http://127.0.0.1/a", "http://10.1.2.3/a",
    "http://172.16.5.4/a", "http://192.168.1.2/a", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a", "http://[fc00::1]/a", "http://[fe80::1]/a", "http://metadata.google.internal/a",
  ]) assert.throws(() => security.safeRemoteUrl(address));
  assert.throws(() => security.safeRemoteUrl("file:///etc/passwd"));
  assert.throws(() => security.safeRemoteUrl("https://user:pass@example.com/a"));
  assert.throws(() => security.safeRemoteUrl("https://example.com:8443/a"));
});

function png(width, height, ended = true) {
  const bytes = new Uint8Array(ended ? 45 : 33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  if (ended) bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0], 33);
  return bytes;
}

function jpeg(width, height, ended = true) {
  const bytes = new Uint8Array(ended ? 23 : 21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255]);
  if (ended) bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

test("download validator sniffs dimensions and rejects lies or broken files", () => {
  assert.deepEqual(security.validateImageBytes(png(1600, 900), "image/png"), {
    mimeType: "image/png", extension: "png", width: 1600, height: 900,
  });
  assert.deepEqual(security.validateImageBytes(jpeg(1200, 800), "image/jpeg"), {
    mimeType: "image/jpeg", extension: "jpg", width: 1200, height: 800,
  });
  assert.throws(() => security.validateImageBytes(png(1600, 900, false), "image/png"));
  assert.throws(() => security.validateImageBytes(jpeg(1200, 800, false), "image/jpeg"));
  assert.throws(() => security.validateImageBytes(png(1600, 900), "image/jpeg"));
  assert.throws(() => security.validateImageBytes(png(20, 20), "image/png"));
  assert.throws(() => security.validateImageBytes(png(16_001, 100), "image/png"));
});

test("schema stores only a digest and pins an exact element and slot", () => {
  const sql = readFileSync(path.join(repoRoot, "supabase/migrations/202608290001_telegram_image_bot.sql"), "utf8");
  assert.match(sql, /token_hash text not null unique/);
  assert.doesNotMatch(sql, /\braw_token\b|\btoken text\b/);
  assert.match(sql, /image_element_id uuid not null/);
  assert.match(sql, /image_slot text not null/);
  assert.match(sql, /where id = v_session\.image_element_id[\s\S]*slide_id = v_session\.slide_id[\s\S]*presentation_id = v_session\.presentation_id/);
  assert.match(sql, /status = 'consumed', consumed_at = now\(\)/);
  assert.match(sql, /'stock'::public\.asset_kind/);
  assert.match(sql, /update public\.slide_elements[\s\S]*set content = v_new_content/);
});

test("webhook authenticates Telegram and callbacks carry only an opaque id", () => {
  const source = readFileSync(path.join(repoRoot, "supabase/functions/telegram-image-bot/index.ts"), "utf8");
  assert.match(source, /X-Telegram-Bot-Api-Secret-Token/);
  assert.match(source, /invalid_webhook_secret.*403/s);
  assert.match(source, /callback_data: `is:\$\{row\.opaque_id\}`/);
  assert.doesNotMatch(source, /callback_data:[^\n]*(presentation|slide|user|https?:)/i);
  assert.match(source, /resolveImageCandidates/);
  assert.doesNotMatch(source, /providers\/(unsplash|wikimedia|wikidata)|openverse\.org/);
  assert.match(source, /inline search is intentionally stateless/i);
});

test("success is sent only after the atomic commit and compensation is present", () => {
  const source = readFileSync(path.join(repoRoot, "supabase/functions/telegram-image-bot/index.ts"), "utf8");
  const committed = source.indexOf("await selectCandidate(service, match[1]!, callback.from.id)");
  const success = source.indexOf("✅ Rasm slaydga qo‘shildi.");
  assert.ok(committed >= 0 && success > committed);
  assert.match(source, /commit_telegram_image_selection/);
  assert.match(source, /storage\.from\("presentation-assets"\)\.remove\(\[path\]\)/);
});
