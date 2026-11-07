import { isTrading212Error, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const everyMinutes = 15;

async function report(): Promise<void> {
	try {
		const { totalValue, cash, takenAt } = await t212.portfolio.snapshot();
		console.log(`${takenAt.toISOString()} total ${totalValue}, cash ${cash}`);
	} catch (error) {
		// Keep running on a bad moment; let anything unexpected stop the program.
		if (!isTrading212Error(error)) throw error;
		console.error(error.message, error.hint);
	}
}

await report();
const timer = setInterval(() => void report(), everyMinutes * 60_000);
process.once("SIGINT", () => clearInterval(timer));
