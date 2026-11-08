const WORKFLOWS_DIR = ".github/workflows/";

type Workflow = { id: number; path: string; state: string };

export function isSmgWorkflow(path: string): boolean {
	return (
		path.startsWith(WORKFLOWS_DIR) &&
		path.slice(WORKFLOWS_DIR.length).startsWith("smg-")
	);
}

// GitHub-managed "dynamic/..." workflows (Pages, Dependabot) are not upstream files: leave them alone.
export function workflowsToDisable(
	list: Workflow[],
): { id: number; path: string }[] {
	return list
		.filter(
			(w) =>
				w.state === "active" &&
				w.path.startsWith(WORKFLOWS_DIR) &&
				!isSmgWorkflow(w.path),
		)
		.map(({ id, path }) => ({ id, path }));
}

// Upstream workflows added by a push only show up in the API once GitHub has registered them.
export function missingWorkflows(
	expected: string[],
	listed: { path: string }[],
): string[] {
	const known = new Set(listed.map((w) => w.path));
	return expected.filter((path) => !isSmgWorkflow(path) && !known.has(path));
}
