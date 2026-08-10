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
  assert(Date.parse(opened.data.token_expires_at) > Date.now(), "and an expiry in the future");

  console.log("Refusing what a signed-out caller must not do…");
  const drive = await screen.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "next" });
  assert(drive.error !== null, "a signed-out caller cannot drive the session");
  const claimAnon = await screen.rpc("presentation_pairing_claim", { p_token: opened.data.token });
  assert(claimAnon.error !== null, "a signed-out caller cannot claim the code");

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

  const moved = await phone.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "zoom_in" });
  if (moved.error) throw moved.error;
  assert(Number(moved.data.zoom) === 1.25, "the paired phone can drive it");

  console.log("Keeping everyone else out…");
  const other = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const otherSignIn = await other.auth.signInWithPassword({ email: strangerEmail, password });
  if (otherSignIn.error) throw otherSignIn.error;
  const stolen = await other.rpc("presentation_command", { p_session_id: opened.data.session_id, p_command: "next" });
  assert(stolen.error !== null, "another signed-in user cannot drive someone else's session");

  // The screen reads its own row while signed out, and the row it can read
  // says nothing about who is presenting.
  const visible = await screen.from("presentation_sessions").select("id,status,current_slide,zoom").eq("id", opened.data.session_id).single();
  assert(visible.error === null && visible.data.id === opened.data.session_id, "the screen can still follow its own session");
  const identity = await screen.from("presentation_sessions").select("host_user_id").eq("id", opened.data.session_id);
  assert(identity.error !== null, "but it cannot read who claimed it");

  console.log("\nPairing smoke test passed.");
} finally {
  await service.auth.admin.deleteUser(created.data.user.id);
  await service.auth.admin.deleteUser(stranger.data.user.id);
  console.log("Disposable accounts removed.");
}
