import { Notice, Platform } from "obsidian";

const SDK_VERSION = "0.3.170";
const SDK_PACKAGE = `@anthropic-ai/claude-agent-sdk@${SDK_VERSION}`;
const INSTALL_TIMEOUT_MS = 120_000;

function getPlatformPackage(): string {
	const platform = process.platform; // darwin, linux, win32
	const arch = process.arch;         // arm64, x64
	let suffix: string;
	if (platform === "darwin" && arch === "arm64") suffix = "darwin-arm64";
	else if (platform === "darwin") suffix = "darwin-x64";
	else if (platform === "linux" && arch === "arm64") suffix = "linux-arm64";
	else if (platform === "linux") suffix = "linux-x64";
	else if (platform === "win32" && arch === "arm64") suffix = "win32-arm64";
	else suffix = "win32-x64";
	return `@anthropic-ai/claude-agent-sdk-${suffix}@${SDK_VERSION}`;
}

export function getNativeBinaryPath(pluginDir: string): string {
	const path = require("path");
	const platform = process.platform;
	const arch = process.arch;
	let suffix: string;
	if (platform === "darwin" && arch === "arm64") suffix = "darwin-arm64";
	else if (platform === "darwin") suffix = "darwin-x64";
	else if (platform === "linux" && arch === "arm64") suffix = "linux-arm64";
	else if (platform === "linux") suffix = "linux-x64";
	else if (platform === "win32" && arch === "arm64") suffix = "win32-arm64";
	else suffix = "win32-x64";
	const binaryName = platform === "win32" ? "claude.exe" : "claude";
	return path.join(pluginDir, "node_modules", "@anthropic-ai", `claude-agent-sdk-${suffix}`, binaryName);
}

function resolveNpmPath(): string {
	if (!Platform.isDesktop) return "npm";
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

export function isSDKInstalled(pluginDir: string): boolean {
	if (!Platform.isDesktop) return false;
	const fs = require("fs");
	return fs.existsSync(getNativeBinaryPath(pluginDir));
}

let installPromise: Promise<void> | null = null;

export async function ensureSDKInstalled(pluginDir: string): Promise<void> {
	if (!Platform.isDesktop) return;
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
	if (!Platform.isDesktop) return;
	const path = require("path");
	const fs = require("fs");
	const pkgPath = path.join(pluginDir, "package.json");
	if (!fs.existsSync(pkgPath)) {
		// Anchor npm to this directory so it doesn't walk up the tree
		fs.writeFileSync(pkgPath, '{"private":true}\n');
	}
}

function resolveNodePath(): string {
	if (!Platform.isDesktop) return "node";
	const fs = require("fs");
	const homedir = require("os").homedir();
	const isWin = process.platform === "win32";
	const candidates: string[] = [];

	// nvm — pick the latest installed version
	if (!isWin) {
		const nvmDir = `${homedir}/.nvm/versions/node`;
		try {
			if (fs.existsSync(nvmDir)) {
				const versions = fs.readdirSync(nvmDir).sort().reverse();
				if (versions.length > 0) {
					candidates.push(`${nvmDir}/${versions[0]}/bin/node`);
				}
			}
		} catch { /* ignore */ }
	}

	if (isWin) {
		const appData = process.env.APPDATA || `${homedir}\\AppData\\Roaming`;
		candidates.push(
			`${appData}\\nvm\\node.exe`,
			`${homedir}\\.volta\\bin\\node.exe`,
			"C:\\Program Files\\nodejs\\node.exe",
		);
	} else {
		candidates.push(
			`${homedir}/.volta/bin/node`,
			`${homedir}/.local/share/fnm/aliases/default/bin/node`,
			`${homedir}/.asdf/shims/node`,
			`${homedir}/.local/bin/node`,
			"/usr/local/bin/node",
			"/usr/bin/node",
			"/snap/bin/node",
		);
	}

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch { /* ignore */ }
	}

	return isWin ? "node.exe" : "node";
}

function doInstall(pluginDir: string): Promise<void> {
	if (!Platform.isDesktop) return Promise.resolve();
	const path = require("path");
	const { spawn } = require("child_process");
	const npmPath = resolveNpmPath();

	// Derive the node binary from the same bin/ directory as npm.
	// This avoids the #!/usr/bin/env node shebang issue in Electron entirely —
	// we spawn node directly and pass the npm script as an argument.
	// If npmPath is a full path, co-locate node; otherwise fall back to resolveNodePath.
	const isWin = process.platform === "win32";
	const nodeBin = isWin ? "node.exe" : "node";
	const npmDir = path.dirname(npmPath);
	const colocatedNode = path.join(npmDir, nodeBin);
	const fs = require("fs");
	const nodePath = (npmDir !== "." && fs.existsSync(colocatedNode))
		? colocatedNode
		: resolveNodePath();

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
			getPlatformPackage(),
			"--no-save",
			"--no-package-lock",
		];

		const child = spawn(nodePath, args, {
			cwd: pluginDir,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const timeout = window.setTimeout(() => {
			child.kill();
			notice.hide();
			reject(new Error("SDK installation failed: timed out after 2 minutes"));
		}, INSTALL_TIMEOUT_MS);

		child.on("error", (err: Error) => {
			window.clearTimeout(timeout);
			notice.hide();
			reject(new Error("SDK installation failed: " + err.message));
		});

		child.on("close", (code: number) => {
			window.clearTimeout(timeout);
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
