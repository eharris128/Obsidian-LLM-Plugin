#!/usr/bin/env node
// Fails if manifest.json is missing required fields or has an empty version.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "manifest.json");

let manifest;
try {
	manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
	console.error("manifest.json is missing or invalid JSON:", e.message);
	process.exit(1);
}

const required = ["id", "version", "name", "minAppVersion"];
const missing = required.filter((k) => !manifest[k]);

if (missing.length > 0) {
	console.error(`manifest.json is missing required fields: ${missing.join(", ")}`);
	process.exit(1);
}

console.log(`manifest.json OK (version: ${manifest.version})`);
