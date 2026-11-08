import { describe, expect, test } from "bun:test";
import {
	buildConflictIssue,
	buildDivergedIssue,
	buildSyncPr,
	hasMigrations,
	mirrorAction,
	shouldOpenSyncPr,
	syncBranchName,
} from "../lib/sync.ts";

describe("mirrorAction", () => {
	test("same sha is up to date", () => {
		expect(
			mirrorAction({
				originMain: "a",
				upstreamMain: "a",
				originIsAncestor: true,
			}),
		).toBe("up-to-date");
	});

	test("ancestor can be fast-forwarded with a push", () => {
		expect(
			mirrorAction({
				originMain: "a",
				upstreamMain: "b",
				originIsAncestor: true,
			}),
		).toBe("push");
	});

	test("non-ancestor means main diverged", () => {
		expect(
			mirrorAction({
				originMain: "a",
				upstreamMain: "b",
				originIsAncestor: false,
			}),
		).toBe("diverged");
	});
});

describe("hasMigrations", () => {
	test("returns only files under the migrations folder", () => {
		expect(
			hasMigrations([
				"apps/web/a.ts",
				"packages/database/migrations/0057_x.sql",
				"packages/database/migrations/meta/_journal.json",
				"packages/database/schema.ts",
			]),
		).toEqual([
			"packages/database/migrations/0057_x.sql",
			"packages/database/migrations/meta/_journal.json",
		]);
	});

	test("does not match a sibling folder with the same prefix", () => {
		expect(hasMigrations(["packages/database/migrationsX/a.sql"])).toEqual([]);
	});
});

describe("shouldOpenSyncPr", () => {
	test("opens when nothing is blocking", () => {
		expect(
			shouldOpenSyncPr({ openConflictIssues: 0, openMigrationSyncPrs: 0 }),
		).toBe(true);
	});

	test("waits while a conflict issue is open", () => {
		expect(
			shouldOpenSyncPr({ openConflictIssues: 1, openMigrationSyncPrs: 0 }),
		).toBe(false);
	});

	test("waits while a migration sync PR is open", () => {
		expect(
			shouldOpenSyncPr({ openConflictIssues: 0, openMigrationSyncPrs: 1 }),
		).toBe(false);
	});
});

describe("syncBranchName", () => {
	test("uses UTC date and minute", () => {
		expect(syncBranchName(new Date("2026-11-08T07:00:30Z"))).toBe(
			"sync/upstream-20261108-0700",
		);
	});
});

const commits = [
	{ sha: "aaa1111", subject: "fix(web): one" },
	{ sha: "bbb2222", subject: "feat(web): two" },
	{ sha: "ccc3333", subject: "chore: three" },
];

describe("buildSyncPr", () => {
	test("auto-merges a sync without migrations", () => {
		const pr = buildSyncPr({
			branch: "sync/upstream-20261108-0700",
			commits,
			migrations: [],
		});
		expect(pr.title).toBe("Sync upstream 2026-11-08 (3 commits)");
		expect(pr.labels).toEqual(["upstream-sync"]);
		expect(pr.autoMerge).toBe(true);
		for (const c of commits) expect(pr.body).toContain(`${c.sha} ${c.subject}`);
	});

	test("holds a sync with migrations for a human", () => {
		const pr = buildSyncPr({
			branch: "sync/upstream-20261108-0700",
			commits,
			migrations: ["packages/database/migrations/0057_x.sql"],
		});
		expect(pr.labels).toContain("has-migrations");
		expect(pr.labels).toContain("upstream-sync");
		expect(pr.autoMerge).toBe(false);
		expect(pr.body).toContain("packages/database/migrations/0057_x.sql");
		expect(pr.body).toContain("Take a MySQL backup before merging");
	});
});

describe("buildSyncPr with a large sync", () => {
	test("lists the first 200 commits and counts the rest", () => {
		const many = Array.from({ length: 250 }, (_, i) => ({
			sha: `s${i}`,
			subject: `c${i}`,
		}));
		const pr = buildSyncPr({
			branch: "sync/upstream-20261108-0700",
			commits: many,
			migrations: [],
		});
		expect(pr.title).toBe("Sync upstream 2026-11-08 (250 commits)");
		expect(pr.body).toContain("- s199 c199");
		expect(pr.body).not.toContain("- s200 c200");
		expect(pr.body).toContain("and 50 more");
	});
});

describe("buildConflictIssue", () => {
	test("lists each conflicting file with the smg commits that touched it", () => {
		const issue = buildConflictIssue({
			branch: "sync/upstream-20261108-0700",
			conflicts: [
				{
					file: "apps/web/a.ts",
					smgCommits: ["d1 Merge feat/a", "d2 Merge feat/b"],
				},
				{ file: "apps/web/b.ts", smgCommits: [] },
			],
		});
		expect(issue.labels).toEqual(["upstream-conflict"]);
		expect(issue.body).toContain("apps/web/a.ts");
		expect(issue.body).toContain("d1 Merge feat/a");
		expect(issue.body).toContain("d2 Merge feat/b");
		expect(issue.body).toContain("apps/web/b.ts");
		expect(issue.body).toContain("git merge origin/main");
		expect(issue.body).toContain("sync/upstream-20261108-0700");
	});
});

describe("buildDivergedIssue", () => {
	test("names the mirror problem and lists the extra commits", () => {
		const issue = buildDivergedIssue({ aheadCommits: ["e1 stray commit"] });
		expect(issue.title).toBe("main diverged from upstream");
		expect(issue.labels).toEqual(["upstream-conflict"]);
		expect(issue.body).toContain("e1 stray commit");
	});
});
