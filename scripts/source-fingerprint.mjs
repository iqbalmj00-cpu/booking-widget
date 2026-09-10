/** Read-only source identity. Only build.mjs can produce a build manifest. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIDGET_ROOT } from "./dist-paths.mjs";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function isSourceInput(path) {
    return /^(src|public|scripts)\//.test(path) || ["package.json", "package-lock.json", "vite.config.ts", ".nvmrc"].includes(path) || /^tsconfig.*\.json$/.test(path);
}
export function sourceInputs(root = WIDGET_ROOT) {
    const files = [];
    function walk(dir) {
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
            if (entry.name === ".DS_Store") continue;
            const path = `${dir}/${entry.name}`;
            if (entry.isSymbolicLink()) throw new Error(`Build input symlink is not supported: ${path}`);
            if (entry.isDirectory()) walk(path);
            else if (entry.isFile()) files.push(path);
        }
    }
    for (const dir of ["src", "public", "scripts"]) if (existsSync(join(root, dir))) {
        if (lstatSync(join(root, dir)).isSymbolicLink()) throw new Error(`Build input symlink is not supported: ${dir}`);
        walk(dir);
    }
    for (const name of readdirSync(root)) {
        if (["package.json", "package-lock.json", "vite.config.ts", ".nvmrc"].includes(name) || /^tsconfig.*\.json$/.test(name)) files.push(name);
    }
    return files.sort().map(path => {
        if (lstatSync(join(root, path)).isSymbolicLink()) throw new Error(`Build input symlink is not supported: ${path}`);
        return { path, sha256: digest(readFileSync(join(root, path))) };
    });
}
export const fingerprintFiles = files => digest(JSON.stringify(files));
export function sourceFingerprint(root = WIDGET_ROOT) { return fingerprintFiles(sourceInputs(root)); }
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    console.log(`Current source SHA-256: ${sourceFingerprint()} (read-only; no build stamped)`);
}
