import { describe, expect, it } from "vitest";
import { shareUnfurlDescription } from "@/lib/share-unfurl-description";

describe("shareUnfurlDescription", () => {
	it("uses a short summary as is, with whitespace collapsed", () => {
		expect(
			shareUnfurlDescription({
				summary: "  Walkthrough of the new\n\nbilling flow.  ",
				disableSummary: false,
			}),
		).toBe("Walkthrough of the new billing flow.");
	});

	it("cuts a long summary at a word boundary and marks the cut", () => {
		const summary = `${"word ".repeat(80)}end`;
		const description = shareUnfurlDescription({
			summary,
			disableSummary: false,
		});

		expect(description).not.toBeNull();
		expect(description?.length).toBeLessThanOrEqual(200);
		expect(description?.endsWith("word…")).toBe(true);
	});

	it("returns null when the summary is turned off for the viewer", () => {
		expect(
			shareUnfurlDescription({
				summary: "Private notes about the client",
				disableSummary: true,
			}),
		).toBeNull();
	});

	it("returns null when there is no usable summary", () => {
		expect(
			shareUnfurlDescription({ summary: undefined, disableSummary: false }),
		).toBeNull();
		expect(
			shareUnfurlDescription({ summary: "   ", disableSummary: false }),
		).toBeNull();
		expect(
			shareUnfurlDescription({ summary: 42, disableSummary: false }),
		).toBeNull();
	});
});
