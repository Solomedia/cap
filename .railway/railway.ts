// Railway Infrastructure as Code for Cap Web. Plan it with `railway config plan`;
// it is applied when a PR touching .railway/ merges into smg (smg-railway-*.yml).
//
// This file is a partial: it owns only Cap Web. MySQL, Cap Media Server, Cap Loom
// Importer and cap-admin-library-sync stay managed in the Railway dashboard, and
// a partial never deletes resources it doesn't own.
//
// Variables are unmanaged: secrets and env live in Railway, never in this file.
import { defineRailway, github, group, project, service } from "railway/iac";

export const partial = "cap-web";

const everyDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
	day,
	startHour: 0,
	endHour: 24,
}));

export default defineRailway(() => {
	const capWeb = service("Cap Web", {
		// Built from smg. checkSuites is Railway's "Wait for CI": a commit deploys
		// only after the workflows on its push (SMG CI) succeed.
		source: github("Solomedia/cap", { branch: "smg", checkSuites: true }),
		build: {
			builder: "DOCKERFILE",
			// apps/web/Dockerfile with Railway's cache mount ids
			// (scripts/smg/lib/railway-dockerfile.ts keeps it in step).
			dockerfilePath: "smg/web.Dockerfile",
			buildEnvironment: "V3",
			// Rebuild only when something the web image uses changes.
			watchPatterns: [
				"/apps/web/**",
				"/smg/web.Dockerfile",
				"/packages/**",
				"/patches/**",
				"/package.json",
				"/bun.lock",
				"/bunfig.toml",
				"/turbo.json",
				"/tsconfig.json",
			],
		},
		healthcheck: "/api/status",
		healthcheckTimeout: 120,
		replicas: { "us-west2": 1 },
		deploy: {
			// Node heap is capped at 8 GB through NODE_OPTIONS.
			limitOverride: { containers: { cpu: 32, memoryBytes: 12_000_000_000 } },
			overlapSeconds: 30,
			restartPolicyType: "ALWAYS",
		},
		domains: [{ domain: "cap.solomediagroup.com", port: 8080 }],
		networking: { privateNetworkEndpoint: "cap-web" },
	});

	return project("SMG - CAP", {
		variables: { managed: false },
		// Same canvas group as today. Declaring Cap Web alone in it leaves
		// MySQL and Cap Media Server where they are.
		resources: [group("Cap", [capWeb])],
	});
});
