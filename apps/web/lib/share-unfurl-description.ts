import { db } from "@cap/database";
import {
	organizations,
	spaces,
	spaceVideos,
	videos,
} from "@cap/database/schema";
import { resolveEffectiveVideoRules } from "@cap/web-backend";
import type { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";

// Twitter truncates card descriptions past 200 characters; other unfurlers
// show about the same.
const MAX_DESCRIPTION_LENGTH = 200;

/**
 * The AI summary as a link preview description, or null when the viewer
 * settings hide the summary or there is none.
 */
export const shareUnfurlDescription = ({
	summary,
	disableSummary,
}: {
	summary: unknown;
	disableSummary: boolean;
}): string | null => {
	if (disableSummary || typeof summary !== "string") return null;
	const text = summary.replace(/\s+/g, " ").trim();
	if (!text) return null;
	if (text.length <= MAX_DESCRIPTION_LENGTH) return text;

	const cut = text.slice(0, MAX_DESCRIPTION_LENGTH - 1);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
};

/**
 * Applies the same summary visibility as the share page: the video's
 * settings, then its organization's, and any space that turns it off.
 */
export const getShareUnfurlDescription = async (
	videoId: Video.VideoId,
	metadata: Record<string, unknown> | undefined,
): Promise<string | null> => {
	const summary = metadata?.summary;
	if (!shareUnfurlDescription({ summary, disableSummary: false })) return null;

	try {
		const [row] = await db()
			.select({
				videoSettings: videos.settings,
				organizationSettings: organizations.settings,
			})
			.from(videos)
			.innerJoin(organizations, eq(videos.orgId, organizations.id))
			.where(eq(videos.id, videoId))
			.limit(1);
		if (!row) return null;

		const spaceRows = await db()
			.select({ id: spaces.id, name: spaces.name, settings: spaces.settings })
			.from(spaceVideos)
			.innerJoin(spaces, eq(spaceVideos.spaceId, spaces.id))
			.where(eq(spaceVideos.videoId, videoId));

		const rules = resolveEffectiveVideoRules({
			videoSettings: row.videoSettings,
			organizationSettings: row.organizationSettings,
			spaces: spaceRows,
		});
		return shareUnfurlDescription({
			summary,
			disableSummary: rules.settings.disableSummary,
		});
	} catch (error) {
		console.warn("[share] Failed to resolve the unfurl description:", error);
		return null;
	}
};
