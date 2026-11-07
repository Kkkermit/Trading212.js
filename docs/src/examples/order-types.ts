import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// Buy at 180 or less. DAY orders expire at midnight in the exchange's time zone.
await t212.orders.buy({
	type: "limit",
	ticker: "AAPL_US_EQ",
	quantity: 1,
	limitPrice: 180,
	timeValidity: "DAY",
});

// A stop-loss: sell at market if the price falls to 150.
await t212.orders.sell({
	type: "stop",
	ticker: "AAPL_US_EQ",
	quantity: 1,
	stopPrice: 150,
	timeValidity: "GOOD_TILL_CANCEL",
});

// Once the price reaches 150, place a limit sell at 148 or better.
await t212.orders.sell({
	type: "stopLimit",
	ticker: "AAPL_US_EQ",
	quantity: 1,
	stopPrice: 150,
	limitPrice: 148,
	timeValidity: "DAY",
});

// Market orders can also fill outside regular hours.
await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1, extendedHours: true });
