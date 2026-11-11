import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// Stops when the signal aborts, here after ten minutes. Leaving the loop with break stops it too.
for await (const event of t212.watch.positions({ signal: AbortSignal.timeout(10 * 60_000) })) {
	if (event.type === "error") console.error(event.error.message);
	else if (event.type === "opened") console.log(`Opened ${event.position.instrument?.ticker}`);
	else if (event.type === "closed") console.log(`Closed ${event.position.instrument?.ticker}`);
	else console.log(`${event.position.instrument?.ticker}: ${event.previous.quantity} -> ${event.position.quantity}`);
}
