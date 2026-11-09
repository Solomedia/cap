// Railway only accepts BuildKit cache mounts whose id is `s/<service id>-<target>`,
// and rejects `# syntax=` directives (external Dockerfile frontends). Upstream's
// apps/web/Dockerfile has both, so Railway builds a generated copy
// (smg/web.Dockerfile) instead of us patching upstream's file.

export const CAP_WEB_SERVICE_ID = "3035d845-1a7e-43c5-8c15-c61db41ff384";

const HEADER = `# Generated from apps/web/Dockerfile for Railway: no syntax directive, Railway cache mount ids.
# Do not edit. Regenerate with: bun scripts/smg/railway-dockerfile.ts --write
`;

function railwayMount(options: string, serviceId: string): string {
	const parts = options.split(",").filter((part) => !part.startsWith("id="));
	const target = parts
		.find((part) => part.startsWith("target="))
		?.slice("target=".length);
	if (!target) throw new Error(`cache mount without a target: ${options}`);
	const rest = parts.filter((part) => part !== "type=cache");
	return ["type=cache", `id=s/${serviceId}-${target}`, ...rest].join(",");
}

export function railwayDockerfile(
	upstream: string,
	serviceId = CAP_WEB_SERVICE_ID,
): string {
	const body = upstream.replace(
		/--mount=(type=cache[^\s]*)/g,
		(_, options: string) => `--mount=${railwayMount(options, serviceId)}`,
	);
	const withoutSyntax = body.replace(/^# syntax=[^\n]*\n/, "");
	return `${HEADER}${withoutSyntax}`;
}
