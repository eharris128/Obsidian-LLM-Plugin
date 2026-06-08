// Dev-gated logger.
//
// esbuild replaces `__DEV__` with the literal `true` (dev / watch build) or
// `false` (production build) via the `define` block in esbuild.config.mjs.
// `debug` / `log` / `info` are silenced in production to keep the console
// clean — an Obsidian community-plugin review guideline. `warn` / `error`
// always emit so user-reported production issues stay diagnosable.
//
// Usage: `import { logger } from "<rel>/utils/logger";` then `logger.log(...)`.

declare const __DEV__: boolean;

const isDev = typeof __DEV__ !== "undefined" && __DEV__;
const PREFIX = "[LLM]";

class Logger {
	debug(...args: unknown[]): void {
		if (isDev) console.debug(PREFIX, ...args);
	}

	log(...args: unknown[]): void {
		if (isDev) console.log(PREFIX, ...args);
	}

	info(...args: unknown[]): void {
		if (isDev) console.info(PREFIX, ...args);
	}

	warn(...args: unknown[]): void {
		console.warn(PREFIX, ...args);
	}

	error(...args: unknown[]): void {
		console.error(PREFIX, ...args);
	}
}

export const logger = new Logger();
