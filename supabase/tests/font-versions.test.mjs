import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The PDF exporter fetches the bundled faces from unpkg by pinned version, so a
 * deck exports in the same outlines the apps drew it in. Nothing enforces that
 * pin at runtime — a 404 only shows up as a warning and a silently substituted
 * face — so it is asserted here instead.
 */
test("the PDF exporter pins the font versions the apps actually ship", () => {
  const fonts = readFileSync("supabase/functions/_shared/fonts.ts", "utf8");
  const pkg = JSON.parse(readFileSync("user/package.json", "utf8"));
  const installed = { ...pkg.dependencies, ...pkg.devDependencies };

  const pinned = [...fonts.matchAll(/@expo-google-fonts\/([a-z-]+)@([\d.]+)\//g)]
    .reduce((seen, [, name, version]) => seen.set(name, version), new Map());
  assert.ok(pinned.size >= 6, `expected every bundled family to be pinned, found ${pinned.size}`);

  for (const [name, version] of pinned) {
    const declared = installed[`@expo-google-fonts/${name}`];
    assert.ok(declared, `@expo-google-fonts/${name} is exported but the app does not install it`);
    // `latest` cannot be compared; a caret range is satisfied by its own floor.
    if (declared === "latest") continue;
    assert.equal(version, declared.replace(/^[\^~]/, ""),
      `${name}: exporter pins ${version}, the app installs ${declared}`);
  }
});
