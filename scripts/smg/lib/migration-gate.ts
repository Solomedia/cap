import { hasMigrations } from "./sync.ts";

export const MIGRATIONS_APPROVED_LABEL = "migrations-approved";

// Migrations run on server start and an image rollback does not undo them, so
// any PR into smg that brings migrations (sync, feat/* or a conflict fix) waits for a human.
export function migrationGate(input: {
	changedFiles: string[];
	labels: string[];
}): {
	ok: boolean;
	message: string;
} {
	const migrations = hasMigrations(input.changedFiles);
	if (migrations.length === 0)
		return { ok: true, message: "No database migrations." };
	if (input.labels.includes(MIGRATIONS_APPROVED_LABEL)) {
		return {
			ok: true,
			message: `Migrations approved (${migrations.length} file(s)).`,
		};
	}
	return {
		ok: false,
		message: [
			"This PR brings database migrations into smg:",
			...migrations.map((file) => `- ${file}`),
			`Read them, take a MySQL backup, then add the \`${MIGRATIONS_APPROVED_LABEL}\` label to unblock this check.`,
		].join("\n"),
	};
}
