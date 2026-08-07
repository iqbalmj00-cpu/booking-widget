/**
 * release.mjs — Report what a release would publish, and optionally publish it.
 *
 *   npm run release        build already done; print checksums + next steps
 *   npm run release:copy   also copy the built files into the ScaleYourJunk repo
 *
 * The copy is opt-in on purpose. ScaleYourJunk is a separate repo owned by
 * someone else; this script should never write into it as a side effect of a
 * build. Even after copying, nothing changes for any operator until that repo
 * is committed and deployed — the bundle is served from there.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, DEPLOYED_DIST, LOCAL_DIST, sha256, shortHash } from "./dist-paths.mjs";

const doCopy = process.argv.includes("--copy");

if (!existsSync(LOCAL_DIST)) {
    console.error(`✗ No build at ${LOCAL_DIST}\n  Run: npm run build`);
    process.exit(1);
}

console.log(`Widget release\n`);
console.log(`  built:    ${LOCAL_DIST}`);
console.log(`  deployed: ${DEPLOYED_DIST}\n`);

if (doCopy) {
    // Never create the target. It used to mkdir -p, which meant a typo'd
    // SYJ_WIDGET_DIR or a ScaleYourJunk checkout in an unexpected place
    // fabricated a directory tree, copied into it, then compared the files
    // against the copies it had just made and reported a clean release. The
    // real repo goes untouched and everyone believes the fix shipped — which is
    // exactly the silent drift this tooling exists to catch.
    if (!existsSync(DEPLOYED_DIST)) {
        console.error(
            `✗ No such directory: ${DEPLOYED_DIST}\n` +
                `  That is not a ScaleYourJunk checkout. Set SYJ_WIDGET_DIR to the\n` +
                `  repo's public/widget directory, or check the repo out beside this one.`,
        );
        process.exit(1);
    }
    for (const file of ARTIFACTS) {
        const from = join(LOCAL_DIST, file);
        if (!existsSync(from)) {
            console.error(`✗ Missing build artifact: ${from}`);
            process.exit(1);
        }
        copyFileSync(from, join(DEPLOYED_DIST, file));
    }
    console.log(`  copied ${ARTIFACTS.length} files into the ScaleYourJunk repo\n`);
}

let drift = false;
for (const file of ARTIFACTS) {
    const local = sha256(join(LOCAL_DIST, file));
    const deployed = sha256(join(DEPLOYED_DIST, file));
    // sha256 returns null for a missing file, and null === null would report a
    // file that exists on neither side as a match. Same guard as check-dist-sync.
    const match = local !== null && local === deployed;
    if (!match) drift = true;
    console.log(
        `  ${file.padEnd(16)} built ${shortHash(local)}  deployed ${shortHash(deployed)}` +
            (match ? "  ✓" : "  ✗ drift"),
    );
}

console.log();
if (drift) {
    console.log(`Next: npm run release:copy`);
    console.log(`Then: commit public/widget/ in ScaleYourJunk and deploy it.`);
} else {
    console.log(`Files match. Still commit + deploy ScaleYourJunk for operators to receive this build.`);
}
