import { describe, expect, it } from "vitest";

import { createRedactor, REDACTED, stripQuery } from "../../src/logging/redact";

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

describe("createRedactor with hostile keys", () => {
	it("keeps a __proto__ key as data rather than replacing the prototype", () => {
		const hostile = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as unknown;
		const result = createRedactor([])(hostile) as Record<string, unknown>;
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(Object.hasOwn(result, "__proto__")).toBe(true);
		expect((result as { polluted?: unknown }).polluted).toBeUndefined();
		expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
	});
});
