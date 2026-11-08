import { describe, expect, test } from "bun:test";
import { migrationGate } from "../lib/migration-gate.ts";

describe("migrationGate", () => {
	test("passes a PR without migrations", () => {
		expect(
			migrationGate({ changedFiles: ["apps/web/a.ts"], labels: [] }).ok,
		).toBe(true);
	});

	test("blocks a PR with migrations until it is approved", () => {
		const gate = migrationGate({
			changedFiles: ["packages/database/migrations/0057_x.sql"],
			labels: ["upstream-sync", "has-migrations"],
		});
		expect(gate.ok).toBe(false);
		expect(gate.message).toContain("packages/database/migrations/0057_x.sql");
		expect(gate.message).toContain("migrations-approved");
		expect(gate.message).toContain("MySQL backup");
	});

	test("passes a PR with migrations once labeled migrations-approved", () => {
		expect(
			migrationGate({
				changedFiles: ["packages/database/migrations/meta/_journal.json"],
				labels: ["migrations-approved"],
			}).ok,
		).toBe(true);
	});
});
