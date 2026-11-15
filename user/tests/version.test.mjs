import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/** The version line in settings and the update notice rest on these rules. */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = path.join(repoRoot, "user", "src", "lib", "version-core.ts");
const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-version-"));
writeFileSync(path.join(outDir, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir, rootDir: path.dirname(source),
  },
  include: [source],
}));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", path.join(outDir, "tsconfig.json")], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
const { compareVersions, isOlder, versionLabel, readUpdateOffer, UPDATE_PAGE } = await import(path.join(outDir, "version-core.js"));

test("versions compare number by number, not as text", () => {
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.equal(compareVersions("2.0", "2.0.0"), 0);
  assert.ok(isOlder("0.1.0", "2.0.0"));
  assert.ok(!isOlder("2.0.0", "2.0.0"));
  assert.ok(!isOlder("2.1.0", "2.0.5"));
  assert.ok(!isOlder("2.0.0", ""), "no published version is never newer");
});

test("a version is said the way people say it", () => {
  assert.equal(versionLabel("2.0.0"), "2.0");
  assert.equal(versionLabel("2.1.3"), "2.1.3");
  assert.equal(versionLabel(undefined), "0.0");
});

test("the update setting is read defensively", () => {
  assert.deepEqual(readUpdateOffer({ version: "2.1.0", url: "https://jaxongirman.app/ilova", required: true }),
    { version: "2.1.0", url: "https://jaxongirman.app/ilova", required: true });
  assert.equal(readUpdateOffer({ version: "2.1.0", url: "https://evil.example/ilova" }).url, UPDATE_PAGE, "a stranger's link is never opened");
  assert.equal(readUpdateOffer({ version: "2.1.0", url: "https://jaxongirman.app.evil.example/" }).url, UPDATE_PAGE);
  assert.equal(readUpdateOffer({ version: "2.1.0", required: "yes" }).required, false, "only a real true makes it required");
  assert.equal(readUpdateOffer({ version: "latest" }), null);
  assert.equal(readUpdateOffer(null), null);
});
