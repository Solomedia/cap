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

const { values } = parseArgs({ options: { repo: { type: "string" } } });
const repo = values.repo;
if (!repo) {
	console.error("Usage: bun scripts/smg/sync.ts --repo <owner/name>");
	process.exit(1);
}

const lines = (text: string) => text.split("\n").filter(Boolean);
const sha = async (ref: string) =>
	(await $`git rev-parse ${ref}`.text()).trim();

async function openIssue(issue: {
	title: string;
	body: string;
	labels: string[];
}) {
	await $`gh issue create --repo ${repo} --title ${issue.title} --body ${issue.body} --label ${issue.labels.join(",")}`;
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

await ensureLabels();

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
	const open =
		(await $`gh issue list --repo ${repo} --state open --search ${`"${DIVERGED_ISSUE_TITLE}" in:title`} --json number`.json()) as unknown[];
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
	await $`git push origin upstream/main:refs/heads/main`;
	console.log(`main fast-forwarded to ${upstreamMain.slice(0, 7)}`);
}

// 2. New upstream workflows arrive with the push: turn them off and cancel what they started.
await disableInheritedWorkflows({
	repo,
	dryRun: false,
	waitFor: addedWorkflows,
});

// 3. Anything for smg to take?
await $`git fetch origin main`.quiet();
const behind = Number(
	(await $`git rev-list --count origin/smg..origin/main`.text()).trim(),
);
if (behind === 0) {
	console.log("smg already contains main");
	process.exit(0);
}

// 4. One sync at a time: an open sync PR (pending, red or held for migrations)
// or an open conflict issue blocks the next one.
const conflictIssues =
	(await $`gh issue list --repo ${repo} --state open --label ${LABELS.conflict} --json number`.json()) as unknown[];
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

// 5. Trial merge locally to find conflicts before touching GitHub.
await $`git switch --detach origin/smg`.quiet();
const trial = await $`git merge --no-commit --no-ff origin/main`
	.nothrow()
	.quiet();
const conflicted = lines(await $`git diff --name-only --diff-filter=U`.text());
await $`git merge --abort`.nothrow().quiet();
if (trial.exitCode !== 0 || conflicted.length > 0) {
	const conflicts = [];
	for (const file of conflicted) {
		const smgCommits = lines(
			await $`git log --first-parent --format=${"%h %s"} origin/main..origin/smg -- ${file}`.text(),
		);
		conflicts.push({ file, smgCommits });
	}
	await openIssue(buildConflictIssue({ branch, conflicts }));
	console.log(`conflict in ${conflicted.length} file(s); opened an issue`);
	process.exit(0);
}

// 6. Let GitHub write (and sign) the merge commit on a fresh branch.
const smgSha = await sha("origin/smg");
await $`gh api -X POST repos/${repo}/git/refs -f ref=${`refs/heads/${branch}`} -f sha=${smgSha}`.quiet();
const date = branch
	.match(/(\d{4})(\d{2})(\d{2})/)
	?.slice(1)
	.join("-");
await $`gh api -X POST repos/${repo}/merges -f base=${branch} -f head=main -f commit_message=${`Merge upstream main into smg (${date})`}`.quiet();

// 7. Open the PR; auto-merge unless it carries migrations.
const migrations = hasMigrations(
	lines(await $`git diff --name-only origin/smg...origin/main`.text()),
);
const commits = lines(
	await $`git log --no-merges --format=${"%h%x09%s"} origin/smg..origin/main`.text(),
).map((line) => {
	const [commitSha, ...subject] = line.split("\t");
	return { sha: commitSha, subject: subject.join("\t") };
});
const pr = buildSyncPr({ branch, commits, migrations });
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
