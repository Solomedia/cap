import { db } from "@cap/database";
import { videos } from "@cap/database/schema";
import { Video } from "@cap/web-domain";
import { and, count, eq, gte } from "drizzle-orm";
import { transcribeVideo } from "@/lib/transcribe";

const TRANSCRIPTION_STARTED_MESSAGE = "Transcription workflow started";

// A transcription claim stamps updatedAt when it flips the row to PROCESSING.
// Rows a deploy orphaned keep PROCESSING forever, so only recent claims count
// as in flight.
export const IN_FLIGHT_WINDOW_MS = 60 * 60 * 1000;

export type TranscriptBackfillOutcome = {
	videoId: string;
	status: "started" | "skipped" | "failed";
	reason?: string;
	transcriptionStatus: string | null;
	aiGenerationStatus: string | null;
	durationSeconds: number | null;
};

export async function backfillTranscript(
	videoId: string,
): Promise<TranscriptBackfillOutcome> {
	const id = Video.VideoId.make(videoId);
	const [video] = await db()
		.select({
			ownerId: videos.ownerId,
			isScreenshot: videos.isScreenshot,
			transcriptionStatus: videos.transcriptionStatus,
			duration: videos.duration,
			metadata: videos.metadata,
		})
		.from(videos)
		.where(eq(videos.id, id))
		.limit(1);

	if (!video)
		return {
			videoId,
			status: "skipped",
			reason: "video not found",
			transcriptionStatus: null,
			aiGenerationStatus: null,
			durationSeconds: null,
		};

	const current = {
		transcriptionStatus: video.transcriptionStatus ?? null,
		aiGenerationStatus: video.metadata?.aiGenerationStatus ?? null,
		durationSeconds: video.duration ?? null,
	};

	if (video.isScreenshot)
		return { videoId, status: "skipped", reason: "screenshot", ...current };

	if (current.transcriptionStatus)
		return {
			videoId,
			status: "skipped",
			reason: `transcription ${current.transcriptionStatus}`,
			...current,
		};

	const result = await transcribeVideo(id, video.ownerId, false);

	if (!result.success)
		return { videoId, status: "failed", reason: result.message, ...current };
	if (result.message !== TRANSCRIPTION_STARTED_MESSAGE)
		return { videoId, status: "skipped", reason: result.message, ...current };
	return {
		videoId,
		status: "started",
		...current,
		transcriptionStatus: "PROCESSING",
	};
}

export async function countTranscriptionsInFlight(now = new Date()) {
	const [row] = await db()
		.select({ total: count() })
		.from(videos)
		.where(
			and(
				eq(videos.isScreenshot, false),
				eq(videos.transcriptionStatus, "PROCESSING"),
				gte(videos.updatedAt, new Date(now.getTime() - IN_FLIGHT_WINDOW_MS)),
			),
		);
	return row?.total ?? 0;
}
