declare const __VERSION__: string;

/** This package's version, replaced at build time. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";
