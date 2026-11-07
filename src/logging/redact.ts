export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /authorization|secret|password|api[-_]?key|token|cookie|credential/i;
const BASIC_HEADER = /Basic\s+[A-Za-z0-9+/=]{8,}/g;
const MAX_DEPTH = 8;

export type Redactor = (value: unknown) => unknown;

/**
 * Builds the one function every output path uses to remove credentials: log fields, error bodies, recorded test
 * requests. It replaces each secret wherever it appears in a string, drops values under sensitive key names, and
 * strips the signature from signed download links.
 */
export function createRedactor(secrets: readonly string[]): Redactor {
	const needles = [...new Set(secrets.filter((secret) => secret.length >= 4))].sort((a, b) => b.length - a.length);

	const redactString = (text: string): string => {
		let out = text.replace(BASIC_HEADER, `Basic ${REDACTED}`);
		for (const needle of needles) out = out.split(needle).join(REDACTED);
		return out;
	};

	const visit = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
		if (typeof value === "string") return redactString(value);
		if (value === null || typeof value !== "object") return value;
		if (seen.has(value)) return "[Circular]";
		if (depth >= MAX_DEPTH) return "[Truncated]";
		seen.add(value);
		if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1, seen));
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			let safe: unknown;
			if (SENSITIVE_KEY.test(key)) safe = REDACTED;
			else if (key === "downloadLink" && typeof inner === "string") safe = stripQuery(redactString(inner));
			else safe = visit(inner, depth + 1, seen);
			// defineProperty, so a key named "__proto__" stays data instead of replacing the prototype.
			Object.defineProperty(out, key, { value: safe, enumerable: true, writable: true, configurable: true });
		}
		return out;
	};

	return (value) => visit(value, 0, new WeakSet());
}

/** A signed URL's query string is the credential, so only its origin and path are safe to show. */
export function stripQuery(url: string): string {
	const index = url.search(/[?#]/);
	return index === -1 ? url : `${url.slice(0, index)}?${REDACTED}`;
}
