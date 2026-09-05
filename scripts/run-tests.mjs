#!/usr/bin/env node
/**
 * Minimal test runner — no test framework.
 *
 * Tests are self-running .ts files that assert with node:assert and throw on
 * the first failure, matching the dashboard's idiom (scaleyourjunk's
 * src/lib/__tests__ run one file per process with tsx).
 *
 * This repo has no tsx. Adding one would mean `npm install`, and this repo's
 * lockfile is already out of sync with node_modules — a plain install already
 * pulls in dozens of unrelated packages. So we transpile with the compiler the
 * repo already depends on and run the emitted JavaScript. That adds no
 * dependency at all and works on Node 20 as well as 22.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = ["lib/__tests__", "src/lib/__tests__"]
    .map(p => path.join(repoRoot, p))
    .find(existsSync);

if (!testsDir) {
    console.error("No __tests__ directory found.");
    process.exit(1);
}

const testFiles = readdirSync(testsDir)
    .filter(f => f.endsWith(".test.ts"))
    .sort()
    .map(f => path.join(testsDir, f));

// Ambient declarations living beside the tests (the widget declares node:assert
// itself, having no @types/node). Explicit file arguments mean tsc picks up
// nothing it was not handed.
const declFiles = readdirSync(testsDir)
    .filter(f => f.endsWith(".d.ts"))
    .sort()
    .map(f => path.join(testsDir, f));

if (testFiles.length === 0) {
    console.error(`No *.test.ts files in ${path.relative(repoRoot, testsDir)}.`);
    process.exit(1);
}

const outDir = path.join(repoRoot, ".test-out");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Passing files on the command line makes tsc ignore tsconfig.json, so the
// emit settings here are the whole configuration. Emitted files are CommonJS;
// the marker package.json stops Node reading the repo's own "type" field.
const tsc = path.join(repoRoot, "node_modules", ".bin", "tsc");
execFileSync(tsc, [
    "--outDir", outDir,
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--target", "ES2022",
    "--lib", "ES2022,DOM",
    "--strict",
    "--esModuleInterop",
    "--skipLibCheck",
    "--rootDir", repoRoot,
    ...declFiles,
    ...testFiles,
], { stdio: "inherit", cwd: repoRoot });

writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

const emitted = [];
(function walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".test.js")) emitted.push(full);
    }
})(outDir);
emitted.sort();

let failed = 0;
for (const file of emitted) {
    const name = path.basename(file, ".js");
    try {
        execFileSync(process.execPath, [file], { stdio: "inherit", cwd: repoRoot });
        console.log(`PASS  ${name}`);
    } catch {
        console.error(`FAIL  ${name}`);
        failed += 1;
    }
}

console.log(`\n${emitted.length - failed}/${emitted.length} test files passed.`);
process.exit(failed === 0 ? 0 : 1);
