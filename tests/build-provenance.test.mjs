import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildId, fetchReleaseFile, identityMarker, validateManifest, verifyDistribution, verifyLocal, verifyLockedTools } from "../scripts/build-manifest.mjs";
import { ARTIFACTS, MANIFEST, WIDGET_ROOT } from "../scripts/dist-paths.mjs";
import { digest, fingerprintFiles } from "../scripts/source-fingerprint.mjs";

function fixture() {
    const bytes = new Map([["embed.iife.js", Buffer.from('console.log("fixture")')], ["embed.css", Buffer.from('body{color:red}')]]);
    const files = [{ path: "package-lock.json", sha256: digest("lock") }];
    const source = { commit: "a".repeat(40), workingTreeDirty: true, inputsMatchCommit: false, sha256: fingerprintFiles(files), lockSha256: files[0].sha256, files };
    const toolchain = { node: "24.21.0", npm: "11.19.0", platform: "darwin", arch: "arm64", vite: "6.4.3", typescript: "5.9.3", reactPlugin: "4.7.0", react: "18.3.1", reactDom: "18.3.1", esbuild: "0.25.12", rollup: "4.62.2" };
    bytes.set("embed.iife.js", Buffer.from(identityMarker(buildId(source, toolchain)) + 'console.log("fixture")'));
    const artifacts = Object.fromEntries(ARTIFACTS.map(name => [name, { sha256: digest(bytes.get(name)), bytes: bytes.get(name).length }]));
    const manifest = { schemaVersion: 2, buildId: buildId(source, toolchain), source, toolchain, artifacts };
    const save = () => bytes.set(MANIFEST, Buffer.from(JSON.stringify(manifest)));
    save();
    const read = name => { if (!bytes.has(name)) throw new Error(`Missing ${name}`); return bytes.get(name); };
    return { manifest, bytes, read, save };
}

test("valid dirty source has a deterministic identity, never commit-only provenance", () => {
    const f = fixture(); assert.equal(verifyDistribution(f.read).source.inputsMatchCommit, false);
    assert.equal(buildId(f.manifest.source, f.manifest.toolchain), fixture().manifest.buildId);
    const changed = structuredClone(f.manifest.source); changed.commit = "b".repeat(40);
    assert.notEqual(buildId(changed, f.manifest.toolchain), f.manifest.buildId);
});
test("rejects malformed JSON, unknown schema, missing/extra fields and invalid types", () => {
    const f = fixture(); f.bytes.set(MANIFEST, Buffer.from("<html>login</html>")); assert.throws(() => verifyDistribution(f.read));
    for (const change of [m => m.schemaVersion = 99, m => delete m.toolchain, m => m.unverified = true, m => m.source.workingTreeDirty = "false", m => m.artifacts[ARTIFACTS[0]].bytes = 0]) {
        const m = fixture().manifest; change(m); assert.throws(() => validateManifest(m));
    }
});
test("rejects source/lock hash mismatch, duplicates, traversal, fabricated clean provenance", () => {
    for (const change of [m => m.source.sha256 = "0".repeat(64), m => m.source.lockSha256 = "0".repeat(64), m => m.source.files.push(m.source.files[0]), m => m.source.files[0].path = "../secret", m => m.source.workingTreeDirty = false]) {
        const m = fixture().manifest; change(m); assert.throws(() => validateManifest(m));
    }
});
test("rejects missing and stale artifact bytes, even when both destinations lack a file", () => {
    for (const name of ARTIFACTS) {
        const f = fixture(); f.bytes.delete(name); assert.throws(() => verifyDistribution(f.read), /Missing/);
        f.bytes.set(name, Buffer.from("stale")); assert.throws(() => verifyDistribution(f.read), /hash\/size/);
    }
});
test("rejects widget commit, build identity and expected release mismatches", () => {
    const f = fixture(); assert.throws(() => verifyDistribution(f.read, { expectedCommit: "b".repeat(40) }), /commit mismatch/);
    assert.throws(() => verifyDistribution(f.read, { expectedBuildId: "0".repeat(64) }), /Build ID mismatch/);
    f.manifest.source.commit = "c".repeat(40); f.save(); assert.throws(() => verifyDistribution(f.read), /identity mismatch/);
});
test("HTML is rejected even with matching manifest hashes", () => {
    const f = fixture(); const data = Buffer.from("<!doctype html><html>Login</html>");
    f.bytes.set(ARTIFACTS[0], data); f.manifest.artifacts[ARTIFACTS[0]] = { sha256: digest(data), bytes: data.length }; f.save();
    assert.throws(() => verifyDistribution(f.read), /HTML received/);
});
test("valid artifact metadata alone cannot claim to match current source", () => {
    const f = fixture(); const dir = mkdtempSync(join(tmpdir(), "widget-manifest-test-"));
    try { for (const [name, bytes] of f.bytes) writeFileSync(join(dir, name), bytes); assert.throws(() => verifyLocal(dir), /Stale build|lock digest/); }
    finally { rmSync(dir, { recursive: true, force: true }); }
});
const url = "https://fixture.invalid/widget/embed.iife.js";
const response = overrides => ({ ok: true, status: 200, url, redirected: false, headers: new Headers({ "content-type": "application/javascript; charset=utf-8" }), arrayBuffer: async () => Buffer.from("fixture"), ...overrides });
test("live fetch checks HTTP status, final URL, redirects and MIME before comparing bytes", async () => {
    let options; assert.equal((await fetchReleaseFile(url, ARTIFACTS[0], async (_, o) => { options = o; return response({}); })).toString(), "fixture");
    assert.equal(options.redirect, "error");
    for (const r of [response({ ok: false, status: 404 }), response({ status: 202 }), response({ url: "https://login.invalid/" }), response({ redirected: true }), response({ headers: new Headers({ "content-type": "text/html" }) }), response({ headers: new Headers() })]) {
        await assert.rejects(fetchReleaseFile(url, ARTIFACTS[0], async () => r));
    }
    await assert.rejects(fetchReleaseFile(url, ARTIFACTS[0], async () => { throw new Error("network failure"); }));
});
test("fingerprint CLI only reads and release --copy fails closed", () => {
    let before; try { before = readFileSync(join(WIDGET_ROOT, "dist", MANIFEST)); } catch { before = null; }
    const output = execFileSync(process.execPath, ["scripts/source-fingerprint.mjs"], { cwd: WIDGET_ROOT }).toString(); assert.match(output, /read-only; no build stamped/);
    assert.throws(() => execFileSync(process.execPath, ["scripts/release.mjs", "--copy"], { cwd: WIDGET_ROOT, stdio: "pipe" }));
    if (before) assert.deepEqual(readFileSync(join(WIDGET_ROOT, "dist", MANIFEST)), before);
    else assert.throws(() => readFileSync(join(WIDGET_ROOT, "dist", MANIFEST)));
});


test("metadata-only toolchain and source-commit relabels fail against the bundle marker", () => {
    for (const change of [m => m.toolchain.node = "24.99.0", m => m.source.commit = "b".repeat(40)]) {
        const f = fixture(); change(f.manifest); f.manifest.buildId = buildId(f.manifest.source, f.manifest.toolchain); f.save();
        assert.throws(() => verifyDistribution(f.read), /bundle identity marker/);
    }
});
test("missing, duplicate and wrong markers fail even with updated artifact hashes", () => {
    for (const value of ["console.log('none')", identityMarker("0".repeat(64)), identityMarker(fixture().manifest.buildId).repeat(2)]) {
        const f = fixture(); const bytes = Buffer.from(value);
        f.bytes.set("embed.iife.js", bytes); f.manifest.artifacts["embed.iife.js"] = { sha256: digest(bytes), bytes: bytes.length }; f.save();
        assert.throws(() => verifyDistribution(f.read), /bundle identity marker/);
    }
});
test("dependency tool versions must match the exact verification lock", () => {
    const f = fixture(); const names = { vite: "vite", typescript: "typescript", reactPlugin: "@vitejs/plugin-react", react: "react", reactDom: "react-dom", esbuild: "esbuild", rollup: "rollup" };
    const lock = Buffer.from(JSON.stringify({ packages: Object.fromEntries(Object.entries(names).map(([key, name]) => [`node_modules/${name}`, {version:f.manifest.toolchain[key]}])) }));
    f.manifest.source.lockSha256 = digest(lock); verifyLockedTools(f.manifest, lock);
    f.manifest.toolchain.vite = "6.4.99"; assert.throws(() => verifyLockedTools(f.manifest, lock), /Toolchain\/lock version mismatch/);
    assert.throws(() => verifyLockedTools(f.manifest, Buffer.from("{}")), /lock digest/);
});
test("HTTP release encoding requires one explicit UTF-8 charset and valid UTF-8 bytes", async () => {
    for (const [file, mime] of [["embed.iife.js", "application/javascript"], ["embed.css", "text/css"], [MANIFEST, "application/json"]]) {
        for (const suffix of ["; charset=utf-8", '; CHARSET="UTF-8"']) {
            const data = await fetchReleaseFile(url, file, async () => response({headers:new Headers({"content-type":mime+suffix})})); assert.equal(data.toString(), "fixture");
        }
        for (const suffix of ["", "; charset=utf-16le", "; charset=iso-8859-1", "; charset=", "; charset=utf-8; charset=utf-8", "; charset=utf-8; charset=latin1", "; charset=utf-8; boundary=wrong", '; charset="utf-8', "; charset=utf-8, text/html", "; charset='utf-8'"]) {
            await assert.rejects(fetchReleaseFile(url, file, async () => response({headers:new Headers({"content-type":mime+suffix})})), /charset=utf-8/);
        }
        await assert.rejects(fetchReleaseFile(url, file, async () => response({headers:new Headers({"content-type":mime+"; charset=utf-8"}), arrayBuffer:async()=>Buffer.from([0xc3,0x28])})), /Invalid UTF-8/);
    }
});
