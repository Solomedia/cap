import { describe, expect, test } from "bun:test";
import { isSmgWorkflow, workflowsToDisable } from "../lib/workflows.ts";

describe("isSmgWorkflow", () => {
	test("recognises our workflows", () => {
		expect(isSmgWorkflow(".github/workflows/smg-ci.yml")).toBe(true);
	});

	test.each([
		".github/workflows/ci.yml",
		".github/workflows/smgfoo.yml",
		".github/workflows/notsmg-x.yml",
		"scripts/smg-ci.yml",
	])("does not claim %p", (path) => {
		expect(isSmgWorkflow(path)).toBe(false);
	});
});

describe("workflowsToDisable", () => {
	test("returns active upstream workflows only", () => {
		expect(
			workflowsToDisable([
				{ id: 1, path: ".github/workflows/ci.yml", state: "active" },
				{ id: 2, path: ".github/workflows/smg-sync.yml", state: "active" },
				{
					id: 3,
					path: ".github/workflows/gpui-bench.yml",
					state: "disabled_manually",
				},
				{ id: 4, path: ".github/workflows/new-upstream.yml", state: "active" },
				{
					id: 5,
					path: "dynamic/pages/pages-build-deployment",
					state: "active",
				},
			]),
		).toEqual([
			{ id: 1, path: ".github/workflows/ci.yml" },
			{ id: 4, path: ".github/workflows/new-upstream.yml" },
		]);
	});
});
