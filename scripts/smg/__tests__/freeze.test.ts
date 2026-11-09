import { describe, expect, test } from "bun:test";
import { parseFreeze } from "../lib/freeze.ts";

describe("parseFreeze", () => {
	test.each([
		undefined,
		"",
		"true",
		"TRUE",
		"True ",
		"no",
		"yes",
		"flase",
		"0",
	])("treats %p as frozen", (value) => {
		expect(parseFreeze(value)).toBe(true);
	});

	test.each(["false", " False ", "FALSE\n"])(
		"treats %p as unfrozen",
		(value) => {
			expect(parseFreeze(value)).toBe(false);
		},
	);
});
