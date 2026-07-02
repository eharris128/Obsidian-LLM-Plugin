/**
 * SearxngService — thin wrapper around a self-hosted SearXNG instance.
 *
 * SearXNG exposes a simple JSON search API:
 *   GET <host>/search?q=<query>&format=json&categories=general
 *
 * No authentication is required for self-hosted instances. Obsidian's
 * `requestUrl` is used so the call works inside the Obsidian desktop
 * sandbox without CORS issues.
 */

import { requestUrl } from "obsidian";

export interface SearxngResult {
	title: string;
	url: string;
	content: string;
	/** Which underlying search engine returned this result (e.g. "google", "bing"). */
	engine?: string;
}

/** Error thrown when SearXNG returns a non-2xx HTTP status. */
export class SearxngHttpError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
		this.name = "SearxngHttpError";
	}
}

/**
 * Headers that make SearXNG (and the underlying search engines it proxies)
 * less likely to trigger bot-detection or rate limits.
 */
const REQUEST_HEADERS: Record<string, string> = {
	"Accept": "application/json, text/html;q=0.9, */*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
		"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

export class SearxngService {
	constructor(private host: string, private maxResults: number = 5) {}

	/**
	 * Search the web via SearXNG and return up to `numResults` results.
	 *
	 * Uses `throw: false` so HTTP errors (429, 5xx, …) are inspected and
	 * converted to descriptive `SearxngHttpError` instances rather than
	 * opaque network exceptions.
	 */
	async search(query: string, numResults?: number): Promise<SearxngResult[]> {
		const limit = Math.min(numResults ?? this.maxResults, 10);
		const base = this.host.replace(/\/$/, "");
		const url =
			`${base}/search?q=${encodeURIComponent(query)}` +
			`&format=json&categories=general&language=auto`;

		const response = await requestUrl({
			url,
			method: "GET",
			headers: REQUEST_HEADERS,
			throw: false,
		});

		if (response.status === 429) {
			throw new SearxngHttpError(
				429,
				"SearXNG returned 429 Too Many Requests. The underlying search engines " +
				"(Google, Bing, etc.) are rate-limiting this SearXNG instance. " +
				"Wait a minute and try again, or configure additional engines in your " +
				"SearXNG settings to spread the load."
			);
		}

		if (response.status < 200 || response.status >= 300) {
			throw new SearxngHttpError(
				response.status,
				`SearXNG returned HTTP ${response.status}. ` +
				"Check that the host is reachable and the instance is running."
			);
		}

		type RawSearxResult = { title?: unknown; url?: unknown; content?: unknown; engine?: unknown };
		let data: { results?: RawSearxResult[] };
		try {
			data = response.json as { results?: RawSearxResult[] };
		} catch {
			throw new Error(
				"SearXNG returned a non-JSON response. " +
				"Ensure the instance is configured with format=json support."
			);
		}

		const asString = (v: unknown): string => (typeof v === "string" ? v : "");
		return (data.results ?? []).slice(0, limit).map((r) => ({
			title:   asString(r.title),
			url:     asString(r.url),
			content: asString(r.content),
			engine:  typeof r.engine === "string" ? r.engine : undefined,
		}));
	}

	/**
	 * Probe the SearXNG instance and return true if it is reachable.
	 * First tries `/healthz`; falls back to a minimal search request.
	 */
	async checkHealth(): Promise<boolean> {
		const base = this.host.replace(/\/$/, "");
		try {
			const res = await requestUrl({
				url: `${base}/healthz`,
				method: "GET",
				headers: REQUEST_HEADERS,
				throw: false,
			});
			if (res.status >= 200 && res.status < 300) return true;
			// /healthz may not exist on older SearXNG builds — fall through to search probe
		} catch { /* network error — fall through */ }

		try {
			const res = await requestUrl({
				url: `${base}/search?q=test&format=json`,
				method: "GET",
				headers: REQUEST_HEADERS,
				throw: false,
			});
			// Any HTTP response (including 429) means the host is up
			return res.status < 500;
		} catch {
			return false;
		}
	}

	/**
	 * Format an array of results into a markdown block suitable for injection
	 * into the model's context.
	 *
	 * Titles are rendered as markdown hyperlinks so the model naturally
	 * reproduces clickable citations in its response.
	 */
	static formatResults(results: SearxngResult[]): string {
		if (results.length === 0) return "No results found.";
		return results
			.map((r, i) => {
				const lines = [`**${i + 1}. [${r.title || r.url}](${r.url})**`];
				if (r.content) lines.push(r.content);
				return lines.join("\n");
			})
			.join("\n\n");
	}
}
