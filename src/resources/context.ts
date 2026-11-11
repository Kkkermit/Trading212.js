import type { CachedLoader } from "../cache";
import type { FetchLike, Transport } from "../http/transport";
import type { Logger } from "../logging/logger";

/** What every resource shares with the client that created it. */
export interface ResourceContext {
	readonly transport: Transport;
	readonly cache: CachedLoader;
	/** Prefixes cache keys so different accounts and environments never share entries. */
	readonly cacheNamespace: string;
	readonly metadataTtlMs: number;
	/** For downloads that must not carry credentials, such as signed report links. */
	readonly fetch: FetchLike;
	readonly timeoutMs: number;
	/** The client's logger, already redacting. */
	readonly logger: Logger;
	/** Each instrument's `maxOpenQuantity`, from the last instrument list this client loaded. */
	readonly maxOpenQuantities: Map<string, number>;
}
