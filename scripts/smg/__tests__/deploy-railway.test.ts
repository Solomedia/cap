import { describe, expect, test } from "bun:test";

const run = (args: string[], env: Record<string, string>) =>
	Bun.spawnSync(["bun", "scripts/smg/deploy-railway.ts", ...args], {
		env: { PATH: process.env.PATH ?? "", ...env },
	});

const digest = "ghcr.io/solomedia/cap-web@sha256:abc";

describe("deploy-railway CLI", () => {
	test("stops without a token when the freeze variable is missing", () => {
		const result = run(["--image", digest], {});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(
			"Deploy frozen (SMG_DEPLOY_FREEZE)",
		);
	});

	test("refuses to deploy without a token when unfrozen", () => {
		const result = run(["--image", digest], { SMG_DEPLOY_FREEZE: "false" });
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("RAILWAY_TOKEN");
	});

	test("refuses an image that is not pinned by digest", () => {
		const result = run(["--image", "ghcr.io/solomedia/cap-web:smg"], {});
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("@sha256:");
	});
});
