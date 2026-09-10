/** Exercises effective configuration paths with actual staged compiler/build processes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WIDGET_ROOT, LOCAL_DIST, RELEASE_FILES } from "../scripts/dist-paths.mjs";
import { git, verifyLocal } from "../scripts/build-manifest.mjs";
import { sourceInputs } from "../scripts/source-fingerprint.mjs";

const candidate = verifyLocal(LOCAL_DIST);
const base = mkdtempSync(join(tmpdir(), "widget-input-fixture-")); const root = join(base, "project"); mkdirSync(root);
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const original = new Map(sourceInputs().map(file => [file.path, readFileSync(join(WIDGET_ROOT, file.path))]));
try {
    for (const [path, bytes] of original) write(join(root, path), bytes);
    copyFileSync(join(WIDGET_ROOT, ".gitignore"), join(root, ".gitignore"));
    write(join(root, ".git"), `gitdir: ${git(WIDGET_ROOT, "rev-parse", "--absolute-git-dir").toString().trim()}\n`);
    const env = { ...process.env, NPM_CONFIG_USERCONFIG: join(base, "host-user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(base, "host-global.npmrc"), npm_config_registry: "http://127.0.0.1:9/", npm_config_omit: "dev", npm_execpath: join(base, "fake-npm.cjs") };
    for (const path of [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG, join(root, ".npmrc")]) write(path, "registry=http://127.0.0.1:9/\nomit=dev\n");
    write(env.npm_execpath, "throw new Error('unreviewed npm');");
    const run = () => execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { cwd: root, env, stdio: "pipe", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    const bytes = dir => new Map(RELEASE_FILES.map(file => [file, readFileSync(join(dir, file))]));
    const equal = (a, b) => { for (const file of RELEASE_FILES) assert.deepEqual(a.get(file), b.get(file), file); };
    // Exact review reproduction plus competing Vite/PostCSS config, ancestor config,
    // shrinkwrap precedence and project/user/global npm configuration poisoning.
    const postcss = "module.exports={plugins:[{postcssPlugin:'review-reproduction',Declaration(d){if(d.prop==='color')d.value='#010203';}}]};\n";
    write(join(root, "postcss.config.cjs"), postcss); write(join(base, "postcss.config.cjs"), postcss);
    write(join(base, "package.json"), JSON.stringify({ postcss: { plugins: { "missing-fixture-plugin": {} } } }));
    for (const ext of ["js", "mjs", "cjs", "mts", "cts"]) write(join(root, `vite.config.${ext}`), "throw new Error('alternative Vite config loaded');");
    for (const name of [".postcssrc", ".postcssrc.json", ".postcssrc.yaml", ".postcssrc.yml", ".postcssrc.ts", ".postcssrc.cts", ".postcssrc.mts", ".postcssrc.js", ".postcssrc.cjs", ".postcssrc.mjs", "postcss.config.ts", "postcss.config.cts", "postcss.config.mts", "postcss.config.js", "postcss.config.mjs"]) write(join(root, name), "invalid external config must not be read");
    write(join(root, "npm-shrinkwrap.json"), '{"lockfileVersion":3,"packages":{}}');
    run(); equal(bytes(join(root, "dist")), bytes(LOCAL_DIST));
    console.log("PASS actual PostCSS reproduction, all alternative config paths, ancestor discovery, shrinkwrap and poisoned npm settings excluded; all release bytes identical");
    for (const path of [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG]) assert.equal(readFileSync(path, "utf8"), "registry=http://127.0.0.1:9/\nomit=dev\n");

    const packagePath = join(root, "package.json"); const pkg = JSON.parse(readFileSync(packagePath)); pkg.postcss = { plugins: { "missing-fixture-plugin": {} } }; write(packagePath, JSON.stringify(pkg, null, 4) + "\n");
    run(); const packageManifest = JSON.parse(readFileSync(join(root, "dist/widget-build-manifest.json"))); assert.notEqual(packageManifest.buildId, candidate.buildId); assert.equal(packageManifest.artifacts["embed.css"].sha256, candidate.artifacts["embed.css"].sha256);
    write(packagePath, original.get("package.json")); console.log("PASS package PostCSS field is fingerprinted but discovery remains disabled");

    const outsideJs = join(base, "outside.mjs"), outsideTs = join(base, "outside.ts"), outsideCss = join(base, "outside.css"), outsideConfig = join(base, "outside-tsconfig.json");
    write(outsideJs, "export default 123;"); write(outsideTs, "export const externalFixture = 123;"); write(outsideCss, ".fixture{color:#010203}"); write(outsideConfig, '{"compilerOptions":{"target":"ES2022"}}');
    const oldDist = bytes(join(root, "dist"));
    const reject = (name, file, content, pattern) => {
        write(join(root, file), content);
        assert.throws(run, error => { assert.match(String(error.stdout) + String(error.stderr), pattern); return true; }, name);
        equal(bytes(join(root, "dist")), oldDist); write(join(root, file), original.get(file)); console.log(`PASS ${name}: rejected and prior release preserved`);
    };
    write(join(root, "unrecorded-helper.mjs"), "export default 123;");
    reject("config relative helper outside permitted roots", "vite.config.ts", 'import "./unrecorded-helper.mjs";\n' + original.get("vite.config.ts"), /ERR_MODULE_NOT_FOUND|Cannot find module/);
    reject("config absolute helper outside stage", "vite.config.ts", `import ${JSON.stringify(outsideJs)};\n` + original.get("vite.config.ts"), /ERR_ACCESS_DENIED|restricted|permissions/);
    reject("source absolute helper outside stage", "src/main.tsx", `import ${JSON.stringify(outsideTs)};\n` + original.get("src/main.tsx"), /ERR_ACCESS_DENIED|restricted|Cannot find module|failed to resolve import/);
    reject("CSS helper outside stage", "src/styles/widget.css", `@import ${JSON.stringify(outsideCss)};\n` + original.get("src/styles/widget.css"), /ERR_ACCESS_DENIED|restricted|ENOENT|Failed to resolve/);
    for (const kind of ["extends", "references"]) {
        const cfg = JSON.parse(original.get("tsconfig.json")); cfg[kind] = kind === "extends" ? outsideConfig : [{ path: outsideConfig }];
        reject(`tsconfig ${kind} outside stage`, "tsconfig.json", JSON.stringify(cfg), /ERR_ACCESS_DENIED|restricted|Cannot read|not found/);
    }
    const lock = JSON.parse(original.get("package-lock.json")); lock.packages["node_modules/unrecorded"] = { version: "1.0.0", resolved: "file:../external" };
    reject("local dependency outside registry lock", "package-lock.json", JSON.stringify(lock), /Only integrity-locked npm registry packages/);
    console.log("PASS permitted input boundary fixtures; original source/Git/npm settings unchanged");
} finally { rmSync(base, { recursive: true, force: true }); }
