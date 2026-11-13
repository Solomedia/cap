import { describe, expect, test } from "bun:test";
import { webTestFiles } from "../lib/web-tests.ts";

const fixture = `
name: CI
jobs:
  typecheck:
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Test web React compatibility
        run: >-
          bun run --cwd apps/web test
          __tests__/unit/a.test.ts
          __tests__/unit/b.test.ts
`;

describe("webTestFiles", () => {
	test("returns upstream's list plus changed web tests, de-duplicated", () => {
		expect(
			webTestFiles({
				ciYaml: fixture,
				changedFiles: [
					"apps/web/__tests__/unit/b.test.ts",
					"apps/web/__tests__/unit/new.test.ts",
					"apps/web/lib/x.ts",
				],
			}),
		).toEqual([
			"__tests__/unit/a.test.ts",
			"__tests__/unit/b.test.ts",
			"__tests__/unit/new.test.ts",
		]);
	});

	test("ignores changed tests on a sync PR, where every upstream change counts as changed", () => {
		expect(
			webTestFiles({
				ciYaml: fixture,
				changedFiles: ["apps/web/__tests__/unit/red-upstream.test.ts"],
				headRef: "sync/upstream-20261108-0700",
			}),
		).toEqual(["__tests__/unit/a.test.ts", "__tests__/unit/b.test.ts"]);
	});

	test("throws when the step is missing", () => {
		expect(() =>
			webTestFiles({
				ciYaml:
					"jobs:\n  x:\n    steps:\n      - name: Other\n        run: echo\n",
				changedFiles: [],
			}),
		).toThrow(/bun run --cwd apps\/web test/);
	});

	test("throws when the step lists no files", () => {
		const empty = fixture.replace(/\s+__tests__\/unit\/[ab]\.test\.ts/g, "");
		expect(() => webTestFiles({ ciYaml: empty, changedFiles: [] })).toThrow();
	});

	test("passes a folder through when upstream runs the whole suite", () => {
		const folder = `
jobs:
  web-tests:
    steps:
      - name: Test web
        run: bun run --cwd apps/web test __tests__/unit
`;
		expect(
			webTestFiles({
				ciYaml: folder,
				changedFiles: ["apps/web/__tests__/integration/x.test.ts"],
			}),
		).toEqual(["__tests__/unit", "__tests__/integration/x.test.ts"]);
	});

	test("reads the real upstream CI workflow", async () => {
		const ciYaml = await Bun.file(".github/workflows/ci.yml").text();
		const tests = webTestFiles({ ciYaml, changedFiles: [] });
		expect(tests.length).toBeGreaterThan(0);
		for (const test of tests) {
			expect(test.startsWith("__tests__/")).toBe(true);
		}
	});
});
