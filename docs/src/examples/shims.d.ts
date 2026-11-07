// Only so the examples type-check without installing pino.
declare module "pino" {
	type Method = (fields: Record<string, unknown>, message: string) => void;
	const pino: (options?: { level?: string }) => { debug: Method; info: Method; warn: Method; error: Method };
	export default pino;
}
