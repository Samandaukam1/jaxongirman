import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const userRoot = path.resolve(here, "..");
const repoRoot = path.resolve(userRoot, "..");

/**
 * A marathon share link is printed on posters and scanned by strangers, and
 * every mistake it can make is silent: a link built against the wrong host, a
 * URL that resolves to the wrong person, an invitation from last month that
 * reroutes an unrelated sign-in months later.
 *
 * `marathon-link-core.ts` holds those decisions and imports nothing native, so
 * it compiles on its own and runs here.
 */
function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-marathon-link-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: path.join(userRoot, "src", "lib"),
    },
    files: [path.join(userRoot, "src", "lib", "marathon-link-core.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const outDir = build();
const link = await import(path.join(outDir, "marathon-link-core.js"));

const CAMPAIGN = "0f2b9a10-8c41-4a6f-9f7a-1b2c3d4e5f60";
const CANDIDATE = "7d1e5c22-3a94-4b18-8e2f-6c5d4b3a2918";

/* -------------------------------------------------------------- the link -- */

test("the link carries the campaign as well as the candidate", () => {
  const url = link.candidateLink(CAMPAIGN, CANDIDATE, "https://jaxongirman.uz");
  assert.equal(url, `https://jaxongirman.uz/marathon/${CAMPAIGN}/${CANDIDATE}`);
});

test("a missing host falls back to production rather than to nothing", () => {
  assert.equal(link.linkHost(undefined), link.DEFAULT_HOST);
  assert.equal(link.linkHost("   "), link.DEFAULT_HOST);
  // A trailing slash in an env var is not part of the origin, and doubling it
  // would produce a URL no Universal Link association matches.
  assert.equal(link.linkHost("https://staging.jaxongirman.uz/"), "https://staging.jaxongirman.uz");
});

test("the share text names who the vote is for", () => {
  assert.equal(link.shareMessage("Talabalar marafoni", "jahongir"),
    "Talabalar marafoni — @jahongir uchun ovoz bering.");
  // An account with no username still shares: the link is what carries identity.
  assert.match(link.shareMessage("Talabalar marafoni", null), /men uchun ovoz bering\.$/);
});

/* ------------------------------------------------------------- the parse -- */

test("both forms of the URL resolve to the same invitation", () => {
  const web = link.parseInviteUrl(`https://jaxongirman.uz/marathon/${CAMPAIGN}/${CANDIDATE}`);
  const scheme = link.parseInviteUrl(`jaxongirman://marathon/${CAMPAIGN}/${CANDIDATE}`);
  assert.deepEqual(web, { campaignId: CAMPAIGN, candidateId: CANDIDATE });
  assert.deepEqual(scheme, web);
});

test("case in a scanned URL does not change who it points at", () => {
  const shouted = link.parseInviteUrl(`HTTPS://JAXONGIRMAN.UZ/MARATHON/${CAMPAIGN.toUpperCase()}/${CANDIDATE.toUpperCase()}`);
  assert.deepEqual(shouted, { campaignId: CAMPAIGN, candidateId: CANDIDATE });
});

test("anything that is not an invitation answers null", () => {
  assert.equal(link.parseInviteUrl("https://jaxongirman.uz/marathon"), null);
  assert.equal(link.parseInviteUrl(`https://jaxongirman.uz/join/${CAMPAIGN}`), null);
  // A short id is not a truncated invitation; it is a different link.
  assert.equal(link.parseInviteUrl("https://jaxongirman.uz/marathon/abc/def"), null);
});

/* ------------------------------------------------------------ the memory -- */

test("a fresh invitation survives the sign-up it was stored for", () => {
  const now = Date.now();
  const raw = JSON.stringify({ campaignId: CAMPAIGN, candidateId: CANDIDATE, at: now - 5 * 60_000 });
  assert.deepEqual(link.readStoredInvite(raw, now), { campaignId: CAMPAIGN, candidateId: CANDIDATE });
});

test("one from last month does not reroute an unrelated sign-in", () => {
  const now = Date.now();
  const stale = JSON.stringify({ campaignId: CAMPAIGN, candidateId: CANDIDATE, at: now - 40 * 86_400_000 });
  assert.equal(link.readStoredInvite(stale, now), null);
});

test("a device whose clock jumped backwards is not trusted either", () => {
  const now = Date.now();
  // Written "in the future": either the clock moved or the value was edited.
  const impossible = JSON.stringify({ campaignId: CAMPAIGN, candidateId: CANDIDATE, at: now + 86_400_000 });
  assert.equal(link.readStoredInvite(impossible, now), null);
});

test("nothing stored, or nonsense stored, is not an invitation", () => {
  assert.equal(link.readStoredInvite(null), null);
  assert.equal(link.readStoredInvite("not json"), null);
  assert.equal(link.readStoredInvite(JSON.stringify({ campaignId: CAMPAIGN })), null);
  assert.equal(link.readStoredInvite(JSON.stringify({ campaignId: CAMPAIGN, candidateId: CANDIDATE })), null);
});
