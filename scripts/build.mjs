/** Staged, local-only build. No project/user npm config, hooks or publisher copying. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACTS, LOCAL_DIST, MANIFEST, WIDGET_ROOT } from "./dist-paths.mjs";
import { buildId, identityMarker, sourceIdentity, validateManifest, verifyDistribution, verifyLockedTools } from "./build-manifest.mjs";
import { digest, sourceInputs } from "./source-fingerprint.mjs";
import { compilerPermissions, isolatedEnvironment, stageInputs } from "./build-environment.mjs";

export function controlledBuild() {
    if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node 24 (see .nvmrc) before building");
    // Bind npm to this Node installation, not an arbitrary npm_execpath from the caller.
    const npmCli = resolve(dirname(realpathSync(process.execPath)), "../lib/node_modules/npm/bin/npm-cli.js");
    if (!existsSync(npmCli)) throw new Error("Use the pinned Node distribution with its bundled npm");
    const before = sourceIdentity();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "syj-widget-build-")));
    const work = join(base, "work"); const output = join(base, "output");
    let publishTemp;
    try {
        stageInputs(WIDGET_ROOT, work, before.files);
        const env = isolatedEnvironment(base);
        const run = (script, args, { compiler = false, extraEnv = {}, capture = false } = {}) => execFileSync(process.execPath,
            [...(compiler ? compilerPermissions(base, work, output) : []), script, ...args],
            { cwd: work, env: { ...env, ...extraEnv }, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", maxBuffer: 32 * 1024 * 1024 });
        const npm = run(npmCli, ["--version"], { capture: true }).toString().trim();
        if (npm !== JSON.parse(readFileSync(join(work, "package.json"))).packageManager.replace("npm@", "")) throw new Error("Use the npm version pinned in packageManager");
        const lockBytes = readFileSync(join(work, "package-lock.json"));
        const lock = JSON.parse(lockBytes);
        // No local/git/link dependency can pull additional bytes from outside the staged inputs.
        for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
            if (!path) continue;
            if (pkg.link || !pkg.integrity || !/^https:\/\/registry\.npmjs\.org\//.test(pkg.resolved || "")) throw new Error(`Only integrity-locked npm registry packages are permitted: ${path}`);
        }
        run(npmCli, ["ci", "--include=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"]);
        run(npmCli, ["ls", "--all", "--omit=optional"], { capture: true });
        const v = name => JSON.parse(readFileSync(join(work, "node_modules", name, "package.json"))).version;
        const toolchain = { node: process.versions.node, npm, platform: process.platform, arch: process.arch, vite: v("vite"), typescript: v("typescript"), reactPlugin: v("@vitejs/plugin-react"), react: v("react"), reactDom: v("react-dom"), esbuild: v("esbuild"), rollup: v("rollup") };
        verifyLockedTools({ source: before, toolchain }, lockBytes);
        const id = buildId(before, toolchain);
        mkdirSync(output);
        run(join(work, "node_modules/typescript/bin/tsc"), ["--noEmit", "--project", join(work, "tsconfig.json")], { compiler: true });
        // Native config loading keeps configuration imports inside Node's file-read boundary;
        // the default esbuild config bundler would read imports in a native subprocess.
        run(join(work, "node_modules/vite/bin/vite.js"), ["build", "--config", join(work, "vite.config.ts"), "--configLoader", "native", "--outDir", output, "--emptyOutDir"], { compiler: true, extraEnv: { SYJ_WIDGET_BUILD_ID: id } });
        if (JSON.stringify(before.files) !== JSON.stringify(sourceInputs(work))) throw new Error("Staged inputs changed during build");
        if (JSON.stringify(before) !== JSON.stringify(sourceIdentity())) throw new Error("Working source changed during build; no manifest published");
        const js = join(output, "embed.iife.js");
        writeFileSync(js, Buffer.concat([Buffer.from(identityMarker(id)), readFileSync(js)]));
        const artifacts = Object.fromEntries(ARTIFACTS.map(file => {
            const bytes = readFileSync(join(output, file)); return [file, { sha256: digest(bytes), bytes: bytes.length }];
        }));
        const manifest = validateManifest({ schemaVersion: 2, buildId: id, source: before, toolchain, artifacts });
        writeFileSync(join(output, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
        verifyDistribution(file => readFileSync(join(output, file)), { lockBytes });
        // Stage publication on the destination volume. Ordinary caught rename failures
        // restore the previous dist; this is not a crash-atomic/concurrent-build claim.
        publishTemp = mkdtempSync(join(WIDGET_ROOT, ".widget-build-"));
        const incoming = join(publishTemp, "incoming"); cpSync(output, incoming, { recursive: true });
        const previous = join(publishTemp, "previous");
        if (existsSync(LOCAL_DIST)) renameSync(LOCAL_DIST, previous);
        try { renameSync(incoming, LOCAL_DIST); }
        catch (error) { if (existsSync(previous)) renameSync(previous, LOCAL_DIST); throw error; }
        console.log(`Controlled staged build ${id}\nArtifacts and manifest: ${LOCAL_DIST}\nPublisher and deployment state: not checked`);
        return manifest;
    } finally {
        if (publishTemp) rmSync(publishTemp, { recursive: true, force: true });
        rmSync(base, { recursive: true, force: true });
    }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    try { controlledBuild(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
