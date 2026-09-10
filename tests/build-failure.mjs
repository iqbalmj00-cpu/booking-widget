/** Real compiler failure in a task-owned copy; original Git and build output stay read-only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WIDGET_ROOT, LOCAL_DIST, RELEASE_FILES } from "../scripts/dist-paths.mjs";
import { sourceInputs } from "../scripts/source-fingerprint.mjs";
import { git, verifyLocal } from "../scripts/build-manifest.mjs";
verifyLocal(LOCAL_DIST);
const temp = mkdtempSync(join(tmpdir(), "widget-build-failure-"));
try {
    for (const { path } of sourceInputs()) { mkdirSync(dirname(join(temp, path)), { recursive: true }); copyFileSync(join(WIDGET_ROOT, path), join(temp, path)); }
    copyFileSync(join(WIDGET_ROOT, ".gitignore"), join(temp, ".gitignore"));
    // The builder only issues --no-optional-locks Git reads. No checkout, refs or index are changed.
    writeFileSync(join(temp, ".git"), `gitdir: ${git(WIDGET_ROOT, "rev-parse", "--absolute-git-dir").toString().trim()}\n`);
    mkdirSync(join(temp, "dist"));
    const before = new Map(RELEASE_FILES.map(file => [file, readFileSync(join(LOCAL_DIST, file))]));
    for (const [file, bytes] of before) writeFileSync(join(temp, "dist", file), bytes);
    appendFileSync(join(temp, "src/main.tsx"), '\nconst deliberateCompileFailure: string = 1;\n');
    let failed = false;
    try { execFileSync(process.execPath, [join(temp, "scripts/build.mjs")], { cwd: temp, env: process.env, stdio: "pipe", timeout: 180000 }); }
    catch (error) {
        failed = true;
        assert.match(String(error.stdout), /Type 'number' is not assignable to type 'string'/, "Failure must come from the deliberate compiler error");
    }
    assert.ok(failed, "Controlled build must reject a compiler failure");
    for (const [file, bytes] of before) assert.deepEqual(readFileSync(join(temp, "dist", file)), bytes, `Failed build must preserve ${file}`);
    assert.ok(!readdirSync(temp).some(file => file.startsWith(".widget-build-")), "Temporary build output is cleaned");
    verifyLocal(LOCAL_DIST);
    console.log("PASS controlled compiler failure: no manifest issued, prior artifacts unchanged, original source/Git read-only.");
} finally { if (existsSync(temp)) rmSync(temp, { recursive: true, force: true }); }
