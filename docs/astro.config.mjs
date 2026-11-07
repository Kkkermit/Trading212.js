import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

const repository = "https://github.com/Kkkermit/Trading212.js";

// GitHub Pages serves a project site under the repository's name, so every link between pages starts with the base.
export default defineConfig({
	site: "https://kkkermit.github.io",
	base: "/Trading212.js",
	trailingSlash: "always",
	integrations: [
		starlight({
			title: "trading212.js",
			description:
				"An unofficial TypeScript client for the Trading 212 Public API: safe around real money, clear when things go wrong, with a fake Trading 212 for tests.",
			logo: { src: "./src/assets/logo.svg", replacesTitle: false },
			favicon: "/favicon.svg",
			social: [{ icon: "github", label: "GitHub", href: repository }],
			editLink: { baseUrl: `${repository}/edit/main/docs/` },
			lastUpdated: true,
			plugins: [starlightLinksValidator({ errorOnLocalLinks: true })],
			sidebar: [
				{ label: "Start here", items: ["getting-started", "reference/api-coverage"] },
				{
					label: "Guides",
					items: [
						"guides/orders",
						"guides/account-and-portfolio",
						"guides/instruments-and-markets",
						"guides/history",
						"guides/reports",
						"guides/pies",
						"guides/errors",
						"guides/rate-limits",
						"guides/logging",
						"guides/testing",
						"guides/safety",
					],
				},
				{ label: "Reference", items: ["reference/configuration", "reference/cli"] },
			],
		}),
	],
});
