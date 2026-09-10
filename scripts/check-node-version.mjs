#!/usr/bin/env node

const expectedMajor = 24;
const currentVersion = process.version;
const currentMajor = Number(process.versions.node.split(".")[0]);

if (currentMajor !== expectedMajor) {
    console.error(`Node preflight failed: booking-widget requires Node ${expectedMajor}.x, but this shell is using ${currentVersion}.`);
    console.error("Activate Node 24 first, then rerun the command. This repo declares the runtime in package.json engines and .nvmrc.");
    process.exit(1);
}

console.log(`Node preflight passed: ${currentVersion}`);
