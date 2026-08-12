import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "..");
const repoRoot = path.resolve(adminRoot, "..");

/**
 * Writing a JSLAYD design means leaving the tab — for a font file, a hex value,
 * a paragraph from somewhere else. Everything below exists because coming back
 * to an empty editor loses an hour of work and there is no undo for it.
 */
function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-workbench-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022", "DOM"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: path.join(adminRoot, "src", "lib"),
    },
    files: [path.join(adminRoot, "src", "lib", "workbench-draft.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  },
};

const dir = build();
const { forgetDraft, keepDraft, recallDraft, sameDraft } = await import(`${dir}/workbench-draft.js`);

const base = {
  id: "design-1",
  slug: "apelsen",
  name: "Apelsen",
  tier: "great",
  description: "",
  premium: false,
  source: "JSLAYD-DESIGN 1.0\n",
  recovered: false,
  thumbnailPath: null,
};

test("work left in the editor comes back after the page is lost", () => {
  store.clear();
  const typed = { ...base, source: `${base.source}[DESIGN]\nname: Apelsen Tungi\n` };
  keepDraft(typed);

  const kept = recallDraft(base.id, base);
  assert.ok(kept, "the draft must be offered back");
  assert.equal(kept.draft.source, typed.source);
  assert.ok(Date.now() - kept.savedAt < 5000, "it should report when it was kept");
});

test("nothing is offered when the kept text already matches the server's", () => {
  store.clear();
  keepDraft(base);
  assert.equal(recallDraft(base.id, base), null, "a notice with nothing to recover trains admins to dismiss notices");
});

test("each design keeps its own slot", () => {
  store.clear();
  keepDraft({ ...base, id: "design-1", source: "birinchi" });
  keepDraft({ ...base, id: "design-2", source: "ikkinchi" });
  keepDraft({ ...base, id: null, source: "yangi" });

  assert.equal(recallDraft("design-1", base).draft.source, "birinchi");
  assert.equal(recallDraft("design-2", base).draft.source, "ikkinchi");
  assert.equal(recallDraft(null, base).draft.source, "yangi");
});

test("a saved design stops offering its old draft", () => {
  store.clear();
  keepDraft({ ...base, source: "eski" });
  forgetDraft(base.id);
  assert.equal(recallDraft(base.id, base), null);
});

test("a draft older than a week is dropped rather than offered", () => {
  store.clear();
  keepDraft({ ...base, source: "juda eski" });
  const key = [...store.keys()][0];
  const kept = JSON.parse(store.get(key));
  store.set(key, JSON.stringify({ ...kept, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }));

  assert.equal(recallDraft(base.id, base), null, "stale text is worse than none");
  assert.equal(store.size, 0, "and it should not be left behind");
});

test("corrupt storage is cleared instead of crashing the editor", () => {
  store.clear();
  keepDraft(base);
  store.set([...store.keys()][0], "{not json");
  assert.equal(recallDraft(base.id, base), null);
  assert.equal(store.size, 0);
});

test("sameDraft compares what an admin can actually edit", () => {
  assert.ok(sameDraft(base, { ...base }));
  assert.ok(!sameDraft(base, { ...base, source: "boshqa" }));
  assert.ok(!sameDraft(base, { ...base, name: "Boshqa" }));
  assert.ok(!sameDraft(base, { ...base, premium: true }));
});

/**
 * The fifteen designs translated from the old TypeScript templates carry no
 * prompt. Opening one used to fall back to the sample prompt, so pressing save
 * would have replaced a published design with the example in the manual.
 */
test("a stored design never opens with the sample prompt", () => {
  const page = readFileSync(path.join(adminRoot, "src", "pages", "JslaydDesignsPage.tsx"), "utf8");
  const uses = [...page.matchAll(/SAMPLE_PROMPT/g)].length;
  assert.equal(uses, 2, "SAMPLE_PROMPT belongs only in the blank draft — an import and one use");
  assert.ok(/const BLANK[^}]*source: SAMPLE_PROMPT/s.test(page), "the one use must be the blank new design");
  assert.ok(page.includes("editableSource(design)"), "a stored design's text must be recovered from the design itself");
});
