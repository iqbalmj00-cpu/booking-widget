/**
 * source-fingerprint.mjs — What the bundle in dist/ was built from.
 *
 * check-dist-sync compares built artifacts against the deployed copy, which
 * answers one question: is the deployed bundle the one sitting in dist/. It
 * says nothing about whether dist/ is the current source. Edit src/, skip the
 * rebuild, run release:copy from a stale dist/, and the check reported
 * "✓ matches" for precisely the drift it exists to catch.
 *
 * So the build records a hash of everything that goes into it, and the check
 * recomputes that hash from the working tree. A mismatch means dist/ was built
 * from source that is no longer on disk.
 *
 * A content hash rather than a git SHA: the SHA is identical across an entire
 * dirty tree, so a bundle built from uncommitted source would still look
 * current — and uncommitted source is the normal state here.
 *
 * Run directly to record the fingerprint (npm run build does this last):
 *
 *   node scripts/source-fingerprint.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WIDGET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Recorded inside dist/, so a discarded build discards its fingerprint too. */
export const FINGERPRINT_FILE = join(WIDGET_ROOT, "dist", ".source-fingerprint");

/**
 * Root files that change the bundle. src/ is obvious; these are not.
 * package.json and the lockfile decide which React and which Vite compiled it,
 * vite.config.ts decides the output format and the minifier, and tsconfig
 * decides the target and the JSX transform.
 */
const ROOT_INPUTS = ["package.json", "package-lock.json", "vite.config.ts"];
const ROOT_INPUT_RE = /^tsconfig.*\.json$/;

/**
 * Nothing the bundle imports reaches a __tests__ directory — main.tsx cannot
 * see them — so a test edit cannot change embed.iife.js. Hashing them would
 * report a stale build on every test change, and a guard that cries wolf is
 * the exact failure the build-stamp normaliser was added to fix.
 *
 * .DS_Store is macOS noise that appears and vanishes on its own.
 */
const EXCLUDED_DIRS = new Set(["__tests__"]);
const EXCLUDED_FILES = new Set([".DS_Store"]);

function walk(dir, out) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
        } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name)) {
            out.push(join(dir, entry.name));
        }
    }
    return out;
}

/** Every build input, as repo-relative paths, sorted. */
export function sourceInputs() {
    const found = new Set();
    const srcDir = join(WIDGET_ROOT, "src");
    if (existsSync(srcDir)) for (const file of walk(srcDir, [])) found.add(file);
    for (const name of readdirSync(WIDGET_ROOT)) {
        if (ROOT_INPUTS.includes(name) || ROOT_INPUT_RE.test(name)) found.add(join(WIDGET_ROOT, name));
    }
    return [...found].map(p => relative(WIDGET_ROOT, p).split(sep).join("/")).sort();
}

/**
 * One hash over every input's path and contents. Paths are hashed too, so a
 * renamed or deleted file registers as a change rather than cancelling out.
 */
export function sourceFingerprint() {
    const hash = createHash("sha256");
    for (const rel of sourceInputs()) {
        hash.update(rel);
        hash.update("\0");
        hash.update(createHash("sha256").update(readFileSync(join(WIDGET_ROOT, rel))).digest());
        hash.update("\n");
    }
    return hash.digest("hex");
}

/** The fingerprint the build recorded, or null when it recorded none. */
export function readRecordedFingerprint() {
    if (!existsSync(FINGERPRINT_FILE)) return null;
    return readFileSync(FINGERPRINT_FILE, "utf8").trim() || null;
}

export function writeFingerprint() {
    const value = sourceFingerprint();
    mkdirSync(dirname(FINGERPRINT_FILE), { recursive: true });
    writeFileSync(FINGERPRINT_FILE, value + "\n");
    return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const value = writeFingerprint();
    console.log(`source fingerprint ${value.slice(0, 12)} → ${relative(WIDGET_ROOT, FINGERPRINT_FILE)}`);
}
