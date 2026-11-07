import type { CachedLoader } from "../cache";
import type { FetchLike, Transport } from "../http/transport";

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
}
