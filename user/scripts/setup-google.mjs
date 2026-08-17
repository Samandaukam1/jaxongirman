#!/usr/bin/env node
/**
 * Sets up Google sign-in by asking, rather than by being edited.
 *
 * The template it replaces asked somebody to paste three commands and swap
 * three values inside them. That went wrong twice in a row in the same way:
 * the example values were stored verbatim, passed a non-empty check, reached
 * the Google SDK and closed the app. A template is a form with no validation.
 *
 * This asks for one value at a time, refuses anything that is not a client ID
 * before it can be stored anywhere, and then does every step itself — three
 * environments, the local .env, and the iOS URL scheme. Nothing is written
 * until all three answers are good, so a mistake half way through leaves the
 * project exactly as it was.
 *
 *   node scripts/setup-google.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { CLIENT_ID, CLIENT_ID_EXAMPLE } from "./client-id.mjs";

const userRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENVIRONMENTS = ["development", "preview", "production"];

const WANTED = [
  {
    key: "WEB",
    name: "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
    prompt: "Web client ID",
    why: "Supabase identity token’ni aynan shunga qarab tekshiradi.",
  },
  {
    key: "IOS",
    name: "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
    prompt: "iOS client ID",
    why: "Bundle ID: uz.jaxongirman.app",
  },
  {
    key: "ANDROID",
    name: "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
    prompt: "Android client ID",
    why: "Package: uz.jaxongirman.app, SHA-1 bilan",
  },
];

console.log(`
Google sign-in sozlash
──────────────────────

Uchta client ID kerak. Ular bu yerda:
  console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client IDs

Har biri shunday ko‘rinadi:
  ${CLIENT_ID_EXAMPLE}

Agar u yerda hali hech narsa yaratmagan bo‘lsangiz, Ctrl+C bosing va avval
uchta OAuth client yarating — docs/social-auth-setup.md da yozilgan.
`);

const rl = createInterface({ input: stdin, output: stdout });
const answers = {};

try {
  for (const item of WANTED) {
    // Asked until it is right rather than accepted and validated later: the
    // value is worthless in three places at once if it is wrong, and undoing it
    // is what took two rounds last time.
    for (;;) {
      const value = (await rl.question(`\n${item.prompt}  (${item.why})\n> `)).trim();

      if (CLIENT_ID.test(value)) {
        answers[item.key] = value;
        break;
      }
      if (value.length === 0) {
        console.log("  Bo‘sh qoldirib bo‘lmaydi.");
        continue;
      }
      console.log(
        `  Bu client ID ga o‘xshamaydi.\n` +
          `  Kutilgan ko‘rinish: ${CLIENT_ID_EXAMPLE}\n` +
          `  Namunani emas, Google Cloud’dagi haqiqiy qiymatni qo‘ying.`,
      );
    }
  }
} finally {
  rl.close();
}

if (new Set(Object.values(answers)).size !== 3) {
  console.error("\n✖ Uchtasi ham har xil bo‘lishi kerak — bittasi ikki marta qo‘yilgan.");
  process.exit(1);
}

console.log("\nEAS ga yozilmoqda…");
for (const environment of ENVIRONMENTS) {
  for (const item of WANTED) {
    // `env:create --force` overwrites when it is already there, so this is the
    // one call whether or not a previous attempt left something behind.
    execFileSync("npx", [
      "eas", "env:create",
      "--scope", "project",
      "--environment", environment,
      "--visibility", "plaintext",
      "--name", item.name,
      "--value", answers[item.key],
      "--force",
      "--non-interactive",
    ], { cwd: userRoot, stdio: ["ignore", "ignore", "inherit"] });
  }
  console.log(`  ✓ ${environment}`);
}

console.log("\n.env yangilanmoqda…");
const envPath = path.join(userRoot, ".env");
let env = "";
try {
  env = readFileSync(envPath, "utf8");
} catch {
  env = "";
}
const kept = env
  .split("\n")
  .filter((line) => !WANTED.some((item) => line.startsWith(`${item.name}=`)))
  .join("\n")
  .replace(/\n+$/, "");
writeFileSync(
  envPath,
  `${kept}\n${WANTED.map((item) => `${item.name}=${answers[item.key]}`).join("\n")}\n`,
);
console.log("  ✓ user/.env");

console.log("\niOS URL scheme yozilmoqda…");
execFileSync("node", [path.join(userRoot, "scripts", "google-url-scheme.mjs"), answers.IOS], {
  cwd: userRoot,
  stdio: "inherit",
});

console.log(`
Tayyor. Qolgani:

  npx pod-install
  cd .. && git add -A && git commit -m "iOS Google URL scheme" && git push && cd user
  npx eas build --profile production --platform ios --auto-submit

Supabase dashboard’da ham tekshiring — Authentication → Providers → Google:
  Client ID     = web client ID
  Client Secret = web client secret
  Authorized Client IDs maydoniga iOS va Android ID larini ham qo‘shing,
  aks holda mobil kirish rad etiladi.
`);
