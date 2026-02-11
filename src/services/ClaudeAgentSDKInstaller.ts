import { Notice } from "obsidian";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk@0.2.37";
const INSTALL_TIMEOUT_MS = 120_000;

function resolveNpmPath(): string {
	const fs = require("fs");
	const homedir = require("os").homedir();
	const isWin = process.platform === "win32";
	const bin = isWin ? "npm.cmd" : "npm";
	const candidates: string[] = [];

	// nvm — pick the latest installed version
	if (!isWin) {
		const nvmDir = `${homedir}/.nvm/versions/node`;
		try {
			if (fs.existsSync(nvmDir)) {
				const versions = fs.readdirSync(nvmDir).sort().reverse();
				if (versions.length > 0) {
					candidates.push(`${nvmDir}/${versions[0]}/bin/npm`);
				}
			}
		} catch { /* ignore */ }
	}

	if (isWin) {
		const appData = process.env.APPDATA || `${homedir}\\AppData\\Roaming`;
		candidates.push(
			`${appData}\\nvm\\npm.cmd`,
			`${homedir}\\.volta\\bin\\npm.cmd`,
			"C:\\Program Files\\nodejs\\npm.cmd",
		);
	} else {
		candidates.push(
			`${homedir}/.volta/bin/npm`,
			`${homedir}/.local/share/fnm/aliases/default/bin/npm`,
			`${homedir}/.asdf/shims/npm`,
			`${homedir}/.local/bin/npm`,
			"/usr/local/bin/npm",
			"/usr/bin/npm",
			"/snap/bin/npm",
		);
	}

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		} catch { /* ignore */ }
	}

	return bin;
}

function isSDKInstalled(pluginDir: string): boolean {
	const path = require("path");
	const fs = require("fs");
	const cliPath = path.join(
		pluginDir,
		"node_modules",
		"@anthropic-ai",
		"claude-agent-sdk",
		"cli.js"
	);
	return fs.existsSync(cliPath);
}

let installPromise: Promise<void> | null = null;

export async function ensureSDKInstalled(pluginDir: string): Promise<void> {
	if (isSDKInstalled(pluginDir)) return;

	// Guard against concurrent installs
	if (installPromise) return installPromise;

	installPromise = doInstall(pluginDir);
	try {
		await installPromise;
	} finally {
		installPromise = null;
	}
}

function ensurePackageJson(pluginDir: string): void {
	const path = require("path");
	const fs = require("fs");
	const pkgPath = path.join(pluginDir, "package.json");
	if (!fs.existsSync(pkgPath)) {
		// Anchor npm to this directory so it doesn't walk up the tree
		fs.writeFileSync(pkgPath, '{"private":true}\n');
	}
}

function doInstall(pluginDir: string): Promise<void> {
	const path = require("path");
	const { spawn } = require("child_process");
	const npmPath = resolveNpmPath();

	// Derive the node binary from the same bin/ directory as npm.
	// This avoids the #!/usr/bin/env node shebang issue in Electron entirely —
	// we spawn node directly and pass the npm script as an argument.
	const isWin = process.platform === "win32";
	const nodeBin = isWin ? "node.exe" : "node";
	const nodePath = path.join(path.dirname(npmPath), nodeBin);

	// Release builds don't ship package.json — without one npm walks up the
	// directory tree and installs into a parent node_modules instead.
	ensurePackageJson(pluginDir);

	return new Promise<void>((resolve, reject) => {
		const notice = new Notice(
			"Installing Claude Code runtime (~69 MB). This is a one-time setup...",
			0 // persistent until hidden
		);

		const args = [
			npmPath,
			"install",
			SDK_PACKAGE,
			"--no-save",
			"--no-package-lock",
			"--no-optional",
		];

		const child = spawn(nodePath, args, {
			cwd: pluginDir,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const timeout = setTimeout(() => {
			child.kill();
			notice.hide();
			reject(new Error("SDK installation failed: timed out after 2 minutes"));
		}, INSTALL_TIMEOUT_MS);

		child.on("error", (err: Error) => {
			clearTimeout(timeout);
			notice.hide();
			reject(new Error("SDK installation failed: " + err.message));
		});

		child.on("close", (code: number) => {
			clearTimeout(timeout);
			notice.hide();

			if (code !== 0) {
				reject(new Error("SDK installation failed: npm exited with code " + code));
				return;
			}

			if (!isSDKInstalled(pluginDir)) {
				reject(new Error("SDK installation failed: cli.js not found after install"));
				return;
			}

			new Notice("Claude Code runtime installed successfully!");
			resolve();
		});
	});
}
