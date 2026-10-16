import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The sentence the server wrote has to be the sentence the person reads.
 *
 * `supabase.functions.invoke` reports every non-2xx the same way — "Edge
 * Function returned a non-2xx status code" — and hangs the real response off
 * `error.context`. Reading it used to be guarded by `instanceof Response`,
 * which is false on React Native, where fetch is a polyfill. So a function
 * answering 400 with a reason produced a screen that named the transport and
 * nothing else, and six different bugs all looked like one nameless failure.
 */

const root = new URL("..", import.meta.url).pathname;
const repoRoot = new URL("../..", import.meta.url).pathname;
// Built inside the app's node_modules so the compiled module finds i18next,
// which it now asks to put the sentence in the app's language.
const cache = join(root, "node_modules", ".cache");
mkdirSync(cache, { recursive: true });
const out = mkdtempSync(join(cache, "fnerr-"));

// Compiled through a config of its own, like `social-auth.test.mjs`: the
// module imports nothing native, so it runs here as written.
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    // CommonJS, so the app's extensionless imports resolve as they do in Metro.
    target: "ES2022", module: "CommonJS", moduleResolution: "node", esModuleInterop: true,
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir: out,
    rootDir: join(root, "src"),
  },
  files: [join(root, "src", "lib", "format.ts")],
}));
execFileSync(join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const { asFunctionErrorMessage } = await import(join(out, "lib", "format.js"));
const { i18n } = await import(join(out, "i18n", "index.js"));

/** What React Native hands back: response-shaped, but not the global Response. */
const rnResponse = (body) => ({
  status: 400,
  clone() { return this; },
  json: async () => JSON.parse(body),
  text: async () => body,
});

const TRANSPORT = "Edge Function returned a non-2xx status code";

test("a reason in the body wins over the transport's sentence", async () => {
  const error = Object.assign(new Error(TRANSPORT), {
    context: rnResponse(JSON.stringify({ error: "Taqdimot topilmadi.", code: "P0002" })),
  });
  assert.equal(await asFunctionErrorMessage(error), "Taqdimot topilmadi.");
});

test("an older English reason is said in the reader's language", async () => {
  const error = Object.assign(new Error(TRANSPORT), {
    context: rnResponse(JSON.stringify({ error: "insufficient credits" })),
  });
  assert.equal(await asFunctionErrorMessage(error), "J Tanga yetarli emas.");
  await i18n.changeLanguage("ru");
  try {
    assert.equal(await asFunctionErrorMessage(error), "Недостаточно J Tanga.");
    const coded = Object.assign(new Error(TRANSPORT), {
      context: rnResponse(JSON.stringify({ error: "Mavzuni lotin yozuvida kiriting.", code: "cyrillic_topic" })),
    });
    assert.equal(await asFunctionErrorMessage(coded), "Введите тему латиницей.");
  } finally {
    await i18n.changeLanguage("uz");
  }
});

test("a body with no reason never shows the transport's sentence", async () => {
  const error = Object.assign(new Error(TRANSPORT), {
    context: rnResponse(JSON.stringify({ code: "P0002" })),
  });
  assert.equal(await asFunctionErrorMessage(error), "Kutilmagan xatolik yuz berdi");
});

test("a body that is not JSON falls back", async () => {
  const error = Object.assign(new Error(TRANSPORT), {
    context: rnResponse("<html>gateway</html>"),
  });
  assert.equal(await asFunctionErrorMessage(error), "Kutilmagan xatolik yuz berdi");
});

test("a response with only text() is still read", async () => {
  // Some polyfills expose no `json`; the reason is still in there.
  const error = Object.assign(new Error("generic"), {
    context: { status: 400, text: async () => JSON.stringify({ error: "quota tugadi" }) },
  });
  assert.equal(await asFunctionErrorMessage(error), "quota tugadi");
});

test("an error with no context at all is unchanged", async () => {
  assert.equal(await asFunctionErrorMessage(new Error("tarmoq yo‘q")), "tarmoq yo‘q");
});
