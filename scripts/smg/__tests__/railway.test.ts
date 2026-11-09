import { describe, expect, test } from "bun:test";
import {
	type DeployStatus,
	deployImage,
	interpretDeploymentStatus,
	waitForDeployment,
} from "../lib/railway.ts";

type Call = {
	url: string;
	headers: Record<string, string>;
	query: string;
	variables: Record<string, unknown>;
};

// Fake Railway API: answers by GraphQL operation, records every call.
function fakeRailway(
	handlers: Record<string, (vars: Record<string, unknown>) => unknown>,
) {
	const calls: Call[] = [];
	const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		if (!href.includes("backboard.railway.com")) {
			return handlers.health
				? (handlers.health({}) as Response)
				: new Response("ok");
		}
		const body = JSON.parse(String(init?.body));
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		calls.push({
			url: href,
			headers,
			query: body.query,
			variables: body.variables,
		});
		const op = Object.keys(handlers).find((name) =>
			body.query.includes(`${name}(`),
		);
		if (!op) throw new Error(`unexpected query ${body.query}`);
		return Response.json(handlers[op](body.variables));
	}) as typeof globalThis.fetch;
	return { fetch, calls };
}

const ids = { projectId: "p1", environmentId: "e1", serviceId: "s1" };
const image = "ghcr.io/solomedia/cap-web@sha256:abc";
const list = (...deploymentIds: string[]) => ({
	data: {
		deployments: {
			edges: deploymentIds.map((id) => ({ node: { id, status: "BUILDING" } })),
		},
	},
});

describe("interpretDeploymentStatus", () => {
	test.each([
		["SUCCESS", "success"],
		["FAILED", "failed"],
		["CRASHED", "failed"],
		["REMOVED", "failed"],
		["SKIPPED", "failed"],
		["BUILDING", "pending"],
		["DEPLOYING", "pending"],
	] as [string, DeployStatus][])("%s → %s", (status, expected) => {
		expect(interpretDeploymentStatus(status)).toBe(expected);
	});
});

describe("deployImage", () => {
	test("sets the image, deploys, and returns the new deployment id", async () => {
		let listed = 0;
		const api = fakeRailway({
			deployments: () => (listed++ === 0 ? list("old") : list("new", "old")),
			serviceInstanceUpdate: () => ({ data: { serviceInstanceUpdate: true } }),
			serviceInstanceDeploy: () => ({ data: { serviceInstanceDeploy: true } }),
		});
		const result = await deployImage({
			token: "tok",
			...ids,
			image,
			fetch: api.fetch,
			pollMs: 0,
		});
		expect(result).toEqual({ deploymentId: "new" });
		for (const call of api.calls) {
			expect(call.url).toBe("https://backboard.railway.com/graphql/v2");
			expect(call.headers["project-access-token"]).toBe("tok");
		}
		const update = api.calls.find((c) =>
			c.query.includes("serviceInstanceUpdate("),
		);
		expect(update?.variables).toEqual({
			serviceId: "s1",
			environmentId: "e1",
			input: { source: { image } },
		});
	});

	test("throws on a GraphQL error", async () => {
		const api = fakeRailway({
			deployments: () => list("old"),
			serviceInstanceUpdate: () => ({
				errors: [{ message: "Not Authorized" }],
			}),
		});
		await expect(
			deployImage({ token: "tok", ...ids, image, fetch: api.fetch, pollMs: 0 }),
		).rejects.toThrow(/Not Authorized/);
	});
});

describe("waitForDeployment", () => {
	test("fails when the health URL is not 200 after SUCCESS", async () => {
		const api = fakeRailway({
			deployment: () => ({
				data: { deployment: { id: "new", status: "SUCCESS" } },
			}),
			health: () => new Response("down", { status: 503 }),
		});
		const status = await waitForDeployment({
			token: "tok",
			deploymentId: "new",
			healthUrl: "https://cap.example/api/status",
			timeoutMs: 1000,
			pollMs: 0,
			fetch: api.fetch,
		});
		expect(status).toBe("failed");
	});

	test("succeeds when SUCCESS and the health URL answers 200", async () => {
		const api = fakeRailway({
			deployment: () => ({
				data: { deployment: { id: "new", status: "SUCCESS" } },
			}),
		});
		const status = await waitForDeployment({
			token: "tok",
			deploymentId: "new",
			healthUrl: "https://cap.example/api/status",
			timeoutMs: 1000,
			pollMs: 0,
			fetch: api.fetch,
		});
		expect(status).toBe("success");
	});

	test("fails after the timeout while still deploying", async () => {
		const api = fakeRailway({
			deployment: () => ({
				data: { deployment: { id: "new", status: "DEPLOYING" } },
			}),
		});
		const status = await waitForDeployment({
			token: "tok",
			deploymentId: "new",
			healthUrl: "https://cap.example/api/status",
			timeoutMs: 20,
			pollMs: 5,
			fetch: api.fetch,
		});
		expect(status).toBe("failed");
	});
});
