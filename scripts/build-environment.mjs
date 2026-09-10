/** Fixed input and npm boundary used by the controlled builder and its tests. */
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { digest } from "./source-fingerprint.mjs";

export function stageInputs(root, work, files) {
    mkdirSync(work, { recursive: true });
    for (const file of files) {
        const bytes = readFileSync(join(root, file.path));
        if (digest(bytes) !== file.sha256) throw new Error(`Input changed while staging: ${file.path}`);
        const to = join(work, file.path);
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, bytes, { mode: 0o444 });
    }
}
export function isolatedEnvironment(base) {
    const home = join(base, "home"); const temp = join(base, "tmp");
    mkdirSync(home); mkdirSync(temp);
    const userconfig = join(base, "user.npmrc"); const globalconfig = join(base, "global.npmrc");
    writeFileSync(userconfig, ""); writeFileSync(globalconfig, "");
    return {
        PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
        ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, TMPDIR: temp, TMP: temp, TEMP: temp,
        LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "production",
        NPM_CONFIG_USERCONFIG: userconfig, NPM_CONFIG_GLOBALCONFIG: globalconfig,
        NPM_CONFIG_CACHE: join(base, "npm-cache"), NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
        NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false",
    };
}
export function compilerPermissions(base, work, output) {
    // This guards ordinary config/TS/CSS/module file reads, including absolute imports.
    // Native tools are trusted; Node permissions are not a hostile-code sandbox.
    const runtime = resolve(dirname(realpathSync(process.execPath)), "..");
    return ["--permission", `--allow-fs-read=${base}`, `--allow-fs-read=${runtime}`,
        `--allow-fs-write=${output}`, `--allow-fs-write=${join(work, "node_modules")}`,
        `--allow-fs-write=${join(base, "tmp")}`, "--allow-child-process", "--allow-addons"];
}
