import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The bug this exists to stop, written down so nobody has to rediscover it.
 *
 * `Pressable` accepts a function for `style` so a caller can style the pressed
 * state. An animated component cannot. Reanimated resolves a style by spreading
 * each entry to look for animated ones, and spreading a function yields no
 * properties at all — so the caller's style is dropped, the animated style is
 * dropped with it, and the component renders with `style={}`.
 *
 * Nothing reports this. It typechecks, it lints, it runs. What you get is a row
 * that has lost its card, a pill that has lost its shape, and a tile that has
 * lost its width — and only on a device.
 */

const ROOT = new URL("..", import.meta.url).pathname;

function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) found.push(path);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "src"));
  return found;
}

/** Component names produced by `createAnimatedComponent`, per file. */
function animatedComponents(src) {
  return [...src.matchAll(/const\s+(\w+)\s*=\s*Animated\.createAnimatedComponent\(/g)].map((m) => m[1]);
}

test("no animated component is handed a function for `style`", () => {
  const offences = [];

  for (const path of sources()) {
    const src = readFileSync(path, "utf8");
    // `Animated.View`, `Animated.ScrollView` and friends are animated too.
    const names = [...animatedComponents(src), "Animated\\.\\w+"];
    for (const name of names) {
      const opening = new RegExp(String.raw`<${name}\b((?:[^<>]|\n)*?)>`, "g");
      for (const [, attributes] of src.matchAll(opening)) {
        if (/\bstyle=\{\s*\(/.test(attributes)) {
          offences.push(`${path.slice(ROOT.length)}: <${name.replace("\\", "")} style={( … )}`);
        }
      }
    }
  }

  assert.deepEqual(offences, [], `funksiya ko‘rinishidagi style animatsiyali komponentga berilgan:\n${offences.join("\n")}`);
});

test("Pressable is wrapped for animation in exactly one place", () => {
  /**
   * One wrapper means one signature to get right. `Touchable` refuses the
   * function form in its types, so the mistake above cannot be made through it
   * — which is only worth anything if it is the only door.
   */
  const wrappers = sources().filter((path) => {
    const src = readFileSync(path, "utf8");
    return /Animated\.createAnimatedComponent\(\s*Pressable\s*\)/.test(src);
  });

  assert.deepEqual(
    wrappers.map((path) => path.slice(ROOT.length)),
    ["src/components/Touchable.tsx"],
  );
});

test("Touchable's own style prop rejects the function form", () => {
  const src = readFileSync(join(ROOT, "src/components/Touchable.tsx"), "utf8");
  assert.match(src, /Omit<PressableProps,\s*"style">/, "PressableProps’ style qayta e’lon qilinmagan");
  assert.match(src, /style\?:\s*StyleProp<ViewStyle>/);
  assert.ok(!/style=\{\s*\(/.test(src), "Touchable o‘zi funksiya uzatmasin");
});
