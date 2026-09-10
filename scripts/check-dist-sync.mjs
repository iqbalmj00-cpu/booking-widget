/** Read-only evidence at explicitly selected boundaries. No local equality proves deployment. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LOCAL_DIST, PUBLISHER_DIST, RELEASE_FILES } from "./dist-paths.mjs";
import { fetchReleaseFile, readCommittedRelease, verifyDistribution, verifyLocal } from "./build-manifest.mjs";

try {
    const { values } = parseArgs({ options: {
        local: { type: "boolean" }, publisher: { type: "boolean" },
        "publisher-repo": { type: "string" }, "publisher-commit": { type: "string" },
        "expected-widget-commit": { type: "string" }, "expected-build-id": { type: "string" },
        "live-base": { type: "string" },
    } });
    const manifest = verifyLocal(LOCAL_DIST);
    const expected = { lockBytes: readFileSync(join(LOCAL_DIST, "../package-lock.json")), expectedCommit: values["expected-widget-commit"] || manifest.source.commit, expectedBuildId: values["expected-build-id"] || manifest.buildId };
    verifyDistribution(file => readFileSync(join(LOCAL_DIST, file)), expected);
    console.log(`SOURCE / LOCAL BUILD verified: ${manifest.buildId}; source commit ${manifest.source.commit}; dirty=${manifest.source.workingTreeDirty}; inputsMatchCommit=${manifest.source.inputsMatchCommit}`);
    if (values.publisher) {
        verifyDistribution(file => readFileSync(join(PUBLISHER_DIST, file)), expected);
        for (const file of RELEASE_FILES) if (!readFileSync(join(LOCAL_DIST, file)).equals(readFileSync(join(PUBLISHER_DIST, file)))) throw new Error(`Publisher working-copy bytes differ: ${file}`);
        console.log(`PUBLISHER WORKING COPY bytes verified: ${PUBLISHER_DIST}`);
    }
    let committed;
    if (values["publisher-commit"] || values["publisher-repo"]) {
        if (!values["publisher-repo"] || !/^[a-f0-9]{40}$/.test(values["publisher-commit"] || "")) throw new Error("Supply --publisher-repo and a full immutable --publisher-commit SHA");
        const root = resolve(values["publisher-repo"]);
        committed = readCommittedRelease(root, values["publisher-commit"], expected);
        verifyDistribution(file => committed.get(file), expected);
        for (const file of RELEASE_FILES) if (!readFileSync(join(LOCAL_DIST, file)).equals(committed.get(file))) throw new Error(`Publisher committed bytes differ: ${file}`);
        console.log(`PUBLISHER COMMITTED BLOBS verified: ${values["publisher-commit"]}`);
    }
    if (values["live-base"]) {
        if (!committed) throw new Error("Live verification requires the reviewed publisher committed blobs");
        const base = new URL(values["live-base"]);
        if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Use an HTTPS public/widget/ base URL without credentials/query/hash");
        if (!base.pathname.endsWith("/")) base.pathname += "/";
        const live = new Map();
        for (const file of RELEASE_FILES) live.set(file, await fetchReleaseFile(new URL(file, base).href, file));
        verifyDistribution(file => live.get(file), expected);
        for (const file of RELEASE_FILES) if (!live.get(file).equals(committed.get(file))) throw new Error(`Live bytes differ from publisher commit: ${file}`);
        console.log(`LIVE BYTES verified against publisher commit: ${base.href}`);
    }
    console.log("DEPLOYMENT MAPPING: not verified by this tool; obtain provider deployment ID, commit and aliases separately.");
    if (!values["live-base"]) console.log("LIVE BYTES: not checked.");
} catch (error) { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; }
