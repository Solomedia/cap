export type MirrorAction = "push" | "up-to-date" | "diverged";

const MIGRATIONS_PREFIX = "packages/database/migrations/";

export const LABELS = {
	sync: "upstream-sync",
	conflict: "upstream-conflict",
	migrations: "has-migrations",
} as const;

export const DIVERGED_ISSUE_TITLE = "main diverged from upstream";

// Keeps the PR body well under GitHub's 65,536-character limit.
const MAX_LISTED_COMMITS = 200;

export function mirrorAction(input: {
	originMain: string;
	upstreamMain: string;
	originIsAncestor: boolean;
}): MirrorAction {
	if (input.originMain === input.upstreamMain) return "up-to-date";
	return input.originIsAncestor ? "push" : "diverged";
}

export function hasMigrations(changedFiles: string[]): string[] {
	return changedFiles.filter((file) => file.startsWith(MIGRATIONS_PREFIX));
}

// One sync PR at a time: a red or pending one blocks the next, so nothing stacks.
export function shouldOpenSyncPr(input: {
	openConflictIssues: number;
	openSyncPrs: number;
}): boolean {
	return input.openConflictIssues === 0 && input.openSyncPrs === 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function syncBranchName(now: Date): string {
	const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
	return `sync/upstream-${date}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

function branchDate(branch: string): string {
	const match = branch.match(/(\d{4})(\d{2})(\d{2})-\d{4}$/);
	if (!match) throw new Error(`Not a sync branch name: ${branch}`);
	return `${match[1]}-${match[2]}-${match[3]}`;
}

export function buildSyncPr(input: {
	branch: string;
	commits: { sha: string; subject: string }[];
	migrations: string[];
}): { title: string; body: string; labels: string[]; autoMerge: boolean } {
	const count = input.commits.length;
	const hasSchemaChanges = input.migrations.length > 0;
	const lines = [
		`Merges ${count} upstream ${count === 1 ? "commit" : "commits"} from \`CapSoftware/Cap:main\` into \`smg\`.`,
		"",
	];
	if (hasSchemaChanges) {
		lines.push(
			"## Database migrations",
			"",
			"This sync adds migrations. They run when Cap Web starts, and rolling back the image does not roll back the schema, so it does not auto-merge.",
			"",
			...input.migrations.map((file) => `- \`${file}\``),
			"",
			"Read the migrations. Take a MySQL backup before merging, then merge by hand.",
			"",
		);
	}
	lines.push(
		"## Upstream commits",
		"",
		...input.commits
			.slice(0, MAX_LISTED_COMMITS)
			.map((c) => `- ${c.sha} ${c.subject}`),
	);
	if (count > MAX_LISTED_COMMITS) {
		lines.push(`- …and ${count - MAX_LISTED_COMMITS} more`);
	}
	return {
		title: `Sync upstream ${branchDate(input.branch)} (${count} ${count === 1 ? "commit" : "commits"})`,
		body: lines.join("\n"),
		labels: hasSchemaChanges ? [LABELS.sync, LABELS.migrations] : [LABELS.sync],
		autoMerge: !hasSchemaChanges,
	};
}

export function buildConflictIssue(input: {
	branch: string;
	conflicts: { file: string; smgCommits: string[] }[];
}): { title: string; body: string; labels: string[] } {
	const files = input.conflicts.flatMap(({ file, smgCommits }) => [
		`- \`${file}\``,
		...(smgCommits.length > 0
			? smgCommits.map((c) => `  - ${c}`)
			: ["  - no `smg` commit touched this file directly"]),
	]);
	return {
		title: `Upstream sync conflict (${branchDate(input.branch)})`,
		body: [
			"Merging `main` into `smg` conflicts. Daily syncs keep `main` current but open no sync PR until this issue is closed.",
			"",
			"## Conflicting files and the `smg` commits that touched them",
			"",
			...files,
			"",
			"## Resolve",
			"",
			"```bash",
			"git fetch origin",
			`git switch -c ${input.branch} origin/smg`,
			"git merge origin/main",
			"# resolve; when upstream merged one of our patches, keep upstream's version",
			`git push origin ${input.branch}`,
			"```",
			"",
			"Open a PR into `smg`, merge it with a merge commit, then close this issue.",
		].join("\n"),
		labels: [LABELS.conflict],
	};
}

export function buildDivergedIssue(input: { aheadCommits: string[] }): {
	title: string;
	body: string;
	labels: string[];
} {
	return {
		title: DIVERGED_ISSUE_TITLE,
		body: [
			"`main` must be an exact mirror of `CapSoftware/Cap:main`, but it has commits upstream does not. The sync stopped and did not touch `smg`.",
			"",
			"## Commits only on `Solomedia/cap:main`",
			"",
			...input.aheadCommits.map((c) => `- ${c}`),
			"",
			"Move these commits to a `feat/*` or `internal/*` branch, reset `main` to upstream (needs an owner, since force pushes are blocked), and close this issue.",
		].join("\n"),
		labels: [LABELS.conflict],
	};
}
