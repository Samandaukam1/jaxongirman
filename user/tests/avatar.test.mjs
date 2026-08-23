import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** Node cannot run TypeScript; the rules under test are pure, so compile them. */
const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-avatar-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "avatar.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { avatarContentType, avatarObjectPath, cacheBusted } = await import(`${outDir}/avatar.js`);

/**
 * "mime type text/plain is not supported" is a strange thing to be told about a
 * photograph, and it is what every avatar upload said.
 *
 * React Native's `fetch` does not sniff a `file://` URI, so the Blob it returns
 * carries no type or the wrong one — and a Blob body is sent as multipart,
 * where the part's type comes from the Blob rather than from the `contentType`
 * beside it. The option was read, agreed with, and ignored.
 */

test("text/plain is never the answer, whatever the picker claims", () => {
  assert.equal(avatarContentType({ mimeType: "text/plain", fileName: "IMG_0042.HEIC" }), "image/jpeg");
  assert.equal(avatarContentType({ mimeType: "text/plain", fileName: "shot.png" }), "image/png");
  assert.equal(avatarContentType({ mimeType: "text/plain" }), "image/jpeg");
});

test("a picker that knows what it picked is believed", () => {
  assert.equal(avatarContentType({ mimeType: "image/png", fileName: "whatever.jpg" }), "image/png");
  assert.equal(avatarContentType({ mimeType: "image/webp" }), "image/webp");
  assert.equal(avatarContentType({ mimeType: "IMAGE/JPEG " }), "image/jpeg");
});

test("where the picker says nothing, the file name does", () => {
  assert.equal(avatarContentType({ fileName: "avatar.WEBP" }), "image/webp");
  assert.equal(avatarContentType({ uri: "file:///var/mobile/x/photo.png" }), "image/png");
  assert.equal(avatarContentType({ uri: "file:///tmp/a.jpeg?width=100" }), "image/jpeg");
});

test("an iPhone's HEIC arrives as the JPEG the picker re-encoded it to", () => {
  assert.equal(avatarContentType({ fileName: "IMG_0042.HEIC" }), "image/jpeg");
});

test("nothing to go on is a JPEG, because that is what the picker writes", () => {
  assert.equal(avatarContentType({}), "image/jpeg");
  assert.equal(avatarContentType({ uri: "file:///tmp/nodotshere" }), "image/jpeg");
});

test("the object is named for what it actually is", () => {
  assert.equal(avatarObjectPath("u1", "abc", "image/png"), "u1/abc.png");
  assert.equal(avatarObjectPath("u1", "abc", "image/jpeg"), "u1/abc.jpg");
  assert.equal(avatarObjectPath("u1", "abc", "image/webp"), "u1/abc.webp");
});

test("a fresh URL does not collide with a query the bucket already added", () => {
  assert.equal(cacheBusted("https://x/a.jpg", 7), "https://x/a.jpg?v=7");
  assert.equal(cacheBusted("https://x/a.jpg?token=1", 7), "https://x/a.jpg?token=1&v=7");
});
