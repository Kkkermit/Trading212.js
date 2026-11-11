import { type ErrorCode, isTrading212Error } from "./errors/errors";
import { sleep } from "./internal/sleep";
import type { Logger } from "./logging/logger";

/** A check that failed. When `willRetry` is false the error needs you, such as a missing scope, and the watcher stops. */
export interface WatchErrorEvent {
	readonly type: "error";
	readonly error: Error;
	readonly willRetry: boolean;
}

export type WatchListener<E> = (event: E) => void | Promise<void>;

/** The events of one type, narrowed so a listener for `"filled"` receives an event whose type is `"filled"`. */
type EventOf<E extends { readonly type: string }, T extends string> = E extends unknown
	? T extends E["type"]
		? E & { readonly type: T }
		: never
	: never;

/** One check: what changed since the last one. */
export type WatchPoll<E> = (signal: AbortSignal) => Promise<readonly E[]>;

export interface WatcherOptions {
	readonly intervalMs: number;
	readonly signal: AbortSignal | undefined;
	readonly logger: Logger;
}

// Errors that will fail the same way on every check until someone changes the key or the code.
const NEEDS_YOU: ReadonlySet<ErrorCode> = new Set([
	"configuration",
	"authentication",
	"missing_scope",
	"not_available_in_demo",
	"permission",
	"validation",
]);

const willPass = (error: unknown): boolean => isTrading212Error(error) && !NEEDS_YOU.has(error.code);

class EventQueue<T> {
	readonly #items: T[] = [];
	#waiting: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void } | undefined;
	#ended = false;
	#failure: { error: unknown } | undefined;

	push(item: T): void {
		if (this.#ended) return;
		const waiting = this.#waiting;
		this.#waiting = undefined;
		if (waiting) waiting.resolve({ value: item, done: false });
		else this.#items.push(item);
	}

	end(failure?: { error: unknown }): void {
		if (this.#ended) return;
		this.#ended = true;
		this.#failure = failure;
		const waiting = this.#waiting;
		this.#waiting = undefined;
		if (waiting) this.#settle(waiting.resolve, waiting.reject);
	}

	next(): Promise<IteratorResult<T>> {
		const item = this.#items.shift();
		if (item !== undefined) return Promise.resolve({ value: item, done: false });
		if (this.#ended) {
			return new Promise((resolve, reject) => {
				this.#settle(resolve, reject);
			});
		}
		return new Promise((resolve, reject) => {
			this.#waiting = { resolve, reject };
		});
	}

	#settle(resolve: (result: IteratorResult<T>) => void, reject: (error: unknown) => void): void {
		const failure = this.#failure;
		this.#failure = undefined;
		if (failure) reject(failure.error);
		else resolve({ value: undefined, done: true });
	}
}

/**
 * Checks the account every `intervalMs` and reports what changed, to callbacks registered with `on()` and to any
 * `for await` loop over it. It runs until `stop()`, the signal aborts, a loop over it ends, or an error that needs
 * you, such as a missing scope; other errors are reported and the next check goes ahead as usual.
 */
export class Watcher<E extends { readonly type: string }> implements AsyncIterable<E | WatchErrorEvent> {
	readonly #listeners = new Map<string, Set<WatchListener<never>>>();
	readonly #queues = new Set<EventQueue<E | WatchErrorEvent>>();
	readonly #controller = new AbortController();
	readonly #logger: Logger;
	readonly #signal: AbortSignal | undefined;
	#failure: { error: unknown } | undefined;

	constructor(poll: WatchPoll<E>, options: WatcherOptions) {
		this.#logger = options.logger;
		this.#signal = options.signal;
		if (this.#signal?.aborted) this.stop();
		else this.#signal?.addEventListener("abort", this.#onAbort, { once: true });
		void this.#run(poll, options.intervalMs);
	}

	/** True once the watcher has stopped checking. */
	get stopped(): boolean {
		return this.#controller.signal.aborted;
	}

	/**
	 * Calls `listener` for each event of one type, such as `"filled"`, and returns a function that removes it. A
	 * listener that throws is logged and the watcher carries on.
	 */
	on<T extends (E | WatchErrorEvent)["type"]>(
		type: T,
		listener: WatchListener<EventOf<E | WatchErrorEvent, T>>,
	): () => void {
		const listeners = this.#listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
		return () => {
			listeners.delete(listener);
		};
	}

	/** Stops checking. Loops over the watcher finish, and no listener is called again. */
	stop(): void {
		if (this.stopped) return;
		this.#controller.abort();
		this.#signal?.removeEventListener("abort", this.#onAbort);
		this.#listeners.clear();
		for (const queue of this.#queues) queue.end(this.#failure);
		this.#queues.clear();
	}

	/** Every event, errors the watcher will retry included. An error that stops it is thrown, and leaving the loop stops it. */
	[Symbol.asyncIterator](): AsyncIterator<E | WatchErrorEvent> {
		const queue = new EventQueue<E | WatchErrorEvent>();
		if (this.stopped) queue.end(this.#failure);
		else this.#queues.add(queue);
		return {
			next: () => queue.next(),
			return: () => {
				this.#queues.delete(queue);
				this.stop();
				return Promise.resolve({ value: undefined, done: true });
			},
		};
	}

	readonly #onAbort = (): void => {
		this.stop();
	};

	async #run(poll: WatchPoll<E>, intervalMs: number): Promise<void> {
		const { signal } = this.#controller;
		for (;;) {
			if (this.stopped) return;
			try {
				for (const event of await poll(signal)) this.#emit(event, true);
			} catch (error) {
				if (signal.aborted) return;
				const failure = error instanceof Error ? error : new Error(String(error));
				const willRetry = willPass(error);
				this.#emit({ type: "error", error: failure, willRetry }, willRetry);
				if (!willRetry) {
					this.#logger.warn(`The watcher stopped: ${failure.message}`, { code: (error as { code?: unknown }).code });
					this.#failure = { error: failure };
					this.stop();
					return;
				}
			}
			try {
				await sleep(intervalMs, signal);
			} catch {
				return;
			}
		}
	}

	#emit(event: E | WatchErrorEvent, toLoops: boolean): void {
		if (toLoops) for (const queue of this.#queues) queue.push(event);
		for (const listener of this.#listeners.get(event.type) ?? []) {
			try {
				void Promise.resolve((listener as WatchListener<typeof event>)(event)).catch(this.#listenerFailed);
			} catch (error) {
				this.#listenerFailed(error);
			}
		}
	}

	readonly #listenerFailed = (error: unknown): void => {
		this.#logger.warn(
			`A watcher listener threw, so it was skipped: ${error instanceof Error ? error.message : String(error)}`,
		);
	};
}
