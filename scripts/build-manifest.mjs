import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, MANIFEST, WIDGET_ROOT, RELEASE_FILES } from "./dist-paths.mjs";
import { digest, fingerprintFiles, sourceInputs, isSourceInput } from "./source-fingerprint.mjs";

const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const version = value => typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value);
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function keys(value, expected, name) {
    requireValue(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...expected].sort().join(), `Invalid ${name} fields`);
}
// Metadata/source reads have an explicit bound; release blobs get a size preflight.
export const MAX_RELEASE_BYTES = 16 * 1024 * 1024;
export const git = (root, ...args) => execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
export function readGitBlob(root, object, maxBytes = MAX_RELEASE_BYTES) {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_RELEASE_BYTES, "Invalid Git blob byte limit");
    requireValue(typeof object === "string" && /^[a-f0-9]{40}(?::[\w./-]+)?$/.test(object), "Use an immutable blob or commit:path");
    requireValue(git(root, "cat-file", "-t", object).toString().trim() === "blob", "Expected a Git blob");
    const size = Number(git(root, "cat-file", "-s", object).toString().trim());
    requireValue(Number.isSafeInteger(size) && size >= 0 && size <= maxBytes, `Git blob exceeds ${maxBytes}-byte limit`);
    const bytes = execFileSync("git", ["--no-optional-locks", "-C", root, "cat-file", "blob", object], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: maxBytes + 65536 });
    requireValue(bytes.length === size, "Git blob size changed or was truncated");
    return bytes;
}
export function readCommittedRelease(root, publisherCommit, expected = {}) {
    requireValue(commit(publisherCommit), "Supply an immutable publisher commit SHA");
    const files = new Map(RELEASE_FILES.map(file => [file, readGitBlob(root, `${publisherCommit}:public/widget/${file}`)]));
    verifyDistribution(file => files.get(file), expected);
    return files;
}
export function utf8(bytes, name) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(`Invalid UTF-8 bytes: ${name}`); }
}
export const identityMarker = id => `/*! SYJ_WIDGET_BUILD_SHA256:${id} */\n`;
export function verifyBundleIdentity(bytes, id) {
    const text = utf8(bytes, "embed.iife.js");
    requireValue(text.startsWith(identityMarker(id)) && text.split("SYJ_WIDGET_BUILD_SHA256:").length === 2, "Missing, duplicate or mismatched bundle identity marker");
}
export function verifyLockedTools(manifest, lockBytes) {
    requireValue(digest(lockBytes) === manifest.source.lockSha256, "Verification lock digest mismatch");
    const lock = JSON.parse(utf8(lockBytes, "package-lock.json"));
    const packages = { vite: "vite", typescript: "typescript", reactPlugin: "@vitejs/plugin-react", react: "react", reactDom: "react-dom", esbuild: "esbuild", rollup: "rollup" };
    for (const [key, name] of Object.entries(packages)) requireValue(lock.packages?.[`node_modules/${name}`]?.version === manifest.toolchain[key], `Toolchain/lock version mismatch: ${key}`);
}
export function sourceIdentity(root = WIDGET_ROOT) {
    const files = sourceInputs(root);
    const head = git(root, "rev-parse", "HEAD").toString().trim();
    const dirty = git(root, "status", "--porcelain=v1", "--untracked-files=all").length > 0;
    const committedInputs = git(root, "ls-tree", "-r", "--name-only", head).toString().trim().split("\n").filter(isSourceInput);
    const currentPaths = new Set(files.map(file => file.path));
    let inputsMatchCommit = committedInputs.every(path => currentPaths.has(path));
    for (const file of files) {
        try { if (digest(git(root, "show", `${head}:${file.path}`)) !== file.sha256) inputsMatchCommit = false; }
        catch { inputsMatchCommit = false; }
    }
    return { commit: head, workingTreeDirty: dirty, inputsMatchCommit, sha256: fingerprintFiles(files), lockSha256: digest(readFileSync(join(root, "package-lock.json"))), files };
}
export function buildId(source, toolchain) { return digest(JSON.stringify({ source, toolchain })); }
export function validateManifest(value) {
    keys(value, ["schemaVersion", "buildId", "source", "toolchain", "artifacts"], "manifest");
    requireValue(value.schemaVersion === 2, "Unsupported manifest schemaVersion");
    keys(value.source, ["commit", "workingTreeDirty", "inputsMatchCommit", "sha256", "lockSha256", "files"], "source");
    const s = value.source;
    requireValue(commit(s.commit) && typeof s.workingTreeDirty === "boolean" && typeof s.inputsMatchCommit === "boolean" && sha(s.sha256) && sha(s.lockSha256), "Invalid source identity");
    requireValue(s.workingTreeDirty || s.inputsMatchCommit, "Clean tree cannot have changed inputs");
    requireValue(Array.isArray(s.files) && s.files.length > 0, "Missing source files");
    let previous = "";
    for (const file of s.files) {
        keys(file, ["path", "sha256"], "source file");
        requireValue(typeof file.path === "string" && /^(?:[\w.@-]+\/)*[\w.@-]+$/.test(file.path) && !file.path.split("/").includes("..") && file.path > previous && sha(file.sha256), "Invalid or unordered source file");
        previous = file.path;
    }
    requireValue(fingerprintFiles(s.files) === s.sha256 && s.files.find(f => f.path === "package-lock.json")?.sha256 === s.lockSha256, "Source/lock digest mismatch");
    keys(value.toolchain, ["node", "npm", "platform", "arch", "vite", "typescript", "reactPlugin", "react", "reactDom", "esbuild", "rollup"], "toolchain");
    for (const [key, val] of Object.entries(value.toolchain)) requireValue(key === "platform" || key === "arch" ? typeof val === "string" && /^[a-z0-9_-]+$/.test(val) : version(val), `Invalid toolchain ${key}`);
    requireValue(sha(value.buildId) && buildId(s, value.toolchain) === value.buildId, "Build identity mismatch");
    keys(value.artifacts, ARTIFACTS, "artifacts");
    for (const file of ARTIFACTS) {
        keys(value.artifacts[file], ["sha256", "bytes"], "artifact");
        requireValue(sha(value.artifacts[file].sha256) && Number.isSafeInteger(value.artifacts[file].bytes) && value.artifacts[file].bytes > 0, `Invalid artifact ${file}`);
    }
    return value;
}
export function validateArtifact(manifest, name, bytes) {
    requireValue(!/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(utf8(bytes, name)), `HTML received for ${name}`);
    requireValue(bytes.length === manifest.artifacts[name].bytes && digest(bytes) === manifest.artifacts[name].sha256, `Artifact hash/size mismatch: ${name}`);
}
export function verifyDistribution(read, { expectedCommit, expectedBuildId, lockBytes } = {}) {
    const manifest = validateManifest(JSON.parse(utf8(read(MANIFEST), MANIFEST)));
    if (expectedCommit) requireValue(manifest.source.commit === expectedCommit, "Widget source commit mismatch");
    if (expectedBuildId) requireValue(manifest.buildId === expectedBuildId, "Build ID mismatch");
    for (const file of ARTIFACTS) validateArtifact(manifest, file, read(file));
    verifyBundleIdentity(read("embed.iife.js"), manifest.buildId);
    if (lockBytes) verifyLockedTools(manifest, lockBytes);
    return manifest;
}
export function verifyLocal(dist, root = WIDGET_ROOT) {
    const manifest = verifyDistribution(file => readFileSync(join(dist, file)), { lockBytes: readFileSync(join(root, "package-lock.json")) });
    requireValue(JSON.stringify(manifest.source) === JSON.stringify(sourceIdentity(root)), "Stale build: current source/commit/dirty state differs from manifest");
    return manifest;
}
export async function fetchReleaseFile(url, file, fetchImpl = fetch) {
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/javascript, application/javascript" } });
    requireValue(response.ok && response.status === 200 && response.url === url && !response.redirected, `Unexpected HTTP status/final URL for ${file}`);
    const header = response.headers.get("content-type");
    // Deliberately narrow release policy: one MIME and exactly one UTF-8 charset.
    // Reject duplicate/conflicting/unknown/malformed parameters instead of guessing.
    const match = header?.match(/^\s*([\w.+-]+\/[\w.+-]+)\s*;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*$/i);
    const allowed = file.endsWith(".json") ? ["application/json"] : file.endsWith(".css") ? ["text/css"] : ["application/javascript", "text/javascript", "application/x-javascript"];
    requireValue(match && allowed.includes(match[1].toLowerCase()), `Expected supported MIME with exactly one charset=utf-8: ${file}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    requireValue(bytes.length <= MAX_RELEASE_BYTES, `HTTP artifact exceeds ${MAX_RELEASE_BYTES}-byte limit`);
    utf8(bytes, file);
    return bytes;
}
