const COMMAND = "bun run --cwd apps/web test";
const WEB_TEST = /^apps\/web\/(__tests__\/.+\.test\.ts)$/;

type Workflow = {
	jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>;
};

// Upstream's web test step lists files or a folder (`__tests__/unit` since
// 2026-11-13); either is passed through to vitest as is. On a sync PR every
// upstream change counts as "changed", including tests that are red on
// upstream's own main, so only upstream's list runs there.
export function webTestFiles(input: {
	ciYaml: string;
	changedFiles: string[];
	headRef?: string;
}): string[] {
	const workflow = Bun.YAML.parse(input.ciYaml) as Workflow;
	const step = Object.values(workflow.jobs ?? {})
		.flatMap((job) => job.steps ?? [])
		.find((s) => s.run?.includes(COMMAND));
	if (!step?.run) {
		throw new Error(`No step runs "${COMMAND}" in upstream ci.yml`);
	}
	const upstream = step.run
		.slice(step.run.indexOf(COMMAND) + COMMAND.length)
		.split(/\s+/)
		.filter((token) => token.startsWith("__tests__/"));
	if (upstream.length === 0) {
		throw new Error(`The "${COMMAND}" step lists no tests`);
	}
	const isSync = input.headRef?.startsWith("sync/upstream-") ?? false;
	const changed = (isSync ? [] : input.changedFiles).flatMap((file) => {
		const match = file.match(WEB_TEST);
		return match ? [match[1]] : [];
	});
	return [...new Set([...upstream, ...changed])];
}
