import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(packageRoot, "..", "..");

/**
 * Compiles the package to plain JS so `node --test` can import it.
 *
 * The sources import each other with `.ts` extensions — the spelling Deno needs
 * and bundlers accept — so `rewriteRelativeImportExtensions` does the
 * translation, exactly as `supabase/scripts/build-edge.mjs` does for the Edge
 * modules. Tests therefore run against the same files the apps import, not a
 * separate copy.
 */
export function buildJslayd() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jslayd-"));
  const configPath = path.join(outDir, "tsconfig.json");
  const src = path.join(packageRoot, "src");

  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      noUncheckedIndexedAccess: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      skipLibCheck: true,
      types: [],
      outDir,
      rootDir: src,
    },
    include: [path.join(src, "**", "*.ts")],
  }, null, 2));

  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}
