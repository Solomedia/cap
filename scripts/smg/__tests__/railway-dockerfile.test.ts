import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CAP_WEB_SERVICE_ID,
	GEOIP_DATABASE_PATH,
	railwayDockerfile,
	smgWebDockerfile,
	withGeoIpDatabase,
} from "../lib/railway-dockerfile.ts";

describe("railwayDockerfile", () => {
	test("prefixes cache mount ids with the Railway service id", () => {
		const out = railwayDockerfile(
			"RUN --mount=type=cache,id=bun-1.4.4,target=/root/.bun/install/cache bun install\n",
		);
		expect(out).toContain(
			`RUN --mount=type=cache,id=s/${CAP_WEB_SERVICE_ID}-/root/.bun/install/cache,target=/root/.bun/install/cache bun install`,
		);
	});

	test("handles target before id and mounts without an id", () => {
		const out = railwayDockerfile(
			"RUN --mount=type=cache,target=/a --mount=type=cache,target=/b,id=x make\n",
		);
		expect(out).toContain(
			`--mount=type=cache,id=s/${CAP_WEB_SERVICE_ID}-/a,target=/a`,
		);
		expect(out).toContain(
			`--mount=type=cache,id=s/${CAP_WEB_SERVICE_ID}-/b,target=/b`,
		);
	});

	// Railway's builder rejects external Dockerfile frontends; the built-in one
	// already supports cache mounts.
	test("drops the syntax directive and starts with how to regenerate", () => {
		const out = railwayDockerfile(
			"# syntax=docker.io/docker/dockerfile:1\nFROM node\n",
		);
		expect(out).not.toContain("# syntax=");
		expect(out).toMatch(
			/^# Generated from apps\/web\/Dockerfile.*bun scripts\/smg\/railway-dockerfile.ts --write\nFROM node\n$/s,
		);
	});

	test("keeps every other line as upstream wrote it", () => {
		const upstream =
			"# syntax=docker.io/docker/dockerfile:1\n\nFROM node AS base\nCOPY . .\n";
		const out = railwayDockerfile(upstream);
		expect(out).toContain("FROM node AS base\nCOPY . .\n");
	});

	// Fails when a sync changes apps/web/Dockerfile: run
	// `bun scripts/smg/railway-dockerfile.ts --write` and commit the result.
	test("smg/web.Dockerfile is up to date with apps/web/Dockerfile", () => {
		const upstream = readFileSync("apps/web/Dockerfile", "utf8");
		const ours = readFileSync("smg/web.Dockerfile", "utf8");
		expect(ours).toBe(smgWebDockerfile(upstream));
	});
});

describe("withGeoIpDatabase", () => {
	const dockerfile =
		"FROM node AS base\nFROM base AS builder\nRUN build\nFROM base AS runner\nCOPY a b\nUSER nextjs\nCMD node server.js\n";

	test("downloads the database in its own stage and points the app at it", () => {
		const out = withGeoIpDatabase(dockerfile);
		expect(out.indexOf("FROM base AS geoip")).toBeLessThan(
			out.indexOf("FROM base AS runner"),
		);
		expect(out).toContain("ARG RAILWAY_GIT_COMMIT_SHA");
		expect(out).toContain(
			"https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz",
		);
		expect(out).toContain(
			`COPY --from=geoip --chown=nextjs:nodejs /geoip /app/geoip\nENV CAP_GEOIP_DATABASE_PATH=${GEOIP_DATABASE_PATH}\n\nUSER nextjs`,
		);
	});

	test("fails when upstream's Dockerfile loses an anchor", () => {
		expect(() =>
			withGeoIpDatabase(dockerfile.replace("USER nextjs\n", "")),
		).toThrow('"USER nextjs"');
		expect(() =>
			withGeoIpDatabase(dockerfile.replace("FROM base AS runner", "FROM base")),
		).toThrow('"FROM base AS runner"');
	});
});
