import { Trading212Error, UnexpectedResponseError, ValidationError } from "./errors/errors";
import type { EndpointDefinition } from "./http/endpoint";
import type { CallOptions, Transport } from "./http/transport";

/** One page of a history list. */
export interface Page<T> {
	readonly items: T[];
	/** Pass as `cursor` to fetch the next page later, or `null` on the last page. */
	readonly nextCursor: string | null;
	readonly hasMore: boolean;
	/** Fetches the next page, or resolves to `null` on the last one. */
	next(options?: CallOptions): Promise<Page<T> | null>;
}

export interface PageOptions extends CallOptions {
	/** Items per page, 1 to 50. Default 20. */
	limit?: number;
	/** A `nextCursor` from an earlier page, to carry on from there. */
	cursor?: string;
}

export interface IterateOptions extends Omit<PageOptions, "limit"> {
	/** Items per request, 1 to 50. Default 50, the fewest requests. */
	pageSize?: number;
	/** Stop after this many pages. */
	maxPages?: number;
	/** Stop after this many items. */
	maxItems?: number;
}

interface WirePage<T> {
	items?: T[] | null;
	nextPagePath?: string | null;
}

const MAX_LIMIT = 50;

export function checkLimit(limit: number | undefined, field = "limit"): void {
	if (limit === undefined) return;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		throw new ValidationError(`${field} must be a whole number from 1 to ${MAX_LIMIT}.`, {
			issues: [{ field, message: `must be 1 to ${MAX_LIMIT}` }],
		});
	}
}

/**
 * Turns `nextPagePath` into a query string for the same endpoint, or `null` at the end. It accepts every form seen in
 * the wild (a full path, a bare query, `""`, `"null"`), and refuses anything that would point the client elsewhere,
 * because the next request carries your credentials.
 */
export function nextPageQuery(
	nextPagePath: string | null | undefined,
	endpoint: EndpointDefinition,
	origin: string,
): string | null {
	if (nextPagePath === null || nextPagePath === undefined) return null;
	const raw = nextPagePath.trim();
	if (raw === "" || raw === "null" || raw.startsWith("null&") || raw.startsWith("null?")) return null;
	// A full URL is parsed as one, so its origin is checked rather than slipping through as a query string.
	const absolute = raw.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(raw);
	const relative = absolute ? raw : `${endpoint.path}?${raw.replace(/^\?/, "")}`;
	let url: URL;
	try {
		url = new URL(relative, origin);
	} catch {
		throw unsafeNextPage(endpoint);
	}
	if (url.origin !== origin || url.pathname !== endpoint.path || raw.startsWith("//") || raw.includes("\\")) {
		throw unsafeNextPage(endpoint);
	}
	const query = url.search.replace(/^\?/, "");
	return query === "" ? null : query;
}

function unsafeNextPage(endpoint: EndpointDefinition): UnexpectedResponseError {
	return new UnexpectedResponseError(
		`Trading 212 returned a nextPagePath for ${endpoint.id} that points somewhere else; it was not followed.`,
		{ request: { method: endpoint.method, path: endpoint.path, endpoint: endpoint.id } },
	);
}

/** A cursor is a query string this library produced; refuse one that is anything else. */
function cursorQuery(cursor: string, endpoint: EndpointDefinition, origin: string): string {
	const query = nextPageQuery(cursor, endpoint, origin);
	if (query === null || cursor.startsWith("/")) {
		throw new ValidationError("cursor must be a nextCursor returned by an earlier page.", {
			issues: [{ field: "cursor", message: "is not a cursor this library produced" }],
		});
	}
	return query;
}

/** A history list: one page at a time, or every item with `for await`. */
export class PagedList<T, F extends object = object> {
	readonly #transport: Transport;
	readonly #endpoint: EndpointDefinition;

	constructor(transport: Transport, endpoint: EndpointDefinition) {
		this.#transport = transport;
		this.#endpoint = endpoint;
	}

	/** Fetches one page. */
	async list(options: PageOptions & F = {} as PageOptions & F): Promise<Page<T>> {
		const { limit, cursor, signal, timeoutMs, ...filters } = options;
		checkLimit(limit);
		const call: CallOptions = { ...(signal && { signal }), ...(timeoutMs !== undefined && { timeoutMs }) };
		if (cursor !== undefined) {
			return this.#fetch(cursorQuery(cursor, this.#endpoint, this.#transport.origin), call);
		}
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(filters)) {
			if (value instanceof Date) query.set(key, value.toISOString());
			else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
				query.set(key, String(value));
		}
		if (limit !== undefined) query.set("limit", String(limit));
		return this.#fetch(query.toString(), call);
	}

	async #fetch(rawQuery: string, call: CallOptions): Promise<Page<T>> {
		const { data } = await this.#transport.request<WirePage<T> | undefined>(this.#endpoint, { ...call, rawQuery });
		const items = Array.isArray(data?.items) ? data.items : [];
		const following = nextPageQuery(data?.nextPagePath, this.#endpoint, this.#transport.origin);
		return {
			items,
			nextCursor: following,
			hasMore: following !== null,
			next: (options = {}) => (following === null ? Promise.resolve(null) : this.#fetch(following, options)),
		};
	}

	/**
	 * Every item, newest first, fetching pages as the loop asks for them. If a request fails part-way, the error's
	 * `resumeCursor` says where to carry on.
	 */
	async *all(options: IterateOptions & F = {} as IterateOptions & F): AsyncGenerator<T, void, undefined> {
		const { pageSize = MAX_LIMIT, maxPages, maxItems, ...rest } = options;
		checkLimit(pageSize, "pageSize");
		let pages = 0;
		let yielded = 0;
		let cursor: string | undefined = rest.cursor;
		let page: Page<T> | null;
		try {
			page = await this.list({ ...rest, limit: pageSize } as PageOptions & F);
		} catch (error) {
			throw attachCursor(error, cursor);
		}
		while (page) {
			pages++;
			for (const item of page.items) {
				if (maxItems !== undefined && yielded >= maxItems) return;
				yield item;
				yielded++;
			}
			if (!page.hasMore || (maxPages !== undefined && pages >= maxPages)) return;
			cursor = page.nextCursor ?? undefined;
			try {
				page = await page.next({ ...(rest.signal && { signal: rest.signal }) });
			} catch (error) {
				throw attachCursor(error, cursor);
			}
		}
	}
}

function attachCursor(error: unknown, cursor: string | undefined): unknown {
	if (error instanceof Trading212Error && cursor !== undefined) error.resumeCursor = cursor;
	return error;
}
