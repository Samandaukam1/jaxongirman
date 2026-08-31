import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

/**
 * The marathon, photographed.
 *
 * §32 asks for a screenshot audit and is right to: no assertion sees that a
 * poster is cropped through somebody's face, that a compact button has crushed
 * a search field, or that a card which is legible in light mode is a grey
 * smudge in dark. So this stands the real app up — the Expo web build, the same
 * components and the same tokens — signs in as a real account against a real
 * campaign, and takes pictures at the two widths and both themes.
 *
 * Everything it creates it removes, and it puts both switches back exactly as
 * it found them, whatever happens.
 *
 *   npx expo export --platform web --output-dir /tmp/expo-web   (in user/)
 *   node supabase/tests/marathon-screens.mjs
 *
 * The pictures land in /tmp/marathon-shots.
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (() => {
  try {
    return readFileSync(new URL("../../user/.env", import.meta.url), "utf8")
      .match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  } catch { return ""; }
})();

const WEB = process.env.WEB ?? "/tmp/expo-web";
const OUT = process.env.OUT ?? "/tmp/marathon-shots";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8788;
const DEBUG_PORT = 9323;

if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and an anon key are required.");
  process.exit(1);
}
if (!existsSync(path.join(WEB, "index.html"))) {
  console.error(`No web build at ${WEB}. Run: (cd user && npx expo export --platform web --output-dir ${WEB})`);
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const projectRef = new URL(url).hostname.split(".")[0];

/* ------------------------------------------------------------- the stage -- */

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2",
};

/** A static server with an SPA fallback: expo-router owns every path. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const requested = decodeURIComponent(new URL(request.url, "http://x").pathname);
      const candidate = path.join(WEB, requested);
      const file = existsSync(candidate) && !candidate.endsWith("/") && path.extname(candidate)
        ? candidate
        : path.join(WEB, "index.html");
      response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(response);
    });
    server.listen(PORT, () => resolve(server));
  });
}

/* ------------------------------------------------------------ the browser -- */

let chrome;
let socket;
let nextId = 1;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = nextId += 1;
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} javob bermadi`));
    }, 30_000);
  });
}

async function openBrowser() {
  chrome = execFile(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    "--no-first-run", "--disable-extensions", "--force-device-scale-factor=2",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=/tmp/marathon-chrome-${randomUUID().slice(0, 8)}`,
    "about:blank",
  ]);

  // The port is not open the instant the process starts.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const listing = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json());
      socket = new WebSocket(listing.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Chrome ochilmadi");
}

/** One page, attached, with the session already in storage. */
async function openPage(session) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  // Written before anything runs, so the app boots already signed in rather
  // than rendering the sign-in screen and then being told otherwise.
  await page("Page.addScriptToEvaluateOnNewDocument", {
    source: `try {
      localStorage.setItem(${JSON.stringify(`sb-${projectRef}-auth-token`)}, ${JSON.stringify(JSON.stringify(session))});
    } catch (error) {}`,
  });
  return { page, targetId };
}

async function shoot({ page }, { route, width, height, dark, name, wait = 4200 }) {
  await page("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 2, mobile: true,
  });
  await page("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }],
  });
  await page("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
  await new Promise((resolve) => setTimeout(resolve, wait));
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

/* --------------------------------------------------------------- the run -- */

const stamp = randomUUID().slice(0, 8);
const password = `${randomUUID()}Aa1!`;
const people = {};
let campaignId = null;
let previousMarathon = null;
let previousMarket = null;
let server;

async function makeUser(entry, admin = false) {
  const created = await service.auth.admin.createUser({ email: entry.email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
  entry.id = created.data.user.id;
  await service.from("profiles").update({ username: entry.username, full_name: entry.name }).eq("id", entry.id);
  if (admin) await service.from("user_roles").insert({ user_id: entry.id, role: "admin" });
}

try {
  mkdirSync(OUT, { recursive: true });

  const flags = await service.from("app_settings").select("key,value")
    .in("key", ["student_marathon_enabled", "marathon.vote_marketplace_enabled"]);
  previousMarathon = flags.data?.find((row) => row.key === "student_marathon_enabled")?.value ?? false;
  previousMarket = flags.data?.find((row) => row.key === "marathon.vote_marketplace_enabled")?.value ?? false;

  people.star = { email: `shot-star-${randomUUID()}@example.test`, username: `dilnoza${stamp}`, name: "Dilnoza Karimova" };
  people.fan = { email: `shot-fan-${randomUUID()}@example.test`, username: `aziza${stamp}`, name: "Aziza Karimova" };
  for (const entry of Object.values(people)) await makeUser(entry);

  campaignId = randomUUID();
  const campaign = await service.from("marathon_campaigns").insert({
    id: campaignId,
    title: "Talabalar marafoni",
    description: "30 kun davomida ovoz to‘plang va kontraktingiz uchun 10 000 000 so‘mgacha mukofot oling.",
    rules: "Har bir foydalanuvchida 1 ta bepul va 1 ta Premium ovoz bor. Ovoz berilgach qaytarib olinmaydi.",
    starts_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 18 * 86_400_000 + 4 * 3_600_000).toISOString(),
    status: "active",
  });
  if (campaign.error) throw campaign.error;

  await service.from("marathon_reward_tiers").insert([
    { campaign_id: campaignId, position: 1, votes_required: 1000, premium_required: 300, reward_percent: 25 },
    { campaign_id: campaignId, position: 2, votes_required: 2000, premium_required: 600, reward_percent: 50 },
    { campaign_id: campaignId, position: 3, votes_required: 3000, premium_required: 900, reward_percent: 75 },
    { campaign_id: campaignId, position: 4, votes_required: 4000, premium_required: 1200, reward_percent: 100 },
  ]);
  await service.from("marathon_participants").insert([
    { campaign_id: campaignId, user_id: people.star.id },
    { campaign_id: campaignId, user_id: people.fan.id },
  ]);

  // A poster, so the frame in the pictures is a real photograph rather than the
  // gradient fallback — the crop is exactly what §32.6 asks to look at.
  // A square image on purpose: the frame is 2.35:1, so what these pictures
  // show is the cover crop doing its job rather than a poster that was already
  // the right shape. It comes from the repository, because an audit that needs
  // the internet is an audit that fails on a train.
  const posterBytes = readFileSync(new URL("../../user/assets/icon.png", import.meta.url));
  const posterPath = `${campaignId}/poster.png`;
  const uploaded = await service.storage.from("marathon-posters")
    .upload(posterPath, posterBytes, { contentType: "image/png", upsert: true });
  if (uploaded.error) console.log(`  · afisha yuklanmadi: ${uploaded.error.message}`);
  else await service.from("marathon_campaigns").update({ poster_path: posterPath }).eq("id", campaignId);

  await service.from("app_settings").update({ value: true }).eq("key", "student_marathon_enabled");
  await service.from("app_settings").update({ value: true }).eq("key", "marathon.vote_marketplace_enabled");

  // Votes for the star, so the progress bars have something to draw.
  const voters = [];
  for (let index = 0; index < 3; index += 1) {
    const entry = { email: `shot-voter-${randomUUID()}@example.test`, username: `voter${index}${stamp}`, name: `Voter ${index}` };
    await makeUser(entry);
    voters.push(entry);
    people[`voter${index}`] = entry;
    await service.from("marathon_vote_ledger").insert([
      { campaign_id: campaignId, candidate_id: people.star.id, voter_id: entry.id, kind: "free", source: "direct" },
      { campaign_id: campaignId, candidate_id: people.star.id, voter_id: entry.id, kind: "premium", source: "direct" },
    ]);
  }

  // A lot on the market, so the marketplace has something in it.
  const sellerClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sellerIn = await sellerClient.auth.signInWithPassword({ email: voters[0].email, password });
  if (sellerIn.error) throw sellerIn.error;
  // The seller spent both votes above, so a second account supplies the lot.
  const lotSeller = { email: `shot-lot-${randomUUID()}@example.test`, username: `lot${stamp}`, name: "Lot Seller" };
  await makeUser(lotSeller);
  people.lot = lotSeller;
  const lotClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await lotClient.auth.signInWithPassword({ email: lotSeller.email, password });
  const listed = await lotClient.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 1, p_unit_price: 22000 });
  if (listed.error) console.log(`  · e'lon qo'yilmadi: ${listed.error.message}`);

  // The session the browser will wear: the candidate, who has the fullest screens.
  const starClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const starIn = await starClient.auth.signInWithPassword({ email: people.star.email, password });
  if (starIn.error) throw starIn.error;

  server = await serve();
  await openBrowser();
  const page = await openPage(starIn.data.session);

  const routes = [
    { route: "/", name: "home" },
    { route: "/projects", name: "projects" },
    { route: "/marketplace", name: "shop" },
    { route: "/games", name: "games" },
    { route: "/profile", name: "profile" },
    { route: "/marathon", name: "marathon" },
    { route: "/marathon/vote", name: "vote" },
    { route: "/marathon/market", name: "market" },
    { route: "/marathon/sell", name: "sell" },
  ];

  console.log(`Suratlar → ${OUT}`);
  for (const item of routes) {
    for (const theme of [false, true]) {
      const file = await shoot(page, {
        ...item, width: 390, height: 844, dark: theme,
        name: `${item.name}-${theme ? "dark" : "light"}`,
      });
      console.log(`  ✓ ${path.basename(file)}`);
    }
  }

  // §32.15: the small screen, where the headers either fit or do not.
  for (const item of routes.slice(0, 5)) {
    const file = await shoot(page, {
      ...item, width: 320, height: 640, dark: false, name: `${item.name}-320`,
    });
    console.log(`  ✓ ${path.basename(file)}`);
  }

  // §32.12: with the feature off, every one of those surfaces has to be bare.
  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  for (const item of routes.slice(0, 6)) {
    const file = await shoot(page, {
      ...item, width: 390, height: 844, dark: false, name: `${item.name}-off`,
    });
    console.log(`  ✓ ${path.basename(file)}`);
  }
} finally {
  try { if (socket) socket.close(); } catch { /* already gone */ }
  if (chrome) chrome.kill();
  if (server) server.close();

  if (campaignId) await service.from("marathon_campaigns").delete().eq("id", campaignId);
  for (const entry of Object.values(people)) {
    if (entry.id) await service.auth.admin.deleteUser(entry.id);
  }
  if (previousMarathon !== null) {
    await service.from("app_settings").update({ value: previousMarathon }).eq("key", "student_marathon_enabled");
  }
  if (previousMarket !== null) {
    await service.from("app_settings").update({ value: previousMarket }).eq("key", "marathon.vote_marketplace_enabled");
  }
  const left = await service.from("app_settings").select("key,value")
    .in("key", ["student_marathon_enabled", "marathon.vote_marketplace_enabled"]);
  console.log("Kalitlar joyida:", JSON.stringify(left.data));
}
