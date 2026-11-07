/** A short non-cryptographic fingerprint, so a key can name a cache or a rate-limit bucket without being stored. */
export function fingerprint(value: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		a = Math.imul(a ^ code, 0x01000193);
		b = Math.imul(b ^ code, 0x5bd1e995) ^ (b >>> 15);
	}
	return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
