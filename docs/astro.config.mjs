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
			logo: {
				light: "./src/assets/logo-light.svg",
				dark: "./src/assets/logo-dark.svg",
				alt: "trading212.js",
				replacesTitle: true,
			},
			favicon: "/favicon.svg",
			customCss: ["./src/styles/theme.css"],
			social: [{ icon: "github", label: "GitHub", href: repository }],
			editLink: { baseUrl: `${repository}/edit/main/docs/` },
			lastUpdated: true,
			plugins: [starlightLinksValidator({ errorOnLocalLinks: true })],
			sidebar: [
				{
					label: "Start here",
					items: ["getting-started", "concepts", "tutorial", "reference/api-coverage"],
				},
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
						"guides/logging",
						"guides/rate-limits",
						"guides/testing",
						"guides/safety",
					],
				},
				"recipes",
				{
					label: "Reference",
					items: [
						"reference/client",
						"reference/methods",
						"reference/configuration",
						"reference/utilities",
						"reference/testing-kit",
						"reference/types",
						"reference/cli",
					],
				},
				{ label: "Help", items: ["help/faq", "help/glossary"] },
			],
		}),
	],
});
