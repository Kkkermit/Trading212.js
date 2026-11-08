import { beforeEach } from "vitest";

import { resetRateLimitState } from "../src/http/rateLimiter";

// Budgets are shared per account across clients, so each test starts with none spent.
beforeEach(() => {
	resetRateLimitState();
});
