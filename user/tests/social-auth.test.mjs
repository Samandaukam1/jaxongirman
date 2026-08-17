import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const userRoot = path.resolve(here, "..");
const repoRoot = path.resolve(userRoot, "..");

/**
 * Social sign-in decides several things quietly, and each of them is the kind
 * of mistake that only shows up on somebody else's phone: an error message that
 * says the wrong thing, a name overwritten on a second login, a provider that
 * looks configured and is not.
 *
 * `social-auth-core.ts` holds every one of those decisions and imports nothing
 * native, so it can be compiled on its own and run here. The adapters around it
 * only call things.
 */
function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-social-auth-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: path.join(userRoot, "src", "lib", "auth"),
    },
    files: [path.join(userRoot, "src", "lib", "auth", "social-auth-core.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const outDir = build();
const core = await import(path.join(outDir, "social-auth-core.js"));

/* ------------------------------------------------------------------ config */

test("Google is unconfigured until the web client id exists", () => {
  const missing = core.getGoogleAuthConfig({ web: undefined, ios: undefined, android: undefined });
  assert.equal(missing.configured, false, "an empty environment must not claim to be ready");

  // The platform ids alone are not enough: Supabase verifies the token against
  // the web client, so a build with only an iOS id would sign somebody in on
  // the device and then fail at the exchange, which is the confusing half.
  const partial = core.getGoogleAuthConfig({ ios: "123456789012-k3m9d2ba7qp1vn8s.apps.googleusercontent.com" });
  assert.equal(partial.configured, false, "an iOS id without a web id is not a configuration");

  const ready = core.getGoogleAuthConfig({ web: " 123456789012-k3m9d2ba7qp1vn8s.apps.googleusercontent.com " });
  assert.equal(ready.configured, true);
  assert.equal(ready.webClientId, "123456789012-k3m9d2ba7qp1vn8s.apps.googleusercontent.com",
    "surrounding space in an env var is not part of the id");
});

test("a value that is not a client id means unconfigured, not a crash", () => {
  // How the app actually came to close on a tap: placeholder text out of a set
  // of instructions was stored in EAS, passed a non-empty check, and reached
  // the Google SDK — which answers a malformed client id with an Objective-C
  // exception that no JavaScript can catch.
  for (const junk of [
    "<haqiqiy web client id>",
    "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
    "changeme",
    "123456789012-k3m9d2ba7qp1vn8s.apps.googleusercontent.com.evil.example",
    // Well-formed at both ends and still a placeholder: this is the exact
    // shape of the example values that got pasted, and the reason the
    // identifier has a length floor at all.
    "847263910284-xxxx.apps.googleusercontent.com",
  ]) {
    const config = core.getGoogleAuthConfig({ web: junk, ios: junk });
    assert.equal(config.configured, false, `"${junk}" must not read as a configuration`);
    assert.equal(config.iosClientId, null);
  }
});

test("on iOS a web id alone is not enough to attempt a sign-in", () => {
  // This one has teeth: the Google SDK raises an Objective-C exception when it
  // is asked to sign in without an iOS client ID, and an NSException kills the
  // process — the app does not show an error, it disappears. The adapter refuses
  // before reaching native code, and this is the arithmetic it refuses on.
  const config = core.getGoogleAuthConfig({ web: "123456789012-k3m9d2ba7qp1vn8s.apps.googleusercontent.com" });
  assert.equal(config.configured, true, "configured is about the exchange, which the web id governs");
  assert.equal(config.iosClientId, null, "but there is nothing for the iOS sheet to identify itself with");
});

test("a blank string is as unset as an absent one", () => {
  assert.equal(core.getGoogleAuthConfig({ web: "   " }).configured, false);
});

test("the app and the setup scripts agree on what a client id is", () => {
  // Two copies exist because the core is compiled standalone by this harness
  // and may import nothing, while the scripts are plain node. Two copies of a
  // rule drift, so this compares them rather than trusting they were both
  // edited — the pattern text has to match exactly.
  const fromCore = readFileSync(
    path.join(userRoot, "src", "lib", "auth", "social-auth-core.ts"), "utf8",
  ).match(/const CLIENT_ID = (\/.+\/);/);
  const fromScripts = readFileSync(
    path.join(userRoot, "scripts", "client-id.mjs"), "utf8",
  ).match(/export const CLIENT_ID = (\/.+\/);/);

  assert.ok(fromCore, "the core must declare CLIENT_ID as a literal regex");
  assert.ok(fromScripts, "and so must scripts/client-id.mjs");
  assert.equal(fromCore[1], fromScripts[1],
    "the app would accept a value the setup script refuses, or the reverse");
});

/* ------------------------------------------------------------------ errors */

test("a cancelled sign-in is recognised from every provider's spelling", () => {
  for (const thrown of [
    { code: "ERR_REQUEST_CANCELED" },
    { code: "SIGN_IN_CANCELLED" },
    { code: "-5", message: "The user canceled the sign-in flow." },
    new Error("The operation was cancelled"),
  ]) {
    assert.equal(core.classifyAuthError(thrown).code, "cancelled", `${JSON.stringify(thrown)} should read as a cancellation`);
  }
});

test("a provider that is not switched on says so plainly", () => {
  // This is the error the dashboard actually returns until the providers are
  // enabled, so it is the first one anybody will see.
  assert.equal(core.classifyAuthError({ code: "provider_disabled" }).code, "provider_disabled");
  assert.equal(
    core.classifyAuthError({ message: "Unsupported provider: provider is not enabled" }).code,
    "provider_disabled",
    "the same condition arrives as prose from older gotrue versions",
  );
  assert.match(core.authError("provider_disabled").message, /email orqali/, "and it should point at the way in that does work");
});

test("an email already used by another way in gets one sentence", () => {
  for (const code of [
    "email_exists", "user_already_exists", "identity_already_exists",
    "email_conflict_identity_not_deletable", "provider_email_needs_verification",
  ]) {
    const error = core.classifyAuthError({ code });
    assert.equal(error.code, "duplicate_account", `${code} is a duplicate account`);
  }
  assert.equal(
    core.authError("duplicate_account").message,
    "Bu email boshqa kirish usuli bilan allaqachon ishlatilgan.",
  );
});

test("Play Services and Apple availability are their own answers", () => {
  assert.equal(core.classifyAuthError({ code: "PLAY_SERVICES_NOT_AVAILABLE" }).code, "play_services_unavailable");
  assert.equal(core.classifyAuthError({ code: "ERR_APPLE_AUTHENTICATION_UNAVAILABLE" }).code, "apple_unavailable");
  assert.equal(core.classifyAuthError({ code: "IN_PROGRESS" }).code, "in_progress");
});

test("a network failure is not reported as a mystery", () => {
  assert.equal(core.classifyAuthError(new TypeError("Network request failed")).code, "network");
});

test("anything unrecognised still produces a sentence, never a blank", () => {
  for (const thrown of [null, undefined, {}, 42, new Error("")]) {
    const error = core.classifyAuthError(thrown);
    assert.equal(error.code, "unknown");
    assert.ok(error.message.length > 0, "an empty message would render as an empty toast");
  }
});

test("no provider's own words reach the screen", () => {
  const leaky = { code: "bad_oauth_state", message: "invalid audience: 123-abc.apps.googleusercontent.com" };
  assert.equal(
    core.classifyAuthError(leaky).message.includes("googleusercontent"),
    false,
    "a client id in a toast tells a person nothing and tells everyone else how this is wired",
  );
});

/* -------------------------------------------------------------- Apple name */

test("Apple's name parts become one name", () => {
  assert.equal(core.appleFullName({ givenName: "Jahongir", familyName: "Qurbonnazarov" }), "Jahongir Qurbonnazarov");
  assert.equal(core.appleFullName({ givenName: "Ali", middleName: "Vali", familyName: "Sodiq" }), "Ali Vali Sodiq");
  assert.equal(core.appleFullName({ givenName: "  Dilnoza  ", familyName: null }), "Dilnoza");
});

test("a later Apple login, which carries no name, returns null rather than blank", () => {
  // Apple hands the name over once and never again. `null` means "keep what is
  // stored"; an empty string would read as "the name is blank" and wipe it.
  assert.equal(core.appleFullName(null), null);
  assert.equal(core.appleFullName({}), null);
  assert.equal(core.appleFullName({ givenName: "", familyName: "  " }), null);
});

/* ------------------------------------------------------------ profile fill */

test("a first social login fills the name it was given", () => {
  assert.deepEqual(
    core.profilePatch({ full_name: "", avatar_url: null }, { fullName: "Jahongir Qurbonnazarov" }),
    { full_name: "Jahongir Qurbonnazarov" },
  );
});

test("an existing profile is never overwritten by a provider", () => {
  // Somebody who renamed themselves in the app made a decision, and signing in
  // again must not undo it.
  assert.equal(
    core.profilePatch({ full_name: "O‘zim qo‘ygan ism", avatar_url: "https://x/a.png" },
      { fullName: "Google Name", avatarUrl: "https://google/photo.png" }),
    null,
    "nothing to write means no write at all, not an update that changes no column",
  );
});

test("only the missing half is filled", () => {
  assert.deepEqual(
    core.profilePatch({ full_name: "Bor ism", avatar_url: "" }, { fullName: "Yangi", avatarUrl: "https://x/p.png" }),
    { avatar_url: "https://x/p.png" },
  );
});

test("a name longer than the column is cut rather than refused", () => {
  const patch = core.profilePatch({ full_name: "" }, { fullName: "a".repeat(300) });
  assert.equal(patch.full_name.length, 120, "profiles.full_name is capped at 120 by a check constraint");
});

/* ---------------------------------------------------------------- metadata */

test("Google's claims are read under either of the two names it uses", () => {
  assert.deepEqual(
    core.hintsFromUserMetadata({ name: "Ism Familiya", picture: "https://g/p.jpg" }),
    { fullName: "Ism Familiya", avatarUrl: "https://g/p.jpg" },
  );
  assert.deepEqual(
    core.hintsFromUserMetadata({ full_name: "Ism", avatar_url: "https://g/a.jpg" }),
    { fullName: "Ism", avatarUrl: "https://g/a.jpg" },
  );
  assert.deepEqual(core.hintsFromUserMetadata(null), { fullName: null, avatarUrl: null });
});

test("the credential's own answer outranks metadata, and neither blanks the other", () => {
  const merged = core.mergeHints(
    { fullName: "Apple’dan kelgan", avatarUrl: null },
    { fullName: "Metadata’dan", avatarUrl: "https://x/a.png" },
  );
  assert.equal(merged.fullName, "Apple’dan kelgan");
  assert.equal(merged.avatarUrl, "https://x/a.png", "a gap in the first source is filled from the second");
});
