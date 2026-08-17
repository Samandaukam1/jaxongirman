import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

/**
 * Compiles the dependency-free Edge sources (templates, palettes, engine) to
 * plain JS so Node scripts and tests can import them. Deno is not installed on
 * developer machines, and these modules import each other with `.ts` extensions,
 * so `rewriteRelativeImportExtensions` does the translation for us.
 */
export function buildEdgeModules() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-edge-"));
  const configPath = path.join(outDir, "tsconfig.json");
  const shared = path.join(repoRoot, "supabase", "functions", "_shared");

  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      strict: true,
      noUncheckedIndexedAccess: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      skipLibCheck: true,
      types: [],
      outDir,
      rootDir: shared,
    },
    include: [
      // Everything here is dependency-free on purpose — no Supabase client, no
      // `Deno.env` — so it can be type-checked and unit-tested without a Deno
      // toolchain, which no developer machine in this repo has.
      path.join(shared, "presentation-types.ts"),
      path.join(shared, "gemini-schema.ts"),
      path.join(shared, "writer.ts"),
      path.join(shared, "photo-query.ts"),
      path.join(shared, "export-model.ts"),
      path.join(shared, "fonts.ts"),
      path.join(shared, "layout.ts"),
      path.join(shared, "jslayd-layout.ts"),
      path.join(shared, "jslayd", "*.ts"),
    ],
  }, null, 2));

  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}
