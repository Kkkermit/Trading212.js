import { Trading212 } from "../client";
import type { Trading212Options } from "../config";
import type { Environment } from "../environment";

import { FAKE_API_KEY, FAKE_API_SECRET, type FakeAccountState, FakeTrading212Server } from "./fakeServer";

export {
	DEFAULT_INSTRUMENTS,
	FAKE_API_KEY,
	FAKE_API_SECRET,
	type FakeAccountState,
	type FakeFailure,
	type FakeHolding,
	type FakeHoldingState,
	type FakePendingOrder,
	FakeTrading212Server,
	weekOfSessions,
} from "./fakeServer";
export {
	networkError,
	type RecordedRequest,
	type ScriptedFetch,
	scriptedFetch,
	type ScriptedResponse,
	type ScriptStep,
} from "./scriptedFetch";

export interface CreateFakeOptions {
	/** The account the fake starts with. */
	state?: FakeAccountState;
	/** Default `demo`. On `live`, trading is enabled for you unless `client.trading` says otherwise. */
	environment?: Environment;
	/** Any other client option, such as a logger. */
	client?: Partial<Omit<Trading212Options, "environment" | "apiKey" | "apiSecret" | "fetch">>;
}

/**
 * A real `Trading212` client wired to an in-memory Trading 212, for testing your own code with no network and no
 * key. Rate limiting is off so tests run instantly.
 *
 * @example
 * const { client, server } = createFakeTrading212({ state: { cash: 1000 } });
 * await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 2 });
 * expect(server.position("AAPL_US_EQ")?.quantity).toBe(2);
 */
export function createFakeTrading212(options: CreateFakeOptions = {}): {
	client: Trading212;
	server: FakeTrading212Server;
} {
	const environment = options.environment ?? "demo";
	const server = new FakeTrading212Server(options.state, environment);
	const client = new Trading212({
		rateLimit: "off",
		trading: "enabled",
		...options.client,
		environment,
		apiKey: FAKE_API_KEY,
		apiSecret: FAKE_API_SECRET,
		fetch: server.fetch,
	});
	return { client, server };
}
