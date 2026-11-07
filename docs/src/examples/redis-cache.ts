import { type CacheStore, Trading212 } from "@kkkermit/trading212.js";

// Any client with get and set works; this is the shape of node-redis and ioredis.
interface RedisLike {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
	del(key: string): Promise<unknown>;
}
declare const redis: RedisLike;

const redisCache: CacheStore = {
	// A null from Redis counts as a miss.
	get: async (key) => {
		const text = await redis.get(key);
		return text === null ? undefined : (JSON.parse(text) as unknown);
	},
	set: (key, value, ttlMs) => redis.set(key, JSON.stringify(value), "PX", ttlMs),
	delete: (key) => redis.del(key),
};

// Every process now shares one copy of the 5 MB instrument list.
const t212 = Trading212.fromEnv({ cache: redisCache });
await t212.instruments.list();
