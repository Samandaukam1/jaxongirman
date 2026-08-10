/**
 * The projector pairing path, end to end, plus the misconfiguration that broke
 * it: a non-JWT in `Authorization`.
 *
 * The bug this guards against produced `Expected 3 parts in JWT; got 1` from
 * PostgREST — a message about the shape of a string, with nothing in it about
 * which environment variable was wrong. Two halves are checked here: that the
 * wire really does reject such a token (so the symptom is understood, not
 * guessed at), and that the client bootstrap now refuses to build one.
 *
 * Requires: npx supabase start
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { publishableKey, requiredUrl } from "../../web/lib/env-guard.ts";

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
  return { url: values.API_URL, anonKey: values.ANON_KEY ?? values.PUBLISHABLE_KEY, serviceKey: values.SERVICE_ROLE_KEY ?? values.SECRET_KEY };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function subscribe(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 8_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

function refuses(run, message) {
  try {
    run();
  } catch (error) {
    // The operator has to be able to act on it, which means naming the variable
    // and never quoting the value.
    assert(/[A-Z_]{4,}/.test(error.message), message);
    return error.message;
  }
  throw new Error(`expected a refusal: ${message}`);
}

/* ------------------------------------------------- the bootstrap guard */

console.log("Rejecting keys that cannot work…");

const secretShaped = "sb_secret_ThisIsNotARealKeyItIsATestFixture";
const messages = [
  refuses(() => publishableKey(undefined, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), "a missing key is refused by name"),
  refuses(() => publishableKey("missing-anon-key", "NEXT_PUBLIC_SUPABASE_ANON_KEY"), "the old placeholder is refused instead of being sent as a bearer token"),
  refuses(() => publishableKey(secretShaped, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), "a secret key in a browser variable is refused"),
  refuses(() => requiredUrl("", "NEXT_PUBLIC_SUPABASE_URL"), "a missing url is refused by name"),
];
assert(
  messages.every((message) => !message.includes(secretShaped) && !message.includes("missing-anon-key")),
  "no refusal quotes the value it rejected",
);

const { url, anonKey, serviceKey } = localEnvironment();
assert(publishableKey(anonKey, "TEST") === anonKey, "a real publishable key passes the guard");
assert(
  publishableKey("sb_publishable_AbCdEfGhIjKlMnOp", "TEST").startsWith("sb_publishable_"),
  "the newer key format passes the guard too",
);

/* ------------------------------------------------------------ the wire */

console.log("Checking what the transport does with a bad token…");
const badToken = await fetch(`${url}/rest/v1/rpc/presentation_session_open`, {
  method: "POST",
  headers: { apikey: anonKey, Authorization: "Bearer not-a-jwt", "Content-Type": "application/json" },
  body: "{}",
});
const badBody = await badToken.json();
assert(badToken.status === 401, "a non-JWT bearer token is refused by PostgREST");
assert(
  String(badBody.message ?? "").includes("Expected 3 parts in JWT"),
  "and the refusal is the exact error the projector was showing",
);

/* --------------------------------------------------------- the pairing */

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `pairing-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");

const strangerEmail = `stranger-${randomUUID()}@example.test`;
const stranger = await service.auth.admin.createUser({ email: strangerEmail, password, email_confirm: true });
if (stranger.error || !stranger.data.user) throw stranger.error ?? new Error("Second test user was not created");

try {
  console.log("Opening a session the way the projector does…");
  // Signed out on purpose: the browser on a projector has nobody logged in, and
  // the session it opens can do nothing until a phone claims it.
  const screen = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const opened = await screen.rpc("presentation_session_open");
  if (opened.error) throw opened.error;
  assert(typeof opened.data.session_id === "string", "an anonymous screen gets a session id");
  assert(/^[A-Za-z0-9_-]{32,64}$/.test(opened.data.token), "and an opaque pairing token");
  assert(/^[A-Za-z0-9_-]{32,64}$/.test(opened.data.screen_token), "and a separate screen capability");
  assert(/^[A-Za-z0-9_-]{32,64}$/.test(opened.data.realtime_token), "and a separate realtime channel token");
  assert(new Set([opened.data.token, opened.data.screen_token, opened.data.realtime_token]).size === 3, "and none of the three capabilities is reused");
  assert(Date.parse(opened.data.token_expires_at) > Date.now(), "and an expiry in the future");

  console.log("Refusing what a signed-out caller must not do…");
  const drive = await screen.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "next" });
  assert(drive.error !== null, "a signed-out caller cannot drive the session");
  const claimAnon = await screen.rpc("presentation_pairing_claim", { p_token: opened.data.token });
  assert(claimAnon.error !== null, "a signed-out caller cannot claim the code");
  const guessedSnapshot = await screen.rpc("presentation_screen_snapshot", {
    p_session_id: opened.data.session_id,
    p_screen_token: "z".repeat(43),
  });
  assert(guessedSnapshot.error !== null, "a guessed screen capability cannot read the session");
  const pairingSnapshot = await screen.rpc("presentation_screen_snapshot", {
    p_session_id: opened.data.session_id,
    p_screen_token: opened.data.screen_token,
  });
  assert(pairingSnapshot.error !== null, "even the real screen capability cannot fetch a deck before pairing");

  console.log("Claiming it from a signed-in phone…");
  const phone = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await phone.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  assert(
    (signedIn.data.session?.access_token ?? "").split(".").length === 3,
    "the phone holds a real access token, not an api key",
  );

  const claimed = await phone.rpc("presentation_pairing_claim", { p_token: opened.data.token });
  if (claimed.error) throw claimed.error;
  assert(claimed.data.session_id === opened.data.session_id, "the phone claims the session it scanned");
  assert(claimed.data.realtime_token === opened.data.realtime_token, "the paired phone receives the private realtime token");

  const activeSnapshot = await screen.rpc("presentation_screen_snapshot", {
    p_session_id: opened.data.session_id,
    p_screen_token: opened.data.screen_token,
  });
  if (activeSnapshot.error) throw activeSnapshot.error;
  assert(activeSnapshot.data.status === "active", "the real screen capability recovers active session state");
  assert(!("host_user_id" in activeSnapshot.data) && !("screen_token_hash" in activeSnapshot.data), "the screen snapshot omits identity and the stored digest");

  const viewport = await phone.rpc("presentation_viewport_commit", {
    p_session_id: opened.data.session_id,
    p_scale: 2,
    p_translate_x: 100,
    p_translate_y: 50,
    p_slide: 0,
  });
  if (viewport.error) throw viewport.error;
  assert(Number(viewport.data.zoom) === 2 && Number(viewport.data.translate_x) === 100 && Number(viewport.data.translate_y) === 50, "the paired phone persists one bounded viewport snapshot");

  // Live gesture frames must cross Realtime without touching Postgres. Only
  // the explicit commit above/below is durable, so a 15–30 fps stream cannot
  // turn into an equivalent rate of database writes.
  const topic = `presentation-viewport:${opened.data.realtime_token}`;
  let broadcastTimeout;
  let receiveLiveFrame;
  const liveFrame = new Promise((resolve, reject) => {
    receiveLiveFrame = resolve;
    broadcastTimeout = setTimeout(() => reject(new Error("Viewport broadcast timed out")), 8_000);
  });
  const screenViewportChannel = screen
    .channel(topic, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "viewport" }, ({ payload }) => {
      clearTimeout(broadcastTimeout);
      receiveLiveFrame(payload);
    });
  const phoneViewportChannel = phone.channel(topic, { config: { broadcast: { self: false } } });
  try {
    await Promise.all([subscribe(screenViewportChannel), subscribe(phoneViewportChannel)]);
    const sent = await phoneViewportChannel.send({
      type: "broadcast",
      event: "viewport",
      payload: { scale: 2.5, translate_x: 120, translate_y: 60, slide: 0 },
    });
    assert(sent === "ok", "a live gesture frame is accepted by the private Realtime topic");
    const frame = await liveFrame;
    assert(Number(frame.scale) === 2.5 && Number(frame.translate_x) === 120 && Number(frame.translate_y) === 60, "the projector receives the same live viewport frame");
    const unchanged = await phone.from("presentation_sessions").select("zoom,translate_x,translate_y").eq("id", opened.data.session_id).single();
    if (unchanged.error) throw unchanged.error;
    assert(Number(unchanged.data.zoom) === 2 && Number(unchanged.data.translate_x) === 100 && Number(unchanged.data.translate_y) === 50, "a live frame does not write gesture state to Postgres");
  } finally {
    clearTimeout(broadcastTimeout);
    await Promise.all([screen.removeChannel(screenViewportChannel), phone.removeChannel(phoneViewportChannel)]);
    screen.realtime.disconnect();
    phone.realtime.disconnect();
  }

  const reset = await screen.rpc("presentation_screen_command", {
    p_session_id: opened.data.session_id,
    p_screen_token: opened.data.screen_token,
    p_command: "reset_viewport",
  });
  if (reset.error) throw reset.error;
  assert(Number(reset.data.zoom) === 1 && Number(reset.data.translate_x) === 0 && Number(reset.data.translate_y) === 0, "the capability-authorized screen command resets the shared viewport");

  const guessedCommand = await screen.rpc("presentation_screen_command", {
    p_session_id: opened.data.session_id,
    p_screen_token: "z".repeat(43),
    p_command: "next",
  });
  assert(guessedCommand.error !== null, "a guessed screen capability cannot issue keyboard commands");

  console.log("Keeping everyone else out…");
  const other = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const otherSignIn = await other.auth.signInWithPassword({ email: strangerEmail, password });
  if (otherSignIn.error) throw otherSignIn.error;
  const stolen = await other.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "next" });
  assert(stolen.error !== null, "another signed-in user cannot drive someone else's session");
  const stolenViewport = await other.rpc("presentation_viewport_commit", {
    p_session_id: opened.data.session_id,
    p_scale: 2,
    p_translate_x: 20,
    p_translate_y: 20,
    p_slide: 0,
  });
  assert(stolenViewport.error !== null, "another signed-in user cannot commit someone else's viewport");

  // The screen reads its own row while signed out, and the row it can read
  // says nothing about who is presenting.
  const visible = await screen.from("presentation_sessions").select("id,status,current_slide,zoom").eq("id", opened.data.session_id).single();
  assert(visible.error === null && visible.data.id === opened.data.session_id, "the screen can still follow its own session");
  const identity = await screen.from("presentation_sessions").select("host_user_id").eq("id", opened.data.session_id);
  assert(identity.error !== null, "but it cannot read who claimed it");
  const capabilities = await screen.from("presentation_sessions").select("screen_token_hash,realtime_token").eq("id", opened.data.session_id);
  assert(capabilities.error !== null, "and it cannot list either private session capability");

  /* ------------------------------------------------ the deck the screen draws */

  console.log("Serving the deck to the paired screen…");
  const ownerId = created.data.user.id;
  const presentationId = randomUUID();
  const strangerId = stranger.data.user.id;

  const madeDeck = await service.from("presentations").insert({
    id: presentationId, owner_id: ownerId, title: "Yillik hisobot",
    topic: "Audit uchun taqdimot", style: "simple", status: "ready",
    requested_slide_count: 1, generated_slide_count: 1,
  });
  if (madeDeck.error) throw madeDeck.error;

  const slideId = randomUUID();
  const madeSlide = await service.from("slides").insert({
    id: slideId, presentation_id: presentationId, owner_id: ownerId,
    position: 0, title: "Birinchi", layout: "title_body", background: {},
  });
  if (madeSlide.error) throw madeSlide.error;

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const ownPath = `${ownerId}/${presentationId}/cover.png`;
  // Same bucket, another owner's folder: the shape of a cross-owner injection.
  const foreignPath = `${strangerId}/${randomUUID()}/stolen.png`;
  for (const path of [ownPath, foreignPath]) {
    const put = await service.storage.from("generated-images").upload(path, png, { contentType: "image/png", upsert: true });
    if (put.error) throw put.error;
  }

  const madeElements = await service.from("slide_elements").insert([
    {
      id: randomUUID(), slide_id: slideId, presentation_id: presentationId, owner_id: ownerId,
      type: "text", x: 60, y: 60, width: 500, height: 120, rotation: 0, z_index: 1, opacity: 1,
      style: { fontSize: 40 }, content: { text: "Yillik hisobot" },
    },
    {
      id: randomUUID(), slide_id: slideId, presentation_id: presentationId, owner_id: ownerId,
      type: "image", x: 600, y: 60, width: 320, height: 240, rotation: 0, z_index: 2, opacity: 1,
      style: { objectFit: "cover" }, content: { storageBucket: "generated-images", storagePath: ownPath },
    },
    {
      id: randomUUID(), slide_id: slideId, presentation_id: presentationId, owner_id: ownerId,
      type: "image", x: 60, y: 300, width: 200, height: 150, rotation: 0, z_index: 3, opacity: 1,
      style: {}, content: { storageBucket: "generated-images", storagePath: foreignPath },
    },
  ]);
  if (madeElements.error) throw madeElements.error;

  const chose = await phone.rpc("presentation_session_set_deck", {
    p_session_id: opened.data.session_id,
    p_presentation_id: presentationId,
  });
  if (chose.error) throw chose.error;

  const guessedDeck = await screen.functions.invoke("presentation-screen-data", {
    body: { sessionId: opened.data.session_id, screenToken: "z".repeat(43) },
  });
  assert(guessedDeck.error !== null, "a guessed screen capability cannot fetch the deck");

  const served = await screen.functions.invoke("presentation-screen-data", {
    body: { sessionId: opened.data.session_id, screenToken: opened.data.screen_token },
  });
  if (served.error) {
    throw new Error(`presentation-screen-data failed: ${await served.error.context?.text?.().catch(() => served.error.message)}`);
  }
  assert(served.data.slides.length === 1, "the paired screen gets the deck's slides");
  assert(
    served.data.elements.some((element) => element.type === "text" && element.content.text === "Yillik hisobot"),
    "text elements arrive ready to render",
  );

  const images = served.data.elements.filter((element) => element.type === "image");
  assert(images.length === 1, "the element pointing at another owner's object is dropped, not signed");
  assert(typeof images[0].content.signedUrl === "string", "the image the deck owns comes back as a signed url");
  assert(
    !("storagePath" in images[0].content) && !("storageBucket" in images[0].content),
    "and the storage coordinates stay on the server",
  );
  // The function signs against the URL it is given, and inside Docker that is
  // the compose hostname. In production `SUPABASE_URL` is the public address
  // and the signed link is already reachable; here it is rewritten so the test
  // checks the signature rather than the local network's name resolution.
  const reachable = images[0].content.signedUrl.replace(/^https?:\/\/kong:8000/, url);
  const fetched = await fetch(reachable);
  assert(fetched.status === 200, "the signed url actually resolves to the image");

  const leaked = JSON.stringify(served.data);
  assert(!leaked.includes("owner_id") && !leaked.includes("host_user_id"), "no identity field travels with the deck");
  // Stated rather than asserted away: a signed URL contains the object's path,
  // and both writers put the owner's id in the first segment, so the screen can
  // read that uuid off an image link. Serving signed URLs was the approved
  // trade; changing it would mean proxying every image through the function.
  const elementsOnly = JSON.stringify({ slides: served.data.slides, title: served.data.title });
  assert(!elementsOnly.includes(ownerId), "and nothing outside the image links carries the owner's id");

  /* --------------------------------------------- ending it from the phone */

  console.log("Ending it from the phone…");
  const ended = await phone.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "end" });
  if (ended.error) throw ended.error;
  assert(ended.data.status === "ended", "the phone ends the talk");

  // The screen has to be able to see this. Realtime applies the same row policy
  // to every change it delivers, so a policy that excluded `ended` would drop
  // the one update that tells the projector to offer the next presenter a code.
  const afterEnd = await screen.from("presentation_sessions").select("id,status").eq("id", opened.data.session_id).maybeSingle();
  assert(afterEnd.error === null && afterEnd.data?.status === "ended", "and the signed-out screen can see that it ended");

  const deadDeck = await screen.functions.invoke("presentation-screen-data", {
    body: { sessionId: opened.data.session_id, screenToken: opened.data.screen_token },
  });
  assert(deadDeck.error !== null, "the screen capability stops serving the deck once the talk is over");

  // Recycling: the projector opens a fresh session, and the next person pairs
  // with it exactly as the first one did.
  const recycled = await screen.rpc("presentation_session_open");
  if (recycled.error) throw recycled.error;
  assert(recycled.data.session_id !== opened.data.session_id, "the projector opens a new session for the next presenter");
  const nextPhone = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const nextSignIn = await nextPhone.auth.signInWithPassword({ email: strangerEmail, password });
  if (nextSignIn.error) throw nextSignIn.error;
  const nextClaim = await nextPhone.rpc("presentation_pairing_claim", { p_token: recycled.data.token });
  if (nextClaim.error) throw nextClaim.error;
  assert(nextClaim.data.session_id === recycled.data.session_id, "a different person can scan the new code and present");

  console.log("\nPairing smoke test passed.");
} finally {
  await service.auth.admin.deleteUser(created.data.user.id);
  await service.auth.admin.deleteUser(stranger.data.user.id);
  console.log("Disposable accounts removed.");
}
