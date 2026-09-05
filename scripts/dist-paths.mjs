/**
 * dist-paths.mjs — Shared locations for the widget bundle and its deployed copy.
 *
 * The widget is served to operators from the ScaleYourJunk repo, not from here.
 * Building in this repo therefore changes nothing anyone can see until the built
 * files are copied across AND that repo is deployed. Both halves are manual and
 * there is no CI anywhere, so these paths exist to make the drift detectable.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const WIDGET_ROOT = resolve(here, "..");
export const LOCAL_DIST = join(WIDGET_ROOT, "dist");

/**
 * Where the deployed copy lives inside the ScaleYourJunk repo.
 * Override with SYJ_WIDGET_DIR when the repos aren't checked out side by side.
 */
export const DEPLOYED_DIST =
    process.env.SYJ_WIDGET_DIR || resolve(WIDGET_ROOT, "../../scaleyourjunk/public/widget");

/** Files that make up a release. `loader.js` is owned by ScaleYourJunk, not built here. */
export const ARTIFACTS = ["embed.iife.js", "embed.css"];

/**
 * vite.config.ts stamps `new Date().toISOString()` into every build so an
 * embed's console reveals which build is running. Hashed as-is, that made two
 * builds of identical source differ, so check:sync reported drift every single
 * time — a guard that always fails is worse than no guard, because the one real
 * drift is indistinguishable from the noise.
 *
 * Blank the stamp before hashing. The comparison then sees the code and nothing
 * else. The pattern is an ISO-8601 instant, which appears exactly once in a
 * build (assertBuildStampCount checks that, so this cannot rot into a
 * normaliser that matches nothing and silently restores the old behaviour).
 */
const BUILD_STAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const BUILD_STAMP_PLACEHOLDER = "<build-stamp>";

/** Every build stamp in a file, in order. Empty for a missing file. */
export function buildStamps(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8").match(BUILD_STAMP_RE) ?? [];
}

export function sha256(path) {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path);
    // CSS carries no stamp; leaving it as bytes keeps that comparison exact.
    const bytes = path.endsWith(".js")
        ? Buffer.from(raw.toString("utf8").replace(BUILD_STAMP_RE, BUILD_STAMP_PLACEHOLDER), "utf8")
        : raw;
    return createHash("sha256").update(bytes).digest("hex");
}

export function shortHash(hash) {
    return hash ? hash.slice(0, 12) : "MISSING";
}
