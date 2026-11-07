/**
 * Where the client keeps the instrument and exchange lists. Implement it over a file, Redis or anything else to share
 * them between processes; values are plain JSON.
 */
export interface CacheStore {
	get(key: string): unknown;
	set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
	delete?(key: string): void | Promise<void>;
}

interface Entry {
	value: unknown;
	expiresAt: number;
}

/** The default store: a `Map` with expiry, private to one client. */
export class MemoryCache implements CacheStore {
	readonly #entries = new Map<string, Entry>();

	get(key: string): unknown {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		if (Date.now() >= entry.expiresAt) {
			this.#entries.delete(key);
			return undefined;
		}
		return entry.value;
	}

	set(key: string, value: unknown, ttlMs: number): void {
		this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
	}

	delete(key: string): void {
		this.#entries.delete(key);
	}

	clear(): void {
		this.#entries.clear();
	}
}

/** Loads a value through the cache, sharing one in-flight load between concurrent callers. */
export class CachedLoader {
	readonly #store: CacheStore;
	readonly #inFlight = new Map<string, Promise<unknown>>();

	constructor(store: CacheStore) {
		this.#store = store;
	}

	async load<T>(key: string, ttlMs: number, refresh: boolean, loader: () => Promise<T>): Promise<T> {
		if (!refresh) {
			const cached = await this.#store.get(key);
			if (cached !== undefined) return cached as T;
		}
		const pending = this.#inFlight.get(key);
		if (pending) return pending as Promise<T>;
		const promise = (async () => {
			try {
				const value = await loader();
				await this.#store.set(key, value, ttlMs);
				return value;
			} finally {
				this.#inFlight.delete(key);
			}
		})();
		this.#inFlight.set(key, promise);
		return promise;
	}
}
