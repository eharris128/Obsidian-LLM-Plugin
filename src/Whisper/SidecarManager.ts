/**
 * SidecarManager — manages the whisper-server.py lifecycle.
 *
 * Responsibilities:
 *  - Detect whether python3 is available on the system
 *  - Detect whether the required Python packages are installed
 *  - Install missing packages via pip3 (with streaming output)
 *  - Start / stop the whisper-server.py child process
 *  - Check whether the server is currently running via /health
 */

import { Platform, requestUrl } from "obsidian";
import type LLMPlugin from "main";

// ── Types ────────────────────────────────────────────────────────────────────

export type PythonStatus =
	| { found: false; version?: undefined }
	| { found: true;  version: string };

export type DepsStatus =
	| { installed: false; missing: string[] }
	| { installed: true;  missing: [] };

export type ServerStatus =
	| { running: false }
	| { running: true; model: string };

export type EnvStatus = {
	python:  PythonStatus;
	deps:    DepsStatus;
	server:  ServerStatus;
};

// ── Required pip packages ─────────────────────────────────────────────────────

const REQUIRED_PACKAGES = [
	"fastapi",
	"uvicorn",
	"faster_whisper",   // import name (underscore)
	"multipart",        // python-multipart's import name
] as const;

const INSTALL_PACKAGES = [
	"fastapi",
	"uvicorn",
	"faster-whisper",
	"python-multipart",
] as const;

// ── SidecarManager ────────────────────────────────────────────────────────────

export class SidecarManager {
	private serverProcess: import("child_process").ChildProcess | null = null;

	constructor(private plugin: LLMPlugin) {}

	// ── Detection ─────────────────────────────────────────────────────────

	/** Returns the full environment status in one call. */
	async getEnvStatus(): Promise<EnvStatus> {
		const [python, server] = await Promise.all([
			this.getPythonStatus(),
			this.getServerStatus(),
		]);
		const deps = python.found
			? await this.getDepsStatus(python.version)
			: { installed: false as const, missing: [...INSTALL_PACKAGES] as string[] };

		return { python, deps, server };
	}

	async getPythonStatus(): Promise<PythonStatus> {
		try {
			const out = await this.exec("python3 --version");
			// "Python 3.11.4" → "3.11.4"
			const version = out.trim().replace(/^Python\s+/i, "");
			return { found: true, version };
		} catch {
			return { found: false };
		}
	}

	async getDepsStatus(_pythonVersion?: string): Promise<DepsStatus> {
		// Ask python3 to import each package; collect failures.
		const checks = await Promise.all(
			REQUIRED_PACKAGES.map(async (pkg) => {
				try {
					await this.exec(`python3 -c "import ${pkg}"`);
					return null as string | null; // ok
				} catch {
					return pkg as string | null;
				}
			}),
		);
		const missing: string[] = checks.filter((x): x is string => x !== null);
		if (missing.length === 0) return { installed: true, missing: [] };

		// Map import names back to pip package names for display
		const pipNames: string[] = missing.map((m) =>
			m === "faster_whisper" ? "faster-whisper"
			: m === "multipart"    ? "python-multipart"
			: m,
		);
		return { installed: false, missing: pipNames };
	}

	async getServerStatus(): Promise<ServerStatus> {
		const host = this.plugin.settings.whisperSettings.sidecarHost;
		try {
			const res = await requestUrl({ url: `${host}/health`, method: "GET", throw: false });
			if (res.status === 200) {
				return { running: true, model: (res.json as any)?.model ?? "unknown" };
			}
			return { running: false };
		} catch {
			return { running: false };
		}
	}

	// ── Installation ──────────────────────────────────────────────────────

	/**
	 * Install required Python packages via pip3.
	 *
	 * @param onLine  Called with each line of pip output (for live progress display).
	 */
	async installDependencies(onLine: (line: string) => void): Promise<void> {
		if (!Platform.isDesktop) return;
		const { spawn } = require("child_process") as typeof import("child_process");

		return new Promise((resolve, reject) => {
			const proc = spawn(
				"pip3",
				["install", "--upgrade", ...INSTALL_PACKAGES],
				{ env: process.env },
			);

			const handleData = (data: Buffer) => {
				const text = data.toString();
				for (const line of text.split("\n")) {
					const trimmed = line.trim();
					if (trimmed) onLine(trimmed);
				}
			};

			proc.stdout?.on("data", handleData);
			proc.stderr?.on("data", handleData);

			proc.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`pip3 exited with code ${code}`));
			});

			proc.on("error", (err) => {
				reject(new Error(`pip3 not found. Make sure Python 3 is installed: ${err.message}`));
			});
		});
	}

	// ── Server lifecycle ──────────────────────────────────────────────────

	/**
	 * Start whisper-server.py as a background child process.
	 * Returns immediately — poll getServerStatus() to confirm it's ready.
	 */
	startServer(onLine?: (line: string) => void): void {
		if (this.serverProcess) return; // already running
		if (!Platform.isDesktop) return;

		const { spawn } = require("child_process") as typeof import("child_process");
		const path       = require("path")          as typeof import("path");

		// whisper-server.py sits in the plugin root directory
		const pluginDir   = (this.plugin.app.vault.adapter as any).basePath
			+ path.sep + this.plugin.manifest.dir;
		const scriptPath  = path.join(pluginDir, "whisper-server.py");
		const model       = this.plugin.settings.whisperSettings.whisperModel || "medium.en";

		this.serverProcess = spawn(
			"python3",
			[scriptPath, "--model", model],
			{ env: process.env, detached: false },
		);

		const handleData = (data: Buffer) => {
			const text = data.toString();
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed) onLine?.(trimmed);
			}
		};

		this.serverProcess.stdout?.on("data", handleData);
		this.serverProcess.stderr?.on("data", handleData);

		this.serverProcess.on("close", () => {
			this.serverProcess = null;
		});
	}

	/** Stop the whisper-server.py child process if we started it. */
	stopServer(): void {
		if (!this.serverProcess) return;
		this.serverProcess.kill("SIGTERM");
		this.serverProcess = null;
	}

	/** True if we own a running server process. */
	get isServerOwned(): boolean {
		return this.serverProcess !== null;
	}

	// ── Utilities ─────────────────────────────────────────────────────────

	/** Open python.org download page in the system browser. */
	openPythonDownloadPage(): void {
		const { shell } = require("electron") as any;
		shell.openExternal("https://www.python.org/downloads/");
	}

	/** Promisified exec (stdout on resolve, throws on non-zero exit). */
	private exec(cmd: string): Promise<string> {
		if (!Platform.isDesktop) return Promise.reject(new Error("exec is not available on mobile."));
		const { exec } = require("child_process") as typeof import("child_process");
		return new Promise((resolve, reject) => {
			exec(cmd, (err, stdout, stderr) => {
				if (err) reject(new Error(stderr || err.message));
				else resolve(stdout);
			});
		});
	}
}
