import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { disableInheritedWorkflows } from "./disable-workflows.ts";
import {
	buildConflictIssue,
	buildDivergedIssue,
	buildSyncPr,
	DIVERGED_ISSUE_TITLE,
	hasMigrations,
	LABELS,
	mirrorAction,
	shouldOpenSyncPr,
	syncBranchName,
} from "./lib/sync.ts";

const { values } = parseArgs({
	options: {
		repo: { type: "string" },
		"dry-run": { type: "boolean", default: false },
	},
});
const repo = values.repo;
if (!repo) {
	console.error(
		"Usage: bun scripts/smg/sync.ts --repo <owner/name> [--dry-run]",
	);
	process.exit(1);
}
// --dry-run reads everything and prints what it would do; it writes nothing to GitHub.
const dryRun = values["dry-run"] ?? false;
async function act(description: string, run: () => Promise<unknown>) {
	if (dryRun) {
		console.log(`[dry-run] would ${description}`);
		return;
	}
	await run();
}

const lines = (text: string) => text.split("\n").filter(Boolean);
const sha = async (ref: string) =>
	(await $`git rev-parse ${ref}`.text()).trim();

async function openIssue(issue: {
	title: string;
	body: string;
	labels: string[];
}) {
	await act(
		`open issue "${issue.title}"`,
		() =>
			$`gh issue create --repo ${repo} --title ${issue.title} --body ${issue.body} --label ${issue.labels.join(",")}`,
	);
}

async function ensureLabels() {
	const colors: Record<string, string> = {
		[LABELS.sync]: "0e8a16",
		[LABELS.conflict]: "d93f0b",
		[LABELS.migrations]: "fbca04",
	};
	for (const [name, color] of Object.entries(colors)) {
		await $`gh label create ${name} --repo ${repo} --color ${color} --force`.quiet();
	}
}

// Conflicts and a diverged main are reported as issues; forks start with issues off.
const { hasIssuesEnabled } =
	(await $`gh repo view ${repo} --json hasIssuesEnabled`.json()) as {
		hasIssuesEnabled: boolean;
	};
if (!hasIssuesEnabled) {
	const fix = `gh repo edit ${repo} --enable-issues`;
	if (!dryRun) {
		console.error(
			`Issues are disabled on ${repo}; the sync reports conflicts as issues. Run: ${fix}`,
		);
		process.exit(1);
	}
	console.log(
		`[dry-run] issues are disabled on ${repo}; a real run needs: ${fix}`,
	);
}
const listIssues = async (args: string[]) =>
	hasIssuesEnabled
		? ((await $`gh issue list --repo ${repo} --state open ${args} --json number`.json()) as unknown[])
		: [];

await act("create or update the sync labels", ensureLabels);

// 1. Keep main an exact mirror. A plain push can only fast-forward.
await $`git fetch origin main smg`.quiet();
await $`git fetch upstream main`.quiet();
const originMain = await sha("origin/main");
const upstreamMain = await sha("upstream/main");
const originIsAncestor =
	(
		await $`git merge-base --is-ancestor origin/main upstream/main`
			.nothrow()
			.quiet()
	).exitCode === 0;

const action = mirrorAction({ originMain, upstreamMain, originIsAncestor });
if (action === "diverged") {
	const open = await listIssues([
		"--search",
		`"${DIVERGED_ISSUE_TITLE}" in:title`,
	]);
	if (open.length === 0) {
		const aheadCommits = lines(
			await $`git log --format=${"%h %s"} upstream/main..origin/main`.text(),
		);
		await openIssue(buildDivergedIssue({ aheadCommits }));
	}
	console.log("main diverged from upstream; stopping without touching smg");
	process.exit(0);
}
const addedWorkflows = lines(
	await $`git diff --name-only --diff-filter=A origin/main upstream/main -- .github/workflows/`.text(),
);
if (action === "push") {
	await act(`fast-forward main to ${upstreamMain.slice(0, 7)}`, async () => {
		await $`git push origin upstream/main:refs/heads/main`;
		console.log(`main fast-forwarded to ${upstreamMain.slice(0, 7)}`);
	});
}

// 2. New upstream workflows arrive with the push: turn them off and cancel what they started.
await disableInheritedWorkflows({
	repo,
	dryRun,
	waitFor: dryRun ? [] : addedWorkflows,
});

// 3. Anything for smg to take? In a dry run main was not pushed, so compare with upstream.
if (!dryRun) await $`git fetch origin main`.quiet();
const mainRef = dryRun && action === "push" ? "upstream/main" : "origin/main";
const behind = Number(
	(await $`git rev-list --count ${`origin/smg..${mainRef}`}`.text()).trim(),
);
if (behind === 0) {
	console.log("smg already contains main");
	process.exit(0);
}

// 4. One sync at a time: an open sync PR (pending, red or held for migrations)
// or an open conflict issue blocks the next one.
const conflictIssues = await listIssues(["--label", LABELS.conflict]);
const syncPrs = (
	(await $`gh pr list --repo ${repo} --state open --base smg --json headRefName`.json()) as {
		headRefName: string;
	}[]
).filter((pr) => pr.headRefName.startsWith("sync/upstream-"));
if (
	!shouldOpenSyncPr({
		openConflictIssues: conflictIssues.length,
		openSyncPrs: syncPrs.length,
	})
) {
	console.log(
		`waiting: ${conflictIssues.length} open conflict issue(s), ${syncPrs.length} open sync PR(s)`,
	);
	process.exit(0);
}

const branch = syncBranchName(new Date());

// 5. Trial merge in a throwaway worktree, so a local run never touches your checkout.
const worktree = await mkdtemp(join(tmpdir(), "smg-sync-"));
await $`git worktree add --detach ${worktree} origin/smg`.quiet();
const trial = await $`git merge --no-commit --no-ff ${mainRef}`
	.cwd(worktree)
	.nothrow()
	.quiet();
const conflicted = lines(
	await $`git diff --name-only --diff-filter=U`.cwd(worktree).text(),
);
await $`git merge --abort`.cwd(worktree).nothrow().quiet();
await $`git worktree remove --force ${worktree}`.quiet();
if (trial.exitCode !== 0 || conflicted.length > 0) {
	const conflicts = [];
	for (const file of conflicted) {
		const smgCommits = lines(
			await $`git log --first-parent --format=${"%h %s"} ${`${mainRef}..origin/smg`} -- ${file}`.text(),
		);
		conflicts.push({ file, smgCommits });
	}
	await openIssue(buildConflictIssue({ branch, conflicts }));
	console.log(
		`conflict in ${conflicted.length} file(s); ${dryRun ? "a real run opens" : "opened"} an issue`,
	);
	process.exit(0);
}

// 6. Let GitHub write (and sign) the merge commit on a fresh branch.
const smgSha = await sha("origin/smg");
const date = branch
	.match(/(\d{4})(\d{2})(\d{2})/)
	?.slice(1)
	.join("-");
await act(`create ${branch} and merge main into it`, async () => {
	await $`gh api -X POST repos/${repo}/git/refs -f ref=${`refs/heads/${branch}`} -f sha=${smgSha}`.quiet();
	await $`gh api -X POST repos/${repo}/merges -f base=${branch} -f head=main -f commit_message=${`Merge upstream main into smg (${date})`}`.quiet();
});

// 7. Open the PR; auto-merge unless it carries migrations.
const migrations = hasMigrations(
	lines(await $`git diff --name-only ${`origin/smg...${mainRef}`}`.text()),
);
const commits = lines(
	await $`git log --no-merges --format=${"%h%x09%s"} ${`origin/smg..${mainRef}`}`.text(),
).map((line) => {
	const [commitSha, ...subject] = line.split("\t");
	return { sha: commitSha, subject: subject.join("\t") };
});
const pr = buildSyncPr({ branch, commits, migrations });
if (dryRun) {
	console.log(
		`[dry-run] would open PR "${pr.title}" with labels ${pr.labels.join(", ")}`,
	);
	console.log(
		`[dry-run] auto-merge: ${pr.autoMerge ? "yes" : "no (migrations)"}`,
	);
	if (migrations.length > 0)
		console.log(`[dry-run] migrations:\n${migrations.join("\n")}`);
	process.exit(0);
}
const url = (
	await $`gh pr create --repo ${repo} --base smg --head ${branch} --title ${pr.title} --body ${pr.body} --label ${pr.labels.join(",")}`.text()
).trim();
console.log(`opened ${url}`);
if (pr.autoMerge) {
	await $`gh pr merge ${url} --repo ${repo} --auto --merge`;
	console.log("auto-merge armed");
}

// The PR itself can start pull_request runs of upstream workflows; cancel them.
await disableInheritedWorkflows({ repo, dryRun: false, waitMs: 0 });
