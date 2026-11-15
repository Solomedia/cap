import type { HttpApi } from "@effect/platform";
import type { Layer as EffectLayer } from "effect";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition = { column: string; value: unknown };

const mocks = vi.hoisted(() => ({
	videos: new Map<string, Record<string, unknown>>(),
	inFlight: 0 as number | Error,
	transcribe: vi.fn(),
}));

vi.mock("@cap/database", () => ({
	db: () => ({
		select: (fields: Record<string, unknown>) => ({
			from: () => ({
				where: (condition: Condition) => {
					if ("total" in fields)
						return mocks.inFlight instanceof Error
							? Promise.reject(mocks.inFlight)
							: Promise.resolve([{ total: mocks.inFlight }]);
					return {
						limit: async () => {
							const row = mocks.videos.get(String(condition.value));
							return row ? [row] : [];
						},
					};
				},
			}),
		}),
	}),
}));
vi.mock("@cap/database/schema", () => ({
	videos: {
		id: "v.id",
		isScreenshot: "v.isScreenshot",
		transcriptionStatus: "v.transcriptionStatus",
		updatedAt: "v.updatedAt",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: Condition[]) => conditions,
	count: () => "count",
	eq: (column: string, value: unknown) => ({ column, value }),
	gte: (column: string, value: unknown) => ({ column, value }),
}));
vi.mock("@cap/env", () => ({
	serverEnv: () => ({ MEDIA_SERVER_WEBHOOK_SECRET: "media-secret" }),
}));
vi.mock("@cap/web-domain", () => ({
	Video: { VideoId: { make: (id: string) => id } },
}));
vi.mock("@/lib/transcribe", () => ({ transcribeVideo: mocks.transcribe }));

type ApiLayer = EffectLayer.Layer<HttpApi.Api>;

vi.mock("@/lib/server", async () => {
	const { HttpApiBuilder, HttpServer } = await import("@effect/platform");
	const { Layer } = await import("effect");
	return {
		apiToHandler: (api: ApiLayer) => {
			const { handler } = HttpApiBuilder.toWebHandler(
				Layer.mergeAll(api, HttpServer.layerContext),
			);
			return (request: Request) => handler(request);
		},
	};
});

import { POST } from "@/app/api/internal/transcripts/backfill/route";

const VIDEO = "abcdefghjkmnpqr";
const OTHER = "__hDHviwdUl78Gf";

const video = (overrides: Record<string, unknown> = {}) => ({
	ownerId: "owner-a",
	isScreenshot: false,
	transcriptionStatus: null,
	duration: 125.5,
	metadata: { transcribeOnView: true },
	...overrides,
});

const call = (body: unknown, secret: string | null = "media-secret") =>
	POST(
		new NextRequest("https://cap.so/api/internal/transcripts/backfill", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(secret ? { "x-media-server-secret": secret } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const results = async (body: unknown) => {
	const response = await call(body);
	expect(response.status).toBe(200);
	return response.json();
};

beforeEach(() => {
	mocks.videos = new Map([[VIDEO, video()]]);
	mocks.inFlight = 3;
	mocks.transcribe.mockReset().mockResolvedValue({
		success: true,
		message: "Transcription workflow started",
	});
});

describe("POST /api/internal/transcripts/backfill", () => {
	it("requires the media server secret", async () => {
		expect((await call({ videoIds: [VIDEO] }, null)).status).toBe(401);
		expect((await call({ videoIds: [VIDEO] }, "wrong")).status).toBe(401);
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it.each([
		{},
		{ videoIds: [] },
		{ videoIds: ["../../etc"] },
		{
			videoIds: Array.from(
				{ length: 26 },
				(_, i) => `abcdefghjkmn${String(i).padStart(3, "0")}`,
			),
		},
	])("rejects invalid batches %#", async (body) => {
		expect((await call(body)).status).toBe(400);
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it("starts transcription as the video's owner without AI generation", async () => {
		await expect(results({ videoIds: [VIDEO] })).resolves.toEqual({
			inFlight: 3,
			results: [
				{
					videoId: VIDEO,
					status: "started",
					transcriptionStatus: "PROCESSING",
					aiGenerationStatus: null,
					durationSeconds: 125.5,
				},
			],
		});
		expect(mocks.transcribe).toHaveBeenCalledTimes(1);
		expect(mocks.transcribe).toHaveBeenCalledWith(VIDEO, "owner-a", false);
	});

	it.each(["COMPLETE", "PROCESSING", "SKIPPED", "NO_AUDIO", "ERROR"])(
		"leaves a %s video alone and reports its status",
		async (status) => {
			mocks.videos.set(
				VIDEO,
				video({
					transcriptionStatus: status,
					metadata: { aiGenerationStatus: "COMPLETE" },
				}),
			);
			const body = await results({ videoIds: [VIDEO] });
			expect(body.results).toEqual([
				{
					videoId: VIDEO,
					status: "skipped",
					reason: `transcription ${status}`,
					transcriptionStatus: status,
					aiGenerationStatus: "COMPLETE",
					durationSeconds: 125.5,
				},
			]);
			expect(mocks.transcribe).not.toHaveBeenCalled();
		},
	);

	it("skips missing videos and screenshots", async () => {
		mocks.videos.set(OTHER, video({ isScreenshot: true }));
		mocks.videos.delete(VIDEO);
		const body = await results({ videoIds: [VIDEO, OTHER] });
		expect(body.results).toMatchObject([
			{ videoId: VIDEO, status: "skipped", reason: "video not found" },
			{ videoId: OTHER, status: "skipped", reason: "screenshot" },
		]);
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it("reports what transcribeVideo decided when it does not start", async () => {
		mocks.videos.set(OTHER, video());
		mocks.transcribe.mockImplementation(async (videoId: string) =>
			videoId === VIDEO
				? {
						success: false,
						message: "Transcription is unavailable for this account",
					}
				: { success: true, message: "Video upload is still in progress" },
		);
		const body = await results({ videoIds: [VIDEO, OTHER] });
		expect(body.results).toMatchObject([
			{
				videoId: VIDEO,
				status: "failed",
				reason: "Transcription is unavailable for this account",
				transcriptionStatus: null,
			},
			{
				videoId: OTHER,
				status: "skipped",
				reason: "Video upload is still in progress",
				transcriptionStatus: null,
			},
		]);
	});

	it("fails only the video whose start throws", async () => {
		mocks.videos.set(OTHER, video({ ownerId: "owner-b" }));
		mocks.transcribe.mockImplementation(async (videoId: string) => {
			if (videoId === VIDEO) throw new Error("connection lost");
			return { success: true, message: "Transcription workflow started" };
		});
		const body = await results({ videoIds: [VIDEO, OTHER] });
		expect(body.results).toMatchObject([
			{ videoId: VIDEO, status: "failed", reason: "connection lost" },
			{ videoId: OTHER, status: "started" },
		]);
		expect(mocks.transcribe).toHaveBeenCalledWith(OTHER, "owner-b", false);
	});

	it("handles a repeated id once", async () => {
		const body = await results({ videoIds: [VIDEO, VIDEO] });
		expect(body.results).toHaveLength(1);
		expect(mocks.transcribe).toHaveBeenCalledTimes(1);
	});

	it("reports an unknown in-flight count instead of failing the batch", async () => {
		mocks.inFlight = new Error("count failed");
		const body = await results({ videoIds: [VIDEO] });
		expect(body.inFlight).toBeNull();
		expect(body.results).toMatchObject([{ status: "started" }]);
	});
});
