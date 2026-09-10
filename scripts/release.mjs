/** Reports a reviewed local handoff. Publishing belongs to the backend developer. */
import { LOCAL_DIST, PUBLISHER_DIST, RELEASE_FILES } from "./dist-paths.mjs";
import { verifyLocal } from "./build-manifest.mjs";
try {
    if (process.argv.length > 2) throw new Error("Copying is no longer supported. The publisher owner must validate and integrate the complete release.");
    const manifest = verifyLocal(LOCAL_DIST);
    console.log(`Local release ready for review: ${manifest.buildId}\nSource commit: ${manifest.source.commit}\nDirty source: ${manifest.source.workingTreeDirty}; inputs match commit: ${manifest.source.inputsMatchCommit}\nLocal artifacts: ${LOCAL_DIST}\nPublisher working copy (not changed): ${PUBLISHER_DIST}\nHandoff files: ${RELEASE_FILES.join(", ")}\nPublishing instructions: PUBLISHING.md\nDeployment and live bytes: not verified`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
