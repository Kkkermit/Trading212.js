import { describe, expect, it, vi } from "vitest";

import { consoleLogger, fieldsFirst, safeLogger, silentLogger } from "../../src/logging/logger";
import { createRedactor, REDACTED } from "../../src/logging/redact";

describe("loggers", () => {
	it("consoleLogger writes one line per event, with its level, and respects its level", () => {
		const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const logger = consoleLogger({ level: "warn", console: target });
		logger.debug("hidden");
		logger.info("hidden");
		logger.warn("shown", { endpoint: "getOrder", attempt: 2, hint: "Try again later.", gone: undefined });
		logger.error("bare");
		expect(target.debug).not.toHaveBeenCalled();
		expect(target.info).not.toHaveBeenCalled();
		expect(target.warn).toHaveBeenCalledWith(
			'[trading212] WARN  shown endpoint=getOrder attempt=2 hint="Try again later."',
		);
		expect(target.error).toHaveBeenCalledWith("[trading212] ERROR bare");
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		consoleLogger().info("default console");
		expect(info).toHaveBeenCalledWith("[trading212] INFO  default console");
		info.mockRestore();
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
