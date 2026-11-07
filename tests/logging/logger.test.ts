import { describe, expect, it, vi } from "vitest";

import { consoleLogger, fieldsFirst, safeLogger, silentLogger } from "../../src/logging/logger";
import { createRedactor, REDACTED } from "../../src/logging/redact";

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

describe("safeLogger messages", () => {
	it("redacts the message as well as the fields", () => {
		const messages: string[] = [];
		const logger = safeLogger(
			{
				debug: (message) => messages.push(message),
				info: () => undefined,
				warn: () => undefined,
				error: () => undefined,
			},
			createRedactor(["the-secret-value"]),
		);
		logger.debug("leaked the-secret-value here");
		expect(messages).toEqual(["leaked [REDACTED] here"]);
	});
});
