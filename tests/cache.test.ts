import { describe, expect, it, vi } from "vitest";

import { CachedLoader, isList, MemoryCache } from "../src/cache";
import { createFakeTrading212 } from "../src/testing";

import { memoryLogger } from "./helpers";

describe("MemoryCache", () => {
	it("forgets entries once they expire", () => {
		vi.useFakeTimers();
		try {
			const cache = new MemoryCache();
			cache.set("a", 1, 1000);
			expect(cache.get("a")).toBe(1);
			vi.advanceTimersByTime(1000);
			expect(cache.get("a")).toBeUndefined();
			cache.set("b", 2, 1000);
			cache.delete("b");
			expect(cache.get("b")).toBeUndefined();
			cache.set("c", 3, 1000);
			cache.clear();
			expect(cache.get("c")).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("CachedLoader", () => {
	it("shares one load between concurrent callers and serves the cache afterwards", async () => {
		const loader = new CachedLoader(new MemoryCache());
		const load = vi.fn(() => Promise.resolve(["value"]));
		const [first, second] = await Promise.all([
			loader.load("k", { ttlMs: 1000 }, load),
			loader.load("k", { ttlMs: 1000 }, load),
		]);
		expect(first).toBe(second);
		await loader.load("k", { ttlMs: 1000 }, load);
		expect(load).toHaveBeenCalledTimes(1);
		await loader.load("k", { ttlMs: 1000, refresh: true }, load);
		expect(load).toHaveBeenCalledTimes(2);
	});

	/** A broken Redis must cost a download, not the call. */
	it("bypasses a cache store that throws, and reports it", async () => {
		const broken = {
			get: () => {
				throw new Error("redis down");
			},
			set: () => Promise.reject(new Error("redis down")),
		};
		const errors: unknown[] = [];
		const loader = new CachedLoader(broken, (error) => errors.push(error));
		await expect(loader.load("k", { ttlMs: 1000 }, () => Promise.resolve(42))).resolves.toBe(42);
		expect(errors).toHaveLength(2);
		const quiet = new CachedLoader(broken);
		await expect(quiet.load("k", { ttlMs: 1000 }, () => Promise.resolve(1))).resolves.toBe(1);
	});

	/** Redis answers a miss with null, and a shared store can hold anything; neither may reach the caller. */
	it("treats null as a miss and reloads a value of the wrong shape", async () => {
		const errors: unknown[] = [];
		const nulls = new CachedLoader({ get: () => null, set: () => undefined }, (error) => errors.push(error));
		await expect(nulls.load("k", { ttlMs: 1000, accept: isList }, () => Promise.resolve([1]))).resolves.toEqual([1]);
		expect(errors).toEqual([]);
		const wrong = new CachedLoader({ get: () => "not a list", set: () => undefined }, (error) => errors.push(error));
		await expect(wrong.load("k", { ttlMs: 1000, accept: isList }, () => Promise.resolve([2]))).resolves.toEqual([2]);
		expect(errors).toHaveLength(1);
		const { client } = createFakeTrading212({ client: { cache: { get: () => null, set: () => "OK" } } });
		await expect(client.instruments.search("Apple")).resolves.not.toHaveLength(0);
	});

	it("warns through the client's logger without naming the key", async () => {
		const { lines, logger } = memoryLogger();
		const cache = { get: () => Promise.reject(new Error("redis down")), set: () => undefined };
		const { client } = createFakeTrading212({ client: { cache, logger } });
		await expect(client.instruments.list()).resolves.not.toHaveLength(0);
		expect(lines.filter((line) => line.level === "warn")).toEqual([
			expect.objectContaining({
				level: "warn",
				message: "The cache store failed for the instruments list, so it was bypassed.",
				fields: { error: "redis down" },
			}),
		]);
	});
});

describe("CachedLoader and abort signals", () => {
	it("lets each caller stop waiting without failing the others", async () => {
		const loader = new CachedLoader(new MemoryCache());
		const load = () =>
			new Promise<string>((resolve) => {
				setTimeout(() => {
					resolve("done");
				}, 10);
			});
		const controller = new AbortController();
		const first = loader.load("k", { ttlMs: 1000, signal: controller.signal }, load);
		const second = loader.load("k", { ttlMs: 1000 }, load);
		controller.abort(new Error("first gave up"));
		await expect(first).rejects.toThrow("first gave up");
		await expect(second).resolves.toBe("done");
		await expect(
			loader.load("k", { ttlMs: 1000, signal: AbortSignal.abort(new Error("already")) }, load),
		).rejects.toThrow("already");

		const later = new AbortController();
		const starter = loader.load("j", { ttlMs: 1000 }, load);
		const joiner = loader.load("j", { ttlMs: 1000, signal: later.signal }, load);
		later.abort(new Error("joiner gave up"));
		await expect(joiner).rejects.toThrow("joiner gave up");
		await expect(starter).resolves.toBe("done");
	});
});
