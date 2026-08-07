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

export function sha256(path) {
    if (!existsSync(path)) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function shortHash(hash) {
    return hash ? hash.slice(0, 12) : "MISSING";
}
