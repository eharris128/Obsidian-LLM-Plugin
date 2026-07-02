#!/usr/bin/env node
// Fails if any CSS file contains an `!important` declaration.
//
// Obsidian's community-plugin review flags `!important` because it stops
// themes and user snippets from overriding plugin styling. This repo's policy
// is zero `!important`: overrides win by specificity boost (repeating a class
// selector) instead. See docs/styling-important-policy.md for the reasoning.
//
// `!important` mentioned inside a /* comment */ (e.g. a note explaining why a
// specificity boost replaced it) is allowed — comments are stripped before the
// scan, so only real declarations fail.
import { readFileSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The plugin ships a single stylesheet; list more here if that changes.
const cssFiles = ["styles.css"];

// Replace every /* … */ block comment with blank space, preserving newlines so
// reported line numbers still match the source file.
function stripComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
		match.replace(/[^\n]/g, " "),
	);
}

let failed = false;

for (const file of cssFiles) {
	const path = resolve(root, file);
	let css;
	try {
		css = readFileSync(path, "utf8");
	} catch (e) {
		console.error(`Could not read ${file}: ${e.message}`);
		process.exit(1);
	}

	const lines = stripComments(css).split("\n");
	lines.forEach((line, i) => {
		// CSS is case-insensitive for `!important`; allow whitespace after `!`.
		if (/!\s*important/i.test(line)) {
			failed = true;
			console.error(`${relative(root, path)}:${i + 1}: ${line.trim()}`);
		}
	});
}

if (failed) {
	console.error(
		"\n✗ Found `!important` in CSS. Use a specificity boost (repeat the " +
			"class selector) instead — see docs/styling-important-policy.md.",
	);
	process.exit(1);
}

console.log(`No \`!important\` in CSS (${cssFiles.join(", ")}) — OK`);
