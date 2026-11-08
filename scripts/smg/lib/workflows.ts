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
