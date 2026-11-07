import { describe, expect, it, vi } from "vitest";

import { consoleLogger, fieldsFirst, safeLogger, silentLogger } from "../src/logging/logger";
import { createRedactor, REDACTED, stripQuery } from "../src/logging/redact";

describe("createRedactor", () => {
	const redact = createRedactor(["supersecretvalue", "key-1234", "abc"]);

	it("removes every secret wherever it appears in a string", () => {
		expect(redact("x supersecretvalue y key-1234 z")).toBe(`x ${REDACTED} y ${REDACTED} z`);
	});

	it("ignores secrets too short to be real, so it does not mangle ordinary text", () => {
		expect(redact("abc")).toBe("abc");
	});

	it("removes Basic credentials even when it was not told them", () => {
		expect(redact("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(`Authorization: Basic ${REDACTED}`);
	});

	it("blanks sensitive keys and walks nested objects and arrays", () => {
		expect(
			redact({
				Authorization: "anything",
				apiKey: "x",
				api_key: "x",
				nested: [{ password: "x", note: "has key-1234 in it" }],
				count: 3,
				nothing: null,
			}),
		).toEqual({
			Authorization: REDACTED,
			apiKey: REDACTED,
			api_key: REDACTED,
			nested: [{ password: REDACTED, note: `has ${REDACTED} in it` }],
			count: 3,
			nothing: null,
		});
	});

	it("strips the signature from download links", () => {
		expect(redact({ downloadLink: "https://s3.example/r.csv?X-Amz-Signature=abc" })).toEqual({
			downloadLink: `https://s3.example/r.csv?${REDACTED}`,
		});
		expect(stripQuery("https://a.example/x")).toBe("https://a.example/x");
	});

	it("survives cycles and very deep objects", () => {
		const cyclic: Record<string, unknown> = { a: 1 };
		cyclic.self = cyclic;
		expect(redact(cyclic)).toEqual({ a: 1, self: "[Circular]" });
		let deep: Record<string, unknown> = { leaf: true };
		for (let index = 0; index < 20; index++) deep = { deep };
		expect(JSON.stringify(redact(deep))).toContain("[Truncated]");
	});
});

describe("loggers", () => {
	it("consoleLogger prefixes lines and respects its level", () => {
		const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const logger = consoleLogger({ level: "warn", console: target });
		logger.debug("hidden");
		logger.info("hidden");
		logger.warn("shown", { a: 1 });
		logger.error("bare");
		expect(target.debug).not.toHaveBeenCalled();
		expect(target.info).not.toHaveBeenCalled();
		expect(target.warn).toHaveBeenCalledWith("[trading212] shown", { a: 1 });
		expect(target.error).toHaveBeenCalledWith("[trading212] bare");
		expect(() => {
			consoleLogger().info("default console");
		}).not.toThrow();
	});

	it("fieldsFirst swaps the arguments for pino-style loggers", () => {
		const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const logger = fieldsFirst(target);
		logger.debug("d", { x: 1 });
		logger.info("i");
		logger.warn("w");
		logger.error("e");
		expect(target.debug).toHaveBeenCalledWith({ x: 1 }, "d");
		expect(target.info).toHaveBeenCalledWith({}, "i");
		expect(target.warn).toHaveBeenCalledWith({}, "w");
		expect(target.error).toHaveBeenCalledWith({}, "e");
	});

	it("safeLogger redacts fields and swallows a logger that throws", () => {
		const calls: unknown[] = [];
		const logger = safeLogger(
			{
				debug: (_message, fields) => calls.push(fields),
				info: () => {
					throw new Error("broken logger");
				},
				warn: (_message, fields) => calls.push(fields),
				error: () => undefined,
			},
			createRedactor(["the-secret-value"]),
		);
		logger.debug("x", { header: "the-secret-value" });
		logger.warn("no fields");
		expect(() => {
			logger.info("y");
		}).not.toThrow();
		logger.error("z");
		expect(calls).toEqual([{ header: REDACTED }, undefined]);
		silentLogger.debug("nothing");
	});
});
