// Railway Infrastructure as Code for Cap Web. Plan it with `railway config plan`;
// it is applied when a PR touching .railway/ merges into smg (smg-railway-*.yml).
//
// This file is a partial: it owns only Cap Web. MySQL, Cap Media Server, Cap Loom
// Importer and cap-admin-library-sync stay managed in the Railway dashboard, and
// a partial never deletes resources it doesn't own.
//
// Variables are unmanaged: secrets and env live in Railway, never in this file.
import { defineRailway, group, image, project, service } from "railway/iac";

export const partial = "cap-web";

const everyDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
	day,
	startHour: 0,
	endHour: 24,
}));

export default defineRailway(() => {
	const capWeb = service("Cap Web", {
		source: image(
			"ghcr.io/capsoftware/cap-web@sha256:e2dbc1e802011c46190c8de19ced866ae43b9dfb23946d49203b368a8cd81719",
			{ autoUpdates: { type: "patch", schedule: everyDay } },
		),
		build: { buildEnvironment: "V3", builder: "RAILPACK" },
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
