/**
 * Narrowing helpers for `unknown` catch-clause values (strict
 * `useUnknownInCatchVariables`). Standalone module so any file can import
 * these without pulling in the provider SDKs that `utils/utils.ts` loads.
 */

/** Human-readable message for an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** HTTP status carried by provider SDK errors, if present. */
export function getErrorStatus(error: unknown): number | undefined {
	if (
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof (error as { status?: unknown }).status === "number"
	) {
		return (error as { status: number }).status;
	}
	return undefined;
}

/** `.name` of an unknown thrown value (AbortError / DOMException checks). */
export function getErrorName(error: unknown): string | undefined {
	if (error && typeof error === "object" && "name" in error) {
		const name = (error as { name?: unknown }).name;
		return typeof name === "string" ? name : undefined;
	}
	return undefined;
}
