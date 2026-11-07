/**
 * Where the client keeps the instrument and exchange lists. Implement it over a file, Redis or anything else to share
 * them between processes; each method may return a promise, and values are plain JSON.
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

/**
 * Loads a value through the cache, sharing one in-flight load between concurrent callers. A cache store that fails is
 * reported and bypassed, so a broken cache costs a download rather than the call.
 */
export class CachedLoader {
	readonly #store: CacheStore;
	readonly #onError: (error: unknown, key: string) => void;
	readonly #inFlight = new Map<string, Promise<unknown>>();

	constructor(store: CacheStore, onError: (error: unknown, key: string) => void = () => undefined) {
		this.#store = store;
		this.#onError = onError;
	}

	/**
	 * The shared load is started without any caller's signal, so one caller giving up never fails the others; each
	 * caller stops waiting when its own `signal` aborts.
	 */
	async load<T>(
		key: string,
		ttlMs: number,
		refresh: boolean,
		loader: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		if (signal?.aborted) throw signal.reason as Error;
		if (!refresh) {
			let cached: unknown;
			try {
				cached = await this.#store.get(key);
			} catch (error) {
				this.#onError(error, key);
			}
			if (cached !== undefined) return cached as T;
		}
		const pending = this.#inFlight.get(key);
		if (pending) return untilAborted(pending as Promise<T>, signal);
		const promise = (async () => {
			try {
				const value = await loader();
				try {
					await this.#store.set(key, value, ttlMs);
				} catch (error) {
					this.#onError(error, key);
				}
				return value;
			} finally {
				this.#inFlight.delete(key);
			}
		})();
		this.#inFlight.set(key, promise);
		return untilAborted(promise, signal);
	}
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(signal.reason as Error);
	let onAbort = (): void => undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => {
			reject(signal.reason as Error);
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
	return Promise.race([promise, aborted]).finally(() => {
		signal.removeEventListener("abort", onAbort);
	});
}
