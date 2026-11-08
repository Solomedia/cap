const STEP_NAME = "Test web React compatibility";
const COMMAND = "bun run --cwd apps/web test";
const WEB_TEST = /^apps\/web\/(__tests__\/.+\.test\.ts)$/;

type Workflow = {
	jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>;
};

export function webTestFiles(input: {
	ciYaml: string;
	changedFiles: string[];
}): string[] {
	const workflow = Bun.YAML.parse(input.ciYaml) as Workflow;
	const step = Object.values(workflow.jobs ?? {})
		.flatMap((job) => job.steps ?? [])
		.find((s) => s.name === STEP_NAME);
	if (!step?.run?.includes(COMMAND)) {
		throw new Error(
			`Step "${STEP_NAME}" with "${COMMAND}" not found in upstream ci.yml`,
		);
	}
	const upstream = step.run
		.slice(step.run.indexOf(COMMAND) + COMMAND.length)
		.split(/\s+/)
		.filter((token) => token.endsWith(".test.ts"));
	if (upstream.length === 0) {
		throw new Error(`Step "${STEP_NAME}" lists no test files`);
	}
	const changed = input.changedFiles.flatMap((file) => {
		const match = file.match(WEB_TEST);
		return match ? [match[1]] : [];
	});
	return [...new Set([...upstream, ...changed])];
}
