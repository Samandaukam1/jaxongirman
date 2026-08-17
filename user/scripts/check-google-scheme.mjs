#!/usr/bin/env node
/**
 * Refuses an iOS build that would crash the moment somebody presses Google.
 *
 * The Google SDK raises an Objective-C exception when it is handed a client ID
 * and cannot find the matching URL scheme in Info.plist. An NSException is not
 * a rejected promise — no `try`/`catch` in JavaScript can catch it, and the
 * process simply dies. So the app cannot defend itself at run time; the only
 * place to catch this is before the build starts.
 *
 * It has already happened once: the env vars were set, `ios/` is checked in so
 * `app.config.js` never reached it, and the button closed the app.
 *
 * Runs as `eas-build-pre-install`, on the machine where EAS has already put the
 * environment in place — which is the only place both halves are visible at
 * once. Also runnable by hand.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLIENT_ID, CLIENT_ID_EXAMPLE } from "./client-id.mjs";

const userRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIX = ".apps.googleusercontent.com";

// Only iOS is at risk: Android has no checked-in native folder, so its config
// is generated from app.config.js and cannot fall out of step this way.
const platform = process.env.EAS_BUILD_PLATFORM;
if (platform && platform !== "ios") process.exit(0);

const clientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "").trim();

// No client ID is a valid state — the button reports itself unconfigured and
// nothing native is ever called. That build is safe to make.
if (!clientId) process.exit(0);

if (!CLIENT_ID.test(clientId)) {
  console.error(
    `\n✖ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID iOS client ID ga o‘xshamaydi:\n  ${clientId}\n` +
      `  Kutilgan ko‘rinish: ${CLIENT_ID_EXAMPLE}\n`,
  );
  process.exit(1);
}

const scheme = `com.googleusercontent.apps.${clientId.slice(0, -SUFFIX.length)}`;
const plistPath = path.join(userRoot, "ios", "Jaxongirman", "Info.plist");

let plist;
try {
  plist = readFileSync(plistPath, "utf8");
} catch {
  // A build from a project without ios/ generates it from app.config.js, which
  // adds the scheme itself. Nothing to check.
  process.exit(0);
}

if (plist.includes(scheme)) {
  console.log(`✓ Google URL scheme joyida: ${scheme}`);
  process.exit(0);
}

console.error(
  "\n✖ iOS build to‘xtatildi — Google URL scheme yo‘q.\n\n" +
    `  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID o‘rnatilgan, lekin Info.plist da\n` +
    `  ${scheme}\n  topilmadi.\n\n` +
    "  Bu build o‘rnatiladi va Google tugmasi bosilganda ilova yopiladi —\n" +
    "  Google SDK Objective-C exception ko‘taradi, uni JS ushlay olmaydi.\n\n" +
    "  Tuzatish:\n" +
    "    cd user\n" +
    "    node scripts/google-url-scheme.mjs \"$EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID\"\n" +
    "    npx pod-install\n" +
    "  so‘ng o‘zgarishni commit qilib, qaytadan build qiling.\n",
);
process.exit(1);
