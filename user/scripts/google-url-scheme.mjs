#!/usr/bin/env node
/**
 * Writes the Google URL scheme into the checked-in iOS project.
 *
 * `ios/` lives in git, so EAS does not sync `app.config.js`'s plugin list into
 * it — the native project is the source of truth for iOS, and this is the one
 * fact in it that depends on a credential.
 *
 * Doing it by hand means reversing a client ID into a URL scheme and editing a
 * plist, which is two chances to make a mistake that only shows up as a blank
 * screen after the Google sheet closes. This does it once, and doing it twice
 * changes nothing.
 *
 *   node scripts/google-url-scheme.mjs 123-abc.apps.googleusercontent.com
 *
 * With no argument it reads EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID from user/.env.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLIENT_ID, CLIENT_ID_EXAMPLE } from "./client-id.mjs";

const userRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plistPath = path.join(userRoot, "ios", "Jaxongirman", "Info.plist");
const SUFFIX = ".apps.googleusercontent.com";

function clientIdFromEnv() {
  try {
    const env = readFileSync(path.join(userRoot, ".env"), "utf8");
    const line = env.split("\n").find((row) => row.startsWith("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID="));
    return line ? line.slice("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=".length).trim() : "";
  } catch {
    return "";
  }
}

const clientId = (process.argv[2] ?? clientIdFromEnv()).trim();

if (!clientId) {
  console.error(
    "iOS client ID kerak.\n\n" +
      "  node scripts/google-url-scheme.mjs <iOS-client-id>\n\n" +
      "yoki user/.env fayliga EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ni yozing.",
  );
  process.exit(1);
}

/**
 * Refused rather than reversed blindly.
 *
 * Checking only the suffix is not enough, and this was learned the hard way: a
 * placeholder copied out of a set of instructions —
 * `YOUR_IOS_CLIENT_ID.apps.googleusercontent.com` — ends correctly, reverses
 * into a plausible-looking scheme, and produces a build that installs and then
 * fails the moment somebody presses the button. A real client ID is a project
 * number, a hyphen, then an identifier.
 */
if (!CLIENT_ID.test(clientId)) {
  console.error(
    `Bu iOS client ID ga o‘xshamaydi:\n  ${clientId}\n\n` +
      `Kutilgan ko‘rinish: ${CLIENT_ID_EXAMPLE}\n` +
      "Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client IDs →\n" +
      "turi «iOS» bo‘lganini oling.",
  );
  process.exit(1);
}

const scheme = `com.googleusercontent.apps.${clientId.slice(0, -SUFFIX.length)}`;
const plist = readFileSync(plistPath, "utf8");

if (plist.includes(scheme)) {
  console.log(`✓ URL scheme allaqachon mavjud: ${scheme}`);
  process.exit(0);
}

if (plist.includes("com.googleusercontent.apps.")) {
  console.error(
    "Info.plist da boshqa googleusercontent scheme bor.\n" +
      "Ikkita bo‘lsa qaysi biri ishlashini aytib bo‘lmaydi — eskisini qo‘lda o‘chiring.",
  );
  process.exit(1);
}

const anchor = "\t<key>CFBundleURLTypes</key>\n\t<array>\n";
if (!plist.includes(anchor)) {
  console.error("Info.plist da CFBundleURLTypes topilmadi — fayl kutilgandan boshqacha.");
  process.exit(1);
}

const entry =
  "\t\t<dict>\n" +
  "\t\t\t<key>CFBundleURLSchemes</key>\n" +
  "\t\t\t<array>\n" +
  `\t\t\t\t<string>${scheme}</string>\n` +
  "\t\t\t</array>\n" +
  "\t\t</dict>\n";

writeFileSync(plistPath, plist.replace(anchor, anchor + entry));
console.log(`✓ Qo‘shildi: ${scheme}`);
console.log("  Endi: npx pod-install && eas build");
