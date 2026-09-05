/**
 * check-dist-sync.mjs — Fail unless operators are running this source.
 *
 * Two questions, both of which have to be yes:
 *
 *   1. Was dist/ built from the source on disk?   (source-fingerprint.mjs)
 *   2. Does the deployed copy match dist/?        (hashes, below)
 *
 * Only the second used to be asked, and it is not enough on its own: edit
 * src/, skip the rebuild, run release:copy from a stale dist/, and every
 * artifact matched — so the guard reported "✓ matches" for exactly the drift
 * it exists to catch. Question 2 alone answers "what are operators running",
 * never "is it what I wrote".
 *
 * Read-only. Exits 1 on either failure so this can be chained in front of
 * anything that assumes the live bundle matches this source tree.
 *
 * The build stamp vite.config.ts writes into every bundle is normalised out
 * before hashing — see dist-paths.mjs. Without that, every run reported drift
 * and the check was worthless.
 *
 *   npm run check:sync
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ARTIFACTS, DEPLOYED_DIST, LOCAL_DIST, buildStamps, sha256, shortHash } from "./dist-paths.mjs";
import { readRecordedFingerprint, sourceFingerprint } from "./source-fingerprint.mjs";

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

// The normaliser is anchored on the stamp's shape, not on the code around it.
// If a build ever stops containing exactly one, the comparison has quietly
// changed meaning and must be looked at rather than trusted.
const localStamps = buildStamps(join(LOCAL_DIST, "embed.iife.js"));
if (localStamps.length !== 1) {
    console.error(
        `✗ Expected exactly one build stamp in embed.iife.js, found ${localStamps.length}.\n` +
            `  BUILD_STAMP_RE in scripts/dist-paths.mjs no longer matches what\n` +
            `  vite.config.ts stamps, so this check cannot be trusted.`,
    );
    process.exit(1);
}

let drift = false;
console.log(`local:    ${LOCAL_DIST}`);
console.log(`          built ${localStamps[0]}`);
console.log(`deployed: ${DEPLOYED_DIST}`);
const deployedStamps = buildStamps(join(DEPLOYED_DIST, "embed.iife.js"));
console.log(`          built ${deployedStamps[0] ?? "unknown"}\n`);

// ── 1. Was dist/ built from the source that is on disk right now? ──────
// A build with no fingerprint cannot answer that, so it fails: "we don't
// know" and "it's fine" are not the same reading, and only one of them is
// safe to copy into another repo.
const recorded = readRecordedFingerprint();
const current = sourceFingerprint();
const stale = recorded !== current;
if (!stale) {
    console.log(`✓ ${"source".padEnd(16)} dist built from this tree  ${shortHash(current)}`);
} else if (recorded === null) {
    console.log(`✗ ${"source".padEnd(16)} no fingerprint recorded    working tree ${shortHash(current)}`);
} else {
    console.log(`✗ ${"source".padEnd(16)} built from ${shortHash(recorded)}  working tree ${shortHash(current)}`);
}

// ── 2. Is the deployed copy the bundle sitting in dist/? ───────────────
for (const file of ARTIFACTS) {
    const local = sha256(join(LOCAL_DIST, file));
    const deployed = sha256(join(DEPLOYED_DIST, file));
    const match = local !== null && local === deployed;
    if (!match) drift = true;
    console.log(
        `${match ? "✓" : "✗"} ${file.padEnd(16)} local ${shortHash(local)}  deployed ${shortHash(deployed)}`,
    );
}

if (stale) {
    console.error(
        `\n✗ dist/ was not built from the source in this working tree.\n` +
            (recorded === null
                ? `  It carries no fingerprint at all — it predates this check, or\n` +
                  `  something built it without recording one.\n`
                : `  Copying it would deploy code you are no longer looking at.\n`) +
            `  Run: npm run build`,
    );
}

if (drift) {
    console.error(
        `\n✗ The deployed widget does not match this build.\n` +
            `  Operators are running the deployed copy, not this one.\n` +
            `  Run: npm run release:copy   (then commit + deploy ScaleYourJunk)`,
    );
}

if (stale || drift) process.exit(1);

console.log(`\n✓ Deployed widget matches this build, and this build matches this source.`);
