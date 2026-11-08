import { parseArgs } from "node:util";
import { $ } from "bun";
import { workflowsToDisable } from "./lib/workflows.ts";

type WorkflowsPage = {
	workflows: { id: number; path: string; state: string }[];
};

export async function disableInheritedWorkflows(input: {
	repo: string;
	dryRun: boolean;
}): Promise<{ disabled: string[]; cancelledRuns: number }> {
	const pages =
		(await $`gh api repos/${input.repo}/actions/workflows --paginate --slurp`.json()) as WorkflowsPage[];
	const targets = workflowsToDisable(pages.flatMap((page) => page.workflows));
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
