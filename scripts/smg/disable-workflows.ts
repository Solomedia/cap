import { parseArgs } from "node:util";
import { $ } from "bun";
import { missingWorkflows, workflowsToDisable } from "./lib/workflows.ts";

type WorkflowsPage = {
	workflows: { id: number; path: string; state: string }[];
};

const listWorkflows = async (repo: string) =>
	(
		(await $`gh api repos/${repo}/actions/workflows --paginate --slurp`.json()) as WorkflowsPage[]
	).flatMap((page) => page.workflows);

// `waitFor`: workflow paths a push just added. GitHub registers them
// asynchronously, so poll until they are listed (or the wait runs out).
export async function disableInheritedWorkflows(input: {
	repo: string;
	dryRun: boolean;
	waitFor?: string[];
	waitMs?: number;
}): Promise<{ disabled: string[]; cancelledRuns: number }> {
	let workflows = await listWorkflows(input.repo);
	const deadline = Date.now() + (input.waitMs ?? 90_000);
	while (
		missingWorkflows(input.waitFor ?? [], workflows).length > 0 &&
		Date.now() < deadline
	) {
		await Bun.sleep(5_000);
		workflows = await listWorkflows(input.repo);
	}
	const stillMissing = missingWorkflows(input.waitFor ?? [], workflows);
	if (stillMissing.length > 0) {
		console.log(
			`not registered yet, next sync disables them: ${stillMissing.join(", ")}`,
		);
	}
	const targets = workflowsToDisable(workflows);
	const disabled: string[] = [];
	let cancelledRuns = 0;

	for (const workflow of targets) {
		if (input.dryRun) {
			console.log(`would disable ${workflow.path}`);
			continue;
		}
		await $`gh workflow disable ${workflow.id} --repo ${input.repo}`.quiet();
		disabled.push(workflow.path);
		console.log(`disabled ${workflow.path}`);

		for (const status of ["queued", "in_progress"]) {
			const runs =
				(await $`gh run list --repo ${input.repo} --workflow ${workflow.id} --status ${status} --json databaseId`.json()) as {
					databaseId: number;
				}[];
			for (const run of runs) {
				await $`gh run cancel ${run.databaseId} --repo ${input.repo}`
					.quiet()
					.nothrow();
				cancelledRuns++;
			}
		}
	}

	return { disabled, cancelledRuns };
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			repo: { type: "string" },
			"dry-run": { type: "boolean", default: false },
		},
	});
	if (!values.repo) {
		console.error(
			"Usage: bun scripts/smg/disable-workflows.ts --repo <owner/name> [--dry-run]",
		);
		process.exit(1);
	}
	const result = await disableInheritedWorkflows({
		repo: values.repo,
		dryRun: values["dry-run"] ?? false,
	});
	if (!values["dry-run"]) {
		console.log(
			`${result.disabled.length} disabled, ${result.cancelledRuns} runs cancelled`,
		);
	}
}
