/** `demo` is paper trading; `live` is real money. A key works in exactly one of them. */
export type Environment = "demo" | "live";

export const ENVIRONMENTS: readonly Environment[] = ["demo", "live"];

export const BASE_URLS: Readonly<Record<Environment, string>> = {
	demo: "https://demo.trading212.com",
	live: "https://live.trading212.com",
};

export function isEnvironment(value: unknown): value is Environment {
	return value === "demo" || value === "live";
}
