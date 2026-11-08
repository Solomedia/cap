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

	test("throws when the step is missing", () => {
		expect(() =>
			webTestFiles({
				ciYaml:
					"jobs:\n  x:\n    steps:\n      - name: Other\n        run: echo\n",
				changedFiles: [],
			}),
		).toThrow(/Test web React compatibility/);
	});

	test("throws when the step lists no files", () => {
		const empty = fixture.replace(/\s+__tests__\/unit\/[ab]\.test\.ts/g, "");
		expect(() => webTestFiles({ ciYaml: empty, changedFiles: [] })).toThrow();
	});

	test("reads the real upstream CI workflow", async () => {
		const ciYaml = await Bun.file(".github/workflows/ci.yml").text();
		expect(webTestFiles({ ciYaml, changedFiles: [] }).length).toBeGreaterThan(
			50,
		);
	});
});
