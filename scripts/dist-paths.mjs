import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WIDGET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCAL_DIST = join(WIDGET_ROOT, "dist");
// A local publisher directory is not a deployment. This module never writes to it.
export const PUBLISHER_DIST = process.env.SYJ_WIDGET_DIR || resolve(WIDGET_ROOT, "../../scaleyourjunk/public/widget");
export const ARTIFACTS = ["embed.iife.js", "embed.css"];
export const MANIFEST = "widget-build-manifest.json";
export const RELEASE_FILES = [...ARTIFACTS, MANIFEST];
