import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

/**
 * Compiles the JElement package so Node can import it.
 *
 * Node cannot run TypeScript, and the package imports the JSLAYD lexer by
 * package name — right for the bundlers that ship it, meaningless inside a temp
 * directory. Both problems are solved here rather than by making the production
 * source reach across packages with a relative path.
 */
export function buildJelement() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-smoke-"));
  const configPath = path.join(outDir, "tsconfig.json");

  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: repoRoot,
      allowImportingTsExtensions: false,
      rewriteRelativeImportExtensions: true,
      paths: { "@jaxongirman/jslayd": [path.join(repoRoot, "packages", "jslayd", "src", "index.ts")] },
    },
    include: [
      path.join(repoRoot, "packages", "jelement", "src", "*.ts"),
      path.join(repoRoot, "packages", "jslayd", "src", "*.ts"),
    ],
  }, null, 2));

  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

  const link = path.join(outDir, "node_modules", "@jaxongirman", "jslayd");
  mkdirSync(link, { recursive: true });
  writeFileSync(path.join(link, "package.json"), JSON.stringify({
    name: "@jaxongirman/jslayd", type: "module",
    main: path.join(outDir, "packages", "jslayd", "src", "index.js"),
  }));

  return path.join(outDir, "packages", "jelement", "src");
}
