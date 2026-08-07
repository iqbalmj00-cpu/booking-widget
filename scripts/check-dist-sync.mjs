/**
 * check-dist-sync.mjs — Fail if the built widget differs from the deployed copy.
 *
 * Read-only. Exits 1 on drift so this can be chained in front of anything that
 * assumes the live bundle matches this source tree.
 *
 *   npm run check:sync
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ARTIFACTS, DEPLOYED_DIST, LOCAL_DIST, sha256, shortHash } from "./dist-paths.mjs";

if (!existsSync(LOCAL_DIST)) {
    console.error(`✗ No local build at ${LOCAL_DIST}\n  Run: npm run build`);
    process.exit(1);
}

if (!existsSync(DEPLOYED_DIST)) {
    console.error(
        `✗ Deployed copy not found at ${DEPLOYED_DIST}\n` +
            `  Set SYJ_WIDGET_DIR if the ScaleYourJunk repo lives elsewhere.`,
    );
    process.exit(1);
}

let drift = false;
console.log(`local:    ${LOCAL_DIST}`);
console.log(`deployed: ${DEPLOYED_DIST}\n`);

for (const file of ARTIFACTS) {
    const local = sha256(join(LOCAL_DIST, file));
    const deployed = sha256(join(DEPLOYED_DIST, file));
    const match = local !== null && local === deployed;
    if (!match) drift = true;
    console.log(
        `${match ? "✓" : "✗"} ${file.padEnd(16)} local ${shortHash(local)}  deployed ${shortHash(deployed)}`,
    );
}

if (drift) {
    console.error(
        `\n✗ The deployed widget does not match this build.\n` +
            `  Operators are running the deployed copy, not this one.\n` +
            `  Run: npm run release:copy   (then commit + deploy ScaleYourJunk)`,
    );
    process.exit(1);
}

console.log(`\n✓ Deployed widget matches this build.`);
