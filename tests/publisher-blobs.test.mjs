import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_RELEASE_BYTES, readGitBlob, readCommittedRelease, verifyLocal } from "../scripts/build-manifest.mjs";
import { LOCAL_DIST, WIDGET_ROOT, RELEASE_FILES } from "../scripts/dist-paths.mjs";

// All object writes/commits live in a new bare fixture. Original refs and index are read-only.
function fixture() {
    const root = mkdtempSync(join(tmpdir(), "widget-publisher-test-"));
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
    const git = (args, input) => execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { env, input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    git(["init", "--bare"]);
    const blob = bytes => git(["hash-object", "-w", "--stdin"], bytes).toString().trim();
    const tree = entries => git(["mktree"], entries.map(([mode, kind, oid, name]) => `${mode} ${kind} ${oid}\t${name}\n`).join("")).toString().trim();
    const commit = files => {
        const widget = tree([...files].map(([name, bytes]) => ["100644", "blob", blob(bytes), name]));
        const pub = tree([["040000", "tree", widget, "widget"]]); const top = tree([["040000", "tree", pub, "public"]]);
        return git(["commit-tree", top], "Isolated release fixture\n").toString().trim();
    };
    return { root, blob, commit, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("bounded binary Git reader handles the actual candidate and >1MiB, rejects explicit over-limit/missing/corrupt/non-blob objects", () => {
    const f = fixture();
    try {
        const actual = readFileSync(join(LOCAL_DIST, "embed.iife.js")); assert.ok(actual.length > 1024 * 1024);
        for (const bytes of [actual, Buffer.alloc(2 * 1024 * 1024 + 7, 0x97)]) assert.deepEqual(readGitBlob(f.root, f.blob(bytes)), bytes);
        const oid = f.blob(Buffer.alloc(MAX_RELEASE_BYTES + 1, 0x4a)); assert.throws(() => readGitBlob(f.root, oid), /exceeds .*byte limit/);
        const small = f.blob(Buffer.alloc(101)); assert.throws(() => readGitBlob(f.root, small, 100), /exceeds 100-byte limit/);
        assert.throws(() => readGitBlob(f.root, "0".repeat(40)));
        const bad = f.blob(Buffer.from("corrupt fixture")); const badPath = join(f.root, "objects", bad.slice(0, 2), bad.slice(2)); chmodSync(badPath, 0o600); writeFileSync(badPath, "not a zlib Git object"); assert.throws(() => readGitBlob(f.root, bad));
        const commit = f.commit(new Map()); assert.throws(() => readGitBlob(f.root, commit), /Expected a Git blob/);
    } finally { f.close(); }
});
test("full committed comparison and actual CLI validate all three candidate release files", () => {
    const f = fixture();
    try {
        const manifest = verifyLocal(LOCAL_DIST); const files = new Map(RELEASE_FILES.map(file => [file, readFileSync(join(LOCAL_DIST, file))]));
        const commit = f.commit(files); const options = { expectedCommit: manifest.source.commit, expectedBuildId: manifest.buildId, lockBytes: readFileSync(join(WIDGET_ROOT, "package-lock.json")) };
        const actual = readCommittedRelease(f.root, commit, options); for (const [file, bytes] of files) assert.deepEqual(actual.get(file), bytes);
        const output = execFileSync(process.execPath, [join(WIDGET_ROOT, "scripts/check-dist-sync.mjs"), "--publisher-repo", f.root, "--publisher-commit", commit], { stdio: "pipe", maxBuffer: 1024 * 1024 }).toString(); assert.match(output, /PUBLISHER COMMITTED BLOBS verified/); assert.match(output, /LIVE BYTES: not checked/);
        for (const file of RELEASE_FILES) {
            const missing = new Map(files); missing.delete(file); assert.throws(() => readCommittedRelease(f.root, f.commit(missing), options));
            const corrupt = new Map(files); corrupt.set(file, Buffer.from("wrong bytes")); assert.throws(() => readCommittedRelease(f.root, f.commit(corrupt), options));
        }
    } finally { f.close(); }
});
